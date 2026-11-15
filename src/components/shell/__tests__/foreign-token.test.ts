/**
 * An amount somebody else moved is worded with the moved denom's identity,
 * never the holding chain's own symbol: 15 USDC.inj on Safrochain is not
 * "15 SAF", and not a guessed scale for an unknown voucher.
 */

import assert from "node:assert/strict";
import { test } from "node:test";

import type { ActivityItem } from "@/lib/activity/types";
import { deriveNotices } from "@/lib/notifications/derive";
import { composeIncoming, coinWords } from "@/lib/server/push/compose";
import { tokenPhrase } from "@/lib/token/text";
import type { TokenIdentity } from "@/lib/token/types";
import { activityInputs } from "../notice-inputs";

const USDC_INJ_ON_SAF: TokenIdentity = {
  key: "injective-1:erc20:0xa00C59fF5a080D2b954d0c75e46E22a0c371235a",
  chainId: "safrochain-1",
  denom: "ibc/AAAA",
  kind: "ibc",
  ticker: "USDC.inj",
  name: "Injective USDC",
  decimals: 6,
  provenance: "table",
  proven: true,
  originChainId: "injective-1",
  originChainName: "Injective",
};
const USDC_INJ_HOME: TokenIdentity = { ...USDC_INJ_ON_SAF, chainId: "injective-1", denom: "erc20:0xa00C", kind: "erc20" };
const UNKNOWN: TokenIdentity = {
  key: "safrochain-1:ibc/BBBB",
  chainId: "safrochain-1",
  denom: "ibc/BBBB",
  kind: "ibc",
  ticker: "IBC·BBBB",
  name: "Unknown token",
  decimals: null,
  provenance: "unknown",
  proven: false,
};

function row(identity: TokenIdentity, amount: string): ActivityItem {
  return {
    chainId: identity.chainId,
    address: "addr",
    hash: "H1",
    height: 1,
    time: "2026-11-15T10:00:00Z",
    kind: "receive",
    summary: "Received",
    success: true,
    amounts: [{ direction: "in", denom: identity.denom, amount, identity }],
  } as unknown as ActivityItem;
}

test("tokenPhrase names the token and where it is from", () => {
  assert.equal(tokenPhrase(USDC_INJ_ON_SAF), "USDC.inj (Injective USDC)");
  assert.equal(tokenPhrase(USDC_INJ_HOME), "USDC.inj");
  assert.equal(tokenPhrase(UNKNOWN), "IBC·BBBB");
});

test("a received foreign denom reads with its own ticker, name and decimals", () => {
  const [input] = activityInputs([row(USDC_INJ_ON_SAF, "15000000")]);
  assert.equal(input?.amountText, "15 USDC.inj (Injective USDC)");
  const [home] = activityInputs([row(USDC_INJ_HOME, "15000000")]);
  assert.equal(home?.amountText, "15 USDC.inj");
  assert.doesNotMatch(input?.amountText ?? "", /SAF/);
});

test("an unknown voucher is never scaled by a guessed exponent", () => {
  const [input] = activityInputs([row(UNKNOWN, "15000000")]);
  assert.match(input?.amountText ?? "", /^15,000,000 base units of IBC·BBBB$/);
});

test("the feed's notice carries the same words", () => {
  const [input] = activityInputs([row(USDC_INJ_ON_SAF, "15000000")]);
  const { notices } = deriveNotices({
    now: Date.parse("2026-11-15T11:00:00Z"),
    account: "addr",
    activity: input ? [input] : [],
    prefs: { transfers: true, ibc: true, swaps: true } as never,
    state: { v: 1, announced: [], accounts: { addr: { since: 0, seenAt: 0, seeded: true, sources: [], rewards: { cycle: 0, phase: "idle" } as never, unbonding: [], validators: {} } }, cycles: 0 },
  });
  const transfer = notices.find((n) => n.kind === "transfer");
  assert.equal(transfer?.title, "Received 15 USDC.inj (Injective USDC) on safrochain-1");
});

test("the push words name a foreign token, and stay silent on an unnamed one", () => {
  const coin = { amount: "15000000", denom: "ibc/AAAA", ticker: "USDC.inj", decimals: 6, name: "Injective USDC" };
  assert.equal(coinWords(coin)?.text, "15 USDC.inj (Injective USDC)");
  assert.equal(coinWords({ ...coin, name: null })?.text, "15 USDC.inj");
  const notice = composeIncoming(
    { chainId: "safrochain-1", chainName: "Safrochain", hash: "H", at: 1, coins: [coin], senders: ["saf1abc"], ibc: null, refund: false },
    1,
  );
  assert.equal(notice?.title, "Received 15 USDC.inj (Injective USDC) on Safrochain");
  assert.doesNotMatch(notice?.title ?? "", /SAF\b/);
});
