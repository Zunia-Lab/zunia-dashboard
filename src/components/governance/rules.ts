/**
 * The tally rules of x/gov, as the governance pages explain them: shares of
 * the votes, the pass line, turnout against quorum, whether a proposal would
 * pass now and why not, what would flip it, and why an ended one failed.
 *
 * Pure (no React, no fetch), so `node --test` covers the parts a reader acts
 * on. The rules mirror x/gov's tally (keeper/tally.go, SDK 0.47–0.53), the
 * same ones the server applies in `@/lib/chain/governance`:
 *
 * 1. turnout (every vote, abstain included, ÷ bonded tokens) below quorum → fails;
 * 2. everyone abstained → fails;
 * 3. No with veto ÷ all votes above the veto threshold → fails (vetoed);
 * 4. Yes ÷ (all votes − abstain) above the threshold → passes, else fails.
 *
 * The server's `passingIfEndedNow` stays the verdict; this module explains it
 * (which rule decides) and never contradicts it.
 *
 * Ended proposals are explained from what the chain keeps exactly: the final
 * tally (so veto and threshold are certain) and the result. It does not keep
 * the staked total of voting day, so turnout is an estimate there, withheld
 * once it stops meaning anything. Quorum is named when that estimate reads
 * clearly under it (x/gov checks quorum first, so a tally below it never
 * reaches the veto or threshold rule), or by elimination when the tally
 * clears both other rules.
 */

import { formatPercent, NO_VALUE } from "@/lib/format";
import type { ProposalRow, Tally } from "@/lib/chain/types";

/* ------------------------------------------------------------------ numbers */

function num(value: string | null | undefined): number {
  if (!value) return 0;
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? n : 0;
}

export interface TallyShares {
  /** Each option's share of all votes cast (abstain included), 0..1. */
  yes: number;
  no: number;
  veto: number;
  abstain: number;
  /** Votes cast, base units as a float (for ratios and compact display only). */
  total: number;
  /** Votes cast minus abstain: the base of the pass threshold. */
  decisive: number;
}

/** Shares of the votes cast; null when there is no tally or nobody voted. */
export function tallyShares(tally: Tally | null | undefined): TallyShares | null {
  if (!tally) return null;
  const yes = num(tally.yes);
  const no = num(tally.no);
  const veto = num(tally.veto);
  const abstain = num(tally.abstain);
  const total = yes + no + veto + abstain;
  if (!(total > 0)) return null;
  return { yes: yes / total, no: no / total, veto: veto / total, abstain: abstain / total, total, decisive: total - abstain };
}

/** Yes ÷ (Yes + No + Veto): the figure the threshold is compared with. */
export function yesOfDecisive(tally: Tally | null | undefined): number | null {
  if (!tally) return null;
  const decisive = num(tally.yes) + num(tally.no) + num(tally.veto);
  return decisive > 0 ? num(tally.yes) / decisive : null;
}

/**
 * Where the pass line sits on a bar of all votes cast (0..1): Yes has to
 * reach past it. With abstain drawn last, it is the threshold of the decisive
 * part of the bar.
 */
export function passLine(tally: Tally | null | undefined, threshold: number | null): number | null {
  const shares = tallyShares(tally);
  if (!shares || threshold === null || !(shares.decisive > 0)) return null;
  return threshold * (1 - shares.abstain);
}

/** Parts laid end to end: each with the offset where it starts (0..1 bars). */
export function stackParts<T extends { share: number }>(parts: readonly T[]): Array<T & { start: number }> {
  const out: Array<T & { start: number }> = [];
  let start = 0;
  for (const part of parts) {
    out.push({ ...part, start });
    start += part.share;
  }
  return out;
}

/* ------------------------------------------------------------------ turnout of ended votes */

const HOUR = 3_600_000;
const DAY = 24 * HOUR;

/**
 * How long after it closed an ended vote's turnout estimate is still shown.
 * Staked totals drift a few percent a month on most chains; past about three
 * months the "approximate" figure can be off by more than the gap to quorum
 * it is read against (older Osmosis votes came out above 100%).
 */
export const TURNOUT_ESTIMATE_MAX_AGE_MS = 90 * DAY;

/**
 * How far under quorum an ended vote's turnout estimate must read before it
 * names quorum as the reason a proposal was rejected. The estimate divides
 * the final tally by today's staked total: to read under 90% of quorum while
 * the real turnout met it, staked tokens would have to have grown by more
 * than 11% since voting day (and estimates older than three months are
 * withheld already). Closer to quorum than that, the tally decides.
 */
