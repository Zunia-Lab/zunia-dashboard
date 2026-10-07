/**
 * Grouping per-chain portfolio rows into assets: proven vouchers merge with
 * their origin, unproven ones never do; unknown stays unknown (null), never 0.
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { groupAssets } from "../holdings";
import type { SpotPrice, TokenIdentity } from "../types";
import type { PortfolioAsset } from "../wire";

function identity(key: string, chainId: string, denom: string, overrides: Partial<TokenIdentity> = {}): TokenIdentity {
  return {
    key,
    chainId,
    denom,
    kind: "native",
    ticker: "ATOM",
    name: "Cosmos Hub ATOM",
    decimals: 6,
    provenance: "native",
    proven: true,
    originChainId: key.split(":")[0] as string,
    ...overrides,
  };
}

const price: SpotPrice = { price: 2, change24h: 10, source: "numia", at: 0 };

function row(id: TokenIdentity, total: number | null, value: number | null, change: number | null): PortfolioAsset {
  return {
    identity: id,
    chainId: id.chainId,
    amounts: { liquid: "0", staked: "0", rewards: "0", unbonding: "0" },
    total,
    price: value === null ? null : price,
    value,
    change24hAbs: change,
    ...(value === null ? { unpriced: total === null ? ("decimals-unknown" as const) : ("no-market" as const) } : {}),
  };
}

describe("groupAssets", () => {
  const hubAtom = identity("cosmoshub-4:uatom", "cosmoshub-4", "uatom");
  const osmoAtom = identity("cosmoshub-4:uatom", "osmosis-1", "ibc/27394", { kind: "ibc", provenance: "table" });
  const fakeAtom = identity("osmosis-1:ibc/FAKE", "osmosis-1", "ibc/FAKE", {
    kind: "ibc",
    ticker: "ATOM·FA4E",
    proven: false,
    provenance: "channel-walk",
    decimals: null,
  });
  const lp = identity("osmosis-1:gamm/pool/1", "osmosis-1", "gamm/pool/1", { ticker: "gamm/pool/1", decimals: null, proven: false });

  it("merges a proven voucher with its origin and names the group from the origin's row", () => {
    const groups = groupAssets([row(osmoAtom, 3, 6, 0.5), row(hubAtom, 10, 20, 1.8)]);
    assert.equal(groups.length, 1);
    const atom = groups[0];
    assert.ok(atom);
    assert.equal(atom.identity.chainId, "cosmoshub-4", "named by the origin chain's own row");
    assert.equal(atom.total, 13);
    assert.equal(atom.value, 26);
    assert.ok(Math.abs((atom.change24hAbs ?? 0) - 2.3) < 1e-9);
    assert.deepEqual(atom.chainIds, ["osmosis-1", "cosmoshub-4"]);
    assert.equal(atom.price?.price, 2);
  });

  it("never merges an unproven look-alike, and keeps unknown as null, sorted after priced", () => {
    const groups = groupAssets([row(lp, null, null, null), row(fakeAtom, null, null, null), row(hubAtom, 10, 20, null)]);
    assert.deepEqual(
      groups.map((group) => group.key),
      ["cosmoshub-4:uatom", "osmosis-1:ibc/FAKE", "osmosis-1:gamm/pool/1"],
    );
    const fake = groups[1];
    assert.ok(fake);
    assert.equal(fake.value, null);
    assert.equal(fake.total, null);
    assert.equal(fake.unpriced, "decimals-unknown");
    assert.equal(groups[0]?.change24hAbs, null, "no row knows its change: unknown, not zero");
  });

  it("adds amounts only when every row's decimals are known", () => {
    const mixed = groupAssets([row(hubAtom, 10, 20, null), row({ ...osmoAtom, decimals: null }, null, null, null)]);
    assert.equal(mixed[0]?.total, null);
    assert.equal(mixed[0]?.value, 20, "the priced part still has a value");
    assert.deepEqual(groupAssets([]), []);
  });
});
