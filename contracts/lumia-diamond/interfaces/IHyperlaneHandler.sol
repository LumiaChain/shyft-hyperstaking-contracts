// SPDX-License-Identifier: MIT
pragma solidity =0.8.27;

import {IMailbox} from "../../external/hyperlane/interfaces/IMailbox.sol";
import {IMessageRecipient} from "../../external/hyperlane/interfaces/IMessageRecipient.sol";
import {IPostDispatchHook} from "../../external/hyperlane/interfaces/hooks/IPostDispatchHook.sol";
import {
    IInterchainSecurityModule,
    ISpecifiesInterchainSecurityModule
} from "../../external/hyperlane/interfaces/IInterchainSecurityModule.sol";

import {RouteInfo, LastMessage} from "../libraries/LibInterchainFactory.sol";

/**
 * @title IHyperlaneHandler
 * @dev Interface for HyperlaneHandlerFacet
 */
interface IHyperlaneHandler is IMessageRecipient, ISpecifiesInterchainSecurityModule {
    //============================================================================================//
    //                                          Events                                            //
    //============================================================================================//

    event ReceivedMessage(
        uint32 indexed origin,
        bytes32 indexed sender,
        uint256 value,
        bytes message
    );

    event MailboxUpdated(address oldMailbox, address newMailbox);

    event HyperlaneISMUpdated(address ism);
    event HyperlaneHookUpdated(address hook);

    event AuthorizedOriginUpdated(
        address originLockbox,
        bool authorized,
        uint32 originDestination
    );

    event RouteRegistered(
        address indexed originLockbox,
        uint32 indexed originDestination,
        address strategy,
        address assetToken,
        address indexed vaultShares
    );

    //===========================================================================================//
    //                                          Errors                                            //
    //============================================================================================//

    error InvalidMailbox(address badMailbox);
    error OriginUpdateFailed();

    error UnsupportedMessage();

    error NotFromHyperStaking(address sender);

    error RouteAlreadyExist();

    //============================================================================================//
    //                                          Mutable                                           //
    //============================================================================================//

    /**
     * @notice Bridges a redeem request through hyperlane
     * @dev The `dispatchFee` must be collected from sender into this contract before calling
     */
    function bridgeStakeRedeem(
        address strategy,
        address user,
        uint256 redeemAmount,
        uint256 dispatchFee
    ) external;

    /**
     * @notice Collects required native dispatch fee into the diamond
     * @dev CurrencyHandler used in this function checks msg.value against
     *      required native amount and refunds any excess value back
     */
    function collectDispatchFee(
        address from,
        uint256 dispatchFee
    ) external payable;

    /**
     * @notice Updates the mailbox address used for interchain messaging
     * @param newMailbox The new mailbox address
     */
    function setMailbox(address newMailbox) external;

    /**
     * @notice Updates the authorization status of an origin Lockbox address
     * @param originLockbox The address of the origin Lockbox
     * @param authorized Whether the Lockbox should be authorized (true) or removed (false)
     * @param originDestination The destination chain Id associated with lockbox
     */
    function updateAuthorizedOrigin(
        address originLockbox,
        bool authorized,
        uint32 originDestination
    ) external;

    /**
     * @notice Sets ISM for this recipient
     * @dev May be zero for Mailbox default ISM
     */
    function setInterchainSecurityModule(IInterchainSecurityModule ism) external;

    /// @notice Sets the post-dispatch hook for outgoing cross-chain messages
    function setHook(address hook) external;

    //============================================================================================//
    //                                           View                                             //
    //============================================================================================//

    /// @notice Returns the mailbox saved in storage
    function mailbox() external view returns(IMailbox);

    /// @notice Returns the destination saved in storage
    function destination(address originLockbox) external view returns(uint32);

    /// @notice Returns the last message saved in storage
    function lastMessage() external view returns(LastMessage memory);

    /// @notice Returns detailed route information for a given strategy
    function getRouteInfo(address strategy) external view returns (RouteInfo memory);

    /**
     * @notice Returns the post dispatch hook
     * @dev Required by Hyperlane for relayer simulation and fee quoting
     *      Returning address(0) will cause the mailbox to use its default hook
     */
    function hook() external view returns (IPostDispatchHook);
}
