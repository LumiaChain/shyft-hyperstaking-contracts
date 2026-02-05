import { expect } from "chai";
import { time } from "@nomicfoundation/hardhat-toolbox/network-helpers";
import { ignition, ethers, network } from "hardhat";
import {
  Contract,
  Signer,
  Interface,
  ZeroAddress,
  ZeroBytes32,
  parseEther,
  parseUnits,
  Addressable,
  TransactionResponse,
  Log,
} from "ethers";
import SuperformMockModule from "../ignition/modules/test/SuperformMock";
import CurveMockModule from "../ignition/modules/test/CurveMock";

import TestERC20Module from "../ignition/modules/test/TestERC20";
import ReserveStrategyModule from "../ignition/modules/test/MockReserveStrategy";

import { CurrencyStruct } from "../typechain-types/contracts/hyperstaking/interfaces/IHyperFactory";

import { IERC20 } from "../typechain-types";

import { SingleDirectSingleVaultStateReqStruct } from "../typechain-types/contracts/external/superform/core/BaseRouter";
import { WithdrawClaimStruct } from "../typechain-types/contracts/hyperstaking/interfaces/IDeposit";

// full - because there are two differnet vesions of IERC20 used in the project
export const fullyQualifiedIERC20 = "@openzeppelin/contracts/token/ERC20/IERC20.sol:IERC20";

export async function toIERC20(contractAddr: Addressable | string): Promise<IERC20> {
  return await ethers.getContractAt(
    fullyQualifiedIERC20,
    contractAddr,
  ) as unknown as IERC20;
}

export const stableUnits = (val: string) => parseUnits(val, 6);

// -------------------- Accounts --------------------

export async function getSigners() {
  const [
    owner, stakingManager, vaultManager, strategyManager, lumiaFactoryManager, bob, alice,
  ] = await ethers.getSigners();

  const strategyUpgrader = owner;

  return { owner, stakingManager, vaultManager, strategyManager, strategyUpgrader, lumiaFactoryManager, bob, alice };
}

// -------------------- Currency --------------------

export const nativeTokenAddress = ZeroAddress;

export function nativeCurrency(): CurrencyStruct {
  return { token: nativeTokenAddress };
}

/// token contract address
export function erc20Currency(token: string): CurrencyStruct {
  return { token };
}

// -------------------- Deployment Helpers --------------------

export async function deploySuperformMock(erc4626Vault: Contract) {
  const testUSDC = await ethers.getContractAt(fullyQualifiedIERC20, await erc4626Vault.asset());

  // --- set TokenizedStrategy code on a given address ---

  const factory = await ethers.getContractFactory("TokenizedStrategy");
  const instance = await factory.deploy(testUSDC);

  const deployedBytecode = await ethers.provider.getCode(await instance.getAddress());

  await network.provider.send("hardhat_setCode", [
    "0xBB51273D6c746910C7C06fe718f30c936170feD0",
    deployedBytecode,
  ]);

  // -------------------- Superform Mock --------------------

  return ignition.deploy(SuperformMockModule, {
    parameters: {
      SuperformMockModule: {
        erc4626VaultAddress: await erc4626Vault.getAddress(),
      },
    },
  });
}

export async function deployCurveMock(testUSDC: Contract, testUSDT: Contract) {
  const { curvePool, curveRouter } = await ignition.deploy(CurveMockModule, {
    parameters: {
      CurveMockModule: {
        usdcAddress: await testUSDC.getAddress(),
        usdtAddress: await testUSDT.getAddress(),
      },
    },
  });

  // fill the pool with some USDC and USDT
  await testUSDC.transfer(await curvePool.getAddress(), stableUnits("500000"));
  await testUSDT.transfer(await curvePool.getAddress(), stableUnits("500000"));

  return { curvePool, curveRouter };
}

// -------------------- Tokens --------------------

export async function deployTestERC20(name: string, symbol: string, decimals: number = 18): Promise<Contract> {
  const { testERC20 } = await ignition.deploy(TestERC20Module, {
    parameters: {
      TestERC20Module: {
        name,
        symbol,
        decimals,
      },
    },
  });
  return testERC20;
}

export async function deployTestERC4626Vault(asset: Contract): Promise<Contract> {
  return ethers.deployContract("TestERC4626", [await asset.getAddress()]) as unknown as Promise<Contract>;
}

// -------------------- Strategies --------------------

