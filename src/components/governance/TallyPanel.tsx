"use client";

/**
 * The tally panel of a proposal page: the verdict in words (what it takes
 * from here while voting is open, what decided it once it closed), the tally
 * bar with amounts, the three rules as a checklist, and the estimate of what
 * would flip a live vote.
 */

import { Icon } from "@/components/icons";
import { Card, CardHeader, InfoTip, SourceTag, useNow } from "@/components/ui";
import { cn } from "@/lib/cn";
import type { ProposalDetail } from "@/lib/chain/types";
import { formatTokenAmount } from "@/lib/format";
import { pastOrNow } from "./model";
import {
  pct,
  quorumShortfall,
  ruleChecks,
  swingOf,
  tallyShares,
  TURNOUT_WITHHELD,
  turnoutWithheld,
  yesOfDecisive,
  type Outcome,
  type RuleCheck,
} from "./rules";
import { TallyBar } from "./TallyBar";

const VERDICT_STYLE: Record<Outcome["tone"], { fill: string; icon: "success" | "warning" | "danger" | "info"; color: string }> = {
  success: { fill: "bg-[var(--z-success-fill)]", icon: "success", color: "text-[var(--z-success)]" },
  warning: { fill: "bg-[var(--z-warning-fill)]", icon: "warning", color: "text-[var(--z-warning)]" },
  danger: { fill: "bg-[var(--z-danger-fill)]", icon: "danger", color: "text-[var(--z-danger)]" },
  neutral: { fill: "bg-[var(--d-glass)]", icon: "info", color: "text-fg-muted" },
  info: { fill: "bg-[var(--z-info-fill)]", icon: "info", color: "text-[var(--z-info)]" },
};

export function TallyCard({
  proposal,
  outcome,
  token,
  updatedAt,
  refreshing,
}: {
  proposal: ProposalDetail;
  outcome: Outcome;
  token: { symbol: string; decimals: number | null };
  updatedAt: number | null;
  refreshing: boolean;
}) {
  const now = useNow();
  const live = proposal.tallyKind === "live";
  const style = VERDICT_STYLE[outcome.tone];
  const checks = ruleChecks(proposal);
  return (
    <Card as="section" aria-label="Tally" pending={refreshing}>
      <CardHeader
        title={live ? "Live tally" : proposal.tally ? "Final tally" : "Tally"}
        subtitle={live ? "If voting closed now" : proposal.tally ? "As recorded by the chain" : undefined}
        icon="governance"
        actions={updatedAt ? <SourceTag source="Chain LCD" at={pastOrNow(updatedAt, now)} /> : null}
      />
      <div className={cn("flex items-start gap-3 rounded-[var(--d-radius-inner)] px-4 py-3", style.fill)}>
        <Icon name={style.icon} size={20} className={cn("mt-0.5 shrink-0", style.color)} />
        <div className="min-w-0">
          <p className={cn("text-[16px] font-semibold leading-snug tracking-[-0.01em]", style.color)}>{outcome.label}</p>
          <p className="mt-0.5 text-[13px] leading-[1.5] text-fg-muted">{verdictSentence(proposal, outcome, token)}</p>
        </div>
      </div>
      <TallyBar row={proposal} size="full" token={token} className="mt-1" />
      {proposal.tally ? <RuleList checks={checks} withheld={turnoutWithheld(proposal)} /> : null}
      {outcome.kind === "passing" || outcome.kind === "failing" ? <SwingNote proposal={proposal} token={token} /> : null}
      <p className="text-[12px] leading-[1.55] text-fg-dim">
        {live
          ? "Live tallies count each validator's vote for the delegators who have not voted; a delegator's own vote replaces it for their stake. Abstain counts toward quorum only."
          : turnoutWithheld(proposal)
            ? "Turnout is not shown: the chain keeps no staked total from voting day, and today's is too far from it to estimate. Abstain counts toward quorum only."
            : proposal.turnoutEstimate
              ? "Turnout uses today's staked total (the chain does not keep the one from voting day), so it is approximate. Abstain counts toward quorum only."
              : "Abstain counts toward quorum only."}
      </p>
    </Card>
  );
}

/** A voting-power amount as a share of the staked total implied by the tally and turnout. */
function impliedShare(proposal: ProposalDetail, amount: number): number | null {
  const total = tallyShares(proposal.tally)?.total ?? 0;
  if (!(total > 0) || proposal.turnout === null || !(proposal.turnout > 0)) return null;
  return amount / (total / proposal.turnout);
}

/**
 * The verdict in words. Live tallies say what it takes from here; ended ones
 * say what decided it, from the final tally (exact) and the turnout estimate
 * only when there is one worth showing.
 */
