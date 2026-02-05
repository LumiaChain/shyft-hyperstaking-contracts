// SPDX-License-Identifier: MIT
pragma solidity =0.8.27;

import {IAllocation} from "../interfaces/IAllocation.sol";
import {IDeposit} from "../interfaces/IDeposit.sol";
import {IStrategy} from "../interfaces/IStrategy.sol";
import {ILockbox} from "../interfaces/ILockbox.sol";
import {IStakeRewardRoute} from "../interfaces/IStakeRewardRoute.sol";
import {HyperStakingAcl} from "../HyperStakingAcl.sol";

import {
    ReentrancyGuardUpgradeable
} from "@openzeppelin/contracts-upgradeable/utils/ReentrancyGuardUpgradeable.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {IERC20Metadata} from "@openzeppelin/contracts/token/ERC20/extensions/IERC20Metadata.sol";
import {Math} from "@openzeppelin/contracts/utils/math/Math.sol";

import {
    LibHyperStaking, HyperStakingStorage, VaultInfo, StakeInfo
} from "../libraries/LibHyperStaking.sol";
import {StakeRewardData} from "../../shared/libraries/HyperlaneMailboxMessages.sol";

import {Currency, CurrencyHandler} from "../../shared/libraries/CurrencyHandler.sol";
import {LibHyperlaneReplayGuard} from "../../shared/libraries/LibHyperlaneReplayGuard.sol";
import {ZeroStakeExit, ZeroAllocationExit, RewardDonationZeroSupply } from "../../shared/Errors.sol";

/**
 * @title AllocationFacet
 * @notice Facet responsible for entering and exiting strategy positions
 *
 * @dev This contract is a facet of Diamond Proxy
 */