/// ZeroAddress is used for native currency
export async function createReserveStrategy(
  diamond: Contract,
  stakeTokenAddress: string,
  assetAddress: string,
  assetPrice: bigint,
) {
  const { reserveStrategy } = await ignition.deploy(ReserveStrategyModule, {
    parameters: {
      ReserveStrategyModule: {
        diamond: await diamond.getAddress(),
        stake: stakeTokenAddress,
        asset: assetAddress,
        assetPrice,
      },
    },
  });

  const { owner, strategyManager } = await getSigners();

  const reserveStrategySupply = parseEther("50");

  const asset = (await ethers.getContractAt(fullyQualifiedIERC20, assetAddress)) as unknown as IERC20;

  await asset.transfer(strategyManager, reserveStrategySupply); // owner -> strategyManager
  await asset.connect(strategyManager).approve(reserveStrategy.target, reserveStrategySupply);

  await reserveStrategy.connect(strategyManager).supplyRevenueAsset(reserveStrategySupply);

  await owner.sendTransaction({
    to: reserveStrategy,
    value: reserveStrategySupply,
  });

  return reserveStrategy;
}

// -------------------- Superform AERC20 --------------------

export async function registerAERC20(
  superformIntegration: Contract,
  superVault: Contract,
  testUSDC: Contract,
): Promise<IERC20> {
  const superformFactory = await ethers.getContractAt("SuperformFactory", await superformIntegration.superformFactory());

  const superformId = await superformFactory.vaultToSuperforms(superVault, 0);
  const superformRouter = await ethers.getContractAt("SuperformRouter", await superformIntegration.superformRouter());
  const superPositions = await ethers.getContractAt("SuperPositions", await superformIntegration.superPositions());

  const [superformAddress,,] = await superformFactory.getSuperform(superformId);
  const superform = await ethers.getContractAt("BaseForm", superformAddress);

  // to register aERC20 we need to deposit some amount first
  const [owner] = await ethers.getSigners();
  const amount = parseUnits("1", 6);
  const maxSlippage = 50n; // 0.5%
  const outputAmount = await superform.previewDepositTo(amount);

  await testUSDC.approve(superformRouter, amount);
  const routerReq: SingleDirectSingleVaultStateReqStruct = {
    superformData: {
      superformId,
      amount,
      outputAmount,
      maxSlippage,
      liqRequest: {
        txData: "0x",
        token: testUSDC,
        interimToken: ZeroAddress,
        bridgeId: 1,
        liqDstChainId: 0,
        nativeAmount: 0,
      },
      permit2data: "0x",
      hasDstSwap: false,
      retain4626: false,
      receiverAddress: owner,
      receiverAddressSP: owner,
      extraFormData: "0x",
    },
  };

  await superformRouter.singleDirectSingleVaultDeposit(routerReq);

  // actual token registration
  await superPositions.registerAERC20(superformId);

  return ethers.getContractAt(
    "@openzeppelin/contracts/token/ERC20/IERC20.sol:IERC20",
    await superPositions.getERC20TokenAddress(superformId),
  ) as unknown as IERC20;
};

// -------------------- Gauntlet --------------------

export async function solveGauntletDepositRequest(
  tx: TransactionResponse,
  gauntletStrategy: Contract,
  provisioner: Contract,
  token: Addressable,
  tokens: bigint,
  requestId: number | bigint,
) {
  const depositRequestHash = await getEventArg(
    tx,
    "AeraAsyncDepositHash",
    gauntletStrategy,
  );
  expect(depositRequestHash).to.not.equal(ZeroBytes32);

  const minUnitsOut = (await gauntletStrategy.aeraDeposit(requestId)).units;
  await provisioner.testSolveDeposit(
    token,
    await gauntletStrategy.getAddress(),
    tokens,
    minUnitsOut,
    depositRequestHash,
  );
}

export async function solveGauntletRedeemRequest(
  tx: TransactionResponse,
  gauntletStrategy: Contract,
  provisioner: Contract,
  token: Addressable,
  minTokensOut: bigint,
  requestId: number | bigint,
) {
  const redeemRequestHash = await getEventArg(
    tx,
    "AeraAsyncRedeemHash",
    gauntletStrategy,
  );
  expect(redeemRequestHash).to.not.equal(ZeroBytes32);

  const units = (await gauntletStrategy.aeraRedeem(requestId)).units;
  await provisioner.testSolveRedeem(
    token,
    await gauntletStrategy.getAddress(),
    minTokensOut,
    units,
    redeemRequestHash,
  );
}