export const QUORUM_ESTIMATE_MARGIN = 0.9;

/** Why an ended vote shows "—" for turnout (tooltips, captions). */
export const TURNOUT_WITHHELD =
  "Not estimated: the chain keeps no staked total from voting day, and today's no longer matches it after about three months";

/**
 * The row with a turnout the page can stand behind. A live tally's turnout
 * is measured. An ended one divides the final tally by today's staked total,
 * so past `TURNOUT_ESTIMATE_MAX_AGE_MS`, or once it reads above 100% (stake
 * has shrunk since), it is withheld (null) rather than shown as a figure.
 * `at` is when the rows were read; null keeps only the 100% check.
 */
export function withUsableTurnout<T extends RuleInput & Pick<ProposalRow, "votingEndTime">>(row: T, at: number | null): T {
  if (row.turnout === null) return row;
  if (!(row.turnout <= 1)) return { ...row, turnout: null };
  if (!row.turnoutEstimate) return row;
  const end = row.votingEndTime ? Date.parse(row.votingEndTime) : Number.NaN;
  if (at !== null && !(Number.isFinite(end) && at - end <= TURNOUT_ESTIMATE_MAX_AGE_MS)) return { ...row, turnout: null };
  // An estimate on the wrong side of quorum for the result the chain
  // recorded (passed, or rejected on turnout) is plainly off: withheld too.
  const metQuorum = row.status === "passed" || row.status === "failed" ? true : rejectionReason(row) === "quorum" ? false : null;
  if (metQuorum !== null && row.quorum !== null && (row.turnout >= row.quorum) !== metQuorum) return { ...row, turnout: null };
  return row;
}

/** An ended vote whose turnout was withheld (or never known): say why, not just "—". */
export function turnoutWithheld(row: Pick<ProposalRow, "turnout" | "turnoutEstimate">): boolean {
  return row.turnout === null && Boolean(row.turnoutEstimate);
}

/** Bonded tokens implied by a tally and its turnout (tally ÷ turnout). */
export function impliedBonded(tally: Tally | null | undefined, turnout: number | null): number | null {
  const shares = tallyShares(tally);
  if (!shares || turnout === null || !(turnout > 0)) return null;
  return shares.total / turnout;
}

/**
 * Voting power still needed to reach quorum, base units (float): null when
 * quorum is met or the figures are unknown.
 */
export function quorumShortfall(row: Pick<ProposalRow, "tally" | "turnout" | "quorum">): number | null {
  if (row.quorum === null || row.turnout === null || row.turnout >= row.quorum) return null;
  const bonded = impliedBonded(row.tally, row.turnout);
  if (bonded === null) return null;
  return (row.quorum - row.turnout) * bonded;
}

/* ------------------------------------------------------------------ swing */

export interface Swing {
  /** A passing proposal that could still fail, or a failing one that could still pass. */
  direction: "to-fail" | "to-pass";
  /** The cheapest rule to flip it through. */
  via: "threshold" | "veto" | "quorum";
  /** Additional voting power, base units (float), that alone would flip it. */
  amount: number;
  /** The same as a share of staked voting power, 0..1. */
  shareOfStaked: number;
  /** Staked voting power that has not voted yet, 0..1. */
  notVoted: number;
  /** More than all the stake that has not voted would be needed. */
  beyondRemaining: boolean;
}

/**
 * How much more voting power, from stake that has not voted, would flip the
 * live result: votes against (No or No with veto, whichever is cheaper) for a
 * passing proposal; more votes for a failing one (reaching quorum, diluting a
 * veto, or Yes past the threshold).
 *
 * An estimate, and labelled as one: a delegator who overrides their
 * validator's vote moves power from one option to another without new
 * turnout, which this does not model. Null when the tally or the rules are
 * unknown, voting is over, or no single side can flip it.
 */
