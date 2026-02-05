// SPDX-License-Identifier: MIT
pragma solidity =0.8.27;

// solhint-disable no-empty-blocks

import {IPostDispatchHook} from "../external/hyperlane/interfaces/hooks/IPostDispatchHook.sol";

/**
 * @title NoOpHook
 * @notice A hyperlane post dispatch hook that does nothing
           no gas payments, just passes through
 */
contract NoOpHook is IPostDispatchHook {
    /// @inheritdoc IPostDispatchHook
    function hookType() external pure override returns (uint8) {
        return uint8(IPostDispatchHook.HookTypes.MERKLE_TREE);
    }

    /// @inheritdoc IPostDispatchHook
    function supportsMetadata(bytes calldata) external pure override returns (bool) {
        return true; // Accept any metadata
    }

    /// @inheritdoc IPostDispatchHook
    function postDispatch(
        bytes calldata /* metadata */,
        bytes calldata /* message */
    ) external payable override {
        // Do nothing - no gas payment, no merkle tree, nothing
    }

    /// @inheritdoc IPostDispatchHook
    function quoteDispatch(
        bytes calldata /* metadata */,
        bytes calldata /* message */
    ) external pure override returns (uint256) {
        return 0; // No fee required
    }
}
