import { ethers } from "hardhat";
import { parseUnits, parseEther, formatEther } from "ethers";
import { sendEther, processTx } from "./libraries/utils";
import * as shared from "../test/shared";

// Network-specific ignition parameters
// Swap these imports to target a different network
import * as originAddresses from "../ignition/parameters.sepolia.json";
import * as lumiaAddresses from "../ignition/parameters.lumia_beam.json";

// CLI Configuration
const CLI_CONFIG = {
  DEFAULT_COMMAND: "info",
  DEFAULT_STRATEGY_NAME: "Test Native Strategy",
  DEFAULT_STRATEGY_SYMBOL: "tETH1",
  DEFAULT_FEE_RATE: parseEther("0.02"), // 2%
} as const;

// --- Get Contracts ---

async function getContracts() {
  const signers = await shared.getSigners();

  const testStrategy = await ethers.getContractAt(
    "MockReserveStrategy",
    originAddresses.General.testReserveStrategy,
  );

  const ethYieldToken = await ethers.getContractAt(
    "TestERC20",
    originAddresses.General.testEthYieldToken,
  );

  const diamond = originAddresses.General.diamond;

  const hyperFactory = await ethers.getContractAt("IHyperFactory", diamond);
  const deposit = await ethers.getContractAt("IDeposit", diamond);
  const allocation = await ethers.getContractAt("IAllocation", diamond);
  const lockbox = await ethers.getContractAt("ILockbox", diamond);

  return {
    diamond,
    signers,
    testStrategy,
    ethYieldToken,
    hyperFactory,
    deposit,
    allocation,
    lockbox,
  };
}

async function getLumiaContracts() {
  const signers = await shared.getSigners();

  const lumiaDiamond = lumiaAddresses.General.lumiaDiamond;
  const testStrategyAddress = originAddresses.General.testReserveStrategy;

  const hyperlaneHandler = await ethers.getContractAt(
    "IHyperlaneHandler",
    lumiaDiamond,
  );

  const realAssets = await ethers.getContractAt(
    "IRealAssets",
    lumiaAddresses.General.lumiaDiamond,
  );

  return {
    signers,
    testStrategyAddress,
    lumiaDiamond,
    hyperlaneHandler,
    realAssets,
  };
}

// --- Management Commands ---

async function cmdAddStrategy() {
  const { signers, hyperFactory, testStrategy } = await getContracts();
  const { vaultManager } = signers;

  console.log(`Adding reserve strategy ${testStrategy.target} via hyperFactory...`);

  const name = CLI_CONFIG.DEFAULT_STRATEGY_NAME;
  const symbol = CLI_CONFIG.DEFAULT_STRATEGY_SYMBOL;

  const dispatchFee = await hyperFactory.quoteAddStrategy(
    testStrategy,
    name,
    symbol,
  );

  console.log("Dispatch fee for adding strategy:", formatEther(dispatchFee));

  const tx = await hyperFactory.connect(vaultManager).addStrategy(
    testStrategy,
    name,
    symbol,
    { value: dispatchFee },
  );

  await processTx(tx, "Add Strategy");
}

async function cmdSetStrategyAssetPrice() {
  const { signers, testStrategy } = await getContracts();
  const { strategyManager } = signers;

  const newPrice = parseEther("2.0"); // new price in ETH +100% from 1 ETH

  console.log(
    `Setting new asset price for strategy ${testStrategy.target} to ${formatEther(newPrice)}...`,
  );

  const tx = await testStrategy.connect(strategyManager).setAssetPrice(newPrice);
  await processTx(tx, "Set Strategy Asset Price");
}

