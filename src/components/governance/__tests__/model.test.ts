/**
 * Governance view model: the pass/fail explanation must agree with x/gov's
 * rules (and never contradict the server's verdict), the participation strip
 * must count what the cards show, and filters must not hide proposals on a
 * guess.
 */

import assert from "node:assert/strict";
import { test } from "node:test";

import type { ProposalRow } from "@/lib/chain/types";
import { formatDate } from "@/lib/format";
import {
  dateText,
  depositState,
  descriptionWithoutTitle,
  filterRows,
  inheritedSummary,
  matchesQuery,
  meaningfulMetadata,
  mergeRows,
  participation,
  powerState,
  proposalHref,
  proposalTimeline,
  summaryWithoutTitle,
  trackRecords,
  typeBadge,
  typeLabel,
  voteChoiceText,
} from "../model";
import {
  failingRule,
  outcomeOf,
  passLine,
  pct,
  quorumShortfall,
  rejectionReason,
  ruleChecks,
  swingOf,
  tallyShares,
  TURNOUT_ESTIMATE_MAX_AGE_MS,
  turnoutWithheld,
  withUsableTurnout,
  yesOfDecisive,
} from "../rules";

const NOW = Date.parse("2026-10-07T04:00:00Z");

function row(overrides: Partial<ProposalRow> = {}): ProposalRow {
  return {
    chainId: "osmosis-1",
    id: "1049",
    api: "v1",
    title: "Withdraw Margined-Managed OSMO LST and ETH/BTC Liquidity",
    summary: "Margined is winding down its managed liquidity offering on Osmosis.",
    type: "MsgCommunityPoolSpend",
    messageTypes: ["MsgCommunityPoolSpend"],
    status: "voting",
    submitTime: "2026-10-03T17:04:51Z",
    depositEndTime: "2026-10-17T17:04:51Z",
    votingStartTime: "2026-10-03T17:04:51Z",
    votingEndTime: "2026-10-08T17:04:51Z",
    totalDeposit: [{ denom: "uosmo", amount: "30000000000" }],
    minDeposit: [{ denom: "uosmo", amount: "30000000000" }],
    expedited: false,
    // Live numbers from osmosis-1 #1049 (2026-10-07).
    tally: { yes: "74149926597299", no: "1671216838", abstain: "9670478826510", veto: "2060000" },
    tallyKind: "live",
    turnout: 0.4687333808711663,
    quorum: 0.3,
    threshold: 0.5,
    vetoThreshold: 0.334,
    passingIfEndedNow: true,
    myVote: null,
    myVoteStatus: null,
    myVotingPower: null,
    ...overrides,
  };
}

/* ------------------------------------------------------------------ tally */

test("tally shares and the decisive Yes ratio", () => {
  const shares = tallyShares(row().tally);
  assert.ok(shares);
  assert.ok(Math.abs(shares.yes + shares.no + shares.veto + shares.abstain - 1) < 1e-12);
  assert.ok(shares.yes > 0.884 && shares.yes < 0.885, String(shares.yes));
  const yes = yesOfDecisive(row().tally);
  assert.ok(yes !== null && yes > 0.9999);
  assert.equal(tallyShares(null), null);
  assert.equal(tallyShares({ yes: "0", no: "0", abstain: "0", veto: "0" }), null);
});

test("the pass line is the threshold of the decisive part of the bar", () => {
  // 40 yes / 20 abstain / 40 no: Yes must pass 0.5 × 0.8 = 0.4 of the bar.
  const line = passLine({ yes: "40", no: "40", abstain: "20", veto: "0" }, 0.5);
  assert.ok(line !== null && Math.abs(line - 0.4) < 1e-12);
  assert.equal(passLine({ yes: "0", no: "0", abstain: "10", veto: "0" }, 0.5), null);
  assert.equal(passLine(null, 0.5), null);
});