function verdictSentence(proposal: ProposalDetail, outcome: Outcome, token: { symbol: string; decimals: number | null }): string {
  const shares = tallyShares(proposal.tally);
  const yes = yesOfDecisive(proposal.tally);
  if (outcome.kind === "failed") {
    return `The vote passed, but executing its messages failed${proposal.failedReason ? `: ${proposal.failedReason}` : "."}`;
  }
  if (!shares) {
    if (outcome.kind === "ended-pending") return outcome.detail ?? "";
    if (outcome.kind === "rejected") return proposal.tally ? "Nobody voted: turnout was zero." : "The chain recorded it as rejected; its final tally could not be read.";
    return proposal.tally ? "Nobody has voted yet." : "The live tally could not be read; figures appear when the chain answers.";
  }
  if (outcome.kind === "passed" || outcome.kind === "rejected") return endedSentence(proposal, outcome, shares.veto, yes);
  const turnout = pct(proposal.turnout);
  switch (outcome.reason) {
    case "quorum": {
      // Exact, not an estimate: overriding a validator's vote moves power
      // between options but never changes turnout.
      const missing = quorumShortfall(proposal);
      const amount =
        missing !== null && token.decimals !== null
          ? `${formatTokenAmount(BigInt(Math.ceil(missing)).toString(), token.decimals, { compact: true })} ${token.symbol}`
          : null;
      const share = missing !== null ? impliedShare(proposal, missing) : null;
      const splitPasses = yes !== null && proposal.threshold !== null && yes > proposal.threshold && shares.veto <= (proposal.vetoThreshold ?? 1);
      return (
        `Turnout is ${turnout}, under the ${pct(proposal.quorum)} quorum` +
        (amount ? `: ${amount} more${share !== null ? ` (${pct(share)} of staked)` : ""} must vote, of any option.` : ".") +
        (splitPasses ? ` With today's split (Yes ${pct(yes)} of decisive votes) it would then pass.` : " Even then, today's split would not pass it.")
      );
    }
    case "veto":
      return `No with veto is ${pct(shares.veto)} of all votes, above the ${pct(proposal.vetoThreshold)} veto threshold: vetoed proposals are rejected and their deposits can be burned.`;
    case "threshold":
      return `Yes has ${pct(yes)} of Yes + No + Veto and needs more than ${pct(proposal.threshold)}. Turnout ${turnout} meets the quorum.`;
    case "all-abstain":
      return "Every vote so far is Abstain, which counts toward quorum but decides nothing.";
    default:
      if (outcome.kind === "passing") {
        return `Yes has ${pct(yes)} of decisive votes (more than ${pct(proposal.threshold)} needed), turnout ${turnout} clears the ${pct(proposal.quorum)} quorum, and veto is ${pct(shares.veto)} (limit ${pct(proposal.vetoThreshold)}).`;
      }
      return outcome.detail ?? `Yes ${pct(yes)} of decisive votes, turnout ${turnout}.`;
  }
}

function endedSentence(proposal: ProposalDetail, outcome: Outcome, veto: number, yes: number | null): string {
  const estimate = proposal.turnout !== null ? ` (about ${pct(proposal.turnout)} by today's staked total)` : "";
  if (outcome.kind === "passed") {
    return `Yes had ${pct(yes)} of decisive votes (more than ${pct(proposal.threshold)} needed), veto stayed at ${pct(veto)} (limit ${pct(proposal.vetoThreshold)}), and turnout cleared the ${pct(proposal.quorum)} quorum${estimate}.`;
  }
  switch (outcome.reason) {
    case "veto":
      return `No with veto reached ${pct(veto)} of all votes, above the ${pct(proposal.vetoThreshold)} veto threshold: vetoed proposals are rejected and their deposits can be burned.`;
    case "threshold":
      return `Yes had ${pct(yes)} of Yes + No + Veto; it needed more than ${pct(proposal.threshold)}.`;
    case "quorum": {
      // Named by elimination (the tally clears both other rules) or by a
      // turnout estimate clearly under quorum, where the split may well
      // have failed too: the chain never got that far, so say so rather
      // than claim the tally would have passed.
      const tallyPasses =
        proposal.vetoThreshold !== null && proposal.threshold !== null && yes !== null && !(veto > proposal.vetoThreshold) && yes > proposal.threshold;
      return tallyPasses
        ? `The final tally clears the veto and threshold rules, so it failed on turnout: under the ${pct(proposal.quorum)} quorum${estimate}.`
        : `Turnout was under the ${pct(proposal.quorum)} quorum${estimate}, so it failed there: below quorum the chain rejects a proposal without applying the veto or threshold rules.`;
    }
    case "all-abstain":
      return "Every vote was Abstain, which counts toward quorum but decides nothing.";
    default:
      return "The chain recorded it as rejected; its tally rules could not be read to say why.";
  }
}

/** What each rule measures, under its name. */
const RULE_MEASURE: Record<RuleCheck["key"], string> = {
  quorum: "Staked voting power that voted",
  veto: "No with veto, of all votes",
  threshold: "Yes, of Yes + No + Veto",
};

