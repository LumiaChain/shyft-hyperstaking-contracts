// SPDX-License-Identifier: MIT
pragma solidity =0.8.27;

//============================================================================================//
//                                    Shared Errors                                           //
//============================================================================================//

error NotAuthorized(address);

error ZeroAddress();
error ZeroAmount();

error ZeroStakeExit();
error ZeroAllocationExit();
error ValueNotAccepted();

error UpdateFailed();

// thrown when a reward donation is attempted while the vault has zero share supply
// OZ ERC4626 zero-supply edge case
error RewardDonationZeroSupply();

/// ------------ cross-chain errors

error BadOriginDestination(uint32 originDestination);
error DispatchUnderpaid();

error HyperlaneReplay(bytes32 msgId);
error InvalidHook(address hook);
error InvalidIsm(address ism);