test("quorum shortfall from tally and turnout", () => {
  // Hub #1058: 12.7% turnout of a 40% quorum.
  const hub = row({
    chainId: "cosmoshub-4",
    tally: { yes: "40716967852594", no: "12010120830", abstain: "2357177633293", veto: "4693438363" },
    turnout: 0.12681678658591428,
    quorum: 0.4,
    passingIfEndedNow: false,
  });
  const shortfall = quorumShortfall(hub);
  assert.ok(shortfall !== null);
  const voted = tallyShares(hub.tally)?.total ?? 0;
  const bonded = voted / 0.12681678658591428;
  assert.ok(Math.abs(shortfall - (0.4 - 0.12681678658591428) * bonded) / shortfall < 1e-9);
  assert.equal(quorumShortfall(row()), null, "quorum met: nothing missing");
  assert.equal(quorumShortfall(row({ turnout: null })), null);
});

/* ------------------------------------------------------------------ rules */

test("rule checks: quorum, veto, threshold", () => {
  const [quorum, veto, threshold] = ruleChecks(row());
  assert.deepEqual([quorum?.ok, veto?.ok, threshold?.ok], [true, true, true]);
  assert.equal(quorum?.limit, 0.3);
  assert.match(threshold?.requirement ?? "", /> 50%/);
  const unknown = ruleChecks(row({ quorum: null, turnout: null }));
  assert.equal(unknown[0]?.ok, null, "unknown inputs are not a verdict");
});

test("the deciding rule follows x/gov's order", () => {
  const base = { turnout: 0.5, quorum: 0.334, threshold: 0.5, vetoThreshold: 0.334 } as const;
  assert.equal(failingRule({ ...base, turnout: 0.2, tally: { yes: "1", no: "9", abstain: "0", veto: "9" } }), "quorum");
  assert.equal(failingRule({ ...base, tally: { yes: "0", no: "0", abstain: "10", veto: "0" } }), "all-abstain");
  assert.equal(failingRule({ ...base, tally: { yes: "50", no: "0", abstain: "10", veto: "40" } }), "veto");
  assert.equal(failingRule({ ...base, tally: { yes: "45", no: "55", abstain: "0", veto: "0" } }), "threshold");
  assert.equal(failingRule({ ...base, tally: { yes: "51", no: "49", abstain: "0", veto: "0" } }), null);
  // Exactly on the threshold fails (x/gov needs strictly more).
  assert.equal(failingRule({ ...base, tally: { yes: "50", no: "50", abstain: "0", veto: "0" } }), "threshold");
});

/* ------------------------------------------------------------------ outcome */

test("outcome: passing, failing with its reason, ended, deposit", () => {
  assert.equal(outcomeOf(row(), NOW).label, "Would pass if it ended now");
  const failing = outcomeOf(row({ turnout: 0.127, quorum: 0.4, passingIfEndedNow: false }), NOW);
  assert.equal(failing.kind, "failing");
  assert.equal(failing.reason, "quorum");
  assert.equal(failing.label, "Would fail: below quorum");
  assert.equal(failing.detail, "Turnout 12.7% · quorum 40%");
  assert.equal(outcomeOf(row(), Date.parse("2026-10-09T00:00:00Z")).kind, "ended-pending");
  assert.equal(outcomeOf(row({ status: "deposit", tally: null }), NOW).kind, "deposit");
  assert.equal(outcomeOf(row({ tally: null }), NOW).kind, "no-tally");
});

test("outcome never contradicts the server's verdict", () => {
  // The server says passing even though the local turnout would read below
  // quorum (a rounding edge): the card says passing.
  const outcome = outcomeOf(row({ turnout: 0.29999, quorum: 0.3, passingIfEndedNow: true }), NOW);
  assert.equal(outcome.kind, "passing");
  // The server says failing but no rule fails locally: a generic failure.
  const generic = outcomeOf(row({ passingIfEndedNow: false }), NOW);
  assert.equal(generic.kind, "failing");
  assert.equal(generic.label, "Would fail if it ended now");
});

