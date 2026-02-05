import { parseUnits, Signer, Interface, TransactionResponse } from "ethers";

// ------------------ Helpers ------------------

/// Send Ether from one signer to an address
export async function sendEther(fromSigner: Signer, toAddress: string, amountEth: string) {
  const tx = await fromSigner.sendTransaction({
    to: toAddress,
    value: parseUnits(amountEth, 18),
  });
  console.log(`Sent ${amountEth} ETH from ${await fromSigner.getAddress()} to ${toAddress}`);
  await tx.wait();
  console.log("tx mined:", tx.hash);
}

/// Process a transaction: wait for it to be mined and check for success
export async function processTx(
  tx: TransactionResponse,
  description?: string,
) {
  console.log(`${description} tx sent: ${tx.hash}`);
  const receipt = await tx.wait();
  if (!receipt) {
    throw new Error(`${description} transaction failed: no receipt`);
  }

  if (receipt.status !== 1) {
    throw new Error(`${description} transaction failed`);
  }
  console.log("tx mined, receipt:", receipt);
}

/**
 * Usage:
 * await debugProviderError(async () => {
 *   // your code that may throw a provider error
 * }, contract.interface);
 */
export async function debugProviderError<T>(
  fn: () => Promise<T>,
  iface?: Interface,
): Promise<T> {
  try {
    return await fn();
  } catch (error: unknown) {
    const e = error as { [key: string]: unknown; data?: unknown };

    // dump the full provider error
    console.error(
      JSON.stringify(e, Object.getOwnPropertyNames(e), 2),
    );

    // try to parse custom error using contract interface, if provided
    if (iface && e.data) {
      try {
        const parsed = iface.parseError(e.data as string);
        console.log("Custom error:", parsed);
        console.log("Custom error name:", parsed?.name);
        console.log("Custom error args:", parsed?.args);
      } catch (parseError) {
        console.error("parseError failed, unknown in this ABI", parseError);
      }
    }

    // rethrow so tests / callers still fail normally
    throw error;
  }
}
