import { parseUnits } from "ethers";
import { ethers, HardhatEthersSigner } from "hardhat";
import { TestSwapIntegration } from "../typechain-types";

import { processTx } from "./libraries/utils";

const stableUnits = (val: string) => parseUnits(val, 6);
const fullyQualifiedIERC20 = "@openzeppelin/contracts/token/ERC20/IERC20.sol:IERC20";

const TEST_SWAP_INTEGRATION_ADDRESS = "0x2aDdD9D895c966cDeBC7D666c8fAC2875b9dECCE";
const SWAP_STRATEGY_ADDRESS = "0x74357ecd9c3D0C75D4F9B5e2954628EB8B9CD790";

// Curve 3pool
const DAI_ADDRESS = "0x6B175474E89094C44Da98b954EedeAC495271d0F";
const USDC_ADDRESS = "0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48";
const USDT_ADDRESS = "0xdAC17F958D2ee523a2206206994597C13D831ec7";

const CURVE_3POOL_ADDRESS = "0xbEbc44782C7dB0a1A60Cb6fe97d0b483032FF1C7";

// ------------------ Add Strategy ------------------
async function addStrategyToIntegration(
  testSwapIntegration: TestSwapIntegration,
  strategyManager: HardhatEthersSigner,
) {
  console.log("Strategy Manager:", strategyManager.address);

  let tx = await testSwapIntegration.connect(strategyManager).updateSuperformStrategies(
    SWAP_STRATEGY_ADDRESS,
    true,
  );
  await processTx(tx, "Update Superform Strategies");

  tx = await testSwapIntegration.connect(strategyManager).updateSwapStrategies(
    SWAP_STRATEGY_ADDRESS,
    true,
  );
  await processTx(tx, "Update Swap Strategies");
}

// ------------------ Register Curve Pool ------------------
async function registerCurvePool(
  testSwapIntegration: TestSwapIntegration,
  strategyManager: HardhatEthersSigner,
) {
  const nCoins = 3n; // 3pool has 3 coins
  const registerTokens = [DAI_ADDRESS, USDC_ADDRESS, USDT_ADDRESS];
  const indexes = [0n, 1n, 2n];
  const tx = await testSwapIntegration.connect(strategyManager).registerPool(
    CURVE_3POOL_ADDRESS,
    nCoins,
    registerTokens,
    indexes,
  );
  await processTx(tx, "Register Curve Pool");
};

// -------------------- Allocate ---------------------

async function allocateToSwapStrategy(
  testSwapIntegration: TestSwapIntegration,
  amount: bigint,
  signer: HardhatEthersSigner,
) {
  const usdt = await ethers.getContractAt(fullyQualifiedIERC20, USDT_ADDRESS);

  // Approve the integration to spend USDT
  let tx = await usdt.connect(signer).approve(testSwapIntegration, amount);
  await processTx(tx, "Approve USDT to Swap Integration");

  // Allocate USDT to the swap strategy
  tx = await testSwapIntegration.connect(signer).allocate(SWAP_STRATEGY_ADDRESS, amount);
  await processTx(tx, "Allocate USDT to Swap Strategy");
}

// -------------------- Exit ---------------------

async function exitFromSwapStrategy(
  testSwapIntegration: TestSwapIntegration,
  signer: HardhatEthersSigner,
) {
  const swapStrategy = await ethers.getContractAt("SwapSuperStrategy", SWAP_STRATEGY_ADDRESS);
  const superUSDCAddress = await swapStrategy.revenueAsset();

  const superUSDC = await ethers.getContractAt(fullyQualifiedIERC20, superUSDCAddress);
  const superAmount = await superUSDC.balanceOf(signer);

  // Approve the integration to spend USDT
  let tx = await superUSDC.connect(signer).approve(testSwapIntegration, superAmount);
  await processTx(tx, "Approve SuperUSDC to Swap Integration");

  // Allocate USDT to the swap strategy
  tx = await testSwapIntegration.connect(signer).exit(SWAP_STRATEGY_ADDRESS, superAmount);
  await processTx(tx, "Exit SuperUSDC from Swap Strategy");
}

// ------------------ Main Function ------------------
async function main() {
  const strategyManager = (await ethers.getSigners())[0];
  const testSwapIntegration = await ethers.getContractAt("TestSwapIntegration", TEST_SWAP_INTEGRATION_ADDRESS);

  // Adding the strategy to the integration
  await addStrategyToIntegration(testSwapIntegration, strategyManager);

  // Registering the Curve pool
  await registerCurvePool(testSwapIntegration, strategyManager);

  // Allocate USDT to the swap strategy
  await allocateToSwapStrategy(testSwapIntegration, stableUnits("10"), strategyManager);

  // Exit from the swap strategy
  await exitFromSwapStrategy(testSwapIntegration, strategyManager);
}

main().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