test("ended outcomes: rejected with the reason, failed execution", () => {
  const rejected = outcomeOf(
    row({ status: "rejected", tallyKind: "final", passingIfEndedNow: null, turnoutEstimate: true, tally: { yes: "10", no: "80", abstain: "0", veto: "10" } }),
    NOW,
  );
  assert.equal(rejected.label, "Rejected: not enough Yes");
  const failed = outcomeOf(row({ status: "failed", failedReason: "out of gas" }), NOW);
  assert.equal(failed.tone, "danger");
  assert.equal(failed.detail, "out of gas");
  const passed = outcomeOf(row({ status: "passed", turnoutEstimate: true }), NOW);
  assert.match(passed.detail ?? "", /≈ 46\.9%/);
});

/* ------------------------------------------------------------------ you */

test("voting power states", () => {
  assert.equal(powerState("1000000"), "some");
  assert.equal(powerState("0"), "none");
  assert.equal(powerState(null), "unknown");
});

test("inherited vote summary keeps unlisted weight separate", () => {
  const summary = inheritedSummary([
    { validator: "a", moniker: "A", option: "yes", weight: 0.5 },
    { validator: "b", moniker: "B", option: "yes", weight: 0.2 },
    { validator: "c", moniker: "C", option: null, weight: 0.2 },
  ]);
  assert.ok(summary);
  assert.deepEqual(
    summary.parts.map((p) => [p.option, Math.round(p.weight * 100)]),
    [
      ["yes", 70],
      ["none", 20],
    ],
  );
  assert.ok(Math.abs(summary.unlisted - 0.1) < 1e-9);
  assert.equal(inheritedSummary([]), null);
});

test("vote choice text, split votes largest first", () => {
  assert.equal(voteChoiceText({ option: "veto" }), "No with veto");
  assert.equal(
    voteChoiceText({ option: "weighted", weights: [{ option: "abstain", weight: 0.4 }, { option: "yes", weight: 0.6 }] }),
    "Split: 60% Yes · 40% Abstain",
  );
  assert.equal(voteChoiceText(null), null);
});

/* ------------------------------------------------------------------ lists */

test("participation strip counts", () => {
  const rows = [
    row({ id: "1", myVoteStatus: "voted", myVote: { option: "yes" }, myVotingPower: "1000000" }),
    row({ id: "2", myVoteStatus: "not-voted", myVotingPower: "5", votingEndTime: "2026-10-12T11:58:17Z", passingIfEndedNow: false, turnout: 0.1, quorum: 0.4 }),
    row({ id: "3", myVoteStatus: "not-voted", myVotingPower: "0" }),
    row({ id: "4", status: "deposit", tally: null }),
    row({ id: "5", status: "passed" }),
  ];
  const p = participation(rows, NOW);
  assert.equal(p.open, 3);
  assert.equal(p.voted, 1);
  assert.equal(p.notVoted, 1, "no voting power is not 'not voted'");
  assert.equal(p.eligible, 2);
  assert.equal(p.passing, 2);
  assert.equal(p.failing, 1);
  assert.equal(p.endingSoon, 2, "the two closing Oct 8 are within 48 h");
  assert.equal(p.endingSoonNotVoted, 0);
  assert.equal(p.deposit, 1);
  assert.equal(p.next?.id, "1");
});

test("filters: tab, search, only where I can vote (unknown power kept)", () => {
  const rows = [
    row({ id: "1", myVotingPower: "10" }),
    row({ id: "2", myVotingPower: "0", title: "Raise the taker fee" }),
    row({ id: "3", myVotingPower: null, chainId: "cosmoshub-4" }),
    row({ id: "4", status: "failed" }),
  ];
  assert.deepEqual(filterRows(rows, { tab: "voting" }).map((r) => r.id), ["3", "2", "1"].sort((a, b) => Number(b) - Number(a)));
  assert.deepEqual(filterRows(rows, { tab: "voting", onlyVotable: true }).map((r) => r.id).sort(), ["1", "3"]);
  assert.deepEqual(filterRows(rows, { tab: "rejected" }).map((r) => r.id), ["4"]);
  assert.deepEqual(filterRows(rows, { tab: "voting", query: "taker" }).map((r) => r.id), ["2"]);
  assert.ok(matchesQuery(row(), "#1049"));
  assert.ok(matchesQuery(row(), "osmosis pool", (id) => (id === "osmosis-1" ? "Osmosis" : undefined)));
  assert.ok(!matchesQuery(row(), "hub"));
});