contract AllocationFacet is IAllocation, HyperStakingAcl, ReentrancyGuardUpgradeable {
    using SafeERC20 for IERC20Metadata;
    using CurrencyHandler for Currency;
    using Math for uint256;

    //============================================================================================//
    //                                      Public Functions                                      //
    //============================================================================================//

    /// @inheritdoc IAllocation
    function joinSync(
        address strategy,
        address user,
        uint256 stake
    ) external payable diamondInternal returns (uint256 requestId, uint256 allocation) {
        uint64 readyAt;
        (requestId, readyAt) = _requestAllocation(strategy, user, stake);
        require(readyAt == 0, NotSyncFlow());

        // make an array
        uint256[] memory ids = new uint256[](1);
        ids[0] = requestId;

        // sync flow: request and claim in the same tx
        allocation = _claimAllocation(strategy, ids);

        // bridge stakeInfo message to the Lumia diamond
        ILockbox(address(this)).bridgeStakeInfo(strategy, user, stake);

        emit Join(strategy, user, stake, allocation, requestId);
    }

    /// @inheritdoc IAllocation
    function joinAsync(
        address strategy,
        address user,
        uint256 stake
    ) external payable diamondInternal returns (uint256 requestId) {
        uint64 readyAt;
        (requestId, readyAt) = _requestAllocation(strategy, user, stake);

        require(readyAt != 0, NotAsyncFlow());

        // async flow: only create request, allocation will be claimed later

        emit JoinRequested(strategy, user, stake, requestId, readyAt);
    }

    /// @inheritdoc IAllocation
    function refundJoinAsync(
        address strategy,
        uint256 requestId,
        address user,
        address to
    ) external diamondInternal returns (uint256 stake) {
        // make an array
        uint256[] memory ids = new uint256[](1);
        ids[0] = requestId;

        stake = IStrategy(strategy).refundAllocation(ids, to);

        emit JoinRefunded(strategy, user, stake, requestId, to);
    }

    /// @inheritdoc IAllocation
    function claimJoinAsync(
        address strategy,
        uint256 requestId,
        address user,
        uint256 stake
    ) external diamondInternal returns (uint256 allocation) {
        // make an array
        uint256[] memory ids = new uint256[](1);
        ids[0] = requestId;

        // async flow: just claim
        allocation = _claimAllocation(strategy, ids);

        // bridge stakeInfo message to the Lumia diamond
        ILockbox(address(this)).bridgeStakeInfo(strategy, user, stake);

        emit Join(strategy, user, stake, allocation, requestId);
    }

    /// @inheritdoc IAllocation
    function leave(
        address strategy,
        address user,
        uint256 stake
    ) public diamondInternal nonReentrant returns (uint256 allocation) {
        return _leave(strategy, user, stake, false);
    }

    // ========= Vault Manager ========= //

    /// @inheritdoc IAllocation
    function report(
        address strategy
    ) external payable onlyVaultManager nonReentrant {
        HyperStakingStorage storage v = LibHyperStaking.diamondStorage();
        VaultInfo storage vault = v.vaultInfo[strategy];
        StakeInfo storage si = v.stakeInfo[strategy];

        address feeRecipient = vault.feeRecipient;
        require(feeRecipient != address(0), FeeRecipientUnset());

        // prevent reward distribution when no shares exist in the vault
        require(si.totalStake > 0, RewardDonationZeroSupply());

        uint256 revenue = checkRevenue(strategy);
        require(revenue > 0, InsufficientRevenue());

        uint256 feeAmount = _calculateFee(vault.feeRate, revenue);
        uint256 feeAllocation;

        if (feeAmount > 0) {
            feeAllocation = _leave(strategy, feeRecipient, feeAmount, true);
        }

        uint256 stakeAdded = revenue - feeAmount;

        // increase total stake value
        si.totalStake += stakeAdded;

        // quote message fee for forwarding a StakeReward message across chains
        uint256 dispatchFee = quoteReport(strategy);
        ILockbox(address(this)).collectDispatchFee{value: msg.value}(msg.sender, dispatchFee);

        // bridge StakeReward message
        ILockbox(address(this)).bridgeStakeReward(strategy, stakeAdded);

        emit StakeCompounded(
            strategy,
            feeRecipient,
            vault.feeRate,
            feeAmount,
            feeAllocation,
            stakeAdded
        );
    }

    /// @inheritdoc IAllocation
    function setBridgeSafetyMargin(address strategy, uint256 newMargin) external onlyVaultManager {
        require(newMargin < LibHyperStaking.PERCENT_PRECISION, SafetyMarginTooHigh());
        HyperStakingStorage storage v = LibHyperStaking.diamondStorage();
        VaultInfo storage vault = v.vaultInfo[strategy];

        uint256 oldMargin = vault.bridgeSafetyMargin;
        vault.bridgeSafetyMargin = newMargin;

        emit BridgeSafetyMarginUpdated(strategy, oldMargin, newMargin);
    }

    /// @inheritdoc IAllocation
    function setFeeRecipient(address strategy, address newRecipient) external onlyVaultManager {
        require(newRecipient != address(0), ZeroFeeRecipient());

        HyperStakingStorage storage v = LibHyperStaking.diamondStorage();
        VaultInfo storage vault = v.vaultInfo[strategy];

        address oldRecipient = vault.feeRecipient;
        vault.feeRecipient = newRecipient;

        emit FeeRecipientUpdated(strategy, oldRecipient, newRecipient);
    }

    /// @inheritdoc IAllocation
    function setFeeRate(address strategy, uint256 newRate) external onlyVaultManager {
        require(newRate <= LibHyperStaking.MAX_FEE_RATE, FeeRateTooHigh());

        HyperStakingStorage storage v = LibHyperStaking.diamondStorage();
        VaultInfo storage vault = v.vaultInfo[strategy];

        uint256 oldRate = vault.feeRate;
        vault.feeRate = newRate;

        emit FeeRateUpdated(strategy, oldRate, newRate);
    }

    // ========= View ========= //

    /// @inheritdoc IAllocation
    function stakeInfo(address strategy) external view returns (StakeInfo memory) {
        HyperStakingStorage storage v = LibHyperStaking.diamondStorage();
        return v.stakeInfo[strategy];
    }

    /// @inheritdoc IAllocation
    function checkRevenue(address strategy) public view returns (uint256) {
        HyperStakingStorage storage v = LibHyperStaking.diamondStorage();

        VaultInfo storage vault = v.vaultInfo[strategy];
        StakeInfo storage si = v.stakeInfo[strategy];

        // calculate total possible stake withdraw
        uint256 stake = IStrategy(strategy).previewExit(si.totalAllocation);

        // total stake that needs to be preserved for potential user bridge-outs
        uint256 bridgeCollateral = si.totalStake;

        // add safety margin to protect users from strategy asset volatility
        uint256 marginAmount = (
            bridgeCollateral * vault.bridgeSafetyMargin
        ) / LibHyperStaking.PERCENT_PRECISION;

        // check for negative revenue
        if (bridgeCollateral + marginAmount > stake) {
            return 0;
        }

        return stake - (bridgeCollateral + marginAmount);
    }

    /// @inheritdoc IAllocation
    function quoteReport(address strategy) public view returns (uint256) {
        VaultInfo storage vault = LibHyperStaking.diamondStorage().vaultInfo[strategy];

        uint256 revenue = checkRevenue(strategy);
        uint256 feeAmount = _calculateFee(vault.feeRate, revenue);
        uint256 stakeAdded = revenue - feeAmount;

        StakeRewardData memory data = StakeRewardData({
            nonce: LibHyperlaneReplayGuard.previewNonce(),
            strategy: strategy,
            stakeAdded: stakeAdded
        });
        return IStakeRewardRoute(address(this)).quoteDispatchStakeReward(data);
    }

    //============================================================================================//
    //                                     Internal Functions                                     //
    //============================================================================================//

    /// @dev leave actual implementation - without diamondInternal & nonReentrant
    function _leave(
        address strategy,
        address user,
        uint256 stake,
        bool feeWithdraw
    ) internal returns (uint256 allocation) {
        HyperStakingStorage storage v = LibHyperStaking.diamondStorage();
        VaultInfo storage vault = v.vaultInfo[strategy];
        StakeInfo storage si = v.stakeInfo[strategy];

        // what we would like to exit to cover 'stake' at current price/slippage
        // previewAllocation rounds up to the nearest whole share, which can result in an allocation
        // that is one unit higher than the actual available shares. To ensure the requested exit stake
        uint256 need = IStrategy(strategy).previewAllocation(stake);

        // stake still available to queue (excludes already-queued exits)
        uint256 availableStake = si.totalStake - si.pendingExitStake;

        uint256 capUnits;
        // guard, div by zero, if everything is already queued
        if (availableStake > 0) {
            capUnits = si.totalAllocation.mulDiv(stake, availableStake);
        }

        // enforces proportional exits under loss
        allocation = need <= capUnits ? need : capUnits;

        // edge-case: prevent zero shares exit
        require(allocation > 0, ZeroAllocationExit());

        // edge-case: check if exit will result in zero assets
        require(IStrategy(strategy).previewExit(allocation) > 0, ZeroStakeExit());

        // save stake information
        si.totalAllocation -= allocation;

        if (feeWithdraw) {
            si.pendingExitFee += stake;
        } else {
            si.pendingExitStake += stake;
        }

        // integrated strategy does not require allowance
        if (!IStrategy(strategy).isIntegratedStakeStrategy()) {
            vault.revenueAsset.safeIncreaseAllowance(strategy, allocation);
        }

        IDeposit(address(this)).queueWithdraw(strategy, user, stake, allocation, feeWithdraw);

        emit Leave(strategy, user, stake, allocation);
    }

    /// @dev Creates an allocation request in the strategy and returns requestId and readyAt
    function _requestAllocation(
        address strategy,
        address user,
        uint256 stake
    ) internal returns (uint256 requestId, uint64 readyAt) {
        HyperStakingStorage storage v = LibHyperStaking.diamondStorage();
        VaultInfo storage vault = v.vaultInfo[strategy];

        requestId = LibHyperStaking.newRequestId();

        // IntegrationFacet handles movements (no msg.value, no allowance)
        if (IStrategy(strategy).isIntegratedStakeStrategy()) {
            readyAt = IStrategy(strategy).requestAllocation(requestId, stake, user);
        } else {
            if (vault.stakeCurrency.isNativeCoin()) {
                readyAt = IStrategy(strategy).requestAllocation{value: stake}(requestId, stake, user);
            } else {
                vault.stakeCurrency.increaseAllowance(strategy, stake);
                readyAt = IStrategy(strategy).requestAllocation(requestId, stake, user);
            }
        }
    }

    /// @dev Claims allocation for given request ids and updates totalAllocation
    function _claimAllocation(
        address strategy,
        uint256[] memory requestIds
    ) internal returns (uint256 allocation) {
        HyperStakingStorage storage v = LibHyperStaking.diamondStorage();
        StakeInfo storage si = v.stakeInfo[strategy];

        allocation = IStrategy(strategy).claimAllocation(requestIds, address(this));

        // save information
        si.totalAllocation += allocation;
    }

    /// @notice Calculates fee based on feeRate and revenue
    function _calculateFee(uint256 feeRate, uint256 revenue) internal pure returns (uint256) {
        return feeRate * revenue / LibHyperStaking.PERCENT_PRECISION;
    }
}
