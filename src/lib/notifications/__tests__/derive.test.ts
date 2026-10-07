/**
 * The feed's contract: same inputs, same rows, same ids — and the ids are the
 * ones every other producer (the push poller, another tab) builds for the same
 * event. A derivation that drifts here re-alerts people for things they read.
 */

import assert from "node:assert/strict";
import { test } from "node:test";

import { deriveNotices, FEED_LIMITS, pendingAnnouncements, type DeriveInput } from "@/lib/notifications/derive";
import { noticeId } from "@/lib/notifications/ids";
import { DEFAULT_NOTIFY_PREFS, inQuietHours } from "@/lib/notifications/prefs";
import { INITIAL_NOTICE_STATE, parseNoticeState, type NoticeState } from "@/lib/notifications/state";
import type { Notice, NotifyPrefs } from "@/lib/notifications/types";

const T0 = Date.parse("2026-10-07T08:00:00Z");
const MIN = 60_000;
const HOUR = 60 * MIN;
const DAY = 24 * HOUR;
const ACCOUNT = "osmo1gv86dp8wmnmmatdckgr5xkevnpmy4662stl5rm";
const ALL_ON: NotifyPrefs = { ...DEFAULT_NOTIFY_PREFS, governance: true, unbonding: true };
const NAMES: Record<string, string> = { "osmosis-1": "Osmosis", "cosmoshub-4": "Cosmos Hub" };
const chainName = (id: string) => NAMES[id] ?? id;

function run(partial: Partial<DeriveInput> & { now: number; state: NoticeState }) {
  return deriveNotices({ account: ACCOUNT, prefs: ALL_ON, chainName, ...partial });
}

/** Derives twice: the first call seeds the account's watermark at `seedAt`. */
function seeded(seedAt = T0): NoticeState {
  return run({ now: seedAt, state: INITIAL_NOTICE_STATE }).state;
}

const ids = (notices: readonly Notice[]) => notices.map((notice) => notice.id);

test("same inputs and clock give the same rows, ids and state", () => {
  const state = seeded();
  const input = {
    now: T0 + 2 * HOUR,
    state,
    activity: [
      {
        chainId: "osmosis-1",
        hash: "7b5e447b64067cf2e5e31d4921927156c3f9b9b913e06895239e0795d72b57f3",
        kind: "receive",
        time: "2026-10-07T09:00:00Z",
        summary: "Received 0.5 OSMO from osmo1zva9…8mm",
        direction: "in" as const,
        amountText: "0.5 OSMO",
      },
    ],
  };
  const a = run(input);
  const b = run(input);
  assert.deepEqual(a, b);
  assert.deepEqual(ids(a.notices), [
    "transfer:7B5E447B64067CF2E5E31D4921927156C3F9B9B913E06895239E0795D72B57F3",
  ]);
  assert.equal(a.notices[0].title, "Received 0.5 OSMO on Osmosis");
  assert.equal(a.notices[0].url, "/activity/7B5E447B64067CF2E5E31D4921927156C3F9B9B913E06895239E0795D72B57F3?chainId=osmosis-1");
  assert.equal(a.notices[0].data?.amount, "0.5 OSMO");
});

test("history from before the first look at an account is not news", () => {
  const state = seeded(T0);
  const { notices } = run({
    now: T0 + HOUR,
    state,
    activity: [
      { chainId: "osmosis-1", hash: "AA", kind: "receive", time: T0 - DAY, summary: "old", direction: "in" },
      { chainId: "osmosis-1", hash: "BB", kind: "receive", time: T0 + 10 * MIN, summary: "new", direction: "in" },
      { chainId: "osmosis-1", hash: "CC", kind: "send", time: T0 + 20 * MIN, summary: "sent", direction: "out" },
    ],
  });
  assert.deepEqual(ids(notices), ["transfer:BB"]);
});