test("merge keeps the first answer per chain and id", () => {
  const merged = mergeRows([row({ id: "1", title: "A" })], [row({ id: "1", title: "B" }), row({ id: "2" })]);
  assert.deepEqual(
    merged.map((r) => [r.id, r.title]),
    [
      ["1", "A"],
      ["2", row().title],
    ],
  );
});

/* ------------------------------------------------------------------ labels & timeline */

test("type labels", () => {
  assert.equal(typeLabel("MsgCommunityPoolSpend"), "Community pool spend");
  assert.equal(typeLabel("MsgBatchExchangeModification"), "Batch exchange modification");
  assert.equal(typeLabel("MsgIBCSoftwareUpgrade"), "IBC upgrade");
  assert.equal(typeLabel("MsgTransferPositions"), "Transfer positions");
  assert.equal(typeLabel("SetDenomPairTakerFeeProposal"), "Set denom pair taker fee");
  assert.equal(typeBadge({ type: "MsgUpdateParams", messageTypes: ["MsgUpdateParams", "MsgSend", "MsgSend"] }), "Parameter change +1");
});

test("timeline: deposit met at submission, voting closes is current", () => {
  const steps = proposalTimeline(row());
  assert.deepEqual(
    steps.map((s) => [s.key, s.state]),
    [
      ["submitted", "done"],
      ["deposit", "done"],
      ["voting-start", "done"],
      ["voting-end", "current"],
      ["result", "todo"],
    ],
  );
  assert.equal(steps[1]?.note, "At submission");
  const deposit = proposalTimeline(row({ status: "deposit", votingStartTime: "0001-01-01T00:00:00Z", votingEndTime: null }));
  assert.equal(deposit[1]?.state, "current");
  assert.equal(deposit[2]?.at, null, "year-1 placeholder times are unset");
  assert.equal(deposit[3]?.label, "Voting closes", "not 'closed' before it even opened");
  const rejected = proposalTimeline(row({ status: "rejected" }));
  assert.equal(rejected[4]?.state, "error");
  assert.equal(rejected[4]?.label, "Rejected");
});

test("percent text", () => {
  assert.equal(pct(0.4687), "46.9%");
  assert.equal(pct(0.3), "30%");
  assert.equal(pct(0.0000001), "<0.1%");
  assert.equal(pct(0.99999), ">99.9%");
  assert.equal(pct(null), "—");
});

test("absolute times: labelled UTC before hydration (same on server and client), the reader's zone after", () => {
  const at = Date.parse("2026-10-05T11:58:17Z");
  // No clock yet (server render, hydrating render): UTC, and it says so.
  assert.equal(dateText(at, "datetime", null), "Oct 5, 2026, 11:58\u00a0AM UTC");
  assert.match(dateText(at, "short", null), /^Oct 5(, 2026)?$/);
  // Hydrated: the runtime's (the reader's) own zone, unlabelled.
  assert.equal(dateText(at, "datetime", NOW), formatDate(at, "datetime"));
  // Late on Dec 31 in UTC is already Jan 1 east of it: the day follows UTC too.
  assert.match(dateText(Date.parse("2025-12-31T23:30:00Z"), "short", null), /^Dec 31(, 2025)?$/);
});

test("proposal links carry the chain", () => {
  assert.equal(proposalHref("osmosis-1", "1049"), "/governance/osmosis-1/1049");
  assert.equal(proposalHref("kava_2222-10", "7"), "/governance/kava_2222-10/7");
});

/* ------------------------------------------------------------------ swing */