export function swingOf(
  row: Pick<ProposalRow, "status" | "tally" | "turnout" | "quorum" | "threshold" | "vetoThreshold" | "passingIfEndedNow">,
): Swing | null {
  if (row.status !== "voting" || !row.tally || row.turnout === null || !(row.turnout > 0)) return null;
  const { quorum, threshold: th, vetoThreshold: vt } = row;
  if (quorum === null || th === null || vt === null || th <= 0 || th >= 1 || vt <= 0 || vt >= 1) return null;
  const yes = num(row.tally.yes);
  const no = num(row.tally.no);
  const veto = num(row.tally.veto);
  const abstain = num(row.tally.abstain);
  const total = yes + no + veto + abstain;
  if (!(total > 0)) return null;
  const bonded = total / row.turnout;
  const notVoted = Math.max(0, 1 - row.turnout);
  const shape = (direction: Swing["direction"], via: Swing["via"], amount: number): Swing => ({
    direction,
    via,
    amount,
    shareOfStaked: amount / bonded,
    notVoted,
    beyondRemaining: amount / bonded > notVoted,
  });
  const passing = row.passingIfEndedNow ?? failingRule(row) === null;
  if (passing) {
    // Against votes until Yes ≤ threshold of the decisive votes…
    const byThreshold = Math.max(0, yes / th - (yes + no + veto));
    // …or veto votes until veto exceeds its share of all votes.
    const byVeto = Math.max(0, (vt * total - veto) / (1 - vt));
    return byVeto < byThreshold ? shape("to-fail", "veto", byVeto) : shape("to-fail", "threshold", byThreshold);
  }
  const reason = failingRule(row);
  // Yes votes needed to clear the threshold (added Yes also dilutes a veto).
  const yesForThreshold = Math.max(0, (th * (no + veto) - (1 - th) * yes) / (1 - th));
  const yesForVeto = Math.max(0, veto / vt - total);
  if (reason === "quorum") {
    const forQuorum = (quorum - row.turnout) * bonded;
    const split = yesOfDecisive(row.tally);
    // A pure turnout question when the split already passes: votes of any
    // kind reach quorum. Otherwise it takes Yes votes, enough for every rule.
    if (split !== null && split > th && veto / total <= vt) return shape("to-pass", "quorum", forQuorum);
    return shape("to-pass", "threshold", Math.max(forQuorum, yesForThreshold * 1.000001, yesForVeto));
  }
  if (reason === "threshold" || reason === "veto") {
    const amount = Math.max(yesForThreshold, yesForVeto) * 1.000001;
    return shape("to-pass", reason, amount);
  }
  return null;
}

/* ------------------------------------------------------------------ outcome */

export type OutcomeReason = "quorum" | "all-abstain" | "veto" | "threshold";

export type OutcomeTone = "success" | "warning" | "danger" | "neutral" | "info";

export interface Outcome {
  kind: "passing" | "failing" | "ended-pending" | "no-tally" | "deposit" | "passed" | "rejected" | "failed" | "unknown";
  /** The rule that decides a failing (or rejected) proposal, when one does. */
  reason: OutcomeReason | null;
  /** "Would pass if it ended now", "Would fail: below quorum", "Passed". */
  label: string;
  /** The numbers behind it: "Turnout 12.7% · quorum 40%". */
  detail: string | null;
  tone: OutcomeTone;
}

export interface RuleCheck {
  key: "quorum" | "veto" | "threshold";
  label: string;
  /** The measured figure (0..1). */
  value: number | null;
  /** The rule's limit (0..1). */
  limit: number | null;
  /** Whether this rule is satisfied; null when unknown. */
  ok: boolean | null;
  /** The figure is an estimate (an ended vote's turnout, read against today's staked total). */
  approx: boolean;
  /** "≥ 30% of staked must vote", "No with veto must stay ≤ 33.4% of votes". */
  requirement: string;
}

/** The fields the tally rules read; status and the estimate flag refine ended proposals. */
export type RuleInput = Pick<ProposalRow, "tally" | "turnout" | "quorum" | "threshold" | "vetoThreshold"> &
  Partial<Pick<ProposalRow, "status" | "turnoutEstimate">>;

/**
 * Percent text for a 0..1 ratio, on the house formatter: one decimal,
 * "<0.1%" for slivers, ">99.9%" for a near-unanimous vote (which must not
 * round up to a 100% it is not), and whole rules without a ".0" ("30%").
 */
export function pct(ratio: number | null | undefined, digits = 1): string {
  if (ratio === null || ratio === undefined || !Number.isFinite(ratio)) return NO_VALUE;
  const value = ratio * 100;
  if (value < 100 && value > 100 - 10 ** -digits) return `>${(100 - 10 ** -digits).toFixed(digits)}%`;
  return formatPercent(value, { digits }).replace(/\.0+%$/, "%");
}

/**
 * The three tally rules, each with its figure and limit, in the order x/gov
 * applies them. Unknown inputs give `ok: null`, never a guess.
 *
 * An ended proposal's result settles what its figures cannot: a passed one
 * met every rule, and a rejected one failed on quorum when `rejectionReason`
 * says so (an estimate clearly under quorum, or a tally that clears veto and
 * threshold). Quorum of a proposal rejected for another reason stays
 * unknown: its turnout is only an estimate.
 */
