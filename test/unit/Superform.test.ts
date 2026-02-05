import { loadFixture } from "@nomicfoundation/hardhat-toolbox/network-helpers";
import { expect } from "chai";
import { ethers, ignition, network } from "hardhat";
import { Interface, Signer, parseUnits, parseEther, ZeroAddress } from "ethers";

import SuperformStrategyModule from "../../ignition/modules/SuperformStrategy";

import * as shared from "../shared";
import { SingleDirectSingleVaultStateReqStruct } from "../../typechain-types/contracts/external/superform/core/BaseRouter";
import { deployHyperStakingBase } from "../setup";

async function getMockedSuperform() {
  const [superManager, alice] = await ethers.getSigners();

  const testUSDC = await shared.deployTestERC20("Test USD Coin", "tUSDC", 6);
  const erc4626Vault = await shared.deployTestERC4626Vault(testUSDC);
  await testUSDC.mint(alice.address, parseUnits("1000000", 6));

  // --------------------

  const {
    superformFactory, superformRouter, superVault, superPositions,
  } = await shared.deploySuperformMock(erc4626Vault);

  // --------------------

  const superformId = await superformFactory.vaultToSuperforms(superVault, 0);
  const subSuperformId = await superVault.superformIds(0);

  const [superformAddress,,] = await superformFactory.getSuperform(superformId);
  const superform = await ethers.getContractAt("BaseForm", superformAddress);

  // --------------------

  return {
    superformFactory, superformRouter, superVault, superPositions, superformId, subSuperformId, superform, superManager, testUSDC, erc4626Vault, alice,
  };
}

async function deployHyperStaking() {
  const {
    signers, hyperStaking, lumiaDiamond, testUSDC, erc4626Vault, invariantChecker,
  } = await loadFixture(deployHyperStakingBase);

  // -------------------- Superform --------------------

  const {
    superformFactory, superformRouter, superVault, superPositions,
  } = await shared.deploySuperformMock(erc4626Vault);

  const superformConfig = {
    superformFactory: await superformFactory.getAddress(),
    superformRouter: await superformRouter.getAddress(),
    superPositions: await superPositions.getAddress(),
  };

  await hyperStaking.superformIntegration.connect(signers.strategyManager).initializeStorage(
    superformConfig,
  );

  // -------------------- Apply Strategies --------------------

  const { superformStrategy } = await ignition.deploy(SuperformStrategyModule, {
    parameters: {
      SuperformStrategyModule: {
        diamond: await hyperStaking.diamond.getAddress(),
        superVault: await superVault.getAddress(),
        stakeToken: await testUSDC.getAddress(),
      },
    },
  });

  const superformId = await superformFactory.vaultToSuperforms(superVault, 0);

  // -------

  const [superformAddress,,] = await superformFactory.getSuperform(superformId);
  const superform = await ethers.getContractAt("BaseForm", superformAddress);

  const aerc20 = await shared.registerAERC20( // transmuted SuperUSDC
    hyperStaking.superformIntegration, superVault, testUSDC,
  );

  // --------------------

  const vaultTokenName = "Lumia USD Superform Position";
  const vaultTokenSymbol = "lspUSD";

  await hyperStaking.hyperFactory.connect(signers.vaultManager).addStrategy(
    superformStrategy,
    vaultTokenName,
    vaultTokenSymbol,
  );

  await hyperStaking.superformIntegration.connect(signers.strategyManager).updateSuperformStrategies(
    superformStrategy,
    true,
    superformId,
  );

  // -------------------- Setup Checker --------------------

  await invariantChecker.addStrategy(await superformStrategy.getAddress());
  setGlobalInvariantChecker(invariantChecker);

  // -------------------- Hyperlane Handler --------------------

  const { principalToken, vaultShares } = await shared.getDerivedTokens(
    lumiaDiamond.hyperlaneHandler,
    await superformStrategy.getAddress(),
  );

  // --------------------

  /* eslint-disable object-property-newline */
  return {
    signers, // signers
    hyperStaking, lumiaDiamond, // diamonds deployment
    testUSDC, erc4626Vault, superformStrategy, aerc20, principalToken, vaultShares, // test contracts
    superform, superVault, superformFactory, superPositions, superformRouter, superformId, // superform
    vaultTokenName, vaultTokenSymbol, // values
  };
  /* eslint-enable object-property-newline */
}

