// SPDX-License-Identifier: MIT
pragma solidity =0.8.27;

import {IBaseRouterImplementation} from "../../external/superform/core/interfaces/IBaseRouterImplementation.sol";
import {ISuperformFactory} from "../../external/superform/core/interfaces/ISuperformFactory.sol";
import {ISuperPositions} from "../../external/superform/core/interfaces/ISuperPositions.sol";

import {IERC1155Receiver} from "@openzeppelin/contracts/token/ERC1155/IERC1155Receiver.sol";

import {SuperformConfig} from "../libraries/LibSuperform.sol";

/**
 * @title ISuperformIntegration
 * @dev Interface for SuperformIntegrationFacet
 */
interface ISuperformIntegration is IERC1155Receiver {
    //============================================================================================//
    //                                          Events                                            //
    //============================================================================================//

    event MaxSlippageUpdated(uint256 oldMaxSlippage, uint256 newMaxSlippage);
    event SuperformFactoryUpdated(address oldFactory, address newFactory);
    event SuperformRouterUpdated(address oldRouter, address newRouter);
    event SuperPositionsUpdated(address oldSuperPositions, address newSuperPositions);

    event SuperformStrategyUpdated(address strategy, bool status, uint256 superformId);

    event SuperformSingleVaultDeposit(
        uint256 indexed superformId,
        uint256 assetAmount,
        address indexed receiver,
        address indexed receiverSP,
        uint256 superPositionsReceived
    );

    event SuperformSingleVaultWithdraw(
        uint256 indexed superformId,
        uint256 superPositionAmount,
        address indexed receiver,
        address indexed receiverSP,
        uint256 assetReceived
    );

    //============================================================================================//
    //                                          Errors                                            //
    //============================================================================================//

    error InvalidSuperformId(uint256 superformId);
    error NotFromSuperStrategy(address);
    error AERC20NotRegistered();

    //============================================================================================//
    //                                          Mutable                                           //
    //============================================================================================//

    /// @notice Deposits assets into a single vault
    /// @return superPositionReceived Amount of Superform positions minted
    function singleVaultDeposit(
        uint256 superformId_,
        uint256 assetAmount_,
        address receiver_,
        address receiverSP_
    ) external returns (uint256 superPositionReceived);

    /// @notice Withdraws assets from a single vault
    /// @return assetReceived Amount of assets withdrawn from the vault
    function singleVaultWithdraw(
        uint256 superformId_,
        uint256 superPositionAmount_,
        address receiver_,
        address receiverSP_
    ) external returns (uint256 assetReceived);

    /// @dev Use SuperPositions ERC1155A functionaliy to transmute token
    function transmuteToERC20(
        address owner,
        uint256 superformId,
        uint256 assetAmount,
        address receiver
    ) external;

    /// @dev Use SuperPositions ERC1155A functionaliy to transmute token
    function transmuteToERC1155A(
        address owner,
        uint256 superformId,
        uint256 superPositionAmount,
        address receiver
    ) external;

    /// @notice Initializes Superform storage with factory, router and positions
    /// @dev Can be called only once and only by the authorized manager
    function initializeStorage(SuperformConfig calldata config) external;

    /// @dev Updates the status of a Superform strategy
    /// @param strategy The address of the strategy to update
    /// @param status The new status of the strategy (true to enable, false to disable)
    /// @param superformId The superformId the strategy is authorized to use
    function updateSuperformStrategies(address strategy, bool status, uint256 superformId) external;

    /// @dev Sets the maximum slippage used in superform, where 10000 = 100%
    function setMaxSlippage(uint256 newMaxSlippage) external;

    //============================================================================================//
    //                                           View                                             //
    //============================================================================================//

    function superformStrategyAt(uint256 index) external view returns (address);

    function superformStrategiesLength() external view returns (uint256);

    function getMaxSlippage() external view returns (uint256);

    function superformFactory() external view returns (ISuperformFactory);

    function superformRouter() external view returns (IBaseRouterImplementation);

    function superPositions() external view returns (ISuperPositions);

    /// @notice Get the authorized superformId for a strategy
    function getAuthorizedSuperformId(address strategy) external view returns (uint256);

    /// @dev Using the underlying superform function with the same name
    function previewDepositTo(
        uint256 superformId,
        uint256 assetAmount
    ) external view returns (uint256);

    /// @dev Using the underlying superform function with the same name
    function previewWithdrawFrom(
        uint256 superformId,
        uint256 assetAmount
    ) external view returns (uint256);

    /// @dev Using the underlying superform function with the same name
    function previewRedeemFrom(
        uint256 superformId,
        uint256 superPositionAmount
    ) external view returns (uint256);

    /// @dev Returns the address of the ERC-20 token for a given Superform ID
    ///      Ensures the token is registered; reverts if not
    function aERC20Token(uint256 superformId) external view returns (address);
}
