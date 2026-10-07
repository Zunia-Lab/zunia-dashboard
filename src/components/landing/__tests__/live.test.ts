/**
 * The live preview's rules (src/components/landing/live.ts): assets matched
 * by key, provenance from the sources that answered, APR bars with honest
 * gaps and the one-sentence highlight.
 */

import assert from "node:assert/strict";
import { describe, test } from "node:test";

import type { ChainStats } from "@/lib/chain/types";
import type { MarketAsset, MarketSourceStatus } from "@/lib/token/wire";
import { aprDetail, aprSummary, assetRowLabel, changeDirection, marketProvenance, pickLiveAssets } from "../live";

function asset(key: string, symbol: string, price = 1): MarketAsset {
  return {
    key,
    symbol,
    name: symbol,
    price,
    change24h: 0,
    change7d: 0,
    volume24h: null,
    liquidity: null,
    marketCap: null,
    sparkline7d: null,
    tradable: true,
    verified: true,
    source: "numia",
  };
}

function stats(chainId: string, apr: Partial<ChainStats["apr"]>, extra: Partial<ChainStats> = {}): ChainStats {
  return {
    chainId,
    chainName: chainId,
    apr: { naive: null, actual: null, source: "lcd", blockTimeFactor: null, excludesFees: true, ...apr },
    ...extra,
  } as ChainStats;
}

describe("pickLiveAssets", () => {
  test("matches on the asset key, not the ticker, in the order asked", () => {
    const rows = pickLiveAssets(
      [asset("osmosis-1:ibc/FAKE", "ATOM", 99), asset("osmosis-1:uosmo", "OSMO"), asset("cosmoshub-4:uatom", "ATOM", 1.78)],
      [
        { key: "cosmoshub-4:uatom", symbol: "ATOM", chainId: "cosmoshub-4" },
        { key: "osmosis-1:uosmo", symbol: "OSMO", chainId: "osmosis-1" },
      ],
    );
    assert.deepEqual(
      rows.map((row) => [row.key, row.asset?.price]),
      [
        ["cosmoshub-4:uatom", 1.78],
        ["osmosis-1:uosmo", 1],
      ],
    );
  });

  test("an asset no source lists stays in its row, empty", () => {
    const rows = pickLiveAssets([], [{ key: "injective-1:inj", symbol: "INJ", chainId: "injective-1" }]);
    assert.equal(rows[0].asset, null);
  });
});

/**
 * The label-in-name comparison axe-core makes (label-content-name-mismatch):
 * parentheticals dropped, anything but letters and digits made a space, and
 * the visible words must appear, in order and together, in the name.
 */
function words(text: string): string[] {
  let out = text.normalize("NFKD");
  for (let previous = ""; previous !== out; ) {
    previous = out;
    out = out.replace(/\([^()]*\)/g, "");
  }
  return out
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .split(/\s+/)
    .filter(Boolean);
}

function nameHoldsLabel(visible: string, name: string): boolean {
  const needle = words(visible);
  const haystack = words(name);
  for (let start = 0; start + needle.length <= haystack.length; start++) {
    if (needle.every((word, index) => haystack[start + index] === word)) return true;
  }
  return false;
}

describe("assetRowLabel", () => {
  const atom = { symbol: "ATOM", chainName: "Cosmos Hub", price: "$1.71", change24h: "−3.72%", change7d: "+1.12%" };

  test("the visible text in source order, then what only the subtitle says", () => {
    assert.equal(assetRowLabel(atom), "ATOM Cosmos Hub, $1.71, −3.72% (24 hours), +1.12% 7d");
  });

  test("holds the row's visible text at every width", () => {
    const label = assetRowLabel(atom);
    // Source order: symbol, network, price, 24 h change, 7-day change + "7d".
    assert.ok(nameHoldsLabel("ATOM Cosmos Hub $1.71 −3.72% +1.12% 7d", label));
    // Below 380px the 7-day column is hidden.
    assert.ok(nameHoldsLabel("ATOM Cosmos Hub $1.71 −3.72%", label));
  });

  test("the source note and unknown changes never break the match", () => {
    const saf = assetRowLabel({ symbol: "SAF", chainName: "Safrochain", note: "via Coinstore", price: "$0.0123", change24h: null, change7d: null });
    assert.equal(saf, "SAF Safrochain (via Coinstore), $0.0123, (24-hour change unknown), 7d (unknown)");
    // ≥1280 shows "(via Coinstore)"; an unknown change prints "—", and the 7-day one keeps its "7d".
    assert.ok(nameHoldsLabel("SAF Safrochain (via Coinstore) $0.0123 — — 7d", saf));
    assert.ok(nameHoldsLabel("SAF Safrochain $0.0123 —", saf));
  });
});

