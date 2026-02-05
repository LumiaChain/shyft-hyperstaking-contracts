// SPDX-License-Identifier: MIT
pragma solidity =0.8.27;

import {HyperStakingAcl} from "../../HyperStakingAcl.sol";
import {IRouteRegistry} from "../../interfaces/IRouteRegistry.sol";

import {TypeCasts} from "../../../external/hyperlane/libs/TypeCasts.sol";
import {
    RouteRegistryData,
    HyperlaneMailboxMessages
} from "../../../shared/libraries/HyperlaneMailboxMessages.sol";

import {LibHyperStaking, LockboxData} from "../../libraries/LibHyperStaking.sol";

/**
 * @title RouteRegistry
 * @notice Handles message routes for registering new strategies on the Lumia chain (Hyperlane messaging)
 */
contract RouteRegistry is IRouteRegistry, HyperStakingAcl {
    //============================================================================================//
    //                                      Public Functions                                      //
    //============================================================================================//

    /// @inheritdoc IRouteRegistry
    function routeRegistryDispatch(
        RouteRegistryData memory data
    ) external payable diamondInternal {
        LockboxData storage box = LibHyperStaking.diamondStorage().lockboxData;
        require(box.lumiaFactory != address(0), RecipientUnset());
        require(box.destination != 0, DestinationUnset());

        bytes memory body = generateRouteRegistryBody(data);

        // address left-padded to bytes32 for compatibility with hyperlane
        bytes32 recipientBytes32 = TypeCasts.addressToBytes32(box.lumiaFactory);

        // metadata used by the post dispatch hook
        bytes memory metadata = "";

        // msg.value should already include fee calculated
        box.mailbox.dispatch{value: msg.value}(
            box.destination,
            recipientBytes32,
            body,
            metadata,
            box.postDispatchHook
        );

        emit RouteRegistryDispatched(
            address(box.mailbox),
            box.lumiaFactory,
            data.nonce,
            data.strategy,
            data.name,
            data.symbol,
            data.decimals
        );
    }

    // ========= View ========= //

    /// @inheritdoc IRouteRegistry
    function quoteDispatchRouteRegistry(
        RouteRegistryData memory data
    ) external view returns (uint256) {
        LockboxData storage box = LibHyperStaking.diamondStorage().lockboxData;
        return box.mailbox.quoteDispatch(
            box.destination,
            TypeCasts.addressToBytes32(box.lumiaFactory),
            generateRouteRegistryBody(data),
            "", // metadata
            box.postDispatchHook
        );
    }

    /// @inheritdoc IRouteRegistry
    function generateRouteRegistryBody(
        RouteRegistryData memory data
    ) public pure returns (bytes memory body) {
        body = HyperlaneMailboxMessages.serializeRouteRegistry(data);
    }
}