// -------------------- Other Helpers --------------------

// shared custom errors declared in a standalone Solidity file (no contract or library)
const errorsIface = new Interface([
  "error OnlyStakingManager()",
  "error ZeroAmount()",
  "error ZeroAddress()",
  "error ZeroStakeExit()",
  "error ZeroAllocationExit()",
  "error RewardDonationZeroSupply()",
  "error BadOriginDestination(uint32 originDestination)",
  "error DispatchUnderpaid()",
  "error InsufficientValue()",
  "error TransferFailed()",
  "error RefundFailed()",
  "error HyperlaneReplay(bytes32 msgId)",
  "error Slippage()",
  "error UnauthorizedSuperformId(address strategy, uint256 requested, uint256 authorized)",
]);
export const errors = { interface: errorsIface };

export async function getLastClaimId(
  deposit: Contract,
  strategy: Addressable,
  owner: Addressable,
): Promise<bigint> {
  const lastClaims = await deposit.lastClaims(strategy, owner, 1);
  return lastClaims[0] as bigint; // return only the claimId
}

export async function getRevenueAsset(strategy: Contract) {
  const revenueAssetAddress = await strategy.revenueAsset();
  return ethers.getContractAt(
    "@openzeppelin/contracts/token/ERC20/IERC20.sol:IERC20",
    revenueAssetAddress,
  );
}

export async function getDerivedTokens(hyperlaneHandler: Contract, strategy: string) {
  const principalTokenAddress = (await hyperlaneHandler.getRouteInfo(strategy)).assetToken;
  const principalToken = await ethers.getContractAt("LumiaPrincipal", principalTokenAddress);

  const vaultSharesAddress = (await hyperlaneHandler.getRouteInfo(strategy)).vaultShares;
  const vaultShares = await ethers.getContractAt("LumiaVaultShares", vaultSharesAddress);

  return { principalToken, vaultShares };
}

export async function getCurrentBlockTimestamp() {
  const blockNumber = await ethers.provider.getBlockNumber();
  const block = await ethers.provider.getBlock(blockNumber);
  return block!.timestamp;
}

export async function getEventArg(tx: TransactionResponse, eventName: string, contract: Contract) {
  const receipt = await tx.wait();
  const logs = receipt!.logs;
  const parsedEvent = logs.map((rawLog: Log) => {
    try {
      return contract.interface.parseLog(rawLog);
    } catch {
      return null;
    }
  }).find((parsedLog: Log) => parsedLog !== null && parsedLog.name === eventName);

  if (parsedEvent && parsedEvent.args) {
    // NOTE: return only the first argument of the event
    return parsedEvent.args[0];
  }
  return null;
}

// claims a pending withdraw at its `unlockTime` by fast-forwarding the next block timestamp if needed
// returns an promise that mines the claim
export async function claimAtDeadline(
  deposit: Contract,
  requestId: number | bigint,
  from: Signer,
  to?: Addressable,
): Promise<TransactionResponse> {
  const pendingClaim: WithdrawClaimStruct[] = await deposit.pendingWithdrawClaims([requestId]);
  const deadline = Number(pendingClaim[0].unlockTime) + 1; // move past unlockTime

  const now = await getCurrentBlockTimestamp();
  if (now < Number(deadline)) {
    await time.setNextBlockTimestamp(Number(deadline));
  }

  if (!to) {
    to = from;
  }

  return deposit.connect(from).claimWithdraws([requestId], to);
}

// fast-forwards the next block timestamp to just after the `readyAt` time of a strategy request
export async function fastForwardStrategyRequest(
  strategy: Contract,
  requestId: number | bigint,
) {
  const reqInfo = await strategy.requestInfo(requestId);
  await time.setNextBlockTimestamp(
    Number(reqInfo.readyAt) + 1, // move past readyAt
  );
}

// fast-forwards the next block timestamp to the last user request unlock time
export async function fastForwardUserLastRequest(
  deposit: Contract,
  strategy: Contract,
  user: Addressable,
): Promise<bigint> {
  const requestId = await getLastClaimId(deposit, strategy, user);
  await fastForwardStrategyRequest(strategy, requestId);

  return requestId;
}