describe("changeDirection", () => {
  test("the sign of the printed figure; zero and unknown are flat", () => {
    assert.equal(changeDirection(1.12), "up");
    assert.equal(changeDirection(-0.004), "down");
    assert.equal(changeDirection(0), "flat");
    assert.equal(changeDirection(null), "flat");
    assert.equal(changeDirection(Number.NaN), "flat");
  });
});

describe("marketProvenance", () => {
  const source = (id: MarketSourceStatus["id"], label: string, ok: boolean, at: number | null): MarketSourceStatus => ({ id, label, url: "", ok, at });

  test("names the sources that answered, aged by the oldest", () => {
    assert.deepEqual(marketProvenance([source("numia", "Numia · Osmosis", true, 2000), source("coinstore", "Coinstore SAF/USDT", true, 1000)]), {
      label: "Numia · Osmosis + Coinstore SAF/USDT",
      at: 1000,
    });
  });

  test("a failed source is left out; none at all says so", () => {
    assert.equal(marketProvenance([source("numia", "Numia · Osmosis", true, 5), source("coinstore", "Coinstore SAF/USDT", false, null)]).label, "Numia · Osmosis");
    assert.deepEqual(marketProvenance([source("numia", "Numia · Osmosis", false, null)]), { label: "No market source answered", at: null });
  });
});

describe("aprSummary", () => {
  test("bars in percent units; unknown APRs listed with the server's reason", () => {
    const summary = aprSummary([
      stats("safrochain-1", { naive: 0.1027, actual: 0.1851, blockTimeFactor: 1.8 }),
      stats("celestia", { naive: 0.0551, actual: 0.0551 }),
      stats("akashnet-2", { actual: null, note: "mint not readable" }, { reasons: { apr: "LCD timed out" } }),
      stats("juno-1", { actual: null, note: "mint not readable" }),
      stats("weird-1", { actual: -0.02 }),
    ]);
    assert.deepEqual(
      summary.bars.map((bar) => [bar.chainId, Number(bar.actual.toFixed(2))]),
      [
        ["safrochain-1", 18.51],
        ["celestia", 5.51],
      ],
    );
    assert.deepEqual(
      summary.missing.map((row) => [row.chainId, row.reason]),
      [
        ["akashnet-2", "LCD timed out"],
        ["juno-1", "mint not readable"],
        ["weird-1", "Not computable from this chain's public data right now"],
      ],
    );
    assert.equal(summary.thirdParty, false);
  });

  test("highlights the biggest block-time gap, only when it is worth a sentence", () => {
    const summary = aprSummary([
      stats("cosmoshub-4", { naive: 0.154, actual: 0.1958, blockTimeFactor: 1.27 }),
      stats("safrochain-1", { naive: 0.1027, actual: 0.1851, blockTimeFactor: 1.8 }),
      stats("akashnet-2", { naive: 0.0397, actual: 0.0405, blockTimeFactor: 1.02 }),
    ]);
    assert.equal(summary.highlight?.chainId, "safrochain-1");
    assert.equal(aprSummary([stats("akashnet-2", { naive: 0.0397, actual: 0.0405, blockTimeFactor: 1.02 })]).highlight, null);
  });

  test("flags a third-party figure", () => {
    assert.equal(aprSummary([stats("celestia", { actual: 0.05, source: "cosmos.directory" })]).thirdParty, true);
  });
});

describe("aprDetail", () => {
  const oneDigit = (value: number) => `${value.toFixed(1)}%`;

  test("compares at the printed precision", () => {
    // 3.97% published, 4.05% actual: both print as 4.0%, so no "parameters say 4.0%".
    assert.equal(aprDetail({ actual: 4.05, naive: 3.97, source: "lcd" }, oneDigit), "Same as the published rate");
    assert.equal(aprDetail({ actual: 18.53, naive: 10.27, source: "lcd" }, oneDigit), "Mint parameters say 10.3%");
  });

  test("never claims a match it cannot check", () => {
    assert.equal(aprDetail({ actual: 5.5, naive: null, source: "lcd" }, oneDigit), "No published rate to compare with");
  });

  test("labels a third-party figure first", () => {
    assert.equal(aprDetail({ actual: 5.5, naive: 5.5, source: "cosmos.directory" }, oneDigit), "Third-party figure (cosmos.directory)");
  });
});
