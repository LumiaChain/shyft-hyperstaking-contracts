/*
 * base source: https://github.com/mudgen/diamond-3-hardhat/tree/main/scripts/libraries
 * library upgraded to ethers v6 and rewritten to typescript
 */

import { ethers, Interface, FunctionFragment, AddressLike, BytesLike } from "ethers";

export enum FacetCutAction {
  Add = 0,
  Replace = 1,
  Remove = 2,
}

export class SelectorArray extends Array<string> {
  iface?: Interface;

  constructor(...args: string[]) {
    super(...args);
    // Needed for extending arrays in TypeScript
    Object.setPrototypeOf(this, SelectorArray.prototype);
  }

  static getSelectors (iface: Interface): SelectorArray {
    const selectors = new SelectorArray();
    selectors.iface = iface;

    for (const f of iface.fragments) {
      if (f.type === "function") {
        const functionFragment = f as FunctionFragment;
        selectors.push(functionFragment.selector);
      }
    }

    return selectors;
  }

  // get function selector from function signature
  static getSelector (funcSig: string) {
    return FunctionFragment.from(funcSig).selector;
  }

  // Method to remove selectors based on function signatures
  remove(funcSigs: string[]): SelectorArray {
    const filteredSelectors = this.filter((selector) => {
      return !funcSigs.some((fn) => SelectorArray.getSelector(fn) === selector);
    });

    return new SelectorArray(...filteredSelectors);
  }

  // Method to get selectors based on function signatures
  get(funcSigs: string[]): SelectorArray {
    const filteredSelectors = this.filter((selector) => {
      return funcSigs.some((fn) => SelectorArray.getSelector(fn) === selector);
    });
    return new SelectorArray(...filteredSelectors);
  }

  // Method to remove selectors based on function names
  removeByNames(funcNames: string[]): SelectorArray {
    const iface = this.iface;

    const filteredSelectors = this.filter((selector) => {
      return !funcNames.some((fn) => iface?.getFunction(fn)?.selector === selector);
    });

    return new SelectorArray(...filteredSelectors);
  }

  // Method to get selectors based on function names
  getByNames(functionNames: string[]): SelectorArray {
    const iface = this.iface;

    const filteredSelectors = this.filter((selector) => {
      return functionNames.some((fn) => iface?.getFunction(fn)?.selector === selector);
    });
    return new SelectorArray(...filteredSelectors);
  }

  // Method to push new selector strings into the instance array
  add(selectors: string[]): SelectorArray {
    this.push(...selectors); // Directly use `push` since we're extending Array
    return this;
  }
}

// Extract selectors from Contract Interface, return SelectorArray
export function getSelectors(iface: Interface): SelectorArray {
  const selectors = new SelectorArray();
  selectors.iface = iface;

  for (const fragment of iface.fragments) {
    if (fragment.type === "function") {
      const functionFragment = fragment as FunctionFragment;
      selectors.push(functionFragment.selector); // Push to the array directly
    }
  }

  return selectors;
}

// Remove selectors using an array of signatures
export function removeSelectors (selectors: string[], signatures: string[]) {
  const iface = new ethers.Interface(signatures.map(v => "function " + v));
  const removeSelectors = signatures.map(v => iface.getFunction(v)?.selector);
  selectors = selectors.filter(v => !removeSelectors.includes(v));
  return selectors;
}

export type FacetStruct = {
  facetAddress: AddressLike;
  functionSelectors: BytesLike[];
};

// find a particular address position in the return value of diamondLoupeFacet.facets()
export function findAddressPositionInFacets (facetAddress: string, facets: FacetStruct[]): number {
  for (let i = 0; i < facets.length; i++) {
    if (facets[i].facetAddress === facetAddress) {
      return i;
    }
  }
  return -1;
}

// find FunctionFragment by selector
export function findFunctionFragmentBySelector(
  iface: Interface,
  selector: string,
): FunctionFragment | undefined {
  for (const fragment of iface.fragments) {
    if (fragment.type !== "function") continue;
    const fn = fragment as FunctionFragment;
    if (fn.selector === selector) {
      return fn;
    }
  }
  return undefined;
}

// get function signature from selector
// return undefined if not found
export function getFunctionSignatureFromSelector(
  iface: Interface,
  selector: string,
): string | undefined {
  const fragment = findFunctionFragmentBySelector(iface, selector);
  return fragment?.format("sighash");
}

// Print selector, if not found in interface, print as hex string
export function printSelector(
  iface: Interface,
  selector: string,
): string {
  const sig = getFunctionSignatureFromSelector(iface, selector);
  if (sig) {
    return sig;
  } else {
    return selector;
  }
}
