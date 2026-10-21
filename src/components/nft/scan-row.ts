/**
 * The "Collections found on chain" row of the sources panel, as words.
 *
 * Kept out of the component so the honesty rules are tested where they are
 * written: "could not run" and "found none" are different rows, a scan the
 * page cannot read is "not run", and every sentence names the window of codes
 * it looked at, never the whole chain.
 */

import { scanWindow } from "@/lib/nft/chain-scan";
import type { NftChainScanWire, NftCollectionsBody } from "@/lib/nft/wire";

/**
 * What the row says before discovery has answered, then what the scan did.
 * `enabled` is the deployment's answer (`discovery.chainScan`): off only when
 * an NFT index is configured.
 */
export function chainScanRow(
  chainName: string,
  enabled: boolean,
  result: NftCollectionsBody | null,
): { state: string; on: boolean; detail: string } {
  if (!enabled) {
    return {
      state: "Not needed",
      on: false,
      detail: "The NFT index answers on this deployment, so the chain's contracts are not looked through.",
    };
  }
  if (!result) {
    return {
      state: "On",
      on: true,
      detail: `Zunia looks through the newest contract codes on ${chainName} for NFT collections, and asks each one.`,
    };
  }
  const scan: NftChainScanWire | null = result.plan.scan;
  if (!scan) {
    return {
      state: "Not run",
      on: false,
      detail: `${chainName} was not looked through this time, so only collections whose address is known were asked.`,
    };
  }
  if (scan.status === "failed") {
    return {
      state: "Could not run",
      on: false,
      detail: `${chainName}'s list of contract codes did not answer, so no collection was found this way. Zunia asks again shortly.`,
    };
  }
  const found =
    scan.contractCount > 0
      ? `Zunia checked ${scanWindow(scan)} on ${chainName} and asked the ${scan.contractCount} ${scan.contractCount === 1 ? "collection" : "collections"} among them. A collection it did not reach can still be added by address.`
      : `Zunia checked ${scanWindow(scan)} on ${chainName}, and none of them is an NFT collection.`;
  const unread =
    scan.codesUnread > 0
      ? ` ${scan.codesUnread} more ${scan.codesUnread === 1 ? "code" : "codes"} did not answer and will be checked again shortly.`
      : "";
  return { state: `${scan.contractCount}`, on: true, detail: `${found}${unread}` };
}
