// SPDX-License-Identifier: MIT
pragma solidity =0.8.27;

import {LumiaDiamondAcl} from "../LumiaDiamondAcl.sol";
import {IStakeRedeemRoute} from "../interfaces/IStakeRedeemRoute.sol";

import {TypeCasts} from "../../external/hyperlane/libs/TypeCasts.sol";

import {
    HyperlaneMailboxMessages, StakeRedeemData
} from "../../shared/libraries/HyperlaneMailboxMessages.sol";

import {
    LibInterchainFactory, InterchainFactoryStorage, RouteInfo
} from "../libraries/LibInterchainFactory.sol";

/**
 * @title StakeRedeemRoute
 * @notice Route message implementation for redeeming stake (Hyperlane integration)
 */
contract StakeRedeemRoute is IStakeRedeemRoute, LumiaDiamondAcl {

    //============================================================================================//
    //                                      Public Functions                                      //
    //============================================================================================//

    /// @inheritdoc IStakeRedeemRoute
    function stakeRedeemDispatch(
        StakeRedeemData memory data
    ) external payable diamondInternal {
        InterchainFactoryStorage storage ifs = LibInterchainFactory.diamondStorage();
        RouteInfo storage r = ifs.routes[data.strategy];
        require(r.originLockbox != address(0), RecipientUnset());
        require(r.originDestination != 0, DestinationUnset());

        bytes memory body = generateStakeRedeemBody(data);

        // address left-padded to bytes32 for compatibility with hyperlane
        bytes32 recipientBytes32 = TypeCasts.addressToBytes32(r.originLockbox);

        // metadata used by the post dispatch hook
        bytes memory metadata = "";

        // msg.value should already include fee calculated
        ifs.mailbox.dispatch{value: msg.value}(
            r.originDestination,
            recipientBytes32,
            body,
            metadata,
            ifs.postDispatchHook
        );

        emit StakeRedeemDispatched(
            address(ifs.mailbox),
            r.originLockbox,
            data.nonce,
            data.strategy,
            data.user,
            data.redeemAmount
        );
    }

    // ========= View ========= //

    /// @inheritdoc IStakeRedeemRoute
    function generateStakeRedeemBody(
        StakeRedeemData memory data
    ) public pure returns (bytes memory body) {
        body = HyperlaneMailboxMessages.serializeStakeRedeem(data);
    }

    /// @inheritdoc IStakeRedeemRoute
    function quoteDispatchStakeRedeem(
        StakeRedeemData memory data
    ) external view returns (uint256) {
        InterchainFactoryStorage storage ifs = LibInterchainFactory.diamondStorage();
        RouteInfo storage r = ifs.routes[data.strategy];

        return ifs.mailbox.quoteDispatch(
            r.originDestination,
            TypeCasts.addressToBytes32(r.originLockbox),
            generateStakeRedeemBody(data),
            "", // metadata
            ifs.postDispatchHook
        );
    }
}
