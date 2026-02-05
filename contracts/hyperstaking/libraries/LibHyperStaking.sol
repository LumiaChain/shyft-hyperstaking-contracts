// SPDX-License-Identifier: MIT
pragma solidity =0.8.27;

// solhint-disable var-name-mixedcase

import {IMailbox} from "../../external/hyperlane/interfaces/IMailbox.sol";
import {IPostDispatchHook} from "../../external/hyperlane/interfaces/hooks/IPostDispatchHook.sol";
import {IInterchainSecurityModule} from "../../external/hyperlane/interfaces/IInterchainSecurityModule.sol";

import {IERC20Metadata} from "@openzeppelin/contracts/token/ERC20/extensions/IERC20Metadata.sol";
import {EnumerableSet} from "@openzeppelin/contracts/utils/structs/EnumerableSet.sol";

import {Currency} from "../../shared/libraries/CurrencyHandler.sol";

//================================================================================================//
//                                            Types                                               //
//================================================================================================//

/// General Vault details
/// @param enabled Determines whether deposits to the strategy are enabled or disabled
/// @param strategy Address of the strategy contract
/// @param stakeCurrency Currency used for staking
/// @param revenueAsset ERC-20 yield token used in the vault
/// @param feeRecipient Address that receives the protocol’s fees
/// @param feeRate Fee percentage, scaled by 1e18 (1e18 = 100%)
/// @param bridgeSafetyMargin Safety buffer, scaled by 1e18, applied during revenue harvesting
struct VaultInfo {
    bool enabled;
    address strategy;
    Currency stakeCurrency;
    IERC20Metadata revenueAsset;
    address feeRecipient;
    uint256 feeRate;
    uint256 bridgeSafetyMargin;
}

/// Tracks aggregate staking and allocation state on the origin chain
/// defining the asset side of the ERC4626 vault on the Lumia chain
struct StakeInfo {
    uint256 totalStake;
    uint256 totalAllocation;
    uint256 pendingDepositStake; // stake moved but allocation not claimed yet
    uint256 pendingExitStake; // stake already queued to leave, not yet claimed
    uint256 pendingExitFee; // fee queued to leave
}

// @param strategy That produced this claim
// @param unlockTime Timestamp when claim becomes withdrawable
// @param eligible Address allowed to execute the claim
// @param expectedAmount The amount of stake expected to be withdrawn in this claim
// @param feeWithdraw Whether protocol-fee claims (true) or user claims (false)
struct WithdrawClaim {
    address strategy;
    uint64 unlockTime;
    address eligible;
    uint256 expectedAmount;
    bool feeWithdraw;
}

struct HyperlaneMessage {
    address sender;
    bytes data;
}

struct LockboxData {
    IMailbox mailbox; /// Hyperlane Mailbox
    IInterchainSecurityModule ism; // May be zero if default ISM is used
    IPostDispatchHook postDispatchHook; // May be zero, required by post dispatch relay process
    uint32 destination; /// ChainID - route destination
    address lumiaFactory; /// Destinaion contract which will be receiving messages
    HyperlaneMessage lastMessage; /// Information about last mailbox message received
}

struct PendingMailbox {
    address newMailbox;
    uint256 applyAfter;
}

struct PendingLumiaFactory {
    address newFactory;
    uint256 applyAfter;
}

struct FailedRedeem {
    address strategy;
    address user;
    uint256 amount;
}

struct FailedRedeemData {
    uint256 failedRedeemCount;
    mapping(uint256 => FailedRedeem) failedRedeems;
    mapping(address => EnumerableSet.UintSet) userToFailedIds;
}

//================================================================================================//
//                                           Storage                                              //
//================================================================================================//

struct HyperStakingStorage {
    /// @notice Info of each vault
    mapping (address strategy => VaultInfo) vaultInfo;

    /// @notice Info about staking into the vaults
    mapping (address strategy => StakeInfo) stakeInfo;

    /// @notice Next request ID for strategy operations
    uint256 nextRequestId;

    /// @notice Pending claims by requestId
    mapping(uint256 requestId => WithdrawClaim) pendingWithdrawClaims;

    /// @notice Pending request IDs by strategy and user, includes both deposit and withdraw requests
    mapping(address strategy => mapping(address user => uint256[])) groupedRequestIds;

    /// @notice General lockbox data
    LockboxData lockboxData;
    uint256[12] __gap_lockboxData;

    /// @notice Pending lockbox mailbox update
    PendingMailbox pendingMailbox;

    /// @notice Pending lockbox lumia factory update
    PendingLumiaFactory pendingLumiaFactory;

    /// @notice Records failed redeem attempts for later re-execution
    FailedRedeemData failedRedeems;
    uint256[8] __gap_failedRedeems;
}

library LibHyperStaking {
    bytes32 constant internal HYPERSTAKING_STORAGE_POSITION
        = bytes32(uint256(keccak256("hyperstaking-0.1.storage")) - 1);

    // 1e18 as a scaling factor, e.g. for allocation, percent, e.g. 0.1 ETH (1e17) == 10%
    uint256 constant internal PERCENT_PRECISION = 1e18; // represent 100%
    uint256 constant internal MAX_FEE_RATE = 2e17; // 20%

    uint256 constant internal PENDING_CHANGE_DELAY = 1 days;

    /// @dev Generates the next request ID
    function newRequestId() internal returns (uint256 id) {
        HyperStakingStorage storage s = diamondStorage();
        unchecked { id = ++s.nextRequestId; } // starts at 0, first id will be 1
    }

    function diamondStorage() internal pure returns (HyperStakingStorage storage s) {
        bytes32 position = HYPERSTAKING_STORAGE_POSITION;
        assembly {
            s.slot := position
        }
    }
}
