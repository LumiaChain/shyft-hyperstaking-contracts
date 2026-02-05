// SPDX-License-Identifier: MIT
pragma solidity =0.8.27;

// solhint-disable var-name-mixedcase

import {IMailbox} from "../../external/hyperlane/interfaces/IMailbox.sol";
import {IPostDispatchHook} from "../../external/hyperlane/interfaces/hooks/IPostDispatchHook.sol";
import {IInterchainSecurityModule} from "../../external/hyperlane/interfaces/IInterchainSecurityModule.sol";

import {IERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import {EnumerableSet} from "@openzeppelin/contracts/utils/structs/EnumerableSet.sol";

import {ILumiaVaultShares} from "../interfaces/ILumiaVaultShares.sol";

//================================================================================================//
//                                            Types                                               //
//================================================================================================//

/**
 * @notice Stores routing information about specific token route
 * @param exists Helper boolean for easy determination if the route exists
 * @param originDestination The Chain id of the origin
 * @param originLockbox The address of the origin Lockbox
 * @param assetToken The LumiaPrincipal token representing stake in a specific remote strategy
 * @param vaultShares The ERC4626 vault used to mint user shares and handle reward distribution
 */
struct RouteInfo {
    bool exists;
    uint32 originDestination;
    address originLockbox;
    IERC20 assetToken;
    ILumiaVaultShares vaultShares;
}

struct LastMessage {
    address sender;
    bytes data;
}

//================================================================================================//
//                                           Storage                                              //
//================================================================================================//

struct InterchainFactoryStorage {
    /// @notice Hyperlane Mailbox
    IMailbox mailbox;

    /// @notice ISM for this recipient (zero if default ISM on the Mailbox is preferred)
    IInterchainSecurityModule ism;

    /// @notice Temporary data about last msg
    LastMessage lastMessage;
    uint256[8] __gap_lastMessage;

    /// @notice Set of authorized Lockboxes (located on their respective origin chains)
    EnumerableSet.AddressSet authorizedOrigins;

    /// @notice Maps an origin address to its corresponding destination chain ID
    mapping (address origin => uint32) destinations;

    /// @notice Mapping of strategy to its detailed route information
    mapping (address strategy => RouteInfo) routes;

    /// @notice Hook for post-dispatch processing (address(0) = use mailbox default)
    IPostDispatchHook postDispatchHook;
}

library LibInterchainFactory {
    // -------------------- Errors

    error RouteDoesNotExist(address strategy);

    // -------------------- Constants

    bytes32 constant internal INTERCHAIN_FACTORY_STORAGE_POSITION
        = bytes32(uint256(keccak256("lumia-diamond.interchain-factory-0.1.storage")) - 1);

    // -------------------- Checks

    /// @notice Checks whether route exists
    /// @dev reverts if route does not exist
    function checkRoute(
        InterchainFactoryStorage storage ifs,
        address strategy
    ) internal view {
        require(ifs.routes[strategy].exists, RouteDoesNotExist(strategy));
    }

    // -------------------- Storage Access

    function diamondStorage() internal pure returns (InterchainFactoryStorage storage s) {
        bytes32 position = INTERCHAIN_FACTORY_STORAGE_POSITION;
        assembly {
            s.slot := position
        }
    }
}
