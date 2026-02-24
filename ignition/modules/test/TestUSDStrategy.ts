import { buildModule } from "@nomicfoundation/hardhat-ignition/modules";
import { parseEther, parseUnits } from "ethers";

const TOKEN_SUPPLY = parseUnits("21000000", 6);
const STRATEGY_SUPPLY = parseUnits("1000000", 6); // pre-supplied reserve strategy

const TestUsdStrategyModule = buildModule("TestUsdStrategyModule", (m) => {
  const diamond = m.getParameter("diamond");
  const assetPrice = m.getParameter("assetPrice", parseEther("1"));

  const strategyManager = m.getAccount(3);

  // --- deploy USD stake token

  const usdStakeToken = m.contract("TestERC20", [
    "USD Stake Token",
    "tUSD",
    TOKEN_SUPPLY,
    6,
  ], { id: "UsdStakeToken" });

  // --- deploy USD yield token (what strategy returns as allocation)

  const usdYieldToken = m.contract("TestERC20", [
    "USD Yield Token",
    "tUSDy",
    TOKEN_SUPPLY,
    6,
  ], { id: "UsdYieldToken" });

  // --- deploy mock reserve strategy: stake=tUSD, asset=tUSDy, price=1:1

  const impl = m.contract("MockReserveStrategy", [], { id: "impl" });

  const initCalldata = m.encodeFunctionCall(impl, "initialize", [
    diamond,
    { token: usdStakeToken },
    usdYieldToken,
    assetPrice,
  ]);

  const proxy = m.contract("ERC1967Proxy", [impl, initCalldata]);
  const reserveStrategy = m.contractAt("MockReserveStrategy", proxy);

  // --- supply yield tokens to strategy

  // mint yield tokens to strategyManager
  const mintFuture = m.call(usdYieldToken, "mint", [strategyManager, STRATEGY_SUPPLY], {
    id: "MintYieldTokensToStrategyManager",
    from: m.getAccount(0),
  });

  // approve strategy to pull yield tokens
  const approveFuture = m.call(usdYieldToken, "approve", [proxy, STRATEGY_SUPPLY], {
    id: "ApproveYieldTokensToStrategy",
    from: strategyManager,
    after: [mintFuture],
  });

  // supply revenue asset into strategy reserve
  m.call(reserveStrategy, "supplyRevenueAsset", [STRATEGY_SUPPLY], {
    id: "SupplyRevenueAsset",
    from: strategyManager,
    after: [approveFuture],
  });

  return { usdStakeToken, usdYieldToken, proxy, reserveStrategy };
});

export default TestUsdStrategyModule;