async function cmdSupplyStrategy() {
  // hardcoded values for simplicity
  const amountRaw = 1000; // amount of yield tokens (without decimals);
  const decimals = 18;

  const amount = parseUnits(amountRaw.toString(), decimals);

  const { signers, testStrategy, ethYieldToken } = await getContracts();
  const { owner, strategyManager } = signers;

  console.log(
    `Supplying ${amountRaw} of asset ${ethYieldToken.target} to testStrategy...`,
  );

  let tx;

  // mint yield tokens to strategyManager
  tx = await ethYieldToken.connect(owner).mint(strategyManager, amount);
  await processTx(tx, "Mint yield tokens to strategyManager");

  tx = await ethYieldToken.connect(strategyManager).approve(
    testStrategy,
    amount,
  );
  await processTx(tx, "Approve yield tokens to testStrategy");

  tx = await testStrategy
    .connect(strategyManager)
    .supplyRevenueAsset(amount);
  await processTx(tx, "Supply revenue asset to testStrategy");
}

async function cmdSetupLockbox() {
  const { signers, lockbox } = await getContracts();
  const { vaultManager } = signers;

  const newDestination = originAddresses.General.lockboxDestination;
  const newLumiaFactory = originAddresses.General.lockboxLumiaFactory;

  console.log("Setting up lockbox...");
  console.log("New destination:", newDestination);

  let tx;
  tx = await lockbox.connect(vaultManager).setDestination(newDestination);
  await processTx(tx, "Set Lockbox Destination");

  tx = await lockbox.connect(vaultManager).proposeLumiaFactory(newLumiaFactory);
  await processTx(tx, "Propose Lumia Factory");

  // in a real scenario, there would be a timelock delay here
  tx = await lockbox.connect(vaultManager).applyLumiaFactory();
  await processTx(tx, "Apply Lumia Factory");

  console.log("Lockbox setup complete.");
}

async function cmdSetOriginISM() {
  const { signers, lockbox } = await getContracts();
  const { vaultManager } = signers;

  const newISM = originAddresses.General.lockboxISM;
  console.log("Setting new origin Lockbox ISM:", newISM);

  const tx = await lockbox.connect(vaultManager).setInterchainSecurityModule(newISM);
  await processTx(tx, "Set Lockbox ISM");
}

async function cmdSetOriginHook() {
  const { signers, lockbox } = await getContracts();
  const { vaultManager } = signers;

  const newHook = originAddresses.General.lockboxHook;
  console.log("Setting new origin Lockbox Post Dispatch Hook:", newHook);

  const tx = await lockbox.connect(vaultManager).setHook(newHook);
  await processTx(tx, "Set Lockbox Post Dispatch Hook");
}

async function cmdSetLumiaISM() {
  const { signers, hyperlaneHandler } = await getLumiaContracts();
  const { lumiaFactoryManager } = signers;

  const newISM = lumiaAddresses.General.lumiaISM;
  console.log("Setting new lumia ISM:", newISM);

  const tx = await hyperlaneHandler.connect(lumiaFactoryManager).setInterchainSecurityModule(newISM);
  await processTx(tx, "Set Lumia ISM");
}

async function cmdSetFeeData() {
  const { signers, allocation, testStrategy } = await getContracts();
  const { bob, vaultManager } = signers;

  const newFeeRate = CLI_CONFIG.DEFAULT_FEE_RATE;
  const newFeeRecipient = bob.address;

  console.log(
    `Setting new fee data for strategy ${testStrategy.target}: rate=${formatEther(newFeeRate)}, recipient=${newFeeRecipient}...`,
  );

  await processTx(
    await allocation.connect(vaultManager).setFeeRecipient(
      testStrategy,
      newFeeRecipient,
    ),
    "Set Fee Recipient",
  );

  await processTx(
    await allocation.connect(vaultManager).setFeeRate(
      testStrategy,
      newFeeRate,
    ),
    "Set Fee Rate",
  );
}

async function cmdSetupHyperlaneHandler() {
  const { signers, hyperlaneHandler } = await getLumiaContracts();
  const { lumiaFactoryManager } = signers;

  const originLockbox = originAddresses.General.diamond;

  const tx = await hyperlaneHandler
    .connect(lumiaFactoryManager)
    .updateAuthorizedOrigin(
      originLockbox,
      true,
      lumiaAddresses.General.originDestination,
    );
  await processTx(tx, "Authorize Origin Lockbox");
}

