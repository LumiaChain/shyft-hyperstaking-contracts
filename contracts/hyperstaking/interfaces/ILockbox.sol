// SPDX-License-Identifier: MIT
pragma solidity =0.8.27;

import {IMessageRecipient} from "../../external/hyperlane/interfaces/IMessageRecipient.sol";
import {IPostDispatchHook} from "../../external/hyperlane/interfaces/hooks/IPostDispatchHook.sol";
import {
    IInterchainSecurityModule,
    ISpecifiesInterchainSecurityModule
} from "../../external/hyperlane/interfaces/IInterchainSecurityModule.sol";

import {LockboxData, FailedRedeem} from "../libraries/LibHyperStaking.sol";

/**
 * @title ILockbox
 * @dev Interface for LockboxFacet
 */
interface ILockbox is IMessageRecipient, ISpecifiesInterchainSecurityModule {
    //============================================================================================//
    //                                          Events                                            //
    //============================================================================================//

    event ReceivedMessage(
        uint32 indexed origin,
        bytes32 indexed sender,
        uint256 value,
        bytes message
    );

    event DestinationUpdated(uint32 indexed oldDestination, uint32 indexed newDestination);

    event MailboxUpdated(address indexed oldMailbox, address indexed newMailbox);
    event MailboxChangeProposed(address newMailbox, uint256 applyAfter);

    event LumiaFactoryUpdated(address indexed oldLumiaFactory, address indexed newLumiaFactory);
    event LumiaFactoryChangeProposed(address newLumiaFactory, uint256 applyAfter);

    event HyperlaneISMUpdated(address ism);
    event HyperlaneHookUpdated(address hook);

    event StakeRedeemFailed(address indexed strategy, address indexed user, uint256 amount, uint256 id);
    event StakeRedeemReexecuted(
        address indexed strategy,
        address indexed user,
        uint256 amount,
        uint256 id
    );

    //===========================================================================================//
    //                                          Errors                                            //
    //============================================================================================//

    error InvalidVaultToken(address badVaultToken);
    error InvalidMailbox(address badMailbox);
    error InvalidLumiaFactory(address badLumiaFactory);

    error PendingChangeFailed(address, uint256 applyAfter);

    error NotFromMailbox(address from);
    error NotFromLumiaFactory(address sender);
    error BadLumiaDestination(uint32 lumiaDestination);

    error UnsupportedMessage();

    //============================================================================================//
    //                                          Mutable                                           //
    //============================================================================================//

    /// @notice Helper function which locks assets and initiates bridge data transfer
    /// @dev Through StakeInfo route
    function bridgeStakeInfo(
        address strategy,
        address user,
        uint256 stake
    ) external;

    /// @notice Helper function which inform about stake added after report-compounding
    /// @dev Through StakeReward route
    function bridgeStakeReward(
        address strategy,
        uint256 stakeAdded
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
     * @notice Re-executes a previously failed stake redeem operation
     * @param id The ID of the failed redeem to reattempt
     */
    function reexecuteFailedRedeem(uint256 id) external;

    /**
     * @notice Updates the destination chain ID for the route
     * @param destination The new destination chain ID
     */
    function setDestination(uint32 destination) external;

    /**
     * @notice Proposes a new mailbox address with delayed application
     * @param mailbox The new mailbox contract address
     */
    function proposeMailbox(address mailbox) external;

    /// @notice Applies the proposed mailbox address after the delay
    function applyMailbox() external;

    /**
     * @notice Proposes a new lumia factory address with delayed application
     * @param lumiaFactory The new factory address
     */
    function proposeLumiaFactory(address lumiaFactory) external;

    /// @notice Applies the proposed lumia factory address after the delay
    function applyLumiaFactory() external;

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

    /// @notice Returns Lockbox data, including mailbox address, destination, and recipient address
    function lockboxData() external view returns (LockboxData memory);

    /**
     * @notice Returns the post dispatch hook
     * @dev Required by Hyperlane for relayer simulation and fee quoting
     *      Returning address(0) will cause the mailbox to use its default hook
     */
    function hook() external view returns (IPostDispatchHook);

    /// @notice Returns the total number of failed redeem attempts (counter)
    function getFailedRedeemCount() external view returns (uint256);

    /**
     * @notice Returns failed redeem records by their IDs
     * @param ids The list of failed redeem IDs to fetch
     */
    function getFailedRedeems(uint256[] calldata ids)
        external
        view
        returns (FailedRedeem[] memory);

    /// @notice Returns list of failed redeem IDs associated with a given user
    function getUserFailedRedeemIds(address user) external view returns (uint256[] memory);
}