const CHECK_NEED: Record<RuleCheck["key"], (check: RuleCheck) => string> = {
  quorum: (check) => `needs ≥ ${pct(check.limit)}`,
  veto: (check) => `must stay ≤ ${pct(check.limit)}`,
  threshold: (check) => `needs > ${pct(check.limit)}`,
};

/**
 * The three rules as a checklist: verdict, rule, measured figure (right), and
 * under them what is measured and the limit. Two aligned lines per rule read
 * the same on a phone as on a wide card.
 */
function RuleList({ checks, withheld }: { checks: RuleCheck[]; withheld: boolean }) {
  return (
    // Side by side on wide screens, where one row per rule would stretch the
    // figure a thousand pixels away from its name.
    <ul
      className="flex flex-col divide-y divide-[var(--d-hairline)] rounded-[var(--d-radius-inner)] border border-[var(--d-hairline)] 2xl:grid 2xl:grid-cols-3 2xl:divide-x 2xl:divide-y-0"
      aria-label="Tally rules"
    >
      {checks.map((check) => (
        <li key={check.key} className="grid min-w-0 grid-cols-[20px_minmax(0,1fr)_auto] items-baseline gap-x-3 gap-y-0.5 px-3.5 py-2.5">
          <span
            className={cn(
              "row-span-2 flex size-5 items-center justify-center self-center rounded-full",
              check.ok === true && "bg-[var(--z-success-fill)] text-[var(--z-success)]",
              check.ok === false && "bg-[var(--z-danger-fill)] text-[var(--z-danger)]",
              check.ok === null && "bg-[var(--d-glass-2)] text-fg-dim",
            )}
          >
            <Icon name={check.ok === true ? "check" : check.ok === false ? "close" : "minus"} size={12} strokeWidth={2.2} />
            <span className="sr-only">{check.ok === true ? "Met" : check.ok === false ? "Not met" : "Unknown"}</span>
          </span>
          <span className="text-[13px] font-medium text-fg">{check.label}</span>
          <span
            className="text-right text-[13px] font-medium tabular-nums text-fg"
            title={check.value === null && check.key === "quorum" && withheld ? TURNOUT_WITHHELD : undefined}
          >
            {check.value === null ? "—" : `${check.approx ? "≈ " : ""}${pct(check.value)}`}
          </span>
          <span className="min-w-0 text-[12px] leading-snug text-fg-dim">{RULE_MEASURE[check.key]}</span>
          <span className="text-right text-[12px] leading-snug tabular-nums text-fg-dim">
            {check.limit === null ? "limit unknown" : CHECK_NEED[check.key](check)}
          </span>
        </li>
      ))}
    </ul>
  );
}

/**
 * How much it would take to flip the result, from stake that has not voted.
 * An estimate (labelled): delegators overriding their validator's vote move
 * power between options without new turnout, which this does not model.
 */
function SwingNote({ proposal, token }: { proposal: ProposalDetail; token: { symbol: string; decimals: number | null } }) {
  const swing = swingOf(proposal);
  // Below quorum with a passing split, the verdict already states the exact
  // turnout needed; repeating it here as an estimate would only blur it.
  if (!swing || swing.via === "quorum") return null;
  const share = pct(swing.shareOfStaked);
  const amount =
    token.decimals !== null && Number.isFinite(swing.amount)
      ? `${formatTokenAmount(BigInt(Math.ceil(swing.amount)).toString(), token.decimals, { compact: true })} ${token.symbol}`
      : `${share} of staked`;
  const sentence =
    swing.direction === "to-fail"
      ? `About ${amount} more voting ${swing.via === "veto" ? "No with veto" : "No"} (${share} of staked) would make it fail.`
      : `About ${amount} more voting Yes (${share} of staked) would make it pass.`;
  const context = swing.beyondRemaining
    ? `That is more than the ${pct(swing.notVoted)} of staked that has not voted: only delegators overriding their validator could still change it.`
    : `${pct(swing.notVoted)} of staked has not voted yet.`;
  return (
    <div className="flex items-start gap-3 rounded-[var(--d-radius-inner)] bg-[var(--d-card-2)] px-3.5 py-3 text-[13px] leading-[1.5]">
      <Icon name={swing.direction === "to-fail" ? "trendingDown" : "trendingUp"} size={18} className="mt-px shrink-0 text-fg-dim" />
      <p className="min-w-0 text-fg-muted">
        <span className="mr-1.5 inline-flex items-center gap-1 align-[1px]">
          <span className="font-medium text-fg">What would flip it</span>
          <span className="rounded-[4px] bg-[var(--d-glass-2)] px-1 font-mono text-[10.5px] leading-[16px] text-fg-muted">est.</span>
          <InfoTip
            size={13}
            content="Counts only new votes from stake that has not voted. A delegator who votes against their validator also moves the result, by taking their stake out of the validator's vote."
          />
        </span>
        {sentence} <span className="text-fg-dim">{context}</span>
      </p>
    </div>
  );
}