async function cmdSetLumiaMailbox() {
  const { signers, hyperlaneHandler } = await getLumiaContracts();
  const { lumiaFactoryManager } = signers;

  const mailbox = lumiaAddresses.General.lumiaMailbox;

  const tx = await hyperlaneHandler
    .connect(lumiaFactoryManager)
    .setMailbox(mailbox);
  await processTx(tx, "Set Lumia Mailbox");
}

// --- Main Operations Commands ---

async function cmdReportRevenue() {
  const { signers, testStrategy, allocation } = await getContracts();
  const { vaultManager } = signers;

  console.log(`Reporting revenue for strategy ${testStrategy.target}...`);

  const stakeAdded = await allocation.checkRevenue(testStrategy.target);
  console.log("Stake added from revenue:", formatEther(stakeAdded));

  const dispatchFee = await allocation.quoteReport(testStrategy.target);

  console.log("Dispatch fee for reporting revenue:", formatEther(dispatchFee));

  const tx = await allocation.connect(vaultManager).report(
    testStrategy,
    { value: dispatchFee },
  );

  await processTx(tx, "Report Strategy Revenue");
}

async function cmdStakeDeposit() {
  const { signers, deposit, testStrategy } = await getContracts();
  const { alice } = signers;

  const stakeAmount = parseEther("0.05");
  console.log(`Staking deposit of ${formatEther(stakeAmount)} ETH for strategy ${testStrategy.target}...`);

  const dispatchFee = await deposit.quoteDepositDispatch(
    testStrategy,
    alice,
    stakeAmount,
  );

  console.log("Dispatch fee for staking deposit:", formatEther(dispatchFee));

  const tx = await deposit.connect(alice).deposit(
    testStrategy,
    alice,
    stakeAmount,
    { value: stakeAmount + dispatchFee },
  );

  await processTx(tx, "Stake Deposit");
}

async function cmdSharesRedeem() {
  const { signers, realAssets, hyperlaneHandler, testStrategyAddress } = await getLumiaContracts();
  const { alice } = signers;

  const sharesAmount = parseEther("0.04");
  console.log(`Redeeming ${formatEther(sharesAmount)} shares for strategy ${testStrategyAddress}...`);

  const routeInfo = await hyperlaneHandler.getRouteInfo(testStrategyAddress);
  const shares = await ethers.getContractAt(
    "LumiaVaultShares", routeInfo.vaultShares,
  );

  console.log("Shares Vault address:", shares.target);
  console.log("Total shares supply:", formatEther(await shares.totalSupply()));
  console.log("Alice shares balance before redeem:", formatEther(await shares.balanceOf(alice)));

  // optional (for third-party allowance):
  // await processTx(
  //   await shares.connect(alice).approve(
  //     realAssets,
  //     sharesAmount,
  //   ),
  //   "Approve Shares to RealAssets",
  // );

  const dispatchFee = await realAssets.quoteRedeem(
    testStrategyAddress,
    alice,
    sharesAmount,
  );

  console.log("Dispatch fee for redeem:", formatEther(dispatchFee));

  await processTx(
    await realAssets.connect(alice).redeem(
      testStrategyAddress,
      alice,
      alice,
      sharesAmount,
      { value: dispatchFee },
    ),
    "Redeem Shares",
  );
}

async function cmdReexecuteFailedRedeem() {
  const { signers, lockbox } = await getContracts();
  const { alice } = signers;

  console.log(`Reexecuting failed redeem messages for ${alice.address}...`);

  const failedRedeemId = 0;
  const tx = await lockbox.connect(alice).reexecuteFailedRedeem(failedRedeemId);
  await processTx(tx, "Reexecute Failed Redeem Messages");
}

async function cmdClaimWithdraw() {
  const { signers, deposit, testStrategy } = await getContracts();
  const { alice } = signers;

  console.log(`Claiming withdraw for user ${alice.address} on strategy ${testStrategy.target}...`);

  const ids = [4];

  const tx = await deposit.connect(alice).claimWithdraws(ids, alice);
  await processTx(tx, "Claim Withdraw");
}