describe("Superform", function () {
  describe("Mock", function () {
    const superUSDCDeposit = async (
      amount: bigint,
      receiver: Signer,
      outputAmount?: bigint,
      maxSlippage: bigint = 50n, // 0.5%
    ) => {
      const { superformRouter, superform, testUSDC, superformId } = await loadFixture(getMockedSuperform);

      if (!outputAmount) {
        outputAmount = await superform.previewDepositTo(amount);
      }

      await testUSDC.connect(receiver).approve(superformRouter, amount);
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
          receiverAddress: receiver,
          receiverAddressSP: receiver,
          extraFormData: "0x",
        },
      };

      await superformRouter.connect(receiver).singleDirectSingleVaultDeposit(routerReq);
    };

    it("overall tests of the mock", async function () {
      const { superformFactory, superVault, superPositions, testUSDC, erc4626Vault, alice } = await loadFixture(getMockedSuperform);

      const superformId = await superVault.superformIds(0);
      expect(await superformFactory.isSuperform(superformId)).to.equal(true);
      expect(await superformFactory.vaultToSuperforms(erc4626Vault.target, 0)).to.equal(superformId);

      expect(await superPositions.name()).to.equal("Super Test Positions");
      expect(await superPositions.symbol()).to.equal("STP");
      expect(await superPositions.dynamicURI()).to.equal("dynamicURI");

      const [superformAddress, formId, chainId] = await superformFactory.getSuperform(superformId);

      expect(formId).to.equal(1);
      expect(chainId).to.equal(network.config.chainId);

      const superform = await ethers.getContractAt("ERC4626Form", superformAddress);

      expect(await superform.getVaultName()).to.equal(await erc4626Vault.name());
      expect(await superform.getVaultSymbol()).to.equal(await erc4626Vault.symbol());

      expect(await superform.vault()).to.equal(erc4626Vault.target);
      expect(await superform.asset()).to.equal(testUSDC.target);

      expect(await superPositions.balanceOf(alice.address, superformId)).to.equal(0);
      expect(await superPositions.totalSupply(superformId)).to.equal(0);
    });

    it("it should be possible to deposit USDC using superRouter", async function () {
      const { superform, superformId, superPositions, alice } = await loadFixture(getMockedSuperform);

      // deposit amount
      const amount = parseUnits("100", 6);

      const maxSlippage = 100n; // 1%
      const outputAmount = await superform.previewDepositTo(amount);

      await superUSDCDeposit(amount, alice, outputAmount, maxSlippage);

      const outputAmountSlipped = outputAmount * (10000n - maxSlippage) / 10000n;
      expect(await superPositions.balanceOf(alice.address, superformId)).to.be.gt(outputAmountSlipped);
    });

    it("it should be possible to transmute superPositions to aERC20", async function () {
      const { superformId, superPositions, alice } = await loadFixture(getMockedSuperform);

      const amount = parseUnits("200", 6);

      await superUSDCDeposit(amount, alice);

      const balance = await superPositions.balanceOf(alice, superformId);

      await superPositions.registerAERC20(superformId);
      expect(await superPositions.aERC20Exists(superformId)).to.be.eq(true);

      const aerc20Address = await superPositions.getERC20TokenAddress(superformId);
      const aerc20 = await ethers.getContractAt("@openzeppelin/contracts/token/ERC20/IERC20.sol:IERC20", aerc20Address);

      await superPositions.connect(alice).transmuteToERC20(alice, superformId, balance, alice);

      // after transmutimg the ERC115 balance should be 0
      expect(await superPositions.balanceOf(alice, superformId)).to.be.eq(0);

      // the same amount is in aERC20
      expect(await aerc20.balanceOf(alice)).to.be.eq(balance);

      // transmute back to ERC1155 (in 2 steps)
      await aerc20.connect(alice).approve(superPositions, balance - 100n);
      await superPositions.connect(alice).transmuteToERC1155A(alice, superformId, balance - 100n, alice);

      expect(await superPositions.balanceOf(alice, superformId)).to.be.eq(balance - 100n);
      expect(await aerc20.balanceOf(alice)).to.be.eq(100);

      await aerc20.connect(alice).approve(superPositions, 100n);
      await superPositions.connect(alice).transmuteToERC1155A(alice, superformId, 100, alice);

      expect(await superPositions.connect(alice).balanceOf(alice, superformId)).to.be.eq(balance);
      expect(await aerc20.balanceOf(alice)).to.be.eq(0);
    });

    it("it should be possible to withdraw superPositions", async function () {
      const { superformRouter, superform, superformId, superPositions, testUSDC, alice } = await loadFixture(getMockedSuperform);

      const amount = parseUnits("100", 6);
      await superUSDCDeposit(amount, alice);

      const superBalance = await superPositions.balanceOf(alice, superformId);
      expect(superBalance).to.be.gt(0);

      const maxSlippage = 100n; // 1%
      const outputAmount = await superform.previewWithdrawFrom(superBalance);

      const testUSDCBalanceBefore = await testUSDC.balanceOf(alice);

      const routerReq: SingleDirectSingleVaultStateReqStruct = {
        superformData: {
          superformId,
          amount: superBalance,
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
          receiverAddress: alice,
          receiverAddressSP: alice,
          extraFormData: "0x",
        },
      };

      await superPositions.connect(alice).setApprovalForOne(superformRouter, superformId, superBalance);
      await superformRouter.connect(alice).singleDirectSingleVaultWithdraw(routerReq);

      expect(await superPositions.balanceOf(alice, superformId)).to.be.eq(0);
      expect(await testUSDC.balanceOf(alice)).to.be.gt(testUSDCBalanceBefore);
    });
  });

  describe("Strategy", function () {
    afterEach(async () => {
      const c = globalThis.$invChecker;
      if (c) await c.check();
    });

    it("Superform Integration must be initialized", async function () {
      clearGlobalInvariantChecker();

      const {
        signers, hyperStaking, erc4626Vault,
      } = await loadFixture(deployHyperStakingBase);

      const {
        superformFactory, superformRouter, superPositions, superVault,
      } = await shared.deploySuperformMock(erc4626Vault);

      // missing superformIntegration storage initialization

      const errors = {
        interface: new Interface([
          "error OnlyStrategyManager()",
          "error SuperformNotConfigured()",
          "error SuperformAlreadyInitialized()",
        ]),
      };

      const randomStrategy = "0x0000000000000000000000000000000000001234";
      await expect(hyperStaking.superformIntegration.connect(signers.strategyManager).updateSuperformStrategies(
        randomStrategy,
        true,
        0n, // bad superformId
      )).to.be.revertedWithCustomError(
        errors,
        "SuperformNotConfigured",
      );

      // initialize storage
      const superformConfig = {
        superformFactory: await superformFactory.getAddress(),
        superformRouter: await superformRouter.getAddress(),
        superPositions: await superPositions.getAddress(),
      };

      // only strategy manager
      await expect(hyperStaking.superformIntegration.initializeStorage(
        superformConfig,
      )).to.be.revertedWithCustomError(
        errors,
        "OnlyStrategyManager",
      );

      await hyperStaking.superformIntegration.connect(signers.strategyManager).initializeStorage(
        superformConfig,
      );

      // OK
      const superformId = await superformFactory.vaultToSuperforms(superVault, 0);
      await hyperStaking.superformIntegration.connect(signers.strategyManager).updateSuperformStrategies(
        randomStrategy,
        true,
        superformId, // correct superformId
      );

      // cannot initialize again
      await expect(hyperStaking.superformIntegration.connect(signers.strategyManager).initializeStorage(
        superformConfig,
      )).to.be.revertedWithCustomError(
        errors,
        "SuperformAlreadyInitialized",
      );
    });

    it("superform strategy with vault should be created and strategy registered on the lumia side", async function () {
      const {
        hyperStaking, lumiaDiamond, superformStrategy, superformId, testUSDC,
      } = await loadFixture(deployHyperStaking);
      const { diamond, hyperFactory } = hyperStaking;
      const { hyperlaneHandler } = lumiaDiamond;

      expect(await superformStrategy.DIAMOND()).to.equal(diamond);
      expect(await superformStrategy.SUPERFORM_ID()).to.equal(superformId);
      expect(await superformStrategy.SUPERFORM_INPUT_TOKEN()).to.equal(testUSDC);

      const revenueAsset = await superformStrategy.revenueAsset(); // aERC20 from superpositons
      expect(revenueAsset).to.not.equal(ZeroAddress);

      // VaultInfo
      expect((await hyperFactory.vaultInfo(superformStrategy)).stakeCurrency).to.deep.equal([testUSDC.target]);
      expect((await hyperFactory.vaultInfo(superformStrategy)).strategy).to.equal(superformStrategy);
      expect((await hyperFactory.vaultInfo(superformStrategy)).revenueAsset).to.equal(revenueAsset);

      const [exists, vaultShares] = await hyperlaneHandler.getRouteInfo(superformStrategy);
      expect(exists).to.equal(true);
      expect(vaultShares).to.not.equal(ZeroAddress);
    });

    it("staking using superform strategy", async function () {
      const {
        signers, hyperStaking, lumiaDiamond, superformStrategy, vaultShares, aerc20, testUSDC, erc4626Vault,
      } = await loadFixture(deployHyperStaking);
      const { deposit, allocation, hyperFactory, lockbox } = hyperStaking;
      const { hyperlaneHandler, realAssets } = lumiaDiamond;

      const { alice } = signers;

      const amount = parseUnits("2000", 6);

      await testUSDC.connect(alice).approve(deposit, amount);
      await expect(deposit.connect(alice).deposit(superformStrategy, alice, amount))
        .to.changeTokenBalances(testUSDC,
          [alice, erc4626Vault], [-amount, amount]);

      expect(await aerc20.totalSupply()).to.equal(amount);
      expect(await aerc20.balanceOf(allocation)).to.equal(amount);

      // there should be no allowance for the superform strategy,
      // (allocate gives it, but superform strategy uses it indirectly)
      expect(await testUSDC.allowance(deposit, superformStrategy)).to.eq(0);

      const [enabled] = await hyperFactory.vaultInfo(superformStrategy, alice);
      expect(enabled).to.be.eq(true);

      const routeInfo = await hyperlaneHandler.getRouteInfo(superformStrategy);
      expect(routeInfo.vaultShares).to.be.eq(vaultShares);

      // lpToken on the Lumia chain side
      const rwaBalance = await vaultShares.balanceOf(alice);
      expect(rwaBalance).to.be.eq(amount);

      const reqId = 2;
      await expect(realAssets.connect(alice).redeem(superformStrategy, alice, alice, rwaBalance))
        .to.emit(superformStrategy, "ExitRequested")
        .withArgs(reqId, alice, amount, 0);

      expect(await aerc20.allowance(deposit, superformStrategy)).to.eq(0);
      const claimTx = shared.claimAtDeadline(deposit, reqId, alice);

      await expect(claimTx)
        .to.changeTokenBalance(aerc20, lockbox, -amount);

      await expect(claimTx)
        .to.changeTokenBalances(testUSDC,
          [alice, erc4626Vault], [amount, -amount],
        );

      expect(await vaultShares.balanceOf(alice)).to.be.eq(0);
    });

    it("revenue from superform strategy", async function () {
      const {
        signers, hyperStaking, lumiaDiamond, testUSDC, erc4626Vault, superVault, superformStrategy, superform, vaultShares, principalToken,
      } = await loadFixture(deployHyperStaking);
      const { deposit, hyperFactory, allocation } = hyperStaking;
      const { realAssets } = lumiaDiamond;
      const { vaultManager, alice, bob } = signers;

      // needed for simulate yield generation
      const tokenizedStrategy = await ethers.getContractAt("ITokenizedStrategy", superVault.target);

      const amount = parseUnits("100", 6);

      await testUSDC.connect(alice).approve(deposit, amount);
      await deposit.connect(alice).deposit(superformStrategy, alice, amount);

      // lpToken on the Lumia chain side
      const rwaBalance = await vaultShares.balanceOf(alice);
      expect(rwaBalance).to.be.eq(amount);

      // change the ratio of the vault, increase the revenue
      const currentVaultAssets = await superform.getTotalAssets();
      await testUSDC.approve(tokenizedStrategy, currentVaultAssets); // double the assets
      await tokenizedStrategy.simulateYieldGeneration(erc4626Vault, currentVaultAssets);

      await realAssets.connect(alice).redeem(superformStrategy, alice, alice, rwaBalance);

      const lastClaimId = await shared.getLastClaimId(deposit, superformStrategy, alice);
      await shared.claimAtDeadline(deposit, lastClaimId, alice);

      // Report revenue

      // everything has been withdrawn, and vault has double the assets,
      // so the revenue is the same as the amount
      const expectedRevenue = amount;
      expect(await allocation.checkRevenue(superformStrategy)).to.be.eq(expectedRevenue);

      await expect(allocation.connect(vaultManager).report(superformStrategy))
        .to.be.revertedWithCustomError(allocation, "FeeRecipientUnset");

      expect((await hyperFactory.vaultInfo(superformStrategy)).feeRate).to.be.eq(0);

      const feeRecipient = bob;
      await allocation.connect(vaultManager).setFeeRecipient(superformStrategy, feeRecipient);

      // it should not be possible to report, when vault has no shares
      await expect(allocation.connect(vaultManager).report(superformStrategy))
        .to.be.revertedWithCustomError(shared.errors, "RewardDonationZeroSupply");

      // stake again, so report can proceed
      await testUSDC.connect(alice).approve(deposit, amount);
      await deposit.connect(alice).deposit(superformStrategy, alice, amount);

      const reportTx = allocation.connect(vaultManager).report(superformStrategy);

      // events
      const feeRate = 0;
      const feeAmount = 0;
      const feeAllocation = 0;
      await expect(reportTx).to.emit(allocation, "StakeCompounded").withArgs(
        superformStrategy, feeRecipient, feeRate, feeAmount, feeAllocation, expectedRevenue,
      );

      // balance
      await expect(reportTx).to.changeTokenBalance(principalToken, vaultShares, expectedRevenue);
    });

    it("revenue should also depend on bridge safety margin", async function () {
      const {
        signers, hyperStaking, lumiaDiamond, testUSDC, erc4626Vault, superformStrategy, superVault,
      } = await loadFixture(deployHyperStaking);
      const { deposit, allocation } = hyperStaking;
      const { realAssets } = lumiaDiamond;
      const { alice, vaultManager } = signers;

      // needed for simulate yield generation
      const tokenizedStrategy = await ethers.getContractAt("ITokenizedStrategy", superVault.target);

      const amount = parseUnits("50", 6);

      await testUSDC.approve(deposit, amount);
      await deposit.deposit(superformStrategy, alice, amount);

      // increase the revenue
      const additionlAssets = parseUnits("100", 6);
      await testUSDC.approve(superVault, additionlAssets);
      await tokenizedStrategy.simulateYieldGeneration(erc4626Vault, additionlAssets);

      // withdraw half of the assets
      await realAssets.connect(alice).redeem(superformStrategy, alice, alice, amount / 2n);

      const newBridgeSafetyMargin = parseEther("0.1"); // 10%;
      const expectedRevenue = await allocation.checkRevenue(superformStrategy);

      await allocation.connect(vaultManager).setBridgeSafetyMargin(superformStrategy, newBridgeSafetyMargin);

      // the revenue should be less than before, the safety margin is 10% of the total stake
      const safetyMarginAmount = (await allocation.stakeInfo(superformStrategy)).totalStake * newBridgeSafetyMargin / parseEther("1");

      expect(await allocation.checkRevenue(superformStrategy)).to.be.eq(expectedRevenue - safetyMarginAmount);
    });

    it("should prevent strategy from accessing unauthorized superformId", async function () {
      const { hyperStaking, superformStrategy, superformId } = await loadFixture(deployHyperStaking);
      const { superformIntegration, diamond } = hyperStaking;

      const strategyAddress = await superformStrategy.getAddress();
      const diamondAddress = await diamond.getAddress();
      const unauthorizedSuperformId = superformId + 1n;

      // Verify strategy is authorized for its superformId
      expect(await superformIntegration.getAuthorizedSuperformId(strategyAddress))
        .to.equal(superformId);

      // Impersonate strategy
      await network.provider.send("hardhat_setBalance", [strategyAddress, "0x21e19e0c9bab2400000"]);
      await network.provider.send("hardhat_impersonateAccount", [strategyAddress]);
      const strategySigner = await ethers.getSigner(strategyAddress);

      const amount = parseUnits("1000", 6);

      // Withdraw should revert for unauthorized superformId
      await expect(
        superformIntegration.connect(strategySigner)
          .singleVaultWithdraw(unauthorizedSuperformId, amount, diamondAddress, diamondAddress),
      ).to.be.revertedWithCustomError(shared.errors, "UnauthorizedSuperformId")
        .withArgs(strategyAddress, unauthorizedSuperformId, superformId);

      // Transmute should also revert for unauthorized superformId
      await expect(
        superformIntegration.connect(strategySigner)
          .transmuteToERC1155A(diamondAddress, unauthorizedSuperformId, amount, diamondAddress),
      ).to.be.revertedWithCustomError(shared.errors, "UnauthorizedSuperformId")
        .withArgs(strategyAddress, unauthorizedSuperformId, superformId);

      // Deposit should also revert for unauthorized superformId
      await expect(
        superformIntegration.connect(strategySigner)
          .singleVaultDeposit(unauthorizedSuperformId, amount, diamondAddress, diamondAddress),
      ).to.be.revertedWithCustomError(shared.errors, "UnauthorizedSuperformId")
        .withArgs(strategyAddress, unauthorizedSuperformId, superformId);

      await network.provider.send("hardhat_stopImpersonatingAccount", [strategyAddress]);
    });
  });
});
