// SPDX-License-Identifier: MIT
pragma solidity =0.8.27;

// solhint-disable func-name-mixedcase

import {WithdrawClaim} from "../libraries/LibHyperStaking.sol";

/**
 * @title IDeposit
 * @dev Interface for DepositFacet
 */
interface IDeposit {
    //============================================================================================//
    //                                          Events                                            //
    //============================================================================================//

    event DepositRequest(
        address from,
        address indexed to,
        address indexed strategy,
        uint256 stake,
        uint256 requestId
    );

    event DepositRefund(
        address from,
        address indexed to,
        address indexed strategy,
        uint256 stake,
        uint256 requestId
    );

    event Deposit(
        address from,
        address indexed to,
        address indexed strategy,
        uint256 stake,
        uint256 requestId
    );

    event WithdrawClaimed(
        address indexed strategy,
        address indexed from,
        address to,
        uint256 stake,
        uint256 exitAmount,
        uint256 requestId
    );

    event FeeWithdrawClaimed(
        address indexed strategy,
        address indexed feeRecipient,
        address to,
        uint256 fee,
        uint256 exitAmount,
        uint256 requestId
    );

    event WithdrawQueued(
        address indexed strategy,
        address indexed to,
        uint64 unlockTime,
        uint256 expectedAmount,
        bool indexed feeWithdraw,
        uint256 requestId
    );

    event FeeLeaveRefunded(
        address indexed strategy,
        address indexed from,
        uint256 stake,
        uint256 allocationRefunded,
        uint256 requestId
    );

    event WithdrawRefunded(
        address indexed strategy,
        address indexed from,
        address to,
        uint256 stake,
        uint256 allocationRefunded,
        uint256 requestId
    );

    //============================================================================================//
    //                                          Errors                                            //
    //============================================================================================//

    /// @notice Thrown when attempting to stake zero amount
    error ZeroStake();

    /// @notice Thrown when an unexpected request type is used
    error BadRequestType();

    /// @notice Thrown when request is not ready to claim
    error RequestNotClaimable();

    /// @notice Thrown when attempting to stake to disabled strategy
    error StrategyDisabled(address strategy);

    /// @notice Thrown when attempting to deposit to a non-existent vault
    error VaultDoesNotExist(address strategy);

    /// @notice Thrown when trying to claim still locked stake
    error ClaimTooEarly(uint64 time, uint64 unlockTime);

    /// @notice Thrown when attempting to claim without providing any request IDs
    error EmptyClaim();

    /// @notice Thrown when attempting to claim to the zero address
    error ClaimToZeroAddress();

    /// @notice Thrown when a pending claim with the given ID does not exist
    error ClaimNotFound(uint256 id);

    /// @notice Thrown when the sender is not the eligible address for the claim
    error NotEligible(uint256 id, address eligible, address sender);

    //============================================================================================//
    //                                          Mutable                                           //
    //============================================================================================//

    /* ========== Deposit  ========== */

    /**
     * @notice Deposit (sync) or claim a previous async deposit request
     * @dev If `requestId` is 0, does a sync deposit. If non-zero, claims that request
     * @param strategy The address of the strategy selected by the user
     * @param to The address receiving the staked token allocation (typically the user's address)
     * @param stake The amount of the token to stake
     */
    function deposit(
        address strategy,
        address to,
        uint256 stake
    ) external payable returns (uint256 requestId, uint256 allocation);

    /**
     * @notice Create an async deposit request
     * @dev For async strategies only, stake is moved now, allocation is claimed later
     */
    function requestDeposit(
        address strategy,
        address to,
        uint256 stake
    ) external payable returns (uint256 requestId);

    /**
     * @notice Refund stake for a failed or canceled async request
     */
    function refundDeposit(
        address strategy,
        uint256 requestId,
        address to
    ) external returns (uint256 stake);

    /**
     * @notice Claims a completed async deposit request
     * @dev Reverts if the request is not claimable, already claimed, or has an unexpected type
     */
    function claimDeposit(
        address strategy,
        uint256 requestId
    ) external payable returns (uint256 allocation);

    /* ========== Stake Withdraw  ========== */

    /**
     * @notice Withdraws stake for the given requests
     * @dev Reverts if any of the requests are not currently claimable
     * @param requestIds IDs of withdrawal requests to claim
     * @param to Recipient address for the withdrawn stake
     */
    function claimWithdraws(uint256[] calldata requestIds, address to) external;

    /**
     * @notice Queues a stake withdrawal
     * @dev Called internally once the cross‑chain `StakeRedeem` message is verified
     *      It **does not** transfer tokens; it just records a pending withdrawal
     *      for the user that becomes available after `withdrawDelay`
     * @param strategy Strategy address that produced the request
     * @param user Address eligible to claim the withdrawal
     * @param stake The amount of stake to withdraw
     * @param allocation The amount of asset allocation in strategy
     * @param feeWithdraw True for protocol-fee withdrawals
     */
    function queueWithdraw(
        address strategy,
        address user,
        uint256 stake,
        uint256 allocation,
        bool feeWithdraw
    ) external;

    /// @notice Refund an async exit after it was queued (reverts the exit and restores allocation)
    /// @dev Uses the pending claim as the source of truth and bridges stake back to the Lumia diamond
    function refundWithdraw(
        uint256 requestId,
        address to
    ) external payable returns (uint256 allocationRefunded);

    /* ========== */

    /// @notice Pauses stake functionalities
    function pauseDeposit() external;

    /// @notice Resumes stake functionalities
    function unpauseDeposit() external;

    //============================================================================================//
    //                                           View                                             //
    //============================================================================================//

    /// @notice Returns claims for given requestIds; chooses fee/user mapping by flag
    function pendingWithdrawClaims(uint256[] calldata requestIds)
        external
        view
        returns (WithdrawClaim[] memory claims);

    /// @notice Returns up to `limit` most recent claim IDs for a strategy and user
    /// @dev Newest IDs first
    function lastClaims(address strategy, address user, uint256 limit)
        external
        view
        returns (uint256[] memory ids);

    /* ========== */

    /// @notice Helper to easily quote the dispatch fee for stake deposit
    function quoteDepositDispatch(
        address strategy,
        address to,
        uint256 stake
    ) external view returns (uint256);
}
