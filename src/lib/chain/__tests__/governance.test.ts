/**
 * Governance math and normalisation. `passingIfEndedNow` must apply x/gov's
 * rules in x/gov's order — quorum on all votes, all-abstain fails, veto
 * share of all votes, yes share of non-abstaining votes — with the SDK's
 * strict inequalities, because "would pass" is shown next to a Vote button.
 */

import assert from "node:assert/strict";
import { test } from "node:test";

import {
  displayTally,
  elideJson,
  govVotingPower,
  inheritedVotes,
  parseProposalV1,
  parseProposalV1beta1,
  parseTally,
  parseVote,
  passingIfEndedNow,
  plainExcerpt,
  proposalStatus,
  tallyTotal,
  turnout,
  voteOptionName,
  votingOverdue,
} from "../governance";
import type { Tally, VoteChoice } from "../types";

const RULES = { quorum: 0.4, threshold: 0.5, vetoThreshold: 0.334 };

function tally(yes: number, no: number, abstain: number, veto: number): Tally {
  return { yes: String(yes), no: String(no), abstain: String(abstain), veto: String(veto) };
}

test("status and vote option names", () => {
  assert.equal(proposalStatus("PROPOSAL_STATUS_VOTING_PERIOD"), "voting");
  assert.equal(proposalStatus("PROPOSAL_STATUS_DEPOSIT_PERIOD"), "deposit");
  assert.equal(proposalStatus("PROPOSAL_STATUS_PASSED"), "passed");
  assert.equal(proposalStatus("PROPOSAL_STATUS_REJECTED"), "rejected");
  assert.equal(proposalStatus("PROPOSAL_STATUS_FAILED"), "failed");
  assert.equal(proposalStatus(2), "voting");
  assert.equal(proposalStatus("weird"), "unknown");
  assert.equal(voteOptionName("VOTE_OPTION_NO_WITH_VETO"), "veto");
  assert.equal(voteOptionName("VOTE_OPTION_ABSTAIN"), "abstain");
  assert.equal(voteOptionName(1), "yes");
  assert.equal(voteOptionName("VOTE_OPTION_UNSPECIFIED"), null);
});

test("votes: single, weighted, and v1beta1's lone option", () => {
  assert.deepEqual(
    parseVote({ vote: { options: [{ option: "VOTE_OPTION_YES", weight: "1.000000000000000000" }] } }),
    { option: "yes" },
  );
  assert.deepEqual(
    parseVote({
      vote: {
        options: [
          { option: "VOTE_OPTION_YES", weight: "0.700000000000000000" },
          { option: "VOTE_OPTION_ABSTAIN", weight: "0.300000000000000000" },
        ],
      },
    }),
    { option: "weighted", weights: [{ option: "yes", weight: 0.7 }, { option: "abstain", weight: 0.3 }] },
  );
  assert.deepEqual(parseVote({ vote: { option: "VOTE_OPTION_NO", options: [] } }), { option: "no" });
  assert.equal(parseVote({ vote: {} }), null);
});

test("tallies in both spellings", () => {
  assert.deepEqual(
    parseTally({ tally: { yes_count: "10", no_count: "2", abstain_count: "3", no_with_veto_count: "1" } }),
    tally(10, 2, 3, 1),
  );
  assert.deepEqual(parseTally({ yes: "10", no: "2", abstain: "3", no_with_veto: "1" }), tally(10, 2, 3, 1));
  assert.equal(parseTally({ yes_count: "10" }), null);
  assert.equal(tallyTotal(tally(10, 2, 3, 1)), BigInt(16));
});

test("turnout counts abstain and needs bonded tokens", () => {
  assert.equal(turnout(tally(30, 5, 5, 0), "100"), 0.4);
  assert.equal(turnout(tally(30, 5, 5, 0), null), null);
  assert.equal(turnout(null, "100"), null);
  assert.equal(turnout(tally(1, 0, 0, 0), "0"), null);
});