// --- Info Commands ---

async function cmdInfo() {
  const {
    diamond, signers, testStrategy, ethYieldToken, deposit, allocation, hyperFactory, lockbox,
  } = await getContracts();

  const { owner, strategyManager, vaultManager, alice } = signers;

  // native ETH balances
  const strategyEthBalance = await ethers.provider.getBalance(testStrategy);
  const diamondEthBalance = await ethers.provider.getBalance(diamond);
  const ownerEthBalance = await ethers.provider.getBalance(owner);
  const aliceEthBalance = await ethers.provider.getBalance(alice);
  const vaultManagerEthBalance = await ethers.provider.getBalance(vaultManager);

  // yield token balances
  const strategyBalance = await ethYieldToken.balanceOf(testStrategy);
  const diamondBalance = await ethYieldToken.balanceOf(diamond);

  console.log("=== Info ===");
  console.log("testStrategy:", testStrategy.target);
  console.log("depositFacet (diamond):", deposit.target);
  console.log("ethYieldToken:", ethYieldToken.target);

  console.log("owner:", owner.address);
  console.log("strategyManager:", strategyManager.address);
  console.log("vaultManager:", vaultManager.address);
  console.log("alice:", alice.address);

  console.log("==============");

  console.log("Native ETH balance (testStrategy):", formatEther(strategyEthBalance));
  console.log("Native ETH balance (diamond):", formatEther(diamondEthBalance));
  console.log("Native ETH balance (owner):", formatEther(ownerEthBalance));
  console.log("Native ETH balance (vaultManager):", formatEther(vaultManagerEthBalance));
  console.log("Native ETH balance (alice):", formatEther(aliceEthBalance));

  console.log("ethYieldToken balance (testStrategy):", formatEther(strategyBalance));
  console.log("ethYieldToken balance (diamond):", formatEther(diamondBalance));

  console.log("==============");

  const strategyAssetPrice = await testStrategy.previewExit(parseEther("1"));
  console.log("Strategy asset price (in ETH):", formatEther(strategyAssetPrice));

  console.log("==============");
  console.log("Stake Info:");

  const stakeInfo = await allocation.stakeInfo(testStrategy);
  console.log({
    totalStake: formatEther(stakeInfo.totalStake),
    totalAllocation: formatEther(stakeInfo.totalAllocation),
    pendingExitStake: formatEther(stakeInfo.pendingExitStake),
  });

  console.log("==============");
  console.log("Vault Info:");

  const vaultInfo = await hyperFactory.vaultInfo(testStrategy);
  console.log({
    enabled: vaultInfo.enabled,
    strategy: vaultInfo.strategy,
    stakeCurrency: vaultInfo.stakeCurrency.token,
    revenueAsset: vaultInfo.revenueAsset,
    feeRecipient: vaultInfo.feeRecipient,
    feeRate: formatEther(vaultInfo.feeRate),
    bridgeSafetyMargin: formatEther(vaultInfo.bridgeSafetyMargin),
  });

  console.log("==============");
  console.log("Lockbox data:");

  const lockboxData = await lockbox.lockboxData();
  console.log({
    mailbox: lockboxData.mailbox,
    ism: lockboxData.ism,
    postDispatchHook: lockboxData.postDispatchHook,
    destination: lockboxData.destination,
    lumiaFactory: lockboxData.lumiaFactory,
    lastMessage: lockboxData.lastMessage,
  });

  console.log("==============");
}

async function getUserFailedRedeems() {
  const { signers, lockbox } = await getContracts();
  const { alice } = signers;

  const userAddress = alice.address;

  const ids = await lockbox.getUserFailedRedeemIds(userAddress);

  console.log(`Failed redeem IDs for user ${userAddress}:`);
  console.log(JSON.stringify(
    ids.map((id) => id.toString()),
  ));

  const failedRedeems = await lockbox.getFailedRedeems([...ids]);
  for (let i = 0; i < ids.length; i++) {
    const redeem = failedRedeems[i];
    console.log(`Failed Redeem ID ${ids[i]}:`, {
      strategy: redeem.strategy,
      user: redeem.user,
      amount: formatEther(redeem.amount),
    });
  }
}

