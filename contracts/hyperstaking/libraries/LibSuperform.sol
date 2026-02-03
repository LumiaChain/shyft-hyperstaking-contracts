// SPDX-License-Identifier: MIT
pragma solidity =0.8.27;

import {EnumerableSet} from "@openzeppelin/contracts/utils/structs/EnumerableSet.sol";

import {IBaseRouterImplementation} from "../../external/superform/core/interfaces/IBaseRouterImplementation.sol";
import {ISuperformFactory} from "../../external/superform/core/interfaces/ISuperformFactory.sol";
import {ISuperPositions} from "../../external/superform/core/interfaces/ISuperPositions.sol";

import {LibDiamond} from "../../diamond/libraries/LibDiamond.sol";
import {IERC1155Receiver} from "@openzeppelin/contracts/token/ERC1155/IERC1155Receiver.sol";

import { ZeroAddress } from "../../shared/Errors.sol";

//================================================================================================//
//                                            Types                                               //
//================================================================================================//

// params for setup
struct SuperformConfig {
    address superformFactory;
    address superformRouter;
    address superPositions;
}

//================================================================================================//
//                                           Storage                                              //
//================================================================================================//

struct SuperformStorage {
    EnumerableSet.AddressSet superformStrategies;
    uint256 maxSlippage; // where 10000 = 100%

    bool initialized; // one-time setup flag

    ISuperformFactory superformFactory;
    IBaseRouterImplementation superformRouter;
    ISuperPositions superPositions;

    /// @notice Maps strategy address to the superformId
    mapping(address => uint256) authorizedSuperformId;
}

library LibSuperform {
    bytes32 constant internal SUPERFORM_STORAGE_POSITION
        = bytes32(uint256(keccak256("hyperstaking.superform-0.1.storage")) - 1);

    error SuperformAlreadyInitialized();
    error SuperformNotConfigured();
    error UnauthorizedSuperformId(address strategy, uint256 requested, uint256 authorized);

    function diamondStorage() internal pure returns (SuperformStorage storage s) {
        bytes32 position = SUPERFORM_STORAGE_POSITION;
        assembly {
            s.slot := position
        }
    }

    /// @notice One-time initialization of this storage
    /// @dev Called from facet, sets router/factory/positions and default slippage
    function init(SuperformConfig memory config) internal {
        SuperformStorage storage s = diamondStorage();

        require(!s.initialized, SuperformAlreadyInitialized());
        require(config.superformFactory != address(0), ZeroAddress());
        require(config.superformRouter != address(0), ZeroAddress());
        require(config.superPositions != address(0), ZeroAddress());

        s.superformFactory = ISuperformFactory(config.superformFactory);
        s.superformRouter = IBaseRouterImplementation(config.superformRouter);
        s.superPositions = ISuperPositions(config.superPositions);

        // default value: 0.5%
        s.maxSlippage = 50;
        s.initialized = true;

        // add IERC1155Receiver to supportedInterfaces
        LibDiamond.DiamondStorage storage ds = LibDiamond.diamondStorage();
        ds.supportedInterfaces[type(IERC1155Receiver).interfaceId] = true;
    }

    /// @notice Verify that the calling strategy is authorized for the given superformId
    function requireAuthorizedSuperformId(
        address strategy,
        uint256 superformId
    ) internal view {
        SuperformStorage storage s = diamondStorage();
        uint256 authorized = s.authorizedSuperformId[strategy];
        require(
            authorized == superformId,
            UnauthorizedSuperformId(strategy, superformId, authorized)
        );
    }

    /// @notice Set the authorized superformId for a strategy
    function setAuthorizedSuperformId(
        address strategy,
        uint256 superformId
    ) internal {
        SuperformStorage storage s = diamondStorage();
        s.authorizedSuperformId[strategy] = superformId;
    }

    /// @notice Get the authorized superformId for a strategy
    function getAuthorizedSuperformId(
        address strategy
    ) internal view returns (uint256) {
        SuperformStorage storage s = diamondStorage();
        return s.authorizedSuperformId[strategy];
    }

    /// @notice Ensures Superform is initialized
    function requireInitialized() internal view {
        SuperformStorage storage s = diamondStorage();
        require(s.initialized, SuperformNotConfigured());
    }
}