test("IBC arrivals name the source chain; swaps report their outcome", () => {
  const state = seeded();
  const { notices } = run({
    now: T0 + HOUR,
    state,
    activity: [
      {
        chainId: "osmosis-1",
        hash: "11",
        kind: "ibc",
        time: T0 + 5 * MIN,
        summary: "Received 2 ATOM over IBC",
        direction: "in",
        counterpartyChainId: "cosmoshub-4",
        amountText: "2 ATOM",
      },
      { chainId: "osmosis-1", hash: "22", kind: "swap", time: T0 + 6 * MIN, summary: "Swapped 10 OSMO → 4.3 USDC", direction: "self" },
      { chainId: "osmosis-1", hash: "33", kind: "swap", time: T0 + 7 * MIN, summary: "Swap failed", direction: "self", success: false },
    ],
  });
  const byId = new Map(notices.map((notice) => [notice.id, notice]));
  assert.equal(byId.get("transfer:11")?.kind, "ibc");
  assert.equal(byId.get("transfer:11")?.title, "Arrived from Cosmos Hub");
  assert.equal(byId.get("transfer:11")?.body, "2 ATOM landed on Osmosis.");
  assert.equal(byId.get("swap:22")?.severity, "success");
  assert.equal(byId.get("swap:33")?.severity, "danger");
  assert.equal(byId.get("swap:33")?.title, "Swap failed on Osmosis");
});

test("rewards: waiting → raised once → rearmed after a claim → raised only at one whole token", () => {
  let state = seeded();
  const at = (now: number, rewardsWhole: number) =>
    run({ now, state, portfolio: { chains: [{ chainId: "osmosis-1", rewardsWhole, nativeSymbol: "OSMO" }] } });

  let result = at(T0 + MIN, 0.2);
  assert.deepEqual(ids(result.notices), ["rewards:1"], "raised as soon as anything is claimable");
  assert.equal(result.notices[0].body, "Waiting on Osmosis. Claim them from Staking.");
  state = result.state;

  result = at(T0 + 2 * MIN, 0.5);
  assert.deepEqual(ids(result.notices), ["rewards:1"], "growing rewards do not re-raise");
  state = result.state;

  result = at(T0 + 3 * MIN, 0);
  assert.deepEqual(ids(result.notices), [], "claimed: the notice goes");
  state = result.state;

  result = at(T0 + 4 * MIN, 0.3);
  assert.deepEqual(ids(result.notices), [], "a few micro-units after a claim are not a new cycle");
  state = result.state;

  result = at(T0 + 5 * MIN, 1.2);
  assert.deepEqual(ids(result.notices), ["rewards:2"], "one whole token raises the next cycle");
});

test("rewards: a failed read is not a claim, and daily reminders raise a new cycle", () => {
  let state = seeded();
  const chains = (rewardsWhole: number, failed = false) => ({
    chains: [{ chainId: "osmosis-1", rewardsWhole, nativeSymbol: "OSMO", failed }],
  });
  state = run({ now: T0 + MIN, state, portfolio: chains(2) }).state;
  const failed = run({ now: T0 + 2 * MIN, state, portfolio: chains(0, true) });
  assert.deepEqual(ids(failed.notices), ["rewards:1"]);
  state = failed.state;

  const daily = { ...ALL_ON, rewards: "daily" as const };
  const sameDay = run({ now: T0 + 3 * HOUR, state, prefs: daily, portfolio: chains(2.5) });
  assert.deepEqual(ids(sameDay.notices), ["rewards:1"]);
  const nextDay = run({ now: T0 + MIN + DAY, state: sameDay.state, prefs: daily, portfolio: chains(3) });
  assert.deepEqual(ids(nextDay.notices), ["rewards:2"]);
});

test("rewards cycle numbers stay unique across accounts", () => {
  let state = seeded();
  state = run({
    now: T0 + MIN,
    state,
    portfolio: { chains: [{ chainId: "osmosis-1", rewardsWhole: 1, nativeSymbol: "OSMO" }] },
  }).state;
  const other = deriveNotices({
    now: T0 + 2 * MIN,
    account: "cosmos1other",
    prefs: ALL_ON,
    state,
    portfolio: { chains: [{ chainId: "cosmoshub-4", rewardsWhole: 1, nativeSymbol: "ATOM" }] },
  });
  assert.deepEqual(ids(other.notices), ["rewards:2"]);
});