test("passing rules, in the SDK's order", () => {
  // Below quorum (39 % < 40 %) fails whatever the yes share.
  assert.equal(passingIfEndedNow(tally(39, 0, 0, 0), "100", RULES), false);
  // Exactly at quorum counts (the SDK fails only when below).
  assert.equal(passingIfEndedNow(tally(40, 0, 0, 0), "100", RULES), true);
  // Everyone abstained.
  assert.equal(passingIfEndedNow(tally(0, 0, 50, 0), "100", RULES), false);
  // Veto share is of all votes, abstain included: 17/50 = 34 % > 33.4 % → vetoed.
  assert.equal(passingIfEndedNow(tally(33, 0, 0, 17), "100", RULES), false);
  // 16/50 = 32 % < 33.4 %, yes 34/50 = 68 % of non-abstain → passes.
  assert.equal(passingIfEndedNow(tally(34, 0, 0, 16), "100", RULES), true);
  // Yes must be strictly above the threshold of non-abstaining votes.
  assert.equal(passingIfEndedNow(tally(25, 25, 10, 0), "100", RULES), false);
  assert.equal(passingIfEndedNow(tally(26, 24, 10, 0), "100", RULES), true);
  // Abstain lowers the bar: 21 yes vs 19 no with 20 abstain.
  assert.equal(passingIfEndedNow(tally(21, 19, 20, 0), "100", RULES), true);
  // Unknown parameters or bonded tokens: unknown, not "fails".
  assert.equal(passingIfEndedNow(tally(60, 0, 0, 0), null, RULES), null);
  assert.equal(passingIfEndedNow(tally(60, 0, 0, 0), "100", { ...RULES, quorum: null }), null);
});

test("Cosmos Hub #1058 on 2026-10-07: 12.4 % turnout is short of the 40 % quorum", () => {
  const live = parseTally({
    tally: {
      yes_count: "39753985256991",
      abstain_count: "2357304040668",
      no_count: "11853061191",
      no_with_veto_count: "4693438363",
    },
  });
  const share = turnout(live, "339785634221068");
  assert.ok(share !== null && Math.abs(share - 0.124) < 0.001);
  assert.equal(passingIfEndedNow(live, "339785634221068", RULES), false);
});

test("plain excerpt strips markdown but keeps identifiers", () => {
  const text = plainExcerpt(
    "# Move the ATOM\n\nThis is a **text** proposal. See [the forum](https://forum.cosmos.network/t/x).\n\n- sets `min_deposit` to 500\n<b>bold</b>",
  );
  assert.equal(text, "Move the ATOM This is a text proposal. See the forum. sets min_deposit to 500 bold");
  const long = plainExcerpt("word ".repeat(200), 50);
  assert.ok(long.length <= 51 && long.endsWith("…"));
});

test("gov v1 proposals: legacy content type, text proposals, final tally", () => {
  const legacy = parseProposalV1({
    id: "5",
    messages: [
      {
        "@type": "/cosmos.gov.v1.MsgExecLegacyContent",
        content: { "@type": "/cosmos.params.v1beta1.ParameterChangeProposal", title: "Raise gas", description: "Body" },
        authority: "x",
      },
    ],
    status: "PROPOSAL_STATUS_PASSED",
    final_tally_result: { yes_count: "1", no_count: "0", abstain_count: "0", no_with_veto_count: "0" },
    submit_time: "2025-01-01T00:00:00Z",
    voting_end_time: "2025-01-08T00:00:00Z",
    total_deposit: [{ denom: "utia", amount: "10000000000" }],
    title: "",
    summary: "",
  });
  assert.ok(legacy);
  assert.equal(legacy.type, "ParameterChangeProposal");
  assert.deepEqual(legacy.messageTypes, ["MsgExecLegacyContent"]);
  assert.equal(legacy.title, "Raise gas");
  assert.equal(legacy.description, "Body");
  assert.equal(legacy.status, "passed");
  assert.deepEqual(legacy.finalTally, tally(1, 0, 0, 0));

  const text = parseProposalV1({ proposal: { id: "1058", messages: [], status: "PROPOSAL_STATUS_VOTING_PERIOD", title: "Move", summary: "Body", expedited: false } });
  assert.equal(text?.type, "Text");
  assert.equal(text?.status, "voting");
  assert.equal(parseProposalV1({ id: "abc" }), null);
});

test("gov v1beta1 proposals", () => {
  const p = parseProposalV1beta1({
    proposal_id: "42",
    content: { "@type": "/cosmos.gov.v1beta1.TextProposal", title: "Hello", description: "World" },
    status: "PROPOSAL_STATUS_REJECTED",
    final_tally_result: { yes: "1", abstain: "2", no: "3", no_with_veto: "4" },
    voting_end_time: "2024-01-01T00:00:00Z",
  });
  assert.ok(p);
  assert.equal(p.id, "42");
  assert.equal(p.type, "TextProposal");
  assert.equal(p.status, "rejected");
  assert.deepEqual(p.finalTally, tally(1, 3, 2, 4));
});