export function ruleChecks(row: RuleInput): RuleCheck[] {
  const shares = tallyShares(row.tally);
  const yes = yesOfDecisive(row.tally);
  const passed = row.status === "passed" || row.status === "failed";
  const rejectedFor = row.status === "rejected" ? rejectionReason(row) : null;
  const measuredQuorum = row.turnout !== null && row.quorum !== null ? row.turnout >= row.quorum : null;
  const quorumOk = passed ? true : rejectedFor === "quorum" ? false : row.status === "rejected" ? null : measuredQuorum;
  const vetoOk = passed ? true : shares && row.vetoThreshold !== null ? !(shares.veto > row.vetoThreshold) : null;
  const thresholdOk = passed
    ? true
    : yes !== null && row.threshold !== null
      ? yes > row.threshold
      : shares && shares.decisive === 0
        ? false
        : null;
  return [
    {
      key: "quorum",
      label: "Quorum",
      value: row.turnout,
      limit: row.quorum,
      ok: quorumOk,
      approx: Boolean(row.turnoutEstimate) && row.turnout !== null,
      requirement: row.quorum !== null ? `≥ ${pct(row.quorum)} of staked must vote` : "Quorum unknown",
    },
    {
      key: "veto",
      label: "Veto",
      value: shares ? shares.veto : null,
      limit: row.vetoThreshold,
      ok: vetoOk,
      approx: false,
      requirement: row.vetoThreshold !== null ? `No with veto must stay ≤ ${pct(row.vetoThreshold)} of votes` : "Veto threshold unknown",
    },
    {
      key: "threshold",
      label: "Threshold",
      value: yes,
      limit: row.threshold,
      ok: thresholdOk,
      approx: false,
      requirement: row.threshold !== null ? `Yes must be > ${pct(row.threshold)} of Yes + No + Veto` : "Threshold unknown",
    },
  ];
}

/** The first rule that fails a live tally, in x/gov's order; null when none does (or unknown). */
export function failingRule(row: RuleInput): OutcomeReason | null {
  const shares = tallyShares(row.tally);
  const [quorum, veto, threshold] = ruleChecks({ ...row, status: "voting" });
  if (quorum?.ok === false) return "quorum";
  if (shares && shares.decisive === 0) return "all-abstain";
  if (veto?.ok === false) return "veto";
  if (threshold?.ok === false) return "threshold";
  return null;
}

/**
 * Why a rejected proposal failed, in x/gov's order. Quorum comes first and
 * ends the tally: below it a proposal is rejected without the veto or
 * threshold rule being applied, and its deposit burns only on chains that
 * burn on missed quorum (the Hub refunded #1056, a 90% veto at about 30%
 * turnout on a 40% quorum). The chain keeps no staked total from voting day,
 * so quorum is named from the turnout estimate only when it reads clearly
 * under quorum (`QUORUM_ESTIMATE_MARGIN`), or by elimination: a rejected
 * proposal whose tally clears both other rules can only have failed on
 * turnout. Otherwise the final tally decides, exactly: veto, then the pass
 * threshold. Null when the tally or the rules are unknown.
 */
export function rejectionReason(row: RuleInput): OutcomeReason | null {
  if (row.status !== "rejected" || !row.tally) return null;
  const shares = tallyShares(row.tally);
  // Nobody voted at all: turnout was zero.
  if (!shares) return "quorum";
  if (row.turnout !== null && row.quorum !== null && row.turnout < row.quorum * QUORUM_ESTIMATE_MARGIN) return "quorum";
  if (shares.decisive === 0) return "all-abstain";
  if (row.vetoThreshold !== null && shares.veto > row.vetoThreshold) return "veto";
  const yes = yesOfDecisive(row.tally);
  if (row.threshold !== null && yes !== null && !(yes > row.threshold)) return "threshold";
  return row.vetoThreshold !== null && row.threshold !== null ? "quorum" : null;
}

/** "vetoed", "below quorum": a reason as a short phrase (labels, table cells). */
export function reasonText(reason: OutcomeReason): string {
  switch (reason) {
    case "quorum":
      return "below quorum";
    case "all-abstain":
      return "everyone abstained";
    case "veto":
      return "vetoed";
    case "threshold":
      return "not enough Yes";
  }
}