test("unbonding: tracked while pending, announced on completion even after it leaves the list", () => {
  let state = seeded();
  const completion = "2026-10-08T10:15:00.123456789Z";
  const completesAt = Date.parse("2026-10-08T10:15:00.123Z");
  const entry = {
    chainId: "cosmoshub-4",
    validator: "cosmosvaloper1abc",
    completionTime: completion,
    amountText: "12.5 ATOM",
    validatorName: "Allnodes",
  };
  let result = run({ now: T0 + MIN, state, staking: { unbonding: [entry], validators: [] } });
  assert.deepEqual(ids(result.notices), [], "nothing while it is pending");
  state = result.state;

  // The chain drops a matured entry a block later: the next read lacks it.
  result = run({ now: completesAt + 2 * MIN, state, staking: { unbonding: [], validators: [] } });
  assert.deepEqual(ids(result.notices), [noticeId.unbonding("cosmoshub-4", "cosmosvaloper1abc", completesAt)]);
  assert.equal(result.notices[0].body, "12.5 ATOM from Allnodes is liquid again on Cosmos Hub.");
  assert.equal(result.notices[0].id, `unbonding:cosmoshub-4:cosmosvaloper1abc:${completesAt}`);
});

test("unbonding: a cancelled entry (gone before its time) is dropped silently", () => {
  let state = seeded();
  const entry = {
    chainId: "cosmoshub-4",
    validator: "cosmosvaloper1abc",
    completionTime: T0 + 10 * DAY,
    amountText: "1 ATOM",
  };
  state = run({ now: T0 + MIN, state, staking: { unbonding: [entry], validators: [] } }).state;
  state = run({ now: T0 + 2 * MIN, state, staking: { unbonding: [], validators: [] } }).state;
  const later = run({ now: T0 + 11 * DAY, state, staking: { unbonding: [], validators: [] } });
  assert.deepEqual(ids(later.notices), []);
});

test("unbonding: a chain whose staking read failed keeps its pending entries (not read as cancelled)", () => {
  let state = seeded();
  const completesAt = T0 + 2 * DAY;
  const entry = { chainId: "cosmoshub-4", validator: "cosmosvaloper1abc", completionTime: completesAt, amountText: "3 ATOM" };
  state = run({ now: T0 + MIN, state, staking: { unbonding: [entry], validators: [] } }).state;
  // The Hub's read fails for a while: its list is unknown, not empty.
  state = run({ now: T0 + HOUR, state, staking: { unbonding: [], validators: [], failedChains: ["cosmoshub-4"] } }).state;
  // Still failing when the entry matures, and gone from the chain's list once it answers again.
  state = run({ now: completesAt + MIN, state, staking: { unbonding: [], validators: [], failedChains: ["cosmoshub-4"] } }).state;
  const back = run({ now: completesAt + 5 * MIN, state, staking: { unbonding: [], validators: [] } });
  assert.deepEqual(ids(back.notices), [noticeId.unbonding("cosmoshub-4", "cosmosvaloper1abc", completesAt)]);
});

test("validators: a chain whose staking read failed keeps its delegations and their alerts", () => {
  let state = seeded();
  const validator = { chainId: "osmosis-1", operatorAddress: "osmovaloper1xyz", moniker: "Example", jailed: false, commissionRate: 0.05 };
  state = run({ now: T0 + MIN, state, staking: { unbonding: [], validators: [validator] } }).state;
  const jailed = run({ now: T0 + 2 * MIN, state, staking: { unbonding: [], validators: [{ ...validator, jailed: true }] } });
  const failing = run({
    now: T0 + 3 * MIN,
    state: jailed.state,
    staking: { unbonding: [], validators: [], failedChains: ["osmosis-1"] },
  });
  assert.deepEqual(ids(failing.notices), ids(jailed.notices), "the jailing notice stays while the read fails");
  const other = run({
    now: T0 + 4 * MIN,
    state: failing.state,
    staking: { unbonding: [], validators: [], failedChains: ["cosmoshub-4"] },
  });
  assert.deepEqual(ids(other.notices), [], "another chain failing changes nothing for Osmosis, which answered: no delegation");
});