test("elideJson cuts wasm blobs and long lists, keeps the structure", () => {
  const { value, truncated } = elideJson(
    [{ "@type": "/cosmwasm.wasm.v1.MsgStoreCode", wasm_byte_code: "A".repeat(300_000), list: Array.from({ length: 150 }, (_, i) => i) }],
    { maxString: 2_000, maxArray: 100 },
  );
  assert.equal(truncated, true);
  const message = (value as Array<Record<string, unknown>>)[0]!;
  assert.equal(message["@type"], "/cosmwasm.wasm.v1.MsgStoreCode");
  assert.match(String(message.wasm_byte_code), /300,000 characters omitted/);
  const list = message.list as unknown[];
  assert.equal(list.length, 101);
  assert.equal(list[100], "[50 more items omitted]");
  assert.deepEqual(elideJson({ a: 1 }), { value: { a: 1 }, truncated: false });
});

test("inherited votes weigh each validator's vote by the delegator's stake", () => {
  const votes = new Map<string, VoteChoice | null>([
    ["val-a", { option: "yes" }],
    ["val-b", null],
  ]);
  assert.deepEqual(
    inheritedVotes(
      [
        { validator: "val-b", moniker: "B", amount: "250" },
        { validator: "val-a", moniker: "A", amount: "750" },
        { validator: "val-c", moniker: null, amount: "0" },
      ],
      votes,
    ),
    [
      { validator: "val-a", moniker: "A", option: "yes", weight: 0.75 },
      { validator: "val-b", moniker: "B", option: null, weight: 0.25 },
      { validator: "val-c", moniker: null, option: null, weight: 0 },
    ],
  );
  assert.deepEqual(inheritedVotes([], votes), []);
});

test("inherited weights are shares of the whole voting power when only the top delegations are listed", () => {
  const votes = new Map<string, VoteChoice | null>([["val-a", { option: "no" }]]);
  // 750 + 150 listed out of 1,000 voting power: 75 % and 15 %, not 83 % and 17 %.
  assert.deepEqual(
    inheritedVotes(
      [
        { validator: "val-a", moniker: "A", amount: "750" },
        { validator: "val-b", moniker: "B", amount: "150" },
      ],
      votes,
      "1000",
    ).map((vote) => [vote.validator, vote.option, vote.weight]),
    [
      ["val-a", "no", 0.75],
      ["val-b", null, 0.15],
    ],
  );
  // An unknown total falls back to the listed sum.
  assert.equal(inheritedVotes([{ validator: "val-a", moniker: null, amount: "10" }], votes, null)[0]?.weight, 1);
});

test("the tally a row shows: live while voting, none in deposit, final after", () => {
  const zeros = tally(0, 0, 0, 0);
  const live = tally(5, 1, 0, 0);
  const final = tally(9, 1, 0, 0);
  assert.deepEqual(displayTally("voting", zeros, live), { tally: live, kind: "live" });
  // The live read failed: no tally rather than the zero placeholder.
  assert.deepEqual(displayTally("voting", zeros, null), { tally: null, kind: null });
  // Deposit period: final_tally_result is a zero placeholder, not "0 % turnout".
  assert.deepEqual(displayTally("deposit", zeros, null), { tally: null, kind: null });
  assert.deepEqual(displayTally("passed", final, null), { tally: final, kind: "final" });
  assert.deepEqual(displayTally("failed", final, null), { tally: final, kind: "final" });
  assert.deepEqual(displayTally("rejected", null, null), { tally: null, kind: null });
});

test("a 'voting' status past its end time is overdue (the chain already tallied it)", () => {
  const now = Date.parse("2026-10-12T12:00:00Z");
  assert.equal(votingOverdue("voting", "2026-10-12T11:58:17Z", now), true);
  // Within the grace for the first block after the end.
  assert.equal(votingOverdue("voting", "2026-10-12T11:59:50Z", now), false);
  assert.equal(votingOverdue("voting", "2026-10-13T00:00:00Z", now), false);
  assert.equal(votingOverdue("passed", "2026-10-01T00:00:00Z", now), false);
  assert.equal(votingOverdue("voting", null, now), false);
});

test("gov voting power counts only stake on bonded validators", () => {
  const delegations = [
    { validator: "bonded-a", amount: "700" },
    { validator: "jailed-b", amount: "300" },
  ];
  assert.equal(govVotingPower(delegations, new Set(["bonded-a"])), "700");
  // Bonded set unknown: unknown, not the 1,000 staked.
  assert.equal(govVotingPower(delegations, null), null);
  // No stake at all is "0" whatever the set.
  assert.equal(govVotingPower([], null), "0");
});