test("swing: a passing vote flips most cheaply through the veto", () => {
  const swing = swingOf(row());
  assert.ok(swing);
  assert.equal(swing.direction, "to-fail");
  assert.equal(swing.via, "veto");
  const total = tallyShares(row().tally)?.total ?? 0;
  const expected = (0.334 * total - 2060000) / (1 - 0.334);
  assert.ok(Math.abs(swing.amount - expected) / expected < 1e-9);
  assert.ok(Math.abs(swing.notVoted - (1 - 0.4687333808711663)) < 1e-12);
  assert.equal(swing.beyondRemaining, false);
});

test("swing: a close threshold race flips through No", () => {
  const swing = swingOf(row({ tally: { yes: "52", no: "48", abstain: "0", veto: "0" }, turnout: 0.5, passingIfEndedNow: true }));
  assert.ok(swing);
  assert.equal(swing.via, "threshold");
  assert.ok(Math.abs(swing.amount - 4) < 1e-9, String(swing.amount));
  assert.ok(Math.abs(swing.shareOfStaked - 0.02) < 1e-9);
});

test("swing: below quorum with a passing split is a turnout question", () => {
  const hub = row({ tally: { yes: "95", no: "1", abstain: "4", veto: "0" }, turnout: 0.1, quorum: 0.4, passingIfEndedNow: false });
  const swing = swingOf(hub);
  assert.ok(swing);
  assert.equal(swing.direction, "to-pass");
  assert.equal(swing.via, "quorum");
  // bonded = 100 / 0.1 = 1000; 30% more of it must vote.
  assert.ok(Math.abs(swing.amount - 300) < 1e-9);
  assert.ok(Math.abs(swing.shareOfStaked - 0.3) < 1e-12);
});

test("swing: failing on the threshold needs Yes votes; beyond what is left is flagged", () => {
  const swing = swingOf(row({ tally: { yes: "40", no: "60", abstain: "0", veto: "0" }, turnout: 0.95, quorum: 0.334, passingIfEndedNow: false }));
  assert.ok(swing);
  assert.equal(swing.via, "threshold");
  // 60 / 120 = 50% is not enough (x/gov needs more than the threshold): just over 20.
  assert.ok(swing.amount > 20 && swing.amount < 20.001, String(swing.amount));
  assert.equal(swing.beyondRemaining, true, "20 of ~105 staked is more than the 5% left");
  assert.equal(swingOf(row({ status: "passed" })), null);
  assert.equal(swingOf(row({ tally: null })), null);
});

test("rejected: quorum first, as x/gov tallies (a vetoed spam far below quorum failed on turnout)", () => {
  // cosmoshub-4 #1046, an airdrop spam: 99.9% veto at ≈ 20.8% turnout on a
  // 40% quorum. x/gov stops at quorum, so the veto rule never applied (the
  // Hub refunds deposits on a missed quorum: burn_vote_quorum is off).
  const spam = row({
    chainId: "cosmoshub-4",
    status: "rejected",
    tallyKind: "final",
    passingIfEndedNow: null,
    turnoutEstimate: true,
    turnout: 0.208,
    quorum: 0.4,
    tally: { yes: "1687160980", no: "7500589228", abstain: "602903933", veto: "70811379029051" },
  });
  assert.equal(rejectionReason(spam), "quorum");
  const outcome = outcomeOf(spam, NOW);
  assert.equal(outcome.label, "Rejected: below quorum");
  assert.equal(outcome.detail, "Turnout ≈ 20.8% · quorum 40%");
  assert.equal(ruleChecks(spam)[0]?.ok, false);
  // No turnout to stand on, or one too close to quorum to trust: the exact
  // final tally decides, and quorum stays unknown rather than guessed.
  assert.equal(rejectionReason({ ...spam, turnout: null }), "veto");
  assert.equal(rejectionReason({ ...spam, turnout: 0.37 }), "veto");
  assert.equal(outcomeOf({ ...spam, turnout: 0.37 }, NOW).label, "Rejected: vetoed");
  assert.equal(ruleChecks({ ...spam, turnout: 0.37 })[0]?.ok, null);
  // osmosis-1 #1022: more No than Yes, at ≈ 21.8% turnout on a 30% quorum.
  const lost = row({ status: "rejected", turnout: 0.218, quorum: 0.3, turnoutEstimate: true, tally: { yes: "8481452269400", no: "28050875921121", abstain: "2430139356666", veto: "12683215933" } });
  assert.equal(rejectionReason(lost), "quorum");
  assert.equal(rejectionReason({ ...lost, turnout: null }), "threshold");
  assert.equal(outcomeOf({ ...lost, turnout: null }, NOW).label, "Rejected: not enough Yes");
  // The estimate named quorum, so it agrees with the result: not withheld.
  assert.equal(withUsableTurnout({ ...spam, votingEndTime: "2026-09-20T00:00:00Z" }, NOW).turnout, 0.208);
});

