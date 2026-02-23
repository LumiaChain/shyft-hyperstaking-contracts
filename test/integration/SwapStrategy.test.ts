import { loadFixture, impersonateAccount, stopImpersonatingAccount } from "@nomicfoundation/hardhat-toolbox/network-helpers";

import { ethers, ignition } from "hardhat";

import SwapSuperStrategyModule from "../../ignition/modules/SwapSuperStrategy";
import TestSwapIntegrationModule from "../../ignition/modules/test/TestSwapIntegration";

import { expect } from "chai";
import * as shared from "../shared";
import { stableUnits } from "../shared";

// ------------------ Mainet Addresses ------------------

// Suuperform
const SUPERFORM_FACTORY_ADDRESS = "0xD85ec15A9F814D6173bF1a89273bFB3964aAdaEC";
const SUPERFORM_ROUTER_ADDRESS = "0xa195608C2306A26f727d5199D5A382a4508308DA";
const SUPER_POSITIONS_ADDRESS = "0x01dF6fb6a28a89d6bFa53b2b3F20644AbF417678";
const SUPER_VAULT_ADDRESS = "0xF7DE3c70F2db39a188A81052d2f3C8e3e217822a";

// Curve
const CURVE_ROUTER_ADDRESS = "0x45312ea0eFf7E09C83CBE249fa1d7598c4C8cd4e";

// Curve 3pool
const CURVE_3POOL_ADDRESS = "0xbEbc44782C7dB0a1A60Cb6fe97d0b483032FF1C7";

const DAI_ADDRESS = "0x6B175474E89094C44Da98b954EedeAC495271d0F";
const USDC_ADDRESS = "0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48";
const USDT_ADDRESS = "0xdAC17F958D2ee523a2206206994597C13D831ec7";

// ----

const qualifiedIERC20 = "@openzeppelin/contracts/token/ERC20/IERC20.sol:IERC20";

