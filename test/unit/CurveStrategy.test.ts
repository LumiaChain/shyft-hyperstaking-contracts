import { loadFixture } from "@nomicfoundation/hardhat-toolbox/network-helpers";

import { ethers, ignition } from "hardhat";
import { Interface, parseEther, parseUnits, Contract, ZeroAddress } from "ethers";
import SwapSuperStrategyModule from "../../ignition/modules/SwapSuperStrategy";
import TestSwapIntegrationModule from "../../ignition/modules/test/TestSwapIntegration";

import { expect } from "chai";
import * as shared from "../shared";
import { stableUnits } from "../shared";

import { deployHyperStakingBase } from "../setup";

async function deployHyperStaking() {
  const {
    signers, hyperStaking, lumiaDiamond, testUSDC, testUSDT, erc4626Vault, invariantChecker,
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

  // -------------------- Curve --------------------

  const { curvePool, curveRouter } = await shared.deployCurveMock(testUSDC, testUSDT);

  await hyperStaking.curveIntegration.connect(signers.strategyManager).setCurveRouter(curveRouter);

  // -------------------- Apply Strategies --------------------

  const testUSDCAddr = await testUSDC.getAddress();
  const testUSDTAddr = await testUSDT.getAddress();

  const { swapSuperStrategy } = await ignition.deploy(SwapSuperStrategyModule, {
    parameters: {
      SwapSuperStrategyModule: {
        diamond: await hyperStaking.diamond.getAddress(),
        curveInputToken: testUSDTAddr,
        curvePool: await curvePool.getAddress(),
        superVault: await superVault.getAddress(),
        superformInputToken: testUSDCAddr,
      },
    },
  });

  // ------------------ SuperUSDC ------------------

  const superUSDC = await shared.registerAERC20( // transmuted ERC20 version
    hyperStaking.superformIntegration, superVault, testUSDC,
  );

  // ------------------ CurveIntegration ------------------

  const nCoins = 3n; // simulating 3pool
  const testDAIAddr = ZeroAddress; // not used in mock
  const registerTokens = [testDAIAddr, testUSDCAddr, testUSDTAddr];
  const indexes = [0n, 1n, 2n];
  await hyperStaking.curveIntegration.connect(signers.strategyManager).registerPool(
    curvePool,
    nCoins,
    registerTokens,
    indexes,
  );

  // --------------------

  const vaultTokenName = "Lumia USDT SwapSuper Position";
  const vaultTokenSymbol = "lspUSDT";

  await hyperStaking.hyperFactory.connect(signers.vaultManager).addStrategy(
    swapSuperStrategy,
    vaultTokenName,
    vaultTokenSymbol,
  );

  const superformId = await swapSuperStrategy.SUPERFORM_ID();
  await hyperStaking.superformIntegration.connect(signers.strategyManager).updateSuperformStrategies(
    swapSuperStrategy,
    true,
    superformId,
  );

  await hyperStaking.curveIntegration.connect(signers.strategyManager).updateSwapStrategies(
    swapSuperStrategy,
    true,
  );

  // ------------------ Configure Pricing ------------------

  await swapSuperStrategy.connect(signers.strategyManager).configureEmaPricing();

  // -------------------- Setup Checker --------------------

  await invariantChecker.addStrategy(await swapSuperStrategy.getAddress());
  setGlobalInvariantChecker(invariantChecker);

  // -------------------- Hyperlane Handler --------------------

  const { principalToken, vaultShares } = await shared.getDerivedTokens(
    lumiaDiamond.hyperlaneHandler,
    await swapSuperStrategy.getAddress(),
  );

  // --------------------

  /* eslint-disable object-property-newline */
  return {
    signers, // signers
    hyperStaking, lumiaDiamond, // diamonds deployment
    swapSuperStrategy, superVault, superformFactory, superUSDC, curvePool, // strategy and related
    testUSDC, testUSDT, erc4626Vault, principalToken, vaultShares, // test contracts
    vaultTokenName, vaultTokenSymbol, // values
  };
  /* eslint-enable object-property-newline */
}

describe("CurveStrategy", function () {
  // ------------------ Helper ------------------
  function oneHopRoute(
    pool: string,
    tokenIn: string,
    tokenOut: string,
    indexes: [bigint, bigint] = [1n, 2n], // default USDC (1) -> USDT (2)
  ): [
    string[],
    [
      [bigint, bigint, bigint, bigint, bigint],
      [bigint, bigint, bigint, bigint, bigint],
      [bigint, bigint, bigint, bigint, bigint],
      [bigint, bigint, bigint, bigint, bigint],
      [bigint, bigint, bigint, bigint, bigint],
    ],
    [string, string, string, string, string],
  ] {
    // route[11]
    const route = Array(11).fill(ZeroAddress);
    route[0] = tokenIn;
    route[1] = pool;
    route[2] = tokenOut;

    // works only with 2 tokens, there is no check for length
    const i = indexes[0];
    const j = indexes[1];

    // swap_params[5][5] – only first row matters; explicit tuple typing
    const params:
    [
      [bigint, bigint, bigint, bigint, bigint],
      [bigint, bigint, bigint, bigint, bigint],
      [bigint, bigint, bigint, bigint, bigint],
      [bigint, bigint, bigint, bigint, bigint],
      [bigint, bigint, bigint, bigint, bigint],
    ] = [
      [i, j, 1n, 1n, 3n],
      [0n, 0n, 0n, 0n, 0n],
      [0n, 0n, 0n, 0n, 0n],
      [0n, 0n, 0n, 0n, 0n],
      [0n, 0n, 0n, 0n, 0n],
    ]; // indexes ignored by mock

    // pools[5]
    const pools: [string, string, string, string, string] = [
      ZeroAddress,
      ZeroAddress,
      ZeroAddress,
      ZeroAddress,
      ZeroAddress,
    ];

    return [route, params, pools];
  }

  async function createMockedCurvePool(
    token1: Contract,
    token2: Contract,
    fillAmount: bigint = parseEther("100"),
  ) {
    const curvePool = await ethers.deployContract("MockCurvePool", [
      await token1.getAddress(),
      await token2.getAddress(),
    ]);

    // fill the pool with tokens
    await token1.transfer(await curvePool.getAddress(), fillAmount);
    await token2.transfer(await curvePool.getAddress(), fillAmount);

    return curvePool;
  }

  async function getMockedCurve() {
    const signers = await shared.getSigners();
    const { owner } = signers;

    // -------------------- Deploy Tokens --------------------

    const usdc = await shared.deployTestERC20("Test USDC", "tUSDC", 6);
    const usdt = await shared.deployTestERC20("Test USDT", "tUSDT", 6);

    await usdc.mint(owner, stableUnits("1000000"));
    await usdt.mint(owner, stableUnits("1000000"));

    // ------------------ Mock Curve Router ------------------

    const curvePool = await createMockedCurvePool(usdc, usdt, stableUnits("500000"));
    const curveRouter = await ethers.deployContract("MockCurveRouter");

    return { curvePool, curveRouter, usdc, usdt, owner };
  }

  describe("Curve Mock Router", function () {
    it("real get_dy / get_dx reflect the rate", async function () {
      const { curvePool, curveRouter, usdc, usdt } = await loadFixture(getMockedCurve);

      const amount = parseUnits("100", 6);
      const [route, params, pools] = oneHopRoute(
        await curvePool.getAddress(),
        await usdc.getAddress(),
        await usdt.getAddress(),
      );

      // 1:1 rate (default)
      let dy = await curveRouter.get_dy(route, params, amount, pools);
      expect(dy).to.equal(amount);

      // change rate to 0.98
      await curvePool.setRate(parseUnits("0.98", 18));
      dy = await curveRouter.get_dy(route, params, amount, pools);
      expect(dy).to.equal((amount)); // still 1:1

      // but real
      expect(await curvePool.realDy(amount)).to.equal((amount * 98n) / 100n);

      // dx should invert dy
      const dx = await curveRouter.get_dx(
        route,
        params,
        dy,
        pools,
        [ZeroAddress, ZeroAddress, ZeroAddress, ZeroAddress, ZeroAddress],
        [ZeroAddress, ZeroAddress, ZeroAddress, ZeroAddress, ZeroAddress],
      );
      expect(dx).to.equal(amount);
    });

    it("exchange USDC -> USDT transfers and returns dy", async function () {
      const { curvePool, curveRouter, usdc, usdt, owner } = await loadFixture(getMockedCurve);

      const amountIn = parseUnits("1000", 6);
      const [route, params, pools] = oneHopRoute(
        await curvePool.getAddress(),
        await usdc.getAddress(),
        await usdt.getAddress(),
      );

      await usdc.approve(await curveRouter.getAddress(), amountIn);

      const balBefore = await usdt.balanceOf(owner);

      // Dry run to get expected output
      const dy = await curveRouter.exchange.staticCall(
        route,
        params,
        amountIn,
        0,
        pools,
        owner,
      );

      // Real transaction
      await curveRouter.exchange(route, params, amountIn, 0, pools, owner.address);
      const balAfter = await usdt.balanceOf(owner.address);

      expect(balAfter - balBefore).to.equal(dy);
      expect(dy).to.equal(amountIn);
    });

    it("exchange USDT -> USDC transfers and returns dy", async function () {
      const { curvePool, curveRouter, usdc, usdt, owner } = await loadFixture(getMockedCurve);

      const amountIn = parseUnits("500", 6);

      const [route, params, pools] = oneHopRoute(
        await curvePool.getAddress(),
        await usdt.getAddress(),
        await usdc.getAddress(),
        [2n, 1n], // USDT (2) -> USDC (1)
      );

      await usdt.approve(await curveRouter.getAddress(), amountIn);

      const balBefore = await usdc.balanceOf(owner.address);
      const dy = await curveRouter.exchange.staticCall(
        route,
        params,
        amountIn,
        0n,
        pools,
        owner,
      );

      await curveRouter.exchange(route, params, amountIn, 0n, pools, owner);
      const balAfter = await usdc.balanceOf(owner.address);

      expect(balAfter - balBefore).to.equal(dy);
    });
  });

  describe("Swap Test Integration", function () {
    async function getMockedIntegrations() {
      const signers = await shared.getSigners();
      const { curvePool, curveRouter, usdc, usdt } = await loadFixture(getMockedCurve);

      await usdc.mint(signers.alice.address, parseUnits("10000", 6));
      await usdt.mint(signers.alice.address, parseUnits("10000", 6));

      const erc4626Vault = await shared.deployTestERC4626Vault(usdc);

      const {
        superformFactory, superformRouter, superVault, superPositions,
      } = await shared.deploySuperformMock(erc4626Vault);

      const { testSwapIntegration } = await ignition.deploy(TestSwapIntegrationModule, {
        parameters: {
          TestSwapIntegrationModule: {
            superformFactory: await superformFactory.getAddress(),
            superformRouter: await superformRouter.getAddress(),
            superPositions: await superPositions.getAddress(),
            curveRouter: await curveRouter.getAddress(),
          },
        },
      });

      // create strategy
      const { swapSuperStrategy } = await ignition.deploy(SwapSuperStrategyModule, {
        parameters: {
          SwapSuperStrategyModule: {
            diamond: await testSwapIntegration.getAddress(), // using testSwapIntegration as a diamond
            curveInputToken: await usdt.getAddress(),
            curvePool: await curvePool.getAddress(),
            superVault: await superVault.getAddress(),
            superformInputToken: await usdc.getAddress(),
          },
        },
      });

      // ------------------ Add Strategy ------------------

      const superformId = await swapSuperStrategy.SUPERFORM_ID();
      await testSwapIntegration.connect(signers.strategyManager).updateSuperformStrategies(
        swapSuperStrategy,
        true,
        superformId,
      );

      await testSwapIntegration.connect(signers.strategyManager).updateSwapStrategies(
        swapSuperStrategy,
        true,
      );

      // ------------------ Configure Pricing ------------------

      await swapSuperStrategy.connect(signers.strategyManager).configureEmaPricing();

      // ------------------ SuperUSDC ------------------

      const superUSDC = await shared.registerAERC20( // transmuted ERC20 version
        testSwapIntegration as unknown as Contract, superVault, usdc,
      );

      // ------------------ CurveIntegration ------------------

      const nCoins = 3n; // simulating 3pool
      const testDAIAddr = ZeroAddress; // not used in mock
      const registerTokens = [testDAIAddr, usdc.target, usdt.target];
      const indexes = [0n, 1n, 2n];
      await testSwapIntegration.connect(signers.strategyManager).registerPool(
        curvePool,
        nCoins,
        registerTokens,
        indexes,
      );

      /* eslint-disable object-property-newline */
      return {
        testSwapIntegration, // integration
        swapSuperStrategy, // strategy
        usdt, usdc, erc4626Vault, superUSDC, // tokens
        curvePool, curveRouter, superformFactory, superformRouter, superVault, superPositions, // mocks
        signers, // signers
      };
      /* eslint-disable object-property-newline */
    }

    it("check for bad route and tokens", async function () {
      const { testSwapIntegration, usdc, usdt, superVault, signers } = await loadFixture(getMockedIntegrations);

      // -------------------- setup

      const badToken = await shared.deployTestERC20("Test BAD1", "BB1", 6);

      const { owner, alice, strategyManager } = signers;
      await badToken.mint(owner, stableUnits("1000000"));
      await badToken.mint(alice, stableUnits("1000000"));

      const strangePool = await createMockedCurvePool(badToken, usdc, stableUnits("500000"));

      // create strategy which uses not registered tokens
      const strangeStrategy = (await ignition.deploy(SwapSuperStrategyModule, {
        parameters: {
          SwapSuperStrategyModule: {
            diamond: await testSwapIntegration.getAddress(), // using testSwapIntegration as a diamond
            curveInputToken: await badToken.getAddress(),
            curvePool: await strangePool.getAddress(),
            superVault: await superVault.getAddress(),
            superformInputToken: await usdc.getAddress(),
          },
        },
      })).swapSuperStrategy;

      // -------------------- actual test

      const amount = parseUnits("321", 6);

      await badToken.connect(alice).approve(testSwapIntegration, amount);

      await expect(testSwapIntegration.connect(alice).allocate(strangeStrategy, amount))
        .to.be.revertedWithCustomError(testSwapIntegration, "PoolNotRegistered");

      // register pool with wrong tokens
      let nCoins = 2n;
      let registerTokens = [usdc.target, usdt.target]; // missing badToken
      let indexes = [0n, 1n];
      await testSwapIntegration.connect(strategyManager).registerPool(
        strangePool,
        nCoins,
        registerTokens,
        indexes,
      );

      await expect(testSwapIntegration.connect(alice).allocate(strangeStrategy, amount))
        .to.be.revertedWithCustomError(testSwapIntegration, "TokenNotRegistered")
        .withArgs(badToken);

      // register bad again
      nCoins = 2n;
      registerTokens = [badToken.target, usdt.target]; // usdt instead of usdc
      indexes = [45n, 4n]; // strange indexes
      await testSwapIntegration.connect(strategyManager).registerPool(
        strangePool,
        nCoins,
        registerTokens,
        indexes,
      );

      await expect(testSwapIntegration.connect(alice).allocate(strangeStrategy, amount))
        .to.be.revertedWithCustomError(testSwapIntegration, "TokenNotRegistered")
        .withArgs(usdc);

      // register correctly
      nCoins = 2n;
      registerTokens = [badToken.target, usdc.target]; // usdt instead of usdc
      indexes = [0n, 1n]; // strange indexes
      await testSwapIntegration.connect(strategyManager).registerPool(
        strangePool,
        nCoins,
        registerTokens,
        indexes,
      );

      // register swap strategy
      await testSwapIntegration.connect(strategyManager).updateSwapStrategies(
        strangeStrategy,
        true,
      );

      // price is not configured yet
      await expect(testSwapIntegration.connect(alice).allocate(strangeStrategy, amount))
        .to.be.revertedWithCustomError(testSwapIntegration, "AnchorNotConfigured")
        .withArgs(badToken.target, usdc.target);

      await strangeStrategy.connect(strategyManager).configureEmaPricing();

      // disable swap strategy
      await testSwapIntegration.connect(strategyManager).updateSwapStrategies(
        strangeStrategy,
        false,
      );

      await expect(testSwapIntegration.connect(alice).allocate(strangeStrategy, amount))
        .to.be.revertedWithCustomError(testSwapIntegration, "NotFromSwapStrategy")
        .withArgs(strangeStrategy);

      // enable again
      await testSwapIntegration.connect(strategyManager).updateSwapStrategies(
        strangeStrategy,
        true,
      );

      await expect(testSwapIntegration.connect(alice).allocate(strangeStrategy, amount))
        .to.be.revertedWithCustomError(testSwapIntegration, "NotFromSuperStrategy")
        .withArgs(strangeStrategy);

      const superformId = await strangeStrategy.SUPERFORM_ID();
      await testSwapIntegration.connect(strategyManager).updateSuperformStrategies(
        strangeStrategy,
        true,
        superformId,
      );

      // OK
      await testSwapIntegration.connect(alice).allocate(strangeStrategy, amount);
    });

    it("allocation", async function () {
      const { testSwapIntegration, swapSuperStrategy, usdt, usdc, erc4626Vault, superUSDC, signers } = await loadFixture(getMockedIntegrations);
      const { alice } = signers;

      const initialSVaultAmount = await usdc.balanceOf(erc4626Vault);
      const amount = parseUnits("100", 6);

      expect(await superUSDC.balanceOf(alice)).to.equal(0);

      await usdt.connect(alice).approve(testSwapIntegration, amount);
      await testSwapIntegration.connect(alice).allocate(swapSuperStrategy, amount);

      expect(await usdt.allowance(alice, testSwapIntegration)).to.equal(0);
      expect(await usdc.balanceOf(erc4626Vault)).to.equal(amount + initialSVaultAmount);
      expect(await superUSDC.balanceOf(alice)).to.equal(amount);
    });

    it("exit", async function () {
      const { testSwapIntegration, swapSuperStrategy, usdt, usdc, erc4626Vault, curvePool, superUSDC, signers } = await loadFixture(getMockedIntegrations);
      const { alice } = signers;

      const amount = parseUnits("300", 6);

      await usdt.connect(alice).approve(testSwapIntegration, amount);
      await testSwapIntegration.connect(alice).allocate(swapSuperStrategy, amount);

      await superUSDC.connect(alice).approve(testSwapIntegration, amount);
      const exitTx = testSwapIntegration.connect(alice).exit(swapSuperStrategy, amount);

      await expect(exitTx).to.changeTokenBalance(superUSDC, alice, -amount);
      await expect(exitTx).to.changeTokenBalances(usdt, [curvePool, alice], [-amount, amount]);
      await expect(exitTx).to.changeTokenBalances(usdc, [erc4626Vault, curvePool], [-amount, amount]);
    });

    it("slippage tolerance", async function () {
      const { testSwapIntegration, swapSuperStrategy, curveRouter, usdt, usdc, erc4626Vault, curvePool, superUSDC, signers } = await loadFixture(getMockedIntegrations);
      const { alice, strategyManager } = signers;

      const amount = parseUnits("300", 6);

      // set rate in the pool to 0.95
      const rate = parseEther("0.95");
      await curvePool.setRate(rate);

      await usdt.connect(alice).approve(testSwapIntegration, amount);
      await expect(testSwapIntegration.connect(alice).allocate(swapSuperStrategy, amount))
        .to.be.revertedWithCustomError(curveRouter, "Slippage");

      await swapSuperStrategy.connect(strategyManager).setSlippage(499); // 4.99% slippage tolerance

      // still should revert, 4.99% < 5%
      await expect(testSwapIntegration.connect(alice).allocate(swapSuperStrategy, amount))
        .to.be.revertedWithCustomError(curveRouter, "Slippage");

      await swapSuperStrategy.connect(strategyManager).setSlippage(500);

      const allocTx = testSwapIntegration.connect(alice).allocate(swapSuperStrategy, amount);

      await expect(allocTx).to.changeTokenBalances(usdt, [curvePool, alice], [amount, -amount]);

      const expectedAmount = (amount * rate) / parseEther("1");
      await expect(allocTx).to.changeTokenBalances(usdc, [erc4626Vault, curvePool], [expectedAmount, -expectedAmount]);
      await expect(allocTx).to.changeTokenBalance(superUSDC, alice, expectedAmount);
    });
  });

  describe("Curve - Swap Strategy", function () {
    afterEach(async () => {
      const c = globalThis.$invChecker;
      if (c) await c.check();
    });

    it("Curve Integration must be initialized", async function () {
      clearGlobalInvariantChecker();

      const {
        signers, hyperStaking, testUSDC, testUSDT,
      } = await loadFixture(deployHyperStakingBase);

      const { curveRouter } = await shared.deployCurveMock(testUSDC, testUSDT);
      const { strategyManager } = signers;

      // missing router setting

      const errors = {
        interface: new Interface([
          "error OnlyStrategyManager()",
          "error CurveRouterNotSet()",
        ]),
      };

      const randomStrategy = "0x0000000000000000000000000000000000001234";
      await expect(hyperStaking.curveIntegration.connect(strategyManager).updateSwapStrategies(
        randomStrategy,
        true,
      )).to.be.revertedWithCustomError(
        errors,
        "CurveRouterNotSet",
      );

      // only strategy manager
      await expect(hyperStaking.curveIntegration.setCurveRouter(
        curveRouter,
      )).to.be.revertedWithCustomError(
        errors,
        "OnlyStrategyManager",
      );

      await hyperStaking.curveIntegration.connect(strategyManager).setCurveRouter(
        curveRouter,
      );

      // OK
      await hyperStaking.curveIntegration.connect(strategyManager).updateSwapStrategies(
        randomStrategy,
        true,
      );
    });

    it("swap strategy is also a superform strategy", async function () {
      const {
        hyperStaking, lumiaDiamond, swapSuperStrategy, testUSDC, testUSDT, superVault, superformFactory,
      } = await loadFixture(deployHyperStaking);
      const { diamond, hyperFactory } = hyperStaking;
      const { hyperlaneHandler } = lumiaDiamond;

      const superformId = await superformFactory.vaultToSuperforms(superVault, 0);

      expect(await swapSuperStrategy.DIAMOND()).to.equal(diamond);
      expect(await swapSuperStrategy.SUPERFORM_ID()).to.equal(superformId);
      expect(await swapSuperStrategy.SUPERFORM_INPUT_TOKEN()).to.equal(testUSDC);

      const revenueAsset = await swapSuperStrategy.revenueAsset();
      expect(revenueAsset).to.not.equal(ZeroAddress);

      // VaultInfo
      expect((await hyperFactory.vaultInfo(swapSuperStrategy)).enabled).to.deep.equal(true);
      expect((await hyperFactory.vaultInfo(swapSuperStrategy)).stakeCurrency).to.deep.equal([testUSDT.target]); // USDT and not USDC
      expect((await hyperFactory.vaultInfo(swapSuperStrategy)).strategy).to.equal(swapSuperStrategy);
      expect((await hyperFactory.vaultInfo(swapSuperStrategy)).revenueAsset).to.equal(revenueAsset);

      const [exists, vaultShares] = await hyperlaneHandler.getRouteInfo(swapSuperStrategy);
      expect(exists).to.equal(true);
      expect(vaultShares).to.not.equal(ZeroAddress);
    });

    it("staking using swap strategy", async function () {
      const {
        signers, hyperStaking, lumiaDiamond, swapSuperStrategy, vaultShares, superUSDC, testUSDC, testUSDT, erc4626Vault, curvePool,
      } = await loadFixture(deployHyperStaking);
      const { deposit, allocation, hyperFactory, lockbox } = hyperStaking;
      const { hyperlaneHandler, realAssets } = lumiaDiamond;
      const { alice } = signers;

      const amount = parseUnits("2000", 6);

      await testUSDT.connect(alice).approve(deposit, amount);
      const depositTx = deposit.connect(alice).deposit(swapSuperStrategy, alice, amount);

      await expect(depositTx).to.changeTokenBalances(testUSDT,
        [alice, curvePool], [-amount, amount]);

      // USDC/USDT 1:1 rate
      await expect(depositTx).to.changeTokenBalances(testUSDC,
        [curvePool, erc4626Vault], [-amount, amount]);

      expect(await superUSDC.totalSupply()).to.equal(amount);
      expect(await superUSDC.balanceOf(allocation)).to.equal(amount);

      // there should be no allowance for the swap strategy,
      // (allocate gives it, but is used indirectly)
      expect(await testUSDT.allowance(deposit, swapSuperStrategy)).to.eq(0);

      const [enabled] = await hyperFactory.vaultInfo(swapSuperStrategy, alice);
      expect(enabled).to.be.eq(true);

      const routeInfo = await hyperlaneHandler.getRouteInfo(swapSuperStrategy);
      expect(routeInfo.vaultShares).to.be.eq(vaultShares);

      // lpToken on the Lumia chain side
      const rwaBalance = await vaultShares.balanceOf(alice);
      expect(rwaBalance).to.be.eq(amount);

      const revenueAsset = await shared.getRevenueAsset(swapSuperStrategy);
      const redeemTx = realAssets.connect(alice).redeem(swapSuperStrategy, alice, alice, rwaBalance);

      await expect(redeemTx)
        .to.changeTokenBalance(vaultShares, alice, -rwaBalance);

      const lastClaimId = await shared.getLastClaimId(deposit, swapSuperStrategy, alice);
      const claimTx = shared.claimAtDeadline(deposit, lastClaimId, alice);

      await expect(claimTx)
        .to.changeTokenBalance(revenueAsset, lockbox, -rwaBalance);

      await expect(claimTx)
        .to.changeTokenBalances(testUSDC,
          [curvePool, erc4626Vault], [amount, -amount]);

      await expect(claimTx)
        .to.changeTokenBalances(testUSDT,
          [alice, curvePool], [amount, -amount]);

      expect(await testUSDT.allowance(deposit, swapSuperStrategy)).to.eq(0);

      expect(await vaultShares.balanceOf(alice)).to.be.eq(0);
    });

    it("check on redeem vulnerability", async function () {
      const {
        signers, hyperStaking, lumiaDiamond, testUSDC, testUSDT, erc4626Vault, swapSuperStrategy, curvePool, vaultShares, superUSDC,
      } = await loadFixture(deployHyperStaking);
      const { deposit, allocation, hyperFactory } = hyperStaking;
      const { hyperlaneHandler, realAssets } = lumiaDiamond;
      const { alice, bob } = signers;

      const amount = parseUnits("2000", 6);

      await testUSDT.connect(alice).approve(deposit, amount);
      const depositTx = deposit.connect(alice).deposit(swapSuperStrategy, alice, amount);

      await expect(depositTx).to.changeTokenBalances(testUSDT,
        [alice, curvePool], [-amount, amount]);

      // USDC/USDT 1:1 rate
      await expect(depositTx).to.changeTokenBalances(testUSDC,
        [curvePool, erc4626Vault], [-amount, amount]);

      expect(await superUSDC.totalSupply()).to.equal(amount);
      expect(await superUSDC.balanceOf(allocation)).to.equal(amount);

      // there should be no allowance for the swap strategy,
      // (allocate gives it, but is used indirectly)
      expect(await testUSDT.allowance(deposit, swapSuperStrategy)).to.eq(0);

      const [enabled] = await hyperFactory.vaultInfo(swapSuperStrategy, alice);
      expect(enabled).to.be.eq(true);

      const routeInfo = await hyperlaneHandler.getRouteInfo(swapSuperStrategy);
      expect(routeInfo.vaultShares).to.be.eq(vaultShares);

      // lpToken on the Lumia chain side
      const rwaBalance = await vaultShares.balanceOf(alice);
      expect(rwaBalance).to.be.eq(amount);

      // At this step, bob saws alice's redeem request in mempool and
      // sends redeem from alice to bob with higher gas price
      await expect(realAssets.connect(bob).redeem(swapSuperStrategy, alice, bob, rwaBalance))
      // but fails because of missing allowance - OK
        .to.be.revertedWithCustomError(vaultShares, "ERC20InsufficientAllowance")
        .withArgs(bob, 0n, rwaBalance);

      // bob needs approval to redeem from alice
      await vaultShares.connect(alice).approve(bob, rwaBalance);
      await expect(realAssets.connect(bob).redeem(swapSuperStrategy, alice, bob, rwaBalance))
        .to.changeTokenBalance(vaultShares, alice, -rwaBalance);

      const lastClaimId = await shared.getLastClaimId(deposit, swapSuperStrategy, bob);
      const claimTx = shared.claimAtDeadline(deposit, lastClaimId, bob);

      await expect(claimTx)
        .to.changeTokenBalances(testUSDC,
          [curvePool, erc4626Vault], [amount, -amount]);

      await expect(claimTx)
        .to.changeTokenBalances(testUSDT,
          [bob, curvePool], [amount, -amount],
        );

      expect(await testUSDT.allowance(deposit, swapSuperStrategy)).to.eq(0);

      expect(await vaultShares.balanceOf(bob)).to.be.eq(0);
      expect(await vaultShares.balanceOf(alice)).to.be.eq(0);
    });
  });
});

describe("EMA Pricing Protection", function () {
  it("should initialize EMA on first swap", async function () {
    const {
      signers, hyperStaking, swapSuperStrategy, testUSDC, testUSDT,
    } = await loadFixture(deployHyperStaking);
    const { deposit, emaPricing } = hyperStaking;
    const { alice } = signers;

    const amount = parseUnits("2000", 6);

    // check EMA not initialized
    expect(
      await emaPricing.isEmaInitialized(testUSDT.target, testUSDC.target),
    ).to.equal(false);

    await testUSDT.connect(alice).approve(deposit, amount);
    await deposit.connect(alice).deposit(swapSuperStrategy, alice, amount);

    // check EMA initialized after first swap
    expect(
      await emaPricing.isEmaInitialized(testUSDT.target, testUSDC.target),
    ).to.equal(true);

    const anchor = await emaPricing.getEmaAnchor(testUSDT.target, testUSDC.target);
    // pool rate is 1:1, actual execution: 2000 USDT -> 2000 USDC
    // first swap initializes EMA to execution price
    expect(anchor.emaPrice).to.equal(parseEther("1"));
  });

  it("should protect against manipulated spot price", async function () {
    const {
      signers, hyperStaking, swapSuperStrategy, testUSDT, curvePool,
    } = await loadFixture(deployHyperStaking);
    const { deposit } = hyperStaking;
    const { alice } = signers;

    // first deposit to initialize EMA at 1:1
    const initAmount = parseUnits("2000", 6);
    await testUSDT.connect(alice).approve(deposit, initAmount);
    await deposit.connect(alice).deposit(swapSuperStrategy, alice, initAmount);

    // attacker manipulates pool rate to 0.97 (3% worse than EMA anchor)
    await curvePool.setRate(parseEther("0.97"));

    const amount = parseUnits("1000", 6);
    await testUSDT.connect(alice).approve(deposit, amount);

    // Flow of protection:
    // 1. quoteProtected gets spot: 1000 * 0.97 = 970 USDC
    // 2. Checks deviation: (1000 - 970) / 1000 = 3% > 1% deviation band
    // 3. guardedOut reverts with Slippage error
    await expect(
      deposit.connect(alice).deposit(swapSuperStrategy, alice, amount),
    ).to.be.revertedWithCustomError(shared.errors, "Slippage");
  });

  it("should accept spot within deviation band and execute at actual rate", async function () {
    const {
      signers, hyperStaking, swapSuperStrategy, testUSDT, testUSDC, curvePool, erc4626Vault,
    } = await loadFixture(deployHyperStaking);
    const { deposit } = hyperStaking;
    const { alice } = signers;

    // initialize EMA at 1:1
    const initAmount = parseUnits("2000", 6);
    await testUSDT.connect(alice).approve(deposit, initAmount);
    await deposit.connect(alice).deposit(swapSuperStrategy, alice, initAmount);

    // attacker tries small manipulation: 0.999 (0.1% worse, within 1% band)
    await curvePool.setRate(parseEther("0.999"));

    const amount = parseUnits("1000", 6);
    await testUSDT.connect(alice).approve(deposit, amount);

    const depositTx = deposit.connect(alice).deposit(swapSuperStrategy, alice, amount);

    // Flow:
    // 1. quoteProtected:
    //    - Gets spot quote: 1000 -> 1000 USDC
    //    - Checks deviation: 1000 - 1000 / 1000 = 0%
    //    - Applies slippage: minDy = 1000 * 0.995 = 995 USDC
    // 2. Actual swap execution:
    //    - Uses realDy: 1000 * 0.999 = 999 USDC (applies the rate)
    //    - 999 > 995 passes minDy check
    // 3. Result: User gets 999 USDC

    const expectedOutput = parseUnits("999", 6);
    await expect(depositTx).to.changeTokenBalance(
      testUSDC,
      erc4626Vault,
      expectedOutput,
    );
  });

  it("should not update EMA for trades below volume threshold", async function () {
    const {
      signers, hyperStaking, swapSuperStrategy, testUSDT, testUSDC, curvePool,
    } = await loadFixture(deployHyperStaking);
    const { deposit, emaPricing } = hyperStaking;
    const { alice } = signers;

    // initialize with large trade (above 1000 USDT threshold)
    const largeAmount = parseUnits("2000", 6);
    await testUSDT.connect(alice).approve(deposit, largeAmount);
    await deposit.connect(alice).deposit(swapSuperStrategy, alice, largeAmount);

    const initialAnchor = await emaPricing.getEmaAnchor(
      testUSDT.target,
      testUSDC.target,
    );

    // manipulate rate to 0.995 (0.5% worse, within 1% band)
    await curvePool.setRate(parseEther("0.995"));

    // small trade below 1000 USDT threshold
    const smallAmount = parseUnits("500", 6);
    await testUSDT.connect(alice).approve(deposit, smallAmount);
    await deposit.connect(alice).deposit(swapSuperStrategy, alice, smallAmount);

    const afterAnchor = await emaPricing.getEmaAnchor(
      testUSDT.target,
      testUSDC.target,
    );

    // EMA should NOT update because volume (500) < threshold (1000)
    // this prevents EMA pollution from small trades
    expect(afterAnchor.emaPrice).to.equal(initialAnchor.emaPrice);
  });

  it("should update EMA for trades above threshold using actual execution price", async function () {
    const {
      signers, hyperStaking, swapSuperStrategy, testUSDT, testUSDC, curvePool,
    } = await loadFixture(deployHyperStaking);
    const { deposit, emaPricing } = hyperStaking;
    const { alice } = signers;

    // initialize at 1:1
    const initAmount = parseUnits("2000", 6);
    await testUSDT.connect(alice).approve(deposit, initAmount);
    await deposit.connect(alice).deposit(swapSuperStrategy, alice, initAmount);

    const initialAnchor = await emaPricing.getEmaAnchor(
      testUSDT.target,
      testUSDC.target,
    );
    expect(initialAnchor.emaPrice).to.equal(parseEther("1"));

    // set rate to 0.999 (0.1% worse, within 1% deviation band)
    await curvePool.setRate(parseEther("0.999"));

    // large trade above 1000 USDT threshold
    const largeAmount = parseUnits("2000", 6);
    await testUSDT.connect(alice).approve(deposit, largeAmount);
    await deposit.connect(alice).deposit(swapSuperStrategy, alice, largeAmount);

    const afterAnchor = await emaPricing.getEmaAnchor(
      testUSDT.target,
      testUSDC.target,
    );

    // EMA update calculation:
    // 1. Actual execution: 2000 USDT -> 2000 * 0.999 = 1998 USDC
    // 2. Execution price: 1998 / 2000 = 0.999
    // 3. EMA recorded via recordExecution(2000, 1998)
    // 4. New EMA = oldEMA * (1 - alpha) + executionPrice * alpha = 0.9998
    const expectedEma = parseEther("0.9998");
    expect(afterAnchor.emaPrice).to.equal(expectedEma);
  });

  it("should work in both swap directions", async function () {
    const {
      signers, hyperStaking, lumiaDiamond, swapSuperStrategy, testUSDT, testUSDC, vaultShares,
    } = await loadFixture(deployHyperStaking);
    const { deposit, emaPricing } = hyperStaking;
    const { realAssets } = lumiaDiamond;
    const { alice } = signers;

    // forward direction: USDT -> USDC (deposit flow)
    const amount = parseUnits("2000", 6);
    await testUSDT.connect(alice).approve(deposit, amount);
    await deposit.connect(alice).deposit(swapSuperStrategy, alice, amount);

    // check forward EMA initialized
    expect(
      await emaPricing.isEmaInitialized(testUSDT.target, testUSDC.target),
    ).to.equal(true);

    // reverse direction: USDC -> USDT (redeem flow)
    const shares = await vaultShares.balanceOf(alice);
    await realAssets.connect(alice).redeem(swapSuperStrategy, alice, alice, shares);

    const lastClaimId = await shared.getLastClaimId(deposit, swapSuperStrategy, alice);
    await shared.claimAtDeadline(deposit, lastClaimId, alice);

    // check reverse direction EMA initialized
    expect(
      await emaPricing.isEmaInitialized(testUSDC.target, testUSDT.target),
    ).to.equal(true);

    const forwardAnchor = await emaPricing.getEmaAnchor(
      testUSDT.target,
      testUSDC.target,
    );
    const reverseAnchor = await emaPricing.getEmaAnchor(
      testUSDC.target,
      testUSDT.target,
    );

    // Both directions record 1:1 rate because:
    // - Pool default rate is 1:1 (parseEther("1"))
    // - Forward: 2000 USDT -> 2000 USDC, price = 1.0
    // - Reverse: ~2000 USDC -> ~2000 USDT, price = 1.0
    expect(forwardAnchor.emaPrice).to.equal(parseEther("1"));
    expect(reverseAnchor.emaPrice).to.equal(parseEther("1"));
  });

  it("execution applies actual market rate", async function () {
    const {
      signers, hyperStaking, swapSuperStrategy, testUSDT, testUSDC, curvePool, erc4626Vault,
    } = await loadFixture(deployHyperStaking);
    const { deposit } = hyperStaking;
    const { alice } = signers;

    // initialize EMA at 1:1
    const initAmount = parseUnits("2000", 6);
    await testUSDT.connect(alice).approve(deposit, initAmount);
    await deposit.connect(alice).deposit(swapSuperStrategy, alice, initAmount);

    // set rate to 0.999 (0.1% worse, within 1% band)
    await curvePool.setRate(parseEther("0.999"));

    const amount = parseUnits("1000", 6);
    await testUSDT.connect(alice).approve(deposit, amount);

    const depositTx = deposit.connect(alice).deposit(swapSuperStrategy, alice, amount);

    // actual execution uses real rate: 1000 * 0.999 = 999 USDC
    // this difference is acceptable slippage
    const actualUsdc = parseUnits("999", 6);
    await expect(depositTx).to.changeTokenBalance(
      testUSDC,
      erc4626Vault,
      actualUsdc,
    );
  });

  it("EMA protection makes frontrunning unprofitable", async function () {
    const {
      signers, hyperStaking, swapSuperStrategy, testUSDT, testUSDC, curvePool, erc4626Vault,
    } = await loadFixture(deployHyperStaking);
    const { deposit, emaPricing } = hyperStaking;
    const { alice, bob } = signers;

    // alice initializes EMA at 1:1 with large deposit
    const aliceInit = parseUnits("5000", 6);
    await testUSDT.connect(alice).approve(deposit, aliceInit);
    await deposit.connect(alice).deposit(swapSuperStrategy, alice, aliceInit);

    const initialAnchor = await emaPricing.getEmaAnchor(testUSDT.target, testUSDC.target);
    expect(initialAnchor.emaPrice).to.equal(parseEther("1"));

    // attacker (bob) tries to frontrun alice's next trade
    await curvePool.setRate(parseEther("0.995"));

    const aliceAmount = parseUnits("2000", 6); // large trade above threshold
    await testUSDT.connect(alice).approve(deposit, aliceAmount);

    // alice's trade executes
    // - quoteProtected: spot=1000
    // - minDy = 1000 * 0.995 = 995
    // - Actual execution: 2000 * 0.995 = 1990 USDC
    // - Alice gets 1990 USDC deposited into vault
    const aliceTx = deposit.connect(alice).deposit(swapSuperStrategy, alice, aliceAmount);

    const expectedAliceOutput = parseUnits("1990", 6); // 2000 * 0.995
    await expect(aliceTx).to.changeTokenBalance(
      testUSDC,
      erc4626Vault,
      expectedAliceOutput,
    );

    // EMA updates to reflect actual execution
    const updatedAnchor = await emaPricing.getEmaAnchor(testUSDT.target, testUSDC.target);

    // new EMA = 1.0 * 0.8 + 0.995 * 0.2 = 0.8 + 0.199 = 0.999
    const expectedEma = parseEther("0.999");
    expect(updatedAnchor.emaPrice).to.equal(expectedEma);

    // attacker tries to profit by unwinding manipulation
    // But now EMA is 0.999, so any future trades have a tighter band
    // if attacker tries to set rate back to 1.0, it's a 0.1% improvement
    await curvePool.setRate(parseEther("1.0"));

    const bobAmount = parseUnits("2000", 6);
    await testUSDT.mint(bob, bobAmount);
    await testUSDT.connect(bob).approve(deposit, bobAmount);

    // bob's trade:
    // - quoteProtected: spot=1000, EMA=0.999, deviation = 0.1%
    // - actual execution: 2000 * 1.0 = 2000 USDC
    // - bob gets fair price, attacker extracted no value
    const bobTx = deposit.connect(bob).deposit(swapSuperStrategy, bob, bobAmount);

    const expectedBobOutput = parseUnits("2000", 6);
    await expect(bobTx).to.changeTokenBalance(
      testUSDC,
      erc4626Vault,
      expectedBobOutput,
    );
  });
});