test("rejected: quorum is also named by elimination, whatever the estimate reads", () => {
  // A clear Yes majority, no veto, still rejected: only turnout can explain it,
  // even when today's staked total makes the estimate look above quorum.
  const quiet = row({ status: "rejected", turnoutEstimate: true, turnout: 0.45, quorum: 0.4, tally: { yes: "90", no: "5", abstain: "5", veto: "0" } });
  assert.equal(rejectionReason(quiet), "quorum");
  assert.equal(ruleChecks(quiet)[0]?.ok, false);
  assert.equal(outcomeOf(quiet, NOW).label, "Rejected: below quorum");
  assert.equal(outcomeOf({ ...quiet, turnout: null }, NOW).detail, "Turnout under the 40% quorum");
  // Nobody voted at all.
  assert.equal(rejectionReason(row({ status: "rejected", tally: { yes: "0", no: "0", abstain: "0", veto: "0" } })), "quorum");
  // Unknown rules or tally: no reason rather than a guess.
  assert.equal(rejectionReason(row({ status: "rejected", threshold: null, tally: { yes: "90", no: "10", abstain: "0", veto: "0" } })), null);
  assert.equal(rejectionReason(row({ status: "rejected", tally: null })), null);
  assert.equal(rejectionReason(row({ status: "passed" })), null);
});

test("passed proposals met every rule, whatever the estimated turnout says", () => {
  const passed = row({ status: "passed", turnoutEstimate: true, turnout: 0.2, quorum: 0.4 });
  assert.deepEqual(ruleChecks(passed).map((c) => c.ok), [true, true, true]);
  assert.equal(ruleChecks(passed)[0]?.approx, true);
});

test("an ended vote's turnout is withheld when the estimate stops meaning anything", () => {
  const ended = row({ status: "passed", turnoutEstimate: true, turnout: 0.6, votingEndTime: "2026-09-20T00:00:00Z" });
  assert.equal(withUsableTurnout(ended, NOW).turnout, 0.6, "recent: shown as an estimate");
  const old = { ...ended, votingEndTime: new Date(NOW - TURNOUT_ESTIMATE_MAX_AGE_MS - 1).toISOString() };
  assert.equal(withUsableTurnout(old, NOW).turnout, null, "past three months: withheld");
  assert.ok(turnoutWithheld(withUsableTurnout(old, NOW)));
  assert.equal(withUsableTurnout({ ...ended, turnout: 1.06 }, NOW).turnout, null, "above 100%: stake shrank since");
  // An estimate on the wrong side of quorum for the recorded result is withheld.
  assert.equal(withUsableTurnout({ ...ended, turnout: 0.25, quorum: 0.3 }, NOW).turnout, null, "passed yet 'below quorum'");
  const quiet = row({ status: "rejected", turnoutEstimate: true, turnout: 0.45, quorum: 0.4, votingEndTime: "2026-09-20T00:00:00Z", tally: { yes: "90", no: "5", abstain: "5", veto: "0" } });
  assert.equal(withUsableTurnout(quiet, NOW).turnout, null, "rejected on turnout yet 'above quorum'");
  assert.equal(withUsableTurnout({ ...quiet, turnout: 0.3 }, NOW).turnout, 0.3);
  // A live turnout is measured, whatever its age.
  assert.equal(withUsableTurnout(row(), NOW + 10 * TURNOUT_ESTIMATE_MAX_AGE_MS).turnout, row().turnout);
  assert.equal(turnoutWithheld(row({ turnout: null })), false, "a live tally without turnout is just unknown");
});

