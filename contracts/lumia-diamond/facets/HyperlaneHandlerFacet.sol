// SPDX-License-Identifier: MIT
pragma solidity =0.8.27;

import {IHyperlaneHandler} from "../interfaces/IHyperlaneHandler.sol";
import {IRealAssets} from "../interfaces/IRealAssets.sol";
import {IStakeRedeemRoute} from "../interfaces/IStakeRedeemRoute.sol";
import {LumiaDiamondAcl} from "../LumiaDiamondAcl.sol";
import {LumiaPrincipal} from "../tokens/LumiaPrincipal.sol";
import {LumiaVaultShares} from "../tokens/LumiaVaultShares.sol";

import {IERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";

import {ILumiaVaultShares} from "../interfaces/ILumiaVaultShares.sol";

import {IMailbox} from "../../external/hyperlane/interfaces/IMailbox.sol";
import {IInterchainSecurityModule} from "../../external/hyperlane/interfaces/IInterchainSecurityModule.sol";
import {IPostDispatchHook} from "../../external/hyperlane/interfaces/hooks/IPostDispatchHook.sol";
import {TypeCasts} from "../../external/hyperlane/libs/TypeCasts.sol";

import {
    LibInterchainFactory, InterchainFactoryStorage, RouteInfo, LastMessage, EnumerableSet
} from "../libraries/LibInterchainFactory.sol";

import {
    MessageType, HyperlaneMailboxMessages, StakeRedeemData
} from "../../shared/libraries/HyperlaneMailboxMessages.sol";

import {Currency, CurrencyHandler} from "../../shared/libraries/CurrencyHandler.sol";
import {LibHyperlaneReplayGuard} from "../../shared/libraries/LibHyperlaneReplayGuard.sol";
import {BadOriginDestination, DispatchUnderpaid, InvalidHook, InvalidIsm} from "../../shared/Errors.sol";

/**
 * @title HyperlaneHandlerFacet
 * @notice Handles interchain messaging via Hyperlane for LP token operations
 */
contract HyperlaneHandlerFacet is IHyperlaneHandler, LumiaDiamondAcl {
    using EnumerableSet for EnumerableSet.AddressSet;
    using CurrencyHandler for Currency;
    using HyperlaneMailboxMessages for bytes;

    //============================================================================================//
    //                                      Public Functions                                      //
    //============================================================================================//

    /// @dev implements hyperlane IMessageRecipient
    function handle(
        uint32 origin,
        bytes32 sender,
        bytes calldata data
    ) external payable onlyMailbox {
        // parse sender
        address originLockbox = TypeCasts.bytes32ToAddress(sender);
        InterchainFactoryStorage storage ifs = LibInterchainFactory.diamondStorage();

        // checks
        require(ifs.authorizedOrigins.contains(originLockbox),
            NotFromHyperStaking(originLockbox)
        );
        require(origin == ifs.destinations[originLockbox], BadOriginDestination(origin));

        // additional replay protection
        LibHyperlaneReplayGuard.requireNotProcessedData(origin, sender, data);

        // save lastMessage in the storage
        ifs.lastMessage = LastMessage({
            sender: originLockbox,
            data: data
        });

        // emit event before route
        emit ReceivedMessage(origin, sender, msg.value, data);

        // parse message type (HyperlaneMailboxMessages)
        MessageType msgType = data.messageType();

        // route message
        if (msgType == MessageType.RouteRegistry) {
            _handleRouteRegistry(originLockbox, origin, data);
            return;
        }

        if (msgType == MessageType.StakeInfo) {
            IRealAssets(address(this)).mint(data);
            return;
        }

        if (msgType == MessageType.StakeReward) {
            IRealAssets(address(this)).stakeReward(data);
            return;
        }

        revert UnsupportedMessage();
    }

    /// @inheritdoc IHyperlaneHandler
    function bridgeStakeRedeem(
        address strategy,
        address user,
        uint256 redeemAmount,
        uint256 dispatchFee
    ) external diamondInternal {
        StakeRedeemData memory data = StakeRedeemData({
            nonce: LibHyperlaneReplayGuard.newNonce(),
            strategy: strategy,
            user: user,
            redeemAmount: redeemAmount
        });
        IStakeRedeemRoute(address(this)).stakeRedeemDispatch{value: dispatchFee}(data);
    }

    /// @inheritdoc IHyperlaneHandler
    function collectDispatchFee(
        address from,
        uint256 dispatchFee
    ) external payable diamondInternal {
        if (dispatchFee == 0) return;

        if (msg.value < dispatchFee) {
            revert DispatchUnderpaid();
        }

        Currency memory nativeCurrency = Currency({
            token: address(0)
        });

        // required native fee value from msg.sender into this (diamond)
        nativeCurrency.transferFrom(
            from,
            address(this),
            dispatchFee
        );
    }

    // ========= Restricted ========= //

    /// @inheritdoc IHyperlaneHandler
    function setMailbox(address newMailbox) external onlyLumiaFactoryManager {
        require(
            newMailbox != address(0) && newMailbox.code.length > 0,
            InvalidMailbox(newMailbox)
        );

        InterchainFactoryStorage storage ifs = LibInterchainFactory.diamondStorage();

        emit MailboxUpdated(address(ifs.mailbox), newMailbox);
        ifs.mailbox = IMailbox(newMailbox);
    }

    /// @inheritdoc IHyperlaneHandler
    function updateAuthorizedOrigin(
        address originLockbox,
        bool authorized,
        uint32 originDestination
    ) external onlyLumiaFactoryManager {
        InterchainFactoryStorage storage ifs = LibInterchainFactory.diamondStorage();
        require(originLockbox != address(0), OriginUpdateFailed());

        if (authorized) {
            // EnumerableSet returns a boolean indicating success
            require(ifs.authorizedOrigins.add(originLockbox), OriginUpdateFailed());
            ifs.destinations[originLockbox] = originDestination;
        } else {
            require(ifs.authorizedOrigins.remove(originLockbox), OriginUpdateFailed());
            delete ifs.destinations[originLockbox];
        }

        emit AuthorizedOriginUpdated(originLockbox, authorized, originDestination);
    }

    /// @inheritdoc IHyperlaneHandler
    function setInterchainSecurityModule(IInterchainSecurityModule ism) external onlyLumiaFactoryManager {
        require(
            address(ism) == address(0) || address(ism).code.length > 0,
            InvalidIsm(address(ism))
        );
        LibInterchainFactory.diamondStorage().ism = ism;
        emit HyperlaneISMUpdated(address(ism));
    }

    /// @inheritdoc IHyperlaneHandler
    function setHook(address postDispatchHook) external onlyLumiaFactoryManager {
        require(
            postDispatchHook == address(0) || postDispatchHook.code.length > 0,
            InvalidHook(postDispatchHook)
        );

        LibInterchainFactory.diamondStorage().postDispatchHook = IPostDispatchHook(postDispatchHook);
        emit HyperlaneHookUpdated(postDispatchHook);
    }

    // ========= View ========= //

    /// @inheritdoc IHyperlaneHandler
    function mailbox() external view returns(IMailbox) {
        return LibInterchainFactory.diamondStorage().mailbox;
    }

    /// @notice Called by Mailbox.recipientIsm() to determine which ISM to use
    /// @dev implements hyperlane ISpecifiesInterchainSecurityModule
    function interchainSecurityModule() external view returns (IInterchainSecurityModule) {
        return LibInterchainFactory.diamondStorage().ism;
    }

    /// @inheritdoc IHyperlaneHandler
    function hook() external view returns (IPostDispatchHook) {
        return LibInterchainFactory.diamondStorage().postDispatchHook;
    }

    /// @inheritdoc IHyperlaneHandler
    function destination(address originLockbox) external view returns(uint32) {
        return LibInterchainFactory.diamondStorage().destinations[originLockbox];
    }

    /// @inheritdoc IHyperlaneHandler
    function lastMessage() external view returns(LastMessage memory) {
        return LibInterchainFactory.diamondStorage().lastMessage;
    }

    /// @inheritdoc IHyperlaneHandler
    function getRouteInfo(address strategy) external view returns (RouteInfo memory) {
        return LibInterchainFactory.diamondStorage().routes[strategy];
    }

    //============================================================================================//
    //                                     Internal Functions                                     //
    //============================================================================================//

    /// @notice Registers a route for rwa asset bridge
    /// @param originLockbox The address of the originating lockbox
    /// @param originDestination The origin destination chain ID
    /// @param data Encoded route-specific data
    function _handleRouteRegistry(
        address originLockbox,
        uint32 originDestination,
        bytes calldata data
    ) internal {
        address strategy = data.strategy(); // origin strategy address

        string memory name = data.name();
        string memory symbol = data.symbol();
        uint8 decimals = data.decimals();

        InterchainFactoryStorage storage ifs = LibInterchainFactory.diamondStorage();
        RouteInfo storage r = ifs.routes[strategy];
        require(!r.exists, RouteAlreadyExist());

        (IERC20 assetToken, ILumiaVaultShares vaultShares) = _deployLumiaTokens(
            strategy,
            name,
            symbol,
            decimals
        );

        ifs.routes[strategy] = RouteInfo({
            exists: true,
            originDestination: originDestination,
            originLockbox: originLockbox,
            assetToken: assetToken,
            vaultShares: vaultShares
        });

        emit RouteRegistered(
            originLockbox,
            originDestination,
            strategy,
            address(assetToken),
            address(vaultShares)
        );
    }

    /**
     * @notice Deploys a new asset Token and Lumia Vault ERC4626 token for a given strategy
     * @param strategy The address of the strategy
     * @param name The name of the vault token (and used for asset too) to be deployed
     * @param symbol The symbol of the vault token (and asset) to be deployed
     * @param decimals Decimal number used both for asset and vault shares
     */
    function _deployLumiaTokens(
        address strategy,
        string memory name,
        string memory symbol,
        uint8 decimals
    ) internal returns (IERC20 assetToken, ILumiaVaultShares vaultShares) {
        assetToken = new LumiaPrincipal(
            address(this),
            string.concat("Principal ", name),
            string.concat("p", symbol),
            decimals
        );

        vaultShares = ILumiaVaultShares(address(new LumiaVaultShares(
            address(this),
            strategy,
            assetToken,
            name,
            symbol,
            decimals
        )));
    }
}
