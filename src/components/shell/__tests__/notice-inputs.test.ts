/**
 * The shell's reads → notification feed inputs: reads without an answer for
 * these accounts stay undefined, unknown is never zero, amounts are named
 * with their decimals (or as base units), directions follow the amounts.
 */

import assert from "node:assert/strict";
import { test } from "node:test";

import type { ActivityItem } from "@/lib/activity/types";
import type { ProposalRow, StakingChain, ValidatorLite } from "@/lib/chain/types";
import type { TokenIdentity } from "@/lib/token/types";
import {
  activityInputs,
  amountText,
  directionOf,
  noticeInputs,
  proposalInputs,
  rewardsInputs,
  stakingInputs,
} from "../notice-inputs";

function validator(partial: Partial<ValidatorLite> = {}): ValidatorLite {
  return {
    operatorAddress: "osmovaloper1a",
    moniker: "Alpha",
    status: "bonded",
    jailed: false,
    tombstoned: false,
    commissionRate: 0.05,
    commissionMaxRate: 0.2,
    commissionReachable30d: 0.1,
    uptime: 1,
    rank: 3,
    votingPower: 0.02,
    inNakamotoSet: false,
    apr: 0.09,
    ...partial,
  };
}

function staking(partial: Partial<StakingChain> = {}): StakingChain {
  return {
    chainId: "osmosis-1",
    address: "osmo1x",
    denom: "uosmo",
    symbol: "OSMO",
    decimals: 6,
    delegations: [{ validator: validator(), amount: "1000000", rewards: [] }],
    unbonding: [
      {
        validator: validator({ operatorAddress: "osmovaloper1b", moniker: "Beta" }),
        entries: [{ balance: "12500000", initialBalance: "12500000", completionTime: "2026-10-20T10:00:00Z", creationHeight: 1 }],
      },
    ],
    redelegations: [],
    withdrawAddress: null,
    totals: { staked: "1000000", rewards: "420000", unbonding: "12500000" },
    rewardsOther: [],
    nextUnbonding: null,
    apr: { chain: null, weighted: null },
    status: "ok",
    ...partial,
  };
}

const IDENTITY: TokenIdentity = {
  key: "osmosis-1:uosmo",
  chainId: "osmosis-1",
  denom: "uosmo",
  kind: "native",
  ticker: "OSMO",
  name: "Osmosis",
  decimals: 6,
  provenance: "native",
  proven: true,
};

function item(partial: Partial<ActivityItem> = {}): ActivityItem {
  return {
    chainId: "osmosis-1",
    address: "osmo1x",
    hash: "ABC",
    height: 10,
    time: "2026-10-07T10:00:00Z",
    kind: "receive",
    success: true,
    summary: "Received 2.5 OSMO from osmo1…",
    fee: null,
    feePaid: false,
    signed: false,
    amounts: [{ direction: "in", denom: "uosmo", amount: "2500000", identity: IDENTITY }],
    messages: 1,
    primaryType: "MsgSend",
    ...partial,
  };
}

test("amountText: decimals when known, base units otherwise", () => {
  assert.equal(amountText("12500000", 6, "ATOM"), "12.5 ATOM");
  assert.equal(amountText("1250", null, "ATOM"), "1,250 base units of ATOM");
});

test("rewardsInputs: whole tokens; a failed read is failed, not zero", () => {
  assert.deepEqual(rewardsInputs([staking()]), [{ chainId: "osmosis-1", rewardsWhole: 0.42, nativeSymbol: "OSMO" }]);
  assert.deepEqual(rewardsInputs([staking({ totals: { staked: "1", rewards: null, unbonding: "0" } })]), [
    { chainId: "osmosis-1", rewardsWhole: 0, nativeSymbol: "OSMO", failed: true },
  ]);
  assert.equal(rewardsInputs([staking({ decimals: null })])[0].failed, true);
  assert.equal(rewardsInputs([staking({ status: "error" })])[0].failed, true);
});

