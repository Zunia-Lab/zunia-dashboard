/**
 * The "Found on chain" row of the sources disclosure, as words.
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
      detail: "An NFT index answers instead.",
    };
  }
  if (!result) {
    return {
      state: "On",
      on: true,
      detail: `Looks through ${chainName}\u2019s newest contract codes for collections.`,
    };
  }
  const scan: NftChainScanWire | null = result.plan.scan;
  if (!scan) {
    return {
      state: "Not run",
      on: false,
      detail: "Not run this time.",
    };
  }
  if (scan.status === "failed") {
    return {
      state: "Could not run",
      on: false,
      detail: `${chainName}\u2019s contract codes didn\u2019t answer. Retries shortly.`,
    };
  }
  const found =
    scan.contractCount > 0
      ? `Checked ${scanWindow(scan)}; ${scan.contractCount} ${scan.contractCount === 1 ? "collection" : "collections"} found.`
      : `Checked ${scanWindow(scan)}; none is a collection.`;
  const unread =
    scan.codesUnread > 0
      ? ` ${scan.codesUnread} more ${scan.codesUnread === 1 ? "code" : "codes"} didn\u2019t answer.`
      : "";
  return { state: `${scan.contractCount}`, on: true, detail: `${found}${unread}` };
}
