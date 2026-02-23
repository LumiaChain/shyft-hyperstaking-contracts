import { buildModule } from "@nomicfoundation/hardhat-ignition/modules";
import { getSelectors, FacetCutAction } from "../../scripts/libraries/diamond";
import { getContractInterface } from "../../scripts/libraries/hardhat";

import DiamondModule from "./Diamond";

// LumiaDiamondModule is a Diamond Proxy setup for Lumia and with applied Facets
const LumiaDiamondModule = buildModule("LumiaDiamondModule", (m) => {
  const mailbox = m.getParameter("lumiaMailbox");

  const { diamond } = m.useModule(DiamondModule);

  // --- accounts

  const owner = m.getAccount(0);
  const lumiaFactoryManager = m.getAccount(4);

  // --- facets

  const aclFacet = m.contract("LumiaDiamondAcl");
  const aclInterface = getContractInterface("LumiaDiamondAcl");
  const aclInterfaceSelectors = getSelectors(aclInterface).remove(["supportsInterface(bytes4)"]);

  const hyperlaneHandlerFacet = m.contract("HyperlaneHandlerFacet");
  const hyperlaneHandlerInterface = getContractInterface("IHyperlaneHandler");

  const realAssetFacet = m.contract("RealAssetsFacet");
  const realAssetInterface = getContractInterface("IRealAssets");

  const stakeRedeemRouteFacet = m.contract("StakeRedeemRoute");
  const stakeRedeemRouteInterface = getContractInterface("IStakeRedeemRoute");

  // --- cut struct

  const cut = [
    {
      facetAddress: aclFacet,
      action: FacetCutAction.Add,
      functionSelectors: aclInterfaceSelectors,
    },
    {
      facetAddress: hyperlaneHandlerFacet,
      action: FacetCutAction.Add,
      functionSelectors: getSelectors(hyperlaneHandlerInterface),
    },
    {
      facetAddress: realAssetFacet,
      action: FacetCutAction.Add,
      functionSelectors: getSelectors(realAssetInterface),
    },
    {
      facetAddress: stakeRedeemRouteFacet,
      action: FacetCutAction.Add,
      functionSelectors: getSelectors(stakeRedeemRouteInterface),
    },
  ];

  // --- cut init

  const lumiaDiamondInit = m.contract("LumiaDiamondInit");

  // _calldata A function call, including function selector and arguments,
  // _calldata is executed with delegatecall on _init
  const initCall = m.encodeFunctionCall(
    lumiaDiamondInit, "init", [mailbox],
  );

  const diamondCut = m.contractAt("IDiamondCut", diamond);
  const diamondCutFuture = m.call(
    diamondCut, "diamondCut", [cut, lumiaDiamondInit, initCall], { from: owner },
  );

  // --- grant roles

  const acl = m.contractAt("LumiaDiamondAcl", diamond, { id: "acl" });
  const LUMIA_FACTORY_MANAGER_ROLE = m.staticCall(
    acl, "LUMIA_FACTORY_MANAGER_ROLE", [], 0, { after: [diamondCutFuture] },
  );

  m.call(
    acl,
    "grantRole",
    [LUMIA_FACTORY_MANAGER_ROLE, lumiaFactoryManager],
    { id: "grantRoleFactoryManager", after: [diamondCutFuture] },
  );

  // --- init facets

  const hyperlaneHandler = m.contractAt("IHyperlaneHandler", diamond);
  const realAssets = m.contractAt("IRealAssets", diamond);
  const stakeRedeemRoute = m.contractAt("IStakeRedeemRoute", diamond);

  // --- return

  return { lumiaDiamond: diamond, hyperlaneHandler, realAssets, stakeRedeemRoute };
});

export default LumiaDiamondModule;
