import { buildModule } from "@nomicfoundation/hardhat-ignition/modules";
import { getSelectors, FacetCutAction } from "../../scripts/libraries/diamond";
import { getContractInterface } from "../../scripts/libraries/hardhat";

import DiamondModule from "./Diamond";

// HyperStakingModule is in fact a proxy upgrade which adds the Facets to the Diamond
const HyperStakingModule = buildModule("HyperStakingModule", (m) => {
  const mailbox = m.getParameter("lockboxMailbox");
  const destination = m.getParameter("lockboxDestination");

  const { diamond } = m.useModule(DiamondModule);

  // --- accounts

  const owner = m.getAccount(0);
  const stakingManager = m.getAccount(1);
  const vaultManager = m.getAccount(2);
  const strategyManager = m.getAccount(3);

  // --- facets

  const aclFacet = m.contract("HyperStakingAcl");
  const aclInterface = getContractInterface("HyperStakingAcl");
  const aclInterfaceSelectors = getSelectors(aclInterface).remove(["supportsInterface(bytes4)"]);

  const depositFacet = m.contract("DepositFacet");
  const depositFacetInterface = getContractInterface("IDeposit");

  const hyperFactoryFacet = m.contract("HyperFactoryFacet");
  const hyperFactoryFacetInterface = getContractInterface("IHyperFactory");

  const allocationFacet = m.contract("AllocationFacet");
  const allocationInterface = getContractInterface("IAllocation");

  const lockboxFacet = m.contract("LockboxFacet");
  const lockboxFacetInterface = getContractInterface("ILockbox");

  const emaPricingFacet = m.contract("EmaPricingFacet");
  const emaPricingFacetInterface = getContractInterface("IEmaPricing");

  const routeRegistryFacet = m.contract("RouteRegistry");
  const routeRegistryInterface = getContractInterface("IRouteRegistry");

  const stakeInfoRouteFacet = m.contract("StakeInfoRoute");
  const stakeInfoRouteInterface = getContractInterface("IStakeInfoRoute");

  const stakeRewardRouteFacet = m.contract("StakeRewardRoute");
  const stakeRewardRouteInterface = getContractInterface("IStakeRewardRoute");

  const superformIntegrationFacet = m.contract("SuperformIntegrationFacet");
  const superformIntegrationFacetInterface = getContractInterface("ISuperformIntegration");
  const superformIntegrationFacetSelectors = getSelectors(superformIntegrationFacetInterface)
    .remove(["supportsInterface(bytes4)"]);

  const curveIntegrationFacet = m.contract("CurveIntegrationFacet");
  const curveIntegrationFacetInterface = getContractInterface("ICurveIntegration");

  // --- cut struct

  const cut = [
    {
      facetAddress: aclFacet,
      action: FacetCutAction.Add,
      functionSelectors: aclInterfaceSelectors,
    },
    {
      facetAddress: depositFacet,
      action: FacetCutAction.Add,
      functionSelectors: getSelectors(depositFacetInterface),
    },
    {
      facetAddress: hyperFactoryFacet,
      action: FacetCutAction.Add,
      functionSelectors: getSelectors(hyperFactoryFacetInterface),
    },
    {
      facetAddress: allocationFacet,
      action: FacetCutAction.Add,
      functionSelectors: getSelectors(allocationInterface),
    },
    {
      facetAddress: lockboxFacet,
      action: FacetCutAction.Add,
      functionSelectors: getSelectors(lockboxFacetInterface),
    },
    {
      facetAddress: emaPricingFacet,
      action: FacetCutAction.Add,
      functionSelectors: getSelectors(emaPricingFacetInterface),
    },
    {
      facetAddress: routeRegistryFacet,
      action: FacetCutAction.Add,
      functionSelectors: getSelectors(routeRegistryInterface),
    },
    {
      facetAddress: stakeInfoRouteFacet,
      action: FacetCutAction.Add,
      functionSelectors: getSelectors(stakeInfoRouteInterface),
    },
    {
      facetAddress: stakeRewardRouteFacet,
      action: FacetCutAction.Add,
      functionSelectors: getSelectors(stakeRewardRouteInterface),
    },
    {
      facetAddress: superformIntegrationFacet,
      action: FacetCutAction.Add,
      functionSelectors: superformIntegrationFacetSelectors,
    },
    {
      facetAddress: curveIntegrationFacet,
      action: FacetCutAction.Add,
      functionSelectors: getSelectors(curveIntegrationFacetInterface),
    },
  ];

  // --- cut init

  const hyperStakingInit = m.contract("HyperStakingInit");
  const initCall = m.encodeFunctionCall(
    hyperStakingInit, "init", [
      stakingManager,
      vaultManager,
      strategyManager,
      mailbox,
      destination,
    ],
  );

  const diamondCut = m.contractAt("IDiamondCut", diamond);
  m.call(
    diamondCut, "diamondCut", [cut, hyperStakingInit, initCall], { from: owner },
  );

  // --- init facets

  const acl = m.contractAt("HyperStakingAcl", diamond, { id: "acl" });
  const deposit = m.contractAt("IDeposit", diamond);
  const hyperFactory = m.contractAt("IHyperFactory", diamond);
  const allocation = m.contractAt("IAllocation", diamond);
  const lockbox = m.contractAt("ILockbox", diamond);
  const emaPricing = m.contractAt("IEmaPricing", diamond);
  const routeRegistry = m.contractAt("IRouteRegistry", diamond);
  const stakeInfoRoute = m.contractAt("IStakeInfoRoute", diamond);
  const stakeRewardRoute = m.contractAt("IStakeRewardRoute", diamond);
  const superformIntegration = m.contractAt("ISuperformIntegration", diamond);
  const curveIntegration = m.contractAt("ICurveIntegration", diamond);

  // --- return

  return {
    diamond, acl, deposit, hyperFactory, allocation, lockbox, emaPricing, routeRegistry, stakeInfoRoute, stakeRewardRoute, superformIntegration, curveIntegration,
  };
});

export default HyperStakingModule;