async function getUserLastClaims() {
  const { signers, deposit, testStrategy } = await getContracts();
  const { alice } = signers;

  const userAddress = alice.address;

  const limit = 10;
  const lastClaimIds = await deposit.lastClaims(testStrategy, userAddress, limit);

  console.log(`Last ${limit} claims for user ${userAddress} on strategy ${testStrategy.target}:`);
  console.log(JSON.stringify(
    lastClaimIds.map((id) => id.toString()),
  ));

  const claims = await deposit.pendingWithdrawClaims([...lastClaimIds]);
  for (let i = 0; i < lastClaimIds.length; i++) {
    const claim = claims[i];
    console.log(`Claim ID ${lastClaimIds[i]}:`, {
      strategy: claim.strategy,
      unlockTime: new Date(Number(claim.unlockTime) * 1000).toISOString(),
      eligible: claim.eligible,
      expectedAmount: formatEther(claim.expectedAmount),
      feeWithdraw: claim.feeWithdraw,
    });
  }
}

async function cmdLumiaInfo() {
  const { signers, testStrategyAddress, lumiaDiamond, hyperlaneHandler } = await getLumiaContracts();
  const { lumiaFactoryManager, alice } = signers;

  // native LUMIA balances
  const lumiaFactoryManagerLumiaBalance = await ethers.provider.getBalance(lumiaFactoryManager);
  const aliceLumiaBalance = await ethers.provider.getBalance(alice);

  console.log("=== Lumia Info ===");
  console.log("lumiaDiamond:", lumiaDiamond);
  console.log("hyperlaneHandler:", hyperlaneHandler.target);

  console.log("lumiaFactoryManager:", lumiaFactoryManager.address);

  const mailbox = await hyperlaneHandler.mailbox();
  const ism = await hyperlaneHandler.interchainSecurityModule();
  const postDispatchHook = await hyperlaneHandler.hook();
  console.log("mailbox:", mailbox);
  console.log("ISM:", ism);
  console.log("postDispatchHook:", postDispatchHook);

  console.log("==============");

  console.log("Native LUMIA balance (lumiaFactoryManager):", formatEther(lumiaFactoryManagerLumiaBalance));
  console.log("Native LUMIA balance (alice):", formatEther(aliceLumiaBalance));

  console.log("==============");

  const routeInfo = await hyperlaneHandler.getRouteInfo(testStrategyAddress);
  if (routeInfo.exists) {
    console.log("Route Info for test strategy:");
    console.log({
      originDestination: routeInfo.originDestination,
      originLockbox: routeInfo.originLockbox,
      assetToken: routeInfo.assetToken,
      vaultShares: routeInfo.vaultShares,
    });

    const principal = await ethers.getContractAt(
      "LumiaPrincipal", routeInfo.assetToken,
    );
    const shares = await ethers.getContractAt(
      "LumiaVaultShares", routeInfo.vaultShares,
    );

    // total supplies
    const principalTotalSupply = await principal.totalSupply();
    const sharesTotalSupply = await shares.totalSupply();

    console.log("Lumia Principal total supply:", formatEther(principalTotalSupply));
    console.log("Lumia Vault Shares total supply:", formatEther(sharesTotalSupply));

    // alice shares balance
    const aliceSharesBalance = await shares.balanceOf(alice.address);
    console.log("Vault Shares balance (alice):", formatEther(aliceSharesBalance));
  } else {
    console.log("No route info for test strategy.");
  }
  console.log("==============");
}

// --- Help Command ---