test("stakingInputs: unbonding entries and delegated validators; unknown left out", () => {
  const { unbonding, validators } = stakingInputs([staking()]);
  assert.deepEqual(unbonding, [
    {
      chainId: "osmosis-1",
      validator: "osmovaloper1b",
      completionTime: "2026-10-20T10:00:00Z",
      amountText: "12.5 OSMO",
      validatorName: "Beta",
    },
  ]);
  assert.deepEqual(validators, [
    { chainId: "osmosis-1", operatorAddress: "osmovaloper1a", moniker: "Alpha", jailed: false, commissionRate: 0.05, active: true },
  ]);
  const unknown = stakingInputs([
    staking({ delegations: [{ validator: validator({ jailed: null }), amount: "1", rewards: [] }] }),
  ]);
  assert.equal(unknown.validators.length, 0);
  const noStatus = stakingInputs([staking({ delegations: [{ validator: validator({ status: null }), amount: "1", rewards: [] }] })]);
  assert.equal("active" in noStatus.validators[0], false);
  assert.deepEqual(stakingInputs([staking({ status: "error" })]), { unbonding: [], validators: [] });
  assert.equal(stakingInputs([staking({ totals: { staked: "1", rewards: "0", unbonding: null } })]).unbonding.length, 0);
});

test("proposalInputs: voting proposals with the vote state and eligibility", () => {
  const base = {
    chainId: "cosmoshub-4",
    id: "1049",
    title: "Upgrade",
    status: "voting",
    votingEndTime: "2026-10-09T00:00:00Z",
    votingStartTime: "2026-10-02T00:00:00Z",
  } as ProposalRow;
  const rows = proposalInputs([
    { ...base, myVoteStatus: "not-voted", myVotingPower: "500" },
    { ...base, id: "1050", myVoteStatus: "voted", myVotingPower: "500" },
    { ...base, id: "1051", myVoteStatus: "unknown", myVotingPower: "0" },
    { ...base, id: "1052", status: "passed", myVoteStatus: null, myVotingPower: null },
  ]);
  assert.deepEqual(
    rows.map((row) => [row.id, row.myVote, row.eligible]),
    [
      ["1049", false, true],
      ["1050", true, true],
      ["1051", null, false],
    ],
  );
  assert.equal(rows[0].votingStartTime, "2026-10-02T00:00:00Z");
});

test("activityInputs: direction from amounts, first incoming amount named", () => {
  const [row] = activityInputs([item({ kind: "ibc-in", ibc: { sourceChainId: "cosmoshub-4" } })]);
  assert.equal(row.direction, "in");
  assert.equal(row.amountText, "2.5 OSMO");
  assert.equal(row.counterpartyChainId, "cosmoshub-4");
  assert.equal(row.kind, "ibc-in");
  assert.equal(directionOf({ amounts: [] }), "self");
  assert.equal(
    directionOf({
      amounts: [
        { direction: "out", denom: "a", amount: "1", identity: IDENTITY },
        { direction: "in", denom: "b", amount: "1", identity: IDENTITY },
      ],
    }),
    "self",
  );
  const [sent] = activityInputs([item({ kind: "send", amounts: [{ direction: "out", denom: "uosmo", amount: "1", identity: IDENTITY }] })]);
  assert.equal(sent.direction, "out");
  assert.equal("amountText" in sent, false);
});

test("noticeInputs: only fresh answers, nothing without an account", () => {
  assert.deepEqual(noticeInputs({ account: null, staking: { data: { chains: [staking()] }, stale: false } }), { account: null });
  const loading = noticeInputs({
    account: "addr_safro1x",
    staking: { data: null, stale: false },
    proposals: { data: { proposals: [] }, stale: true },
    activity: null,
  });
  assert.deepEqual(loading, { account: "addr_safro1x" });
  const ready = noticeInputs({
    account: "addr_safro1x",
    staking: { data: { chains: [staking()] }, stale: false },
    proposals: { data: { proposals: [] }, stale: false },
    activity: { data: [], stale: false },
  });
  assert.equal(ready.portfolio?.chains.length, 1);
  assert.equal(ready.staking?.unbonding.length, 1);
  assert.deepEqual(ready.proposals, []);
  assert.deepEqual(ready.activity, []);
});