test("track record per network: pass rate and why the rest failed", () => {
  const rows = [
    row({ id: "3", status: "passed" }),
    row({ id: "1", status: "rejected", tally: { yes: "1", no: "1", abstain: "0", veto: "98" } }),
    row({ id: "2", status: "failed" }),
    row({ id: "4", status: "voting" }),
    row({ id: "9", chainId: "cosmoshub-4", status: "rejected", tally: { yes: "90", no: "10", abstain: "0", veto: "0" } }),
    row({ id: "7", chainId: "juno-1", status: "passed" }),
  ];
  const [osmosis, hub, celestia] = trackRecords(rows, ["osmosis-1", "cosmoshub-4", "celestia"]);
  assert.deepEqual(osmosis?.entries.map((e) => e.id), ["1", "2", "3"], "ended only, oldest first");
  assert.deepEqual([osmosis?.passed, osmosis?.rejected, osmosis?.failed], [1, 1, 1]);
  assert.deepEqual(osmosis?.reasons, { veto: 1 });
  assert.deepEqual(hub?.reasons, { quorum: 1 });
  assert.equal(celestia?.entries.length, 0, "a network in scope with nothing ended still has its row");
});

test("description: an opening line that only repeats the title is dropped", () => {
  const title = "Move the 1,227,121 ATOM recovered after the Neutron exploit";
  assert.equal(descriptionWithoutTitle(`# ${title}\n\nThis is a text proposal.`, title), "This is a text proposal.");
  assert.equal(descriptionWithoutTitle(`\n**${title}.**\nBody`, title), "Body");
  assert.equal(descriptionWithoutTitle(`${title}\n===\nBody`, title), "Body");
  assert.equal(descriptionWithoutTitle(`# ${title}\\n\\nBody`, title), "Body", "literal \\n from a CLI submission");
  const other = `# Background\n\n${title}`;
  assert.equal(descriptionWithoutTitle(other, title), other, "a different heading stays");
  assert.equal(descriptionWithoutTitle("Plain text", title), "Plain text");
});

test("metadata placeholders are not worth a row", () => {
  assert.equal(meaningfulMetadata("Not Used"), "");
  assert.equal(meaningfulMetadata(" {} "), "");
  assert.equal(meaningfulMetadata(null), "");
  assert.equal(meaningfulMetadata("ipfs://bafy…"), "ipfs://bafy…");
});

test("summary excerpt drops a leading copy of the title", () => {
  const title = "Move the 1,227,121 ATOM recovered after the Neutron exploit to the Neutron recovery multisig";
  assert.equal(summaryWithoutTitle(`${title} This is a text proposal.`, title), "This is a text proposal.");
  assert.equal(summaryWithoutTitle("Margined is winding down.", "Withdraw Margined"), "Margined is winding down.");
  assert.equal(summaryWithoutTitle(`${title}: details`, title), "details");
});

test("deposit against the minimum, in the minimum's denom only", () => {
  const terra = depositState({ totalDeposit: [{ denom: "uluna", amount: "1000000000000" }], minDeposit: [{ denom: "uluna", amount: "5000000000000" }] });
  assert.equal(terra.ratio, 0.2);
  assert.equal(terra.missing, "4000000000000");
  const other = depositState({ totalDeposit: [{ denom: "uusdc", amount: "900" }], minDeposit: [{ denom: "uatom", amount: "500" }] });
  assert.equal(other.total, "0", "a deposit in another token does not count");
  assert.equal(other.ratio, 0);
  const met = depositState({ totalDeposit: [{ denom: "uatom", amount: "700" }], minDeposit: [{ denom: "uatom", amount: "500" }] });
  assert.equal(met.missing, "0");
  assert.equal(depositState({ totalDeposit: [], minDeposit: null }).ratio, null);
});
