/**
 * The browser side of the contract: URLs the routes accept and the shape
 * guards `useApi` parses with.
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { activityUrl, parseActivityPage, parseTxDetailBody, txUrl } from "@/lib/data/activity";
import { ACCOUNTS } from "./helpers";

describe("activityUrl", () => {
  const accounts = [
    { chainId: "safrochain-1", address: ACCOUNTS.vinjan },
    { chainId: "osmosis-1", address: ACCOUNTS.treasury },
  ];

  it("keeps the account order (the cursor is bound to it) and sorts kinds (one URL per filter)", () => {
    const url = new URL(activityUrl({ accounts, limit: 20, kinds: ["vote", "claim"] }), "http://x");
    assert.equal(url.pathname, "/api/activity");
    assert.equal(url.searchParams.get("accounts"), `safrochain-1:${ACCOUNTS.vinjan},osmosis-1:${ACCOUNTS.treasury}`);
    assert.equal(url.searchParams.get("kinds"), "claim,vote");
    assert.equal(url.searchParams.get("limit"), "20");
  });

  it("sends the cursor instead of `before` when it has one", () => {
    const url = new URL(activityUrl({ accounts, cursor: "v1.abc", before: "2026-07-01T00:00:00Z" }), "http://x");
    assert.equal(url.searchParams.get("cursor"), "v1.abc");
    assert.equal(url.searchParams.get("before"), null);
    const timed = new URL(activityUrl({ accounts, before: "2026-07-01T00:00:00Z" }), "http://x");
    assert.equal(timed.searchParams.get("before"), "2026-07-01T00:00:00Z");
  });

  it("builds the detail URL, private only with an address", () => {
    assert.equal(txUrl("osmosis-1", "AB"), "/api/activity/AB?chainId=osmosis-1");
    assert.equal(txUrl("osmosis-1", "AB", ACCOUNTS.treasury), `/api/activity/AB?chainId=osmosis-1&address=${ACCOUNTS.treasury}`);
  });
});

describe("shape guards", () => {
  it("keeps well-formed rows and refuses what is not a page", () => {
    const good = { chainId: "osmosis-1", address: "osmo1x", hash: "AB", time: "2026-10-01T00:00:00Z", kind: "send", summary: "Sent", success: true, amounts: [] };
    const page = parseActivityPage({ updatedAt: 1, items: [good, { hash: 3 }], coverage: [], nextCursor: null, nextBefore: null });
    assert.equal(page?.items.length, 1);
    assert.equal(parseActivityPage({ updatedAt: 1, items: [], coverage: [], nextCursor: 5, nextBefore: null }), null);
    assert.equal(parseActivityPage({ error: "upstream_failed" }), null);
    assert.equal(parseTxDetailBody({ hash: "AB", chainId: "osmosis-1", messages: [] })?.hash, "AB");
    assert.equal(parseTxDetailBody({ hash: "AB" }), null);
  });
});