test("governance: open vote, then a separate last-24h notice; voted or ineligible stays quiet", () => {
  const state = seeded();
  const proposal = {
    chainId: "osmosis-1",
    id: "1049",
    title: "Withdraw Static Community Pool Liquidity",
    votingEndTime: "2026-10-08T17:04:51.119106028Z",
    votingStartTime: "2026-10-03T17:04:51Z",
    myVote: false,
    eligible: true,
  };
  const early = run({ now: T0, state, proposals: [proposal] });
  assert.deepEqual(ids(early.notices), ["gov:osmosis-1:1049"]);
  assert.match(early.notices[0].body, /ends in 33 h\. You haven't voted yet\.$/);

  const late = run({ now: Date.parse("2026-10-08T12:00:00Z"), state, proposals: [proposal] });
  assert.deepEqual(ids(late.notices), ["gov:osmosis-1:1049:24h"]);
  assert.equal(late.notices[0].title, "Vote ends in 5 h");
  assert.equal(late.notices[0].severity, "warning");
  assert.equal(late.notices[0].url, "/governance/osmosis-1/1049");

  const voted = run({ now: T0, state, proposals: [{ ...proposal, myVote: true }] });
  const noStake = run({ now: T0, state, proposals: [{ ...proposal, eligible: false }] });
  const unknown = run({ now: T0, state, proposals: [{ ...proposal, myVote: null }] });
  assert.deepEqual(ids(voted.notices), []);
  assert.deepEqual(ids(noStake.notices), []);
  assert.doesNotMatch(unknown.notices[0].body, /haven't voted/, "unknown is never stated as not voted");
});

test("validators: one notice per jailing, commission raises remembered", () => {
  let state = seeded();
  const validator = {
    chainId: "osmosis-1",
    operatorAddress: "osmovaloper1xyz",
    moniker: "Example",
    jailed: false,
    commissionRate: 0.05,
  };
  state = run({ now: T0 + MIN, state, staking: { unbonding: [], validators: [validator] } }).state;

  const jailed = run({
    now: T0 + 2 * MIN,
    state,
    staking: { unbonding: [], validators: [{ ...validator, jailed: true }] },
  });
  assert.deepEqual(ids(jailed.notices), [noticeId.validatorJailed("osmosis-1", "osmovaloper1xyz", T0 + 2 * MIN)]);
  const stillJailed = run({
    now: T0 + 30 * MIN,
    state: jailed.state,
    staking: { unbonding: [], validators: [{ ...validator, jailed: true }] },
  });
  assert.deepEqual(ids(stillJailed.notices), ids(jailed.notices), "same jailing, same id");

  const raised = run({
    now: T0 + HOUR,
    state: stillJailed.state,
    staking: { unbonding: [], validators: [{ ...validator, commissionRate: 0.1 }] },
  });
  assert.deepEqual(ids(raised.notices), ["validator:osmosis-1:osmovaloper1xyz:commission:1000"]);
  assert.equal(raised.notices[0].body, "From 5% to 10% on Osmosis. Your rewards there shrink accordingly.");

  const undelegated = run({ now: T0 + 2 * HOUR, state: raised.state, staking: { unbonding: [], validators: [] } });
  assert.deepEqual(ids(undelegated.notices), [], "no alerts for validators no longer delegated to");
});

test("prefs filter kinds out of the feed but state keeps tracking", () => {
  let state = seeded();
  const quiet: NotifyPrefs = { ...DEFAULT_NOTIFY_PREFS, transfers: false, rewards: "off" };
  const input = {
    activity: [{ chainId: "osmosis-1", hash: "DD", kind: "receive", time: T0 + MIN, summary: "x", direction: "in" as const }],
    portfolio: { chains: [{ chainId: "osmosis-1", rewardsWhole: 3, nativeSymbol: "OSMO" }] },
  };
  const off = run({ now: T0 + 2 * MIN, state, prefs: quiet, ...input });
  assert.deepEqual(ids(off.notices), []);
  state = off.state;
  const on = run({ now: T0 + 3 * MIN, state, prefs: ALL_ON, ...input });
  assert.deepEqual(ids(on.notices).sort(), ["rewards:1", "transfer:DD"]);
});

test("no account: only system notices, no account state", () => {
  const result = deriveNotices({
    now: T0,
    account: null,
    prefs: DEFAULT_NOTIFY_PREFS,
    state: INITIAL_NOTICE_STATE,
    system: [{ id: "system:update", title: "New version", body: "Reload to update.", at: T0, severity: "info" }],
    activity: [{ chainId: "osmosis-1", hash: "EE", kind: "receive", time: T0, summary: "x", direction: "in" }],
  });
  assert.deepEqual(ids(result.notices), ["system:update"]);
  assert.deepEqual(result.state.accounts, {});
});

test("feed is newest first and bounded", () => {
  const state = seeded();
  const activity = Array.from({ length: 80 }, (_, index) => ({
    chainId: "osmosis-1",
    hash: `H${index}`,
    kind: "receive",
    time: T0 + (index + 1) * MIN,
    summary: "x",
    direction: "in" as const,
  }));
  const { notices } = run({ now: T0 + 2 * HOUR, state, activity });
  assert.equal(notices.length, FEED_LIMITS.notices);
  assert.equal(notices[0].id, "transfer:H79");
  for (let i = 1; i < notices.length; i += 1) assert.ok(notices[i - 1].at >= notices[i].at);
});

test("announcements: the first run seeds silently, later runs announce what is new", () => {
  const notice = (id: string): Notice => ({ id, kind: "transfer", title: id, body: "", at: T0, severity: "success" });
  const first = pendingAnnouncements(null, [notice("a"), notice("b")]);
  assert.deepEqual(first.announce, []);
  assert.deepEqual(first.ids, ["a", "b"]);

  const second = pendingAnnouncements(first.ids, [notice("c"), notice("a"), notice("b")], { read: ["b"] });
  assert.deepEqual(ids(second.announce), ["c"]);
  assert.deepEqual(second.ids.slice(0, 3), ["c", "a", "b"]);

  const read = pendingAnnouncements(second.ids, [notice("d")], { read: ["d"] });
  assert.deepEqual(read.announce, [], "already read is never announced");

  const quiet = pendingAnnouncements(second.ids, [notice("e")], { quiet: true });
  assert.deepEqual(quiet.announce, []);
  assert.ok(quiet.ids.includes("e"), "quiet hours mean not now, not later");

  const burst = pendingAnnouncements([], Array.from({ length: 9 }, (_, i) => notice(`n${i}`)));
  assert.equal(burst.announce.length, FEED_LIMITS.announce, "a backlog does not fire a volley");
  assert.equal(burst.ids.length, 9);
});

test("an account's first derivation with data seeds silently, even after the first run", () => {
  // The first derivation runs before any read answered: nothing to record yet.
  const empty = run({ now: T0, state: INITIAL_NOTICE_STATE });
  assert.equal(empty.seeding, false);
  let announced = pendingAnnouncements(empty.state.announced, empty.notices).ids;
  let state: NoticeState = { ...empty.state, announced };

  // A second later the rewards read lands: month-old rewards are not news.
  const loaded = run({
    now: T0 + 1_000,
    state,
    portfolio: { chains: [{ chainId: "osmosis-1", rewardsWhole: 40, nativeSymbol: "OSMO" }] },
  });
  assert.equal(loaded.seeding, true);
  const first = pendingAnnouncements(loaded.state.announced, loaded.notices, { seed: loaded.seeding });
  assert.deepEqual(first.announce, []);
  assert.ok(first.ids.includes("rewards:1"));
  announced = first.ids;
  state = { ...loaded.state, announced };

  // Later news for the same account is announced.
  const news = run({
    now: T0 + 60_000,
    state,
    portfolio: { chains: [{ chainId: "osmosis-1", rewardsWhole: 41, nativeSymbol: "OSMO" }] },
    activity: [{ chainId: "osmosis-1", hash: "FF", kind: "receive", time: T0 + 30_000, summary: "x", direction: "in" }],
  });
  assert.equal(news.seeding, false);
  assert.deepEqual(ids(pendingAnnouncements(news.state.announced, news.notices, { seed: news.seeding }).announce), ["transfer:FF"]);

  // A second wallet connected later seeds its own state silently too.
  const other = deriveNotices({
    now: T0 + 120_000,
    account: "cosmos1other",
    prefs: ALL_ON,
    state: news.state,
    portfolio: { chains: [{ chainId: "cosmoshub-4", rewardsWhole: 9, nativeSymbol: "ATOM" }] },
  });
  assert.equal(other.seeding, true);
  assert.deepEqual(pendingAnnouncements(other.state.announced, other.notices, { seed: other.seeding }).announce, []);
});

test("quiet hours wrap midnight and honour the user's zone", () => {
  const window = { start: 22, end: 7 };
  // 2026-10-07T21:30Z is 23:30 in Paris (UTC+2) and 17:30 in New York.
  const at = Date.parse("2026-10-07T21:30:00Z");
  assert.equal(inQuietHours(window, at, "Europe/Paris"), true);
  assert.equal(inQuietHours(window, at, "America/New_York"), false);
  assert.equal(inQuietHours({ start: 13, end: 15 }, Date.parse("2026-10-07T13:59:00Z"), "UTC"), true);
  assert.equal(inQuietHours({ start: 13, end: 15 }, Date.parse("2026-10-07T15:00:00Z"), "UTC"), false);
  assert.equal(inQuietHours(window, at, "Not/AZone"), false, "an unreadable zone never silences");
  assert.equal(inQuietHours(undefined, at, "UTC"), false);
});

test("each read's first appearance is recorded silently, whichever read answers first", () => {
  // Activity answers first: the account is seeded on it.
  const first = run({
    now: T0,
    state: INITIAL_NOTICE_STATE,
    activity: [{ chainId: "osmosis-1", hash: "A1", kind: "receive", time: T0 - DAY, summary: "old", direction: "in" }],
  });
  assert.equal(first.seeding, true);
  let state: NoticeState = {
    ...first.state,
    announced: pendingAnnouncements(first.state.announced, first.notices, { seed: first.seeding, silent: first.silent }).ids,
  };

  // Rewards, votes and staking land a few seconds later, after the seeding.
  const later = run({
    now: T0 + 5_000,
    state,
    activity: [],
    portfolio: { chains: [{ chainId: "osmosis-1", rewardsWhole: 40, nativeSymbol: "OSMO" }] },
    proposals: [
      {
        chainId: "osmosis-1",
        id: "7",
        title: "Old vote",
        votingEndTime: T0 + 3 * DAY,
        myVote: false,
        eligible: true,
      },
    ],
    staking: {
      unbonding: [],
      validators: [{ chainId: "osmosis-1", operatorAddress: "osmovaloper1j", moniker: "Jailed", jailed: true, commissionRate: 0.05 }],
    },
  });
  assert.equal(later.seeding, false);
  assert.deepEqual(
    [...later.silent].sort(),
    ["gov:osmosis-1:7", "rewards:1", noticeId.validatorJailed("osmosis-1", "osmovaloper1j", T0 + 5_000)].sort(),
  );
  const quiet = pendingAnnouncements(later.state.announced, later.notices, { silent: later.silent });
  assert.deepEqual(quiet.announce, [], "month-old rewards, an old vote and an old jailing are not news");
  state = { ...later.state, announced: quiet.ids };

  // From now on the same reads report news.
  const news = run({
    now: T0 + 60_000,
    state,
    activity: [{ chainId: "osmosis-1", hash: "A2", kind: "receive", time: T0 + 30_000, summary: "new", direction: "in" }],
    portfolio: { chains: [{ chainId: "osmosis-1", rewardsWhole: 41, nativeSymbol: "OSMO" }] },
    proposals: [
      { chainId: "osmosis-1", id: "8", title: "New vote", votingEndTime: T0 + 4 * DAY, myVote: false, eligible: true },
    ],
  });
  assert.deepEqual(news.silent, []);
  assert.deepEqual(
    ids(pendingAnnouncements(news.state.announced, news.notices, { silent: news.silent }).announce).sort(),
    ["gov:osmosis-1:8", "transfer:A2"],
  );
});

test("a stored state from before sources were tracked counts every source as seen", () => {
  const legacy = parseNoticeState({
    v: 1,
    announced: [],
    accounts: {
      [ACCOUNT]: { since: T0, seenAt: T0, seeded: true, rewards: { phase: "waiting", cycle: 0, raisedAt: 0, last: {} } },
    },
  });
  assert.deepEqual(legacy.accounts[ACCOUNT].sources, ["portfolio", "staking", "proposals", "activity"]);
  const result = run({
    now: T0 + MIN,
    state: legacy,
    proposals: [{ chainId: "osmosis-1", id: "9", title: "x", votingEndTime: T0 + DAY * 3, myVote: false, eligible: true }],
  });
  assert.deepEqual(result.silent, []);
});

test("rewards cycle numbers are never reused, even after the account that raised one is evicted", () => {
  let state = INITIAL_NOTICE_STATE;
  const rewards = { chains: [{ chainId: "osmosis-1", rewardsWhole: 2, nativeSymbol: "OSMO" }] };
  // The first wallet raises rewards:1.
  state = deriveNotices({ now: T0, account: "wallet-0", prefs: ALL_ON, state, portfolio: rewards }).state;
  assert.equal(state.accounts["wallet-0"].rewards.cycle, 1);
  // Eight more wallets with nothing to claim push it out of the bounded memory.
  for (let i = 1; i <= 8; i += 1) {
    state = deriveNotices({
      now: T0 + i * MIN,
      account: `wallet-${i}`,
      prefs: ALL_ON,
      state,
      portfolio: { chains: [{ chainId: "osmosis-1", rewardsWhole: 0, nativeSymbol: "OSMO" }] },
    }).state;
  }
  assert.equal(state.accounts["wallet-0"], undefined, "evicted");
  const next = deriveNotices({ now: T0 + HOUR, account: "wallet-9", prefs: ALL_ON, state, portfolio: rewards });
  assert.deepEqual(ids(next.notices), ["rewards:2"], "rewards:1 may already be read: never hand it out again");
  assert.equal(parseNoticeState(JSON.parse(JSON.stringify(next.state))).cycles, 2, "the sequence survives storage");
});

test("only incoming transfers read as received; a claim or an undelegation never does, and swaps never alert", () => {
  // The activity read has answered before (empty), so its rows are news now.
  const state = run({ now: T0, state: INITIAL_NOTICE_STATE, activity: [] }).state;
  const at = T0 + 5 * MIN;
  const result = run({
    now: T0 + HOUR,
    state,
    activity: [
      { chainId: "osmosis-1", hash: "C1", kind: "claim", time: at, summary: "Claimed 3 OSMO", direction: "in", amountText: "3 OSMO" },
      { chainId: "osmosis-1", hash: "C2", kind: "undelegate", time: at, summary: "Undelegated", direction: "in" },
      { chainId: "osmosis-1", hash: "C3", kind: "contract", time: at, summary: "Contract paid out", direction: "in" },
      { chainId: "osmosis-1", hash: "C4", kind: "ibc-in", time: at, summary: "x", direction: "in", counterpartyChainId: "cosmoshub-4" },
      { chainId: "osmosis-1", hash: "C5", kind: "ibc-out", time: at, summary: "x", direction: "out" },
      { chainId: "osmosis-1", hash: "C6", kind: "receive", time: at, summary: "x", direction: "in" },
      { chainId: "osmosis-1", hash: "C7", kind: "swap", time: at, summary: "Swapped", direction: "self" },
    ],
  });
  assert.deepEqual(ids(result.notices).sort(), ["swap:C7", "transfer:C4", "transfer:C6"]);
  assert.deepEqual(result.silent, ["swap:C7"]);
  const { announce } = pendingAnnouncements(result.state.announced ?? [], result.notices, { silent: result.silent });
  assert.deepEqual(ids(announce).sort(), ["transfer:C4", "transfer:C6"]);
});

test("an event that reaches the feed hours late is listed, not announced", () => {
  const state = run({ now: T0, state: INITIAL_NOTICE_STATE, activity: [] }).state;
  const result = run({
    now: T0 + 10 * HOUR,
    state,
    activity: [
      { chainId: "osmosis-1", hash: "L1", kind: "receive", time: T0 + HOUR, summary: "x", direction: "in" },
      { chainId: "osmosis-1", hash: "L2", kind: "receive", time: T0 + 9 * HOUR, summary: "x", direction: "in" },
    ],
  });
  assert.deepEqual(ids(result.notices), ["transfer:L2", "transfer:L1"]);
  assert.deepEqual(result.silent, ["transfer:L1"], "nine hours old: history by now");
});
