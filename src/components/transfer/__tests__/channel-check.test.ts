/**
 * The route's channels in words, with the page's own pair checks
 * (src/components/transfer/channel-check.ts): a route never opens as
 * "not verified" while its check simply has not finished.
 */

import assert from "node:assert/strict";
import { describe, test } from "node:test";

import type { ChannelLinkWire } from "@/lib/interchain/wire";
import { CHECKING_VERDICT, hopVerdict, linkWithCheck, pairKey, pairsToCheck, routeBadge, type PairCheck } from "../channel-check";

const SEED: ChannelLinkWire = {
  sourceChainId: "safrochain-1",
  destChainId: "osmosis-1",
  channelId: "channel-1",
  port: "transfer",
  source: "seed",
  state: "unknown",
};
const VERIFIED: ChannelLinkWire = { ...SEED, source: "verified", state: "open", counterpartyChannelId: "channel-110497" };

const checks = (check: PairCheck) => new Map([[pairKey("safrochain-1", "osmosis-1"), check]]);

describe("a hop's channel, with the page's own check", () => {
  test("reads as checking, in neutral words, while the pair's check runs", () => {
    const verdict = hopVerdict(SEED, checks({ status: "checking", links: [], failures: [] }));
    assert.equal(verdict, CHECKING_VERDICT);
    assert.equal(verdict.tone, "neutral");
    assert.deepEqual(routeBadge([verdict]), { label: "Checking channels", tone: "neutral" });
  });

  test("reads as verified once the check confirmed the same channel, whatever the plan said", () => {
    const done = checks({ status: "done", links: [VERIFIED], failures: [] });
    assert.deepEqual(linkWithCheck(SEED, done), VERIFIED);
    assert.equal(hopVerdict(SEED, done).label, "Verified · open");
    assert.deepEqual(routeBadge([hopVerdict(SEED, done)]), { label: "Channels verified", tone: "success" });
  });

  test("says 'not verified' only once the check finished without confirming that channel", () => {
    const otherChannel = checks({ status: "done", links: [{ ...VERIFIED, channelId: "channel-9" }], failures: [] });
    assert.equal(hopVerdict(SEED, otherChannel).label, "Registry default");
    assert.deepEqual(routeBadge([hopVerdict(SEED, otherChannel)]), { label: "Not fully verified", tone: "warning" });
    const failed = checks({ status: "failed", links: [], failures: ["Safrochain did not answer."] });
    assert.equal(hopVerdict(SEED, failed).tone, "warning");
  });

  test("never overrides a closed channel or one typed by hand", () => {
    const done = checks({ status: "done", links: [VERIFIED], failures: [] });
    assert.equal(hopVerdict({ ...SEED, state: "closed" }, done).label, "Closed");
    assert.equal(hopVerdict({ ...SEED, source: "manual" }, done).label, "Entered by hand");
  });

  test("keeps a plan's own verified channel as it is", () => {
    assert.equal(hopVerdict(VERIFIED, checks({ status: "checking", links: [], failures: [] })).label, "Verified · open");
  });
});

describe("the pairs a page checks", () => {
  test("starts with its two networks before any route, then adds each hop", () => {
    assert.deepEqual(pairsToCheck("safrochain-1", "osmosis-1"), [["safrochain-1", "osmosis-1"]]);
    assert.deepEqual(pairsToCheck(null, "osmosis-1"), []);
    assert.deepEqual(pairsToCheck("osmosis-1", "osmosis-1"), []);
    assert.deepEqual(
      pairsToCheck("safrochain-1", "noble-1", [
        { chainId: "safrochain-1", counterpartyChainId: "osmosis-1", channelId: "channel-1" },
        { chainId: "osmosis-1", counterpartyChainId: "noble-1", channelId: "channel-750" },
        { chainId: "osmosis-1", counterpartyChainId: null, channelId: "" },
      ]),
      [
        ["safrochain-1", "noble-1"],
        ["safrochain-1", "osmosis-1"],
        ["osmosis-1", "noble-1"],
      ],
    );
  });
});
