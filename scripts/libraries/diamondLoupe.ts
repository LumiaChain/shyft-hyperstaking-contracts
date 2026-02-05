import { ethers } from "hardhat";
import { Interface, AddressLike } from "ethers";
import { getSelectors } from "./diamond";

// Returns all function selectors that point to the given facet
export async function getSelectorsForFacet(
  diamondAddress: AddressLike,
  facetAddress: AddressLike,
): Promise<string[]> {
  const loupe = await ethers.getContractAt("IDiamondLoupe", diamondAddress.toString());
  return loupe.facetFunctionSelectors(facetAddress);
}

// check if a diamond contract has a particular function selector
export async function diamondHasSelector(
  diamondAddress: AddressLike,
  selector: string,
): Promise<boolean> {
  const loupe = await ethers.getContractAt("IDiamondLoupe", diamondAddress.toString());

  const facetAddress: string = await loupe.facetAddress(selector);

  return facetAddress !== ethers.ZeroAddress;
}

/**
 * Compare current facet selectors in the diamond vs a new Interface.
 *
 * Returns selectors to add, replace, and remove.
 * - addSelectors: in new iface but not on facet
 * - replaceSelectors: in new iface and already on facet
 * - removeSelectors: currently on facet but not in new iface
 */
export async function diffFacetSelectors(
  diamondAddress: AddressLike,
  facetAddress: AddressLike,
  iface: Interface,
): Promise<{
  addSelectors: string[];
  replaceSelectors: string[];
  removeSelectors: string[];
}> {
  const oldSelectors = await getSelectorsForFacet(diamondAddress, facetAddress);
  const newSelectors = getSelectors(iface); // SelectorArray extends Array<string>

  const addSelectors: string[] = [];
  const replaceSelectors: string[] = [];
  const removeSelectors: string[] = [];

  // For each new selector: if exists on facet -> replace, else -> add
  for (const selector of newSelectors) {
    if (oldSelectors.includes(selector)) {
      replaceSelectors.push(selector);
    } else {
      addSelectors.push(selector);
    }
  }

  // For each old selector: if not in new -> remove
  for (const selector of oldSelectors) {
    if (!newSelectors.includes(selector)) {
      removeSelectors.push(selector);
    }
  }

  return { addSelectors, replaceSelectors, removeSelectors };
}