function printHelp() {
  console.log(`
╔════════════════════════════════════════════════════════════╗
║              HyperStaking CLI - Command Reference          ║
╚════════════════════════════════════════════════════════════╝

MANAGEMENT COMMANDS:
  add-strategy                 Add a new reserve strategy
  supply-strategy             Supply yield tokens to strategy
  set-strategy-asset-price    Update strategy asset price
  setup-lockbox               Configure lockbox settings
  set-origin-ism              Set origin lockbox ISM
  set-origin-hook             Set origin lockbox post-dispatch hook
  set-lumia-ism               Set lumia ISM
  set-fee-data                Configure fee rate and recipient
  setup-hyperlane-handler     Setup Hyperlane handler
  set-lumia-mailbox           Set Lumia mailbox

OPERATION COMMANDS:
  report-revenue              Report and compound strategy revenue
  stake-deposit               Deposit and stake ETH
  shares-redeem               Redeem shares for assets
  reexecute-failed-redeem     Retry failed redeem messages
  claim-withdraw              Claim pending withdrawals

INFO COMMANDS:
  info                        Display general info (default)
  lumia-info                  Display Lumia chain info
  get-user-failed-redeems     Get user's failed redeems
  get-user-last-claims        Get user's recent claims
  help                        Show this help message

UTILITY COMMANDS:
  send-ether                  Send ETH to an address

USAGE:
  CMD=<command> npx hardhat run scripts/hyper-cli.ts --network <network>

EXAMPLES:
  CMD=info npx hardhat run scripts/hyper-cli.ts --network sepolia
  CMD=stake-deposit npx hardhat run scripts/hyper-cli.ts --network sepolia
  CMD=help npx hardhat run scripts/hyper-cli.ts

  `);
}

// --- Main ---

async function main() {
  // hardhat script cant take args, so we use env var for command
  let command = process.env.CMD;
  if (!command) {
    command = CLI_CONFIG.DEFAULT_COMMAND;
  }

  switch (command) {
    // --- Management Commands ---

    case "add-strategy": {
      await cmdAddStrategy();
      break;
    }
    case "supply-strategy": {
      await cmdSupplyStrategy();
      break;
    }
    case "set-strategy-asset-price": {
      await cmdSetStrategyAssetPrice();
      break;
    }
    case "setup-lockbox": {
      await cmdSetupLockbox();
      break;
    }
    case "set-origin-ism": {
      await cmdSetOriginISM();
      break;
    }
    case "set-origin-hook": {
      await cmdSetOriginHook();
      break;
    }
    case "set-lumia-ism": {
      await cmdSetLumiaISM();
      break;
    }
    case "set-fee-data": {
      await cmdSetFeeData();
      break;
    }
    case "setup-hyperlane-handler": {
      await cmdSetupHyperlaneHandler();
      break;
    }
    case "set-lumia-mailbox": {
      await cmdSetLumiaMailbox();
      break;
    }

    // --- Main Operations Commands ---

    case "report-revenue": {
      await cmdReportRevenue();
      break;
    }
    case "stake-deposit": {
      await cmdStakeDeposit();
      break;
    }
    case "shares-redeem": {
      await cmdSharesRedeem();
      break;
    }
    case "reexecute-failed-redeem": {
      await cmdReexecuteFailedRedeem();
      break;
    }
    case "claim-withdraw": {
      await cmdClaimWithdraw();
      break;
    }

    // --- Info Commands ---

    case "info": {
      await cmdInfo();
      break;
    }

    case "get-user-failed-redeems": {
      await getUserFailedRedeems();
      break;
    }

    case "get-user-last-claims": {
      await getUserLastClaims();
      break;
    }

    case "lumia-info": {
      await cmdLumiaInfo();
      break;
    }

    // --- Help ---

    case "help": {
      printHelp();
      break;
    }

    // --- Utility Commands ---

    case "send-ether": {
      const { signers } = await getContracts();
      await sendEther(
        signers.owner,
        signers.strategyManager.address,
        "0.2",
      );
      break;
    }
    default:
      console.error(`❌ Unknown command: ${command}`);
      console.log("Run 'CMD=help' to see available commands\n");
      printHelp();
      process.exitCode = 1;
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