describe("Swap Test Integration", function () {
  async function getMockedIntegrations() {
    const signers = await shared.getSigners();
    const { strategyManager } = signers;

    // ------------------ USDC / USDT ------------------

    const usdc = await ethers.getContractAt(qualifiedIERC20, USDC_ADDRESS);
    const usdt = await ethers.getContractAt(qualifiedIERC20, USDT_ADDRESS);

    // Binance Hot Wallet hodling a lot of USDC and USDT
    const WHALE_ADDRESS = "0xF977814e90dA44bFA03b6295A0616a897441aceC";

    await impersonateAccount(WHALE_ADDRESS);
    const whaleSigner = await ethers.getSigner(WHALE_ADDRESS);

    await usdc.connect(whaleSigner).transfer(signers.alice, stableUnits("10000"));
    await usdt.connect(whaleSigner).transfer(signers.alice, stableUnits("10000"));

    await stopImpersonatingAccount(WHALE_ADDRESS);

    // ------------------ Deploy ------------------

    // deploy test integration
    const { testSwapIntegration } = await ignition.deploy(TestSwapIntegrationModule, {
      parameters: {
        TestSwapIntegrationModule: {
          superformFactory: SUPERFORM_FACTORY_ADDRESS,
          superformRouter: SUPERFORM_ROUTER_ADDRESS,
          superPositions: SUPER_POSITIONS_ADDRESS,
          curveRouter: CURVE_ROUTER_ADDRESS,
        },
      },
    });

    // create strategy
    const { swapSuperStrategy } = await ignition.deploy(SwapSuperStrategyModule, {
      parameters: {
        SwapSuperStrategyModule: {
          // using testSwapIntegration as a diamond
          diamond: await testSwapIntegration.getAddress(),
          curveInputToken: USDT_ADDRESS,
          curvePool: CURVE_3POOL_ADDRESS,
          superVault: SUPER_VAULT_ADDRESS,
          superformInputToken: USDC_ADDRESS,
        },
      },
    });

    // ------------------ SuperForm ------------------

    const superformFactory = await ethers.getContractAt("SuperformFactory", SUPERFORM_FACTORY_ADDRESS);
    const superPositions = await ethers.getContractAt("ISuperPositions", SUPER_POSITIONS_ADDRESS);
    const superformId = await swapSuperStrategy.SUPERFORM_ID();

    const [superformAddress,,] = await superformFactory.getSuperform(superformId);
    const superVaultAddress = await (await ethers.getContractAt(
      ["function vault() view returns(address)"],
      superformAddress,
    )).vault();

    const exist = await superPositions.aERC20Exists(superformId);
    expect(exist).to.be.eq(true); // ensure it exist
    // await superPositions.registerAERC20(superformId);

    const transmutedTokenAddr = await superPositions.getERC20TokenAddress(superformId);
    // console.log("Transmuted ERC20 Address:", transmutedAddr);

    // transmuted ERC20 superUSDC token
    const superUSDC = await ethers.getContractAt(
      qualifiedIERC20,
      transmutedTokenAddr,
    );

    // ------------------ Add Strategy ------------------

    await testSwapIntegration.connect(strategyManager).updateSuperformStrategies(
      swapSuperStrategy,
      true,
      superformId,
    );

    await testSwapIntegration.connect(strategyManager).updateSwapStrategies(
      swapSuperStrategy,
      true,
    );

    // ------------------ CurveIntegration ------------------

    const nCoins = 3n; // 3pool has 3 coins
    const registerTokens = [DAI_ADDRESS, USDC_ADDRESS, USDT_ADDRESS];
    const indexes = [0n, 1n, 2n];
    await testSwapIntegration.connect(strategyManager).registerPool(
      CURVE_3POOL_ADDRESS,
      nCoins,
      registerTokens,
      indexes,
    );

    // ------------------ Configure Pricing ------------------

    await swapSuperStrategy.connect(strategyManager).configureEmaPricing();

    /* eslint-disable object-property-newline */
    return {
      testSwapIntegration, // integration
      swapSuperStrategy, // strategy
      usdt, usdc, superUSDC, // tokens
      superVaultAddress,
      signers, // signers
    };
    /* eslint-disable object-property-newline */
  }

  it("allocation", async function () {
    const { testSwapIntegration, swapSuperStrategy, usdt, usdc, superVaultAddress, superUSDC, signers } = await loadFixture(getMockedIntegrations);
    const { alice } = signers;

    const initialSVaultAmount = await usdc.balanceOf(superVaultAddress);
    const amount = stableUnits("100");

    expect(await superUSDC.balanceOf(alice)).to.equal(0);

    await usdt.connect(alice).approve(testSwapIntegration, amount);
    await testSwapIntegration.connect(alice).allocate(swapSuperStrategy, amount);

    expect(await usdt.allowance(alice, testSwapIntegration)).to.equal(0);
    expect(await usdc.balanceOf(superVaultAddress)).to.be.gt(initialSVaultAmount);
    expect(await superUSDC.balanceOf(alice)).to.be.gt(0);
  });

  it("exit", async function () {
    const { testSwapIntegration, swapSuperStrategy, usdt, usdc, superVaultAddress, superUSDC, signers } = await loadFixture(getMockedIntegrations);
    const { alice } = signers;

    const amount = stableUnits("300");

    await usdt.connect(alice).approve(testSwapIntegration, amount);
    await testSwapIntegration.connect(alice).allocate(swapSuperStrategy, amount);

    const superAmount = await superUSDC.balanceOf(alice);

    const before3pool = await usdc.balanceOf(CURVE_3POOL_ADDRESS);
    const beforeVault = await usdc.balanceOf(superVaultAddress);

    await superUSDC.connect(alice).approve(testSwapIntegration, superAmount);
    const exitTx = testSwapIntegration.connect(alice).exit(swapSuperStrategy, superAmount);

    const amountOut: bigint = await swapSuperStrategy.previewExit(superAmount);
    const precisionErr = 3n; // 3wei

    await expect(exitTx).to.changeTokenBalance(superUSDC, alice, -superAmount);
    await expect(exitTx).to.changeTokenBalances(usdt, [CURVE_3POOL_ADDRESS, alice], [-amountOut + precisionErr, amountOut - precisionErr]);

    await exitTx;

    const expectedOut = 299914275n; // hardcoded value, based on the pool's current state
    const tolerance = 5n; // allow +/- 5 units

    expect(await usdc.balanceOf(CURVE_3POOL_ADDRESS)).to.be.closeTo(before3pool + expectedOut, tolerance);
    expect(await usdc.balanceOf(superVaultAddress)).to.be.closeTo(beforeVault, tolerance);

    expect(await superUSDC.balanceOf(alice)).to.be.eq(0);
  });
});
