import { ethers } from "hardhat";
import { FacetCutAction, printSelector, getSelectors } from "./libraries/diamond";
import { diffFacetSelectors } from "./libraries/diamondLoupe";
import { getContractInterface } from "./libraries/hardhat";
import promptSync from "prompt-sync";

import { Addressable, ZeroAddress } from "ethers";

// import * as addresses from "../ignition/parameters.sepolia.json";
import * as addresses from "../ignition/parameters.lumia_beam.json";
import { processTx } from "./libraries/utils";

/**
 * This script adds or upgrades a facet in a Diamond
 *
 * For UPGRADE: set OLD_FACET_ADDRESS to the existing facet address
 *   It diffs selectors to determine add/replace/remove actions
 *
 * For NEW FACET: leave OLD_FACET_ADDRESS as empty string
 *   All selectors from the interface will be added

 * Instructions:
 * 1. Set OLD_FACET_ADDRESS (or leave empty for new facet)
 * 2. Set the FACET_CONTRACT_NAME to the new facet to deploy
 * 3. Set the FACET_CONTRACT_INTERFACE to the interface name
 * 4. Optionally set EXCLUDE_SELECTORS for selectors to skip.
 * 5. Run: `npx hardhat run --network <network> scripts/diamondCut.ts`
 */

const OLD_FACET_ADDRESS = "";

const FACET_CONTRACT_NAME = "LumiaDiamondAcl";
const FACET_CONTRACT_INTERFACE = "LumiaDiamondAcl";

// Selectors to exclude (e.g. supportsInterface already registered by another facet)
const EXCLUDE_SELECTORS: string[] = ["supportsInterface(bytes4)"];

async function main() {
  // const diamond = addresses.General.diamond;
  const diamond = addresses.General.lumiaDiamond;

  const isUpgrade = OLD_FACET_ADDRESS !== "";

  console.log(
    isUpgrade
      ? `Upgrading facet ${FACET_CONTRACT_NAME} at address: ${OLD_FACET_ADDRESS} in diamond: ${diamond}`
      : `Adding new facet ${FACET_CONTRACT_NAME} to diamond: ${diamond}`,
  );
  console.log("\n");

  // -- Determine selectors

  const facetInterface = getContractInterface(FACET_CONTRACT_INTERFACE);

  let addSelectors: string[] = [];
  let replaceSelectors: string[] = [];
  let removeSelectors: string[] = [];

  if (isUpgrade) {
    const diff = await diffFacetSelectors(
      diamond,
      OLD_FACET_ADDRESS,
      facetInterface,
    );
    addSelectors = diff.addSelectors.filter(s => !EXCLUDE_SELECTORS.includes(s));
    replaceSelectors = diff.replaceSelectors.filter(s => !EXCLUDE_SELECTORS.includes(s));
    removeSelectors = diff.removeSelectors;
  } else {
    addSelectors = getSelectors(facetInterface).remove(EXCLUDE_SELECTORS);
  }

  console.log("Selectors to add:", addSelectors.map((s) => printSelector(facetInterface, s)));
  console.log("Selectors to replace:", replaceSelectors.map((s) => printSelector(facetInterface, s)));
  console.log("Selectors to remove:", removeSelectors.map((s) => printSelector(facetInterface, s)));
  console.log("\n");

  // are you sure to continue?
  const prompt = promptSync({ sigint: true });
  const answer = prompt("Do you want to continue? (yes/no): ")?.trim().toLowerCase();
  if (answer !== "yes") {
    console.log("Exiting");
    return;
  }

  // -- Deploy new facet

  let newFacetAddress: string | Addressable = ZeroAddress;

  // Only deploy if we have selectors to add or replace
  if (addSelectors.length > 0 || replaceSelectors.length > 0) {
    const newFacet = await ethers.deployContract(FACET_CONTRACT_NAME);
    await newFacet.waitForDeployment();
    console.log(`Deployed new facet ${FACET_CONTRACT_NAME} at address:`, newFacet.target);
    newFacetAddress = newFacet.target;
  }

  // -- Prepare diamond cut

  const cut = [];

  if (addSelectors.length > 0) {
    cut.push({
      facetAddress: newFacetAddress,
      action: FacetCutAction.Add,
      functionSelectors: addSelectors,
    });
  }

  if (replaceSelectors.length > 0) {
    cut.push({
      facetAddress: newFacetAddress,
      action: FacetCutAction.Replace,
      functionSelectors: replaceSelectors,
    });
  }

  if (removeSelectors.length > 0) {
    cut.push({
      facetAddress: ZeroAddress,
      action: FacetCutAction.Remove,
      functionSelectors: removeSelectors,
    });
  }

  if (cut.length === 0) {
    console.log("No changes in facet selectors. Exiting.");
    return;
  }

  // -- Execute diamond cut

  const diamondCut = await ethers.getContractAt(
    "IDiamondCut",
    diamond,
  );

  const tx = await diamondCut.diamondCut(cut, ZeroAddress, "0x");
  await processTx(tx, "Diamond cut");

  console.log("Finished");
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
