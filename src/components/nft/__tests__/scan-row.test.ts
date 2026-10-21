/**
 * The sources panel's scan row, in words.
 *
 * "Nothing asked" is not "nothing found", and a scan has three ways to be
 * nothing: it did not run, it could not run, or it ran and found no
 * collection. Each gets its own sentence, and a scan that ran names the window
 * it looked at instead of implying it covered the chain.
 */

import assert from "node:assert/strict";
import { test } from "node:test";

import type { NftChainScanWire, NftCollectionsBody } from "@/lib/nft/wire";
import { chainScanRow } from "../scan-row";

function body(scan: NftChainScanWire | null): NftCollectionsBody {
  return {
    chainId: "safrochain-1",
    chainName: "Safrochain",
    owner: "addr_safro1owner",
    holdings: [],
    sources: [],
    complete: false,
    limitation: null,
    issues: [],
    plan: { knownContractCount: 0, userContracts: [], indexerName: null, indexerConfigKey: "ZUNIA_NFT_INDEXER_URL", scan },
    queriedContractCount: scan?.contractCount ?? 0,
  };
}

const RAN: NftChainScanWire = {
  status: "ran",
  codesChecked: 16,
  codesUnread: 0,
  newestFirst: true,
  contractCount: 13,
  checkedAt: 1,
};

/** Setting names and paths are operator documentation, never page copy. */
const OPERATOR_WORDS = /ZUNIA_|[A-Z]{2,}_[A-Z]{2,}|\.mjs|scripts\/|zunia-extension|=1\b/;

test("a scan that ran names its window and the collections it asked", () => {
  const row = chainScanRow("Safrochain", true, body(RAN));
  assert.equal(row.state, "13");
  assert.equal(row.on, true);
  assert.match(row.detail, /checked the newest 16 contract codes on Safrochain/);
  assert.match(row.detail, /asked the 13 collections/);
  assert.match(row.detail, /can still be added by address/);
});

test("found none, could not run and did not run are three different rows", () => {
  const none = chainScanRow("Safrochain", true, body({ ...RAN, contractCount: 0 }));
  const failed = chainScanRow("Safrochain", true, body({ ...RAN, status: "failed", codesChecked: 0, contractCount: 0, checkedAt: null }));
  const missing = chainScanRow("Safrochain", true, body(null));

  assert.equal(none.state, "0");
  assert.match(none.detail, /none of them is an NFT collection/);
  assert.equal(failed.state, "Could not run");
  assert.match(failed.detail, /did not answer, so no collection was found this way/);
  assert.equal(missing.state, "Not run");
  assert.match(missing.detail, /only collections whose address is known were asked/);
  assert.equal(new Set([none.detail, failed.detail, missing.detail]).size, 3);
});

test("codes that did not answer are said, not folded into the count", () => {
  const row = chainScanRow("Safrochain", true, body({ ...RAN, codesChecked: 14, codesUnread: 2 }));
  assert.match(row.detail, /newest 14 contract codes/);
  assert.match(row.detail, /2 more codes did not answer and will be checked again shortly/);
});

test("a node that would not sort its codes does not get called newest", () => {
  const row = chainScanRow("Safrochain", true, body({ ...RAN, newestFirst: false }));
  assert.match(row.detail, /checked 16 contract codes/);
  assert.doesNotMatch(row.detail, /newest/);
});

test("with an index configured the scan is off, and before an answer it only says what it does", () => {
  assert.equal(chainScanRow("Safrochain", false, body(RAN)).state, "Not needed");
  const waiting = chainScanRow("Safrochain", true, null);
  assert.equal(waiting.state, "On");
  assert.doesNotMatch(waiting.detail, /\d/);
});

test("no row names a setting", () => {
  const rows = [
    chainScanRow("Safrochain", false, null),
    chainScanRow("Safrochain", true, null),
    chainScanRow("Safrochain", true, body(null)),
    chainScanRow("Safrochain", true, body(RAN)),
    chainScanRow("Safrochain", true, body({ ...RAN, status: "failed" })),
  ];
  for (const row of rows) assert.doesNotMatch(row.detail, OPERATOR_WORDS);
});