/** "Turnout ≈ 20.8%", "turnout —": an ended vote's estimate keeps its "≈". */
function turnoutText(row: Pick<ProposalRow, "turnout" | "turnoutEstimate">): string {
  return `${row.turnoutEstimate && row.turnout !== null ? "≈ " : ""}${pct(row.turnout)}`;
}

function liveDetail(row: ProposalRow, reason: OutcomeReason | null): string | null {
  const shares = tallyShares(row.tally);
  switch (reason) {
    case "quorum":
      return `Turnout ${turnoutText(row)} · quorum ${pct(row.quorum)}`;
    case "veto":
      return shares ? `Veto ${pct(shares.veto)} of votes · limit ${pct(row.vetoThreshold)}` : null;
    case "threshold":
      return `Yes ${pct(yesOfDecisive(row.tally))} of decisive votes · needs > ${pct(row.threshold)}`;
    case "all-abstain":
      return "Abstain counts toward quorum only";
    default:
      return shares ? `Yes ${pct(yesOfDecisive(row.tally))} · turnout ${turnoutText(row)}` : null;
  }
}

/** The figures behind an ended result; turnout only when its estimate is shown. */
function endedDetail(row: ProposalRow, reason: OutcomeReason | null): string | null {
  const shares = tallyShares(row.tally);
  switch (reason) {
    case "veto":
      return shares ? `Veto ${pct(shares.veto)} of votes · limit ${pct(row.vetoThreshold)}` : null;
    case "threshold":
      return `Yes ${pct(yesOfDecisive(row.tally))} of decisive votes · needs > ${pct(row.threshold)}`;
    case "quorum":
      return row.turnout !== null
        ? `Turnout ${turnoutText(row)} · quorum ${pct(row.quorum)}`
        : `Turnout under the ${pct(row.quorum)} quorum`;
    case "all-abstain":
      return "Every vote was Abstain";
    default:
      if (!shares) return null;
      return `Yes ${pct(yesOfDecisive(row.tally))} of decisive votes${row.turnout !== null ? ` · turnout ${turnoutText(row)}` : ""}`;
  }
}

/** Voting has ended but the row still says "voting": the chain is tallying. */
export function votingEnded(row: Pick<ProposalRow, "status" | "votingEndTime">, now: number | null): boolean {
  if (row.status !== "voting" || !row.votingEndTime || now === null) return false;
  const end = Date.parse(row.votingEndTime);
  return Number.isFinite(end) && now > end;
}

/** What the card and the tally panel headline say about a proposal. */
export function outcomeOf(row: ProposalRow, now: number | null): Outcome {
  switch (row.status) {
    case "deposit":
      return { kind: "deposit", reason: null, label: "Collecting deposit", detail: null, tone: "neutral" };
    case "passed":
      return { kind: "passed", reason: null, label: "Passed", detail: endedDetail(row, null), tone: "success" };
    case "failed":
      return {
        kind: "failed",
        reason: null,
        label: "Passed, but execution failed",
        detail: row.failedReason ?? null,
        tone: "danger",
      };
    case "rejected": {
      const reason = rejectionReason(row);
      return {
        kind: "rejected",
        reason,
        label: reason ? `Rejected: ${reasonText(reason)}` : "Rejected",
        detail: endedDetail(row, reason),
        tone: "danger",
      };
    }
    case "voting":
      break;
    default:
      return { kind: "unknown", reason: null, label: "Status unknown", detail: null, tone: "neutral" };
  }
  if (votingEnded(row, now)) {
    return {
      kind: "ended-pending",
      reason: null,
      label: "Voting ended · result pending",
      detail: "The chain tallies at the next block; this refreshes within a minute",
      tone: "neutral",
    };
  }
  if (!row.tally) {
    return { kind: "no-tally", reason: null, label: "Live tally unavailable", detail: null, tone: "neutral" };
  }
  const reason = failingRule(row);
  // The server's verdict wins; the computed rule only explains it.
  const passing = row.passingIfEndedNow ?? (reason === null ? null : false);
  if (passing === true) {
    return {
      kind: "passing",
      reason: null,
      label: "Would pass if it ended now",
      detail: liveDetail(row, null),
      tone: "success",
    };
  }
  if (passing === false) {
    return {
      kind: "failing",
      reason,
      label: reason ? `Would fail: ${reasonText(reason)}` : "Would fail if it ended now",
      detail: liveDetail(row, reason),
      tone: "warning",
    };
  }
  return { kind: "no-tally", reason: null, label: "Outcome unknown", detail: "Tally rules could not be read", tone: "neutral" };
}
