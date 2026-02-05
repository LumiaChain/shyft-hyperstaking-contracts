// SPDX-License-Identifier: MIT
pragma solidity =0.8.27;

import {ISuperformIntegration} from "../../interfaces/ISuperformIntegration.sol";
import {HyperStakingAcl} from "../../HyperStakingAcl.sol";

import {SuperformConfig, LibSuperform, SuperformStorage} from "../../libraries/LibSuperform.sol";

import {IERC20, SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {EnumerableSet} from "@openzeppelin/contracts/utils/structs/EnumerableSet.sol";

import {IBaseRouterImplementation} from "../../../external/superform/core/interfaces/IBaseRouterImplementation.sol";
import {ISuperformFactory} from "../../../external/superform/core/interfaces/ISuperformFactory.sol";
import {ISuperPositions} from "../../../external/superform/core/interfaces/ISuperPositions.sol";
import {IBaseForm} from "../../../external/superform/core/interfaces/IBaseForm.sol";

import {
    SingleDirectSingleVaultStateReq, SingleVaultSFData, LiqRequest
} from "../../../external/superform/core/types/DataTypes.sol";
import {DataLib} from "../../../external/superform/core/libraries/DataLib.sol";

import * as Errors from "../../../shared/Errors.sol";

/**
 * @title SuperformIntegration
 * @dev Integration with Superform, providing deposits and withdrawals from single vaults
 */
contract SuperformIntegrationFacet is ISuperformIntegration, HyperStakingAcl {
    using EnumerableSet for EnumerableSet.AddressSet;
    using SafeERC20 for IERC20;
    using DataLib for uint256;

    /**
     * @dev Internal struct combining data needed to generate Superform route request
     * @param superformId ID of the Superform entity involved in the operation
     * @param amount Amount involved in the operation
     * @param outputAmount Expected output from the operation
     * @param asset Address of the asset used
     * @param receiver Address receiving the operation result
     * @param receiverSP Address for SuperPositions, if applicable
     */
    struct RequestData {
        uint256 superformId;
        uint256 amount;
        uint256 outputAmount;
        address asset;
        address receiver;
        address receiverSP;
    }

    //============================================================================================//
    //                                         Modifiers                                          //
    //============================================================================================//

    /// @notice Only accept messages from superform strategies
    modifier onlySuperStrategy() {
        SuperformStorage storage s = LibSuperform.diamondStorage();

        require(s.superformStrategies.contains(msg.sender), NotFromSuperStrategy(msg.sender));
        _;
    }

    /// @notice Requires storage to be initialized
    modifier requireStorageInitialized() {
        LibSuperform.requireInitialized();
        _;
    }

    //============================================================================================//
    //                                      Public Functions                                      //
    //============================================================================================//

    /* ========== Strategy ========== */

    /// @inheritdoc ISuperformIntegration
    function singleVaultDeposit(
        uint256 superformId,
        uint256 assetAmount,
        address receiver,
        address receiverSP
    ) external onlySuperStrategy requireStorageInitialized returns (uint256 superPositionReceived) {
        // verify strategy is authorized for this superformId
        LibSuperform.requireAuthorizedSuperformId(msg.sender, superformId);

        SuperformStorage storage s = LibSuperform.diamondStorage();

        require(s.superformFactory.isSuperform(superformId), InvalidSuperformId(superformId));
        require(receiver != address(0), Errors.ZeroAddress());
        require(receiverSP != address(0), Errors.ZeroAddress());
        require(assetAmount > 0, Errors.ZeroAmount());

        uint256 superPositionsBefore = s.superPositions.balanceOf(receiverSP, superformId);

        IBaseForm superform = _getSuperform(superformId);

        address asset = superform.getVaultAsset();

        // use superform function similar to ERC4626, to determine output amount
        uint256 outputAmount = superform.previewDepositTo(assetAmount);

        IERC20(asset).safeIncreaseAllowance(address(s.superformRouter), assetAmount);

        RequestData memory reqData = RequestData({
            superformId: superformId,
            amount: assetAmount,
            outputAmount: outputAmount,
            asset: asset,
            receiver: receiver,
            receiverSP: receiverSP
        });

        s.superformRouter.singleDirectSingleVaultDeposit(
            _generateReq(reqData)
        );

        superPositionReceived =
            s.superPositions.balanceOf(receiverSP, superformId) - superPositionsBefore;

        emit SuperformSingleVaultDeposit(
            superformId,
            assetAmount,
            receiver,
            receiverSP,
            superPositionReceived
        );
    }

    /// @inheritdoc ISuperformIntegration
    function singleVaultWithdraw(
        uint256 superformId,
        uint256 superPositionAmount,
        address receiver,
        address receiverSP
    ) external onlySuperStrategy requireStorageInitialized returns (uint256 assetReceived) {
        // verify strategy is authorized for this superformId
        LibSuperform.requireAuthorizedSuperformId(msg.sender, superformId);

        SuperformStorage storage s = LibSuperform.diamondStorage();

        require(s.superformFactory.isSuperform(superformId), InvalidSuperformId(superformId));
        require(receiver != address(0), Errors.ZeroAddress());
        require(receiverSP != address(0), Errors.ZeroAddress());
        require(superPositionAmount > 0, Errors.ZeroAmount());

        IBaseForm superform = _getSuperform(superformId);

        address asset = superform.getVaultAsset();

        // use superform function similar to ERC4626, to determine output amount
        uint256 outputAmount = superform.previewRedeemFrom(superPositionAmount);

        uint256 assetBefore = IERC20(asset).balanceOf(receiverSP);

        // approve superPosition for router
        s.superPositions.setApprovalForOne(
            address(s.superformRouter),
            superformId,
            superPositionAmount
        );

        RequestData memory reqData = RequestData({
            superformId: superformId,
            amount: superPositionAmount,
            outputAmount: outputAmount,
            asset: asset,
            receiver: receiver,
            receiverSP: receiverSP
        });

        s.superformRouter.singleDirectSingleVaultWithdraw(
            _generateReq(reqData)
        );

        assetReceived = IERC20(asset).balanceOf(receiverSP) - assetBefore;

        emit SuperformSingleVaultWithdraw(
            superformId,
            superPositionAmount,
            receiver,
            receiverSP,
            assetReceived
        );
    }

    /// @inheritdoc ISuperformIntegration
    function transmuteToERC20(
        address owner,
        uint256 superformId,
        uint256 assetAmount,
        address receiver
    ) external onlySuperStrategy requireStorageInitialized {
        LibSuperform.requireAuthorizedSuperformId(msg.sender, superformId);

        LibSuperform.diamondStorage().superPositions.transmuteToERC20(
            owner, superformId, assetAmount, receiver
        );
    }

    /// @inheritdoc ISuperformIntegration
    function transmuteToERC1155A(
        address owner,
        uint256 superformId,
        uint256 superPositionAmount,
        address receiver
    ) external onlySuperStrategy requireStorageInitialized {
        LibSuperform.requireAuthorizedSuperformId(msg.sender, superformId);

        LibSuperform.diamondStorage().superPositions.transmuteToERC1155A(
            owner, superformId, superPositionAmount, receiver
        );
    }

    /* ========== Strategy Manager  ========== */

    /// @inheritdoc ISuperformIntegration
    function initializeStorage(SuperformConfig calldata config) external onlyStrategyManager {
        LibSuperform.init(config);
    }

    /// @inheritdoc ISuperformIntegration
    function updateSuperformStrategies(
        address strategy,
        bool status,
        uint256 superformId
    ) external onlyStrategyManager requireStorageInitialized {
        SuperformStorage storage s = LibSuperform.diamondStorage();

        // EnumerableSet returns a boolean indicating success
        if (status) {
            require(s.superformFactory.isSuperform(superformId), InvalidSuperformId(superformId));
            require(s.superformStrategies.add(strategy), Errors.UpdateFailed());
            LibSuperform.setAuthorizedSuperformId(strategy, superformId);

            emit SuperformStrategyUpdated(strategy, status, superformId);
        } else {
            require(s.superformStrategies.remove(strategy), Errors.UpdateFailed());
            LibSuperform.setAuthorizedSuperformId(strategy, 0);

            emit SuperformStrategyUpdated(strategy, status, 0);
        }
    }

    /// @inheritdoc ISuperformIntegration
    function setMaxSlippage(
        uint256 newMaxSlippage
    ) external onlyStrategyManager requireStorageInitialized {
        require(newMaxSlippage > 0, "Max slippage must be greater than 0");

        SuperformStorage storage s = LibSuperform.diamondStorage();
        emit MaxSlippageUpdated(s.maxSlippage, newMaxSlippage);

        s.maxSlippage = newMaxSlippage;
    }

    // ========= View ========= //

    function superformStrategyAt(uint256 index) external view returns (address) {
        return LibSuperform.diamondStorage().superformStrategies.at(index);
    }

    function superformStrategiesLength() external view returns (uint256) {
        return LibSuperform.diamondStorage().superformStrategies.length();
    }

    function getMaxSlippage() external view returns (uint256) {
        return LibSuperform.diamondStorage().maxSlippage;
    }

    function superformFactory() external view returns (ISuperformFactory) {
        return LibSuperform.diamondStorage().superformFactory;
    }

    function superformRouter() external view returns (IBaseRouterImplementation) {
        return LibSuperform.diamondStorage().superformRouter;
    }

    function superPositions() external view returns (ISuperPositions) {
        return LibSuperform.diamondStorage().superPositions;
    }

    /// @inheritdoc ISuperformIntegration
    function getAuthorizedSuperformId(address strategy) external view returns (uint256) {
        return LibSuperform.getAuthorizedSuperformId(strategy);
    }

    /// @inheritdoc ISuperformIntegration
    function previewDepositTo(
        uint256 superformId,
        uint256 assetAmount
    ) external view returns (uint256) {
        IBaseForm superform = _getSuperform(superformId);
        return superform.previewDepositTo(assetAmount);
    }

    /// @inheritdoc ISuperformIntegration
    function previewWithdrawFrom(
        uint256 superformId,
        uint256 assetAmount
    ) external view returns (uint256) {
        IBaseForm superform = _getSuperform(superformId);
        return superform.previewWithdrawFrom(assetAmount);
    }

    /// @inheritdoc ISuperformIntegration
    function previewRedeemFrom(
        uint256 superformId,
        uint256 superPositionAmount
    ) external view returns (uint256) {
        IBaseForm superform = _getSuperform(superformId);
        return superform.previewRedeemFrom(superPositionAmount);
    }

    /// @inheritdoc ISuperformIntegration
    function aERC20Token(uint256 superformId) public view returns (address) {
        SuperformStorage storage s = LibSuperform.diamondStorage();

        address token = s.superPositions.getERC20TokenAddress(superformId);
        require(token != address(0), AERC20NotRegistered());

        return token;
    }

    function onERC1155Received(
        address,
        address,
        uint256,
        uint256,
        bytes calldata
    )
        external
        pure
        override
        returns (bytes4)
    {
        return this.onERC1155Received.selector;
    }

    function onERC1155BatchReceived(
        address,
        address,
        uint256[] calldata,
        uint256[] calldata,
        bytes calldata
    )
        external
        pure
        override
        returns (bytes4)
    {
        return this.onERC1155BatchReceived.selector;
    }

    //============================================================================================//
    //                                     Internal Functions                                     //
    //============================================================================================//

    /**
     * @dev Constructs a request for single vault operations,
     *      a `SingleDirectSingleVaultStateReq` struct
     * @param reqData Internal struct used to generate Superform request
     */
    function _generateReq(
        RequestData memory reqData
    ) internal view returns (SingleDirectSingleVaultStateReq memory req) {
        SuperformStorage storage s = LibSuperform.diamondStorage();

        req = SingleDirectSingleVaultStateReq ({
            superformData: SingleVaultSFData({
                superformId: reqData.superformId,
                amount: reqData.amount,
                outputAmount: reqData.outputAmount,
                maxSlippage: s.maxSlippage,
                liqRequest: LiqRequest({
                    txData: bytes(""),
                    token: reqData.asset,
                    interimToken: address(0),
                    bridgeId: 1,
                    liqDstChainId: 0,
                    nativeAmount: 0
                }),
                permit2data: bytes(""),
                hasDstSwap: false,
                retain4626: false,
                receiverAddress: reqData.receiver,
                receiverAddressSP: reqData.receiverSP,
                extraFormData: bytes("")
            })
        });
    }

    /// @dev Extracts the IBaseForm instance from a superformId
    function _getSuperform(uint256 superformId) internal pure returns (IBaseForm) {
        (address superformAddress,,) = superformId.getSuperform();
        return IBaseForm(superformAddress);
    }
}
