// SPDX-License-Identifier: MIT
pragma solidity =0.8.27;

import {HyperStakingAcl} from "../../HyperStakingAcl.sol";
import {IStakeRewardRoute} from "../../interfaces/IStakeRewardRoute.sol";

import {TypeCasts} from "../../../external/hyperlane/libs/TypeCasts.sol";
import {
    StakeRewardData,
    HyperlaneMailboxMessages
} from "../../../shared/libraries/HyperlaneMailboxMessages.sol";

import {LibHyperStaking, LockboxData} from "../../libraries/LibHyperStaking.sol";

/**
 * @title StakeRewardRoute
 * @notice Route implementation for staking info message (Lockbox-Hyperlane integration)
 */
contract StakeRewardRoute is IStakeRewardRoute, HyperStakingAcl {

    //============================================================================================//
    //                                      Public Functions                                      //
    //============================================================================================//

    /// @inheritdoc IStakeRewardRoute
    function stakeRewardDispatch(
        StakeRewardData memory data
    ) external payable diamondInternal {
        LockboxData storage box = LibHyperStaking.diamondStorage().lockboxData;
        require(box.lumiaFactory != address(0), RecipientUnset());
        require(box.destination != 0, DestinationUnset());

        bytes memory body = generateStakeRewardBody(data);

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

        emit StakeRewardDispatched(
            address(box.mailbox),
            box.lumiaFactory,
            data.nonce,
            data.strategy,
            data.stakeAdded
        );
    }

    // ========= View ========= //

    /// @inheritdoc IStakeRewardRoute
    function quoteDispatchStakeReward(
        StakeRewardData memory data
    ) external view returns (uint256) {
        LockboxData storage box = LibHyperStaking.diamondStorage().lockboxData;
        return box.mailbox.quoteDispatch(
            box.destination,
            TypeCasts.addressToBytes32(box.lumiaFactory),
            generateStakeRewardBody(data),
            "", // metadata
            box.postDispatchHook
        );
    }

    /// @inheritdoc IStakeRewardRoute
    function generateStakeRewardBody(
        StakeRewardData memory data
    ) public pure returns (bytes memory body) {
        body = HyperlaneMailboxMessages.serializeStakeReward(data);
    }
}
