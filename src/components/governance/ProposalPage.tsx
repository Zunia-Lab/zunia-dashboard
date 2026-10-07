"use client";

/**
 * /governance/<chainId>/<id> — one proposal, read and decided on one page.
 *
 * Hero (where, what, status, the timeline from submission to result), the
 * live tally with its rules spelled out (quorum, veto, threshold: which pass,
 * which fail, by how much), your vote and the form to cast it, the full text
 * (safe markdown), the facts, how the largest validators voted, and the
 * messages that execute if it passes.
 *
 * `initial` is the server's public read, so the page paints complete on first
 * load; the client read takes over (with the wallet's vote when connected)
 * and refreshes every two minutes while the tab is visible.
 */

import Link from "next/link";
import { useEffect, useId, useMemo, useState, type ReactNode } from "react";
import { Page } from "@/components/shell/Page";
import {
  AddressText,
  Badge,
  Button,
  Callout,
  Card,
  CardHeader,
  ChainLogo,
  chainById,
  EmptyState,
  ExternalLink,
  InlineError,
  isSafeExternalHref,
  KeyValueList,
  PartialDataBadge,
  ProgressBar,
  Skeleton,
  SkeletonText,
  StatusBadge,
  Stepper,
  TokenAmount,
  useIsPhone,
  useNow,
  type KeyValueItem,
  type Step,
  type Tone,
} from "@/components/ui";
import { cn } from "@/lib/cn";
import type { ProposalDetail, ProposalDetailResponse } from "@/lib/chain/types";
import { formatDuration } from "@/lib/format";
import { useProposal } from "@/lib/data/governance";
import { markdownExcerpt } from "@/lib/markdown";
import { useWallet } from "@/providers/WalletProvider";
import { Markdown } from "./Markdown";
import {
  dateText,
  depositState,
  descriptionWithoutTitle,
  meaningfulMetadata,
  proposalTimeline,
  STATUS_LABEL,
  summaryWithoutTitle,
  typeBadge,
  typeLabel,
} from "./model";
import { outcomeOf, pct, tallyShares, withUsableTurnout, type Outcome } from "./rules";
import { ProposalMessages } from "./ProposalMessages";
import { TallyCard } from "./TallyPanel";
import { ValidatorVotes } from "./ValidatorVotes";
import { stakeTokenOf, VoteFlow } from "./VoteFlow";

export interface ProposalPageProps {
  chainId: string;
  id: string;
  /** The server's public read; null when it was not ready in time. */
  initial: ProposalDetailResponse | null;
}

const STATUS_TONE: Record<ProposalDetail["status"], Tone> = {
  voting: "info",
  deposit: "neutral",
  passed: "success",
  rejected: "danger",
  failed: "danger",
  unknown: "neutral",
};

/** Retries after the route's "still loading" 503 (its Retry-After is 5 s). */
const RETRY_MS = 5_000;
const MAX_RETRIES = 6;

export function ProposalPage({ chainId, id, initial }: ProposalPageProps) {
  const { account } = useWallet();
  const state = useProposal(chainId, id);
  const gaveUp = useStillLoadingRetry(state.error?.code === "upstream_timeout" && !state.refreshing, state.refetch);
  const chain = chainById(chainId);
  const chainName = chain?.chainName ?? chainId;
  const data = state.data ?? initial;
  // An ended vote's turnout estimate, checked against when it was read.
  const proposal = useMemo(() => (data ? withUsableTurnout(data.proposal, data.updatedAt) : null), [data]);
  // Connected, but only a public read is on screen (the server's snapshot,
  // or the public answer kept while the wallet's own read loads): the
  // personal part (your power, your vote) is not known and must never read
  // as "not voted".
  const personalMissing = account !== null && (state.data === null || state.stale);
  // That read failed: say so, with Retry. A "still loading" 503 counts as
  // failed only once its retries are spent (until then, the skeleton).
  const personalFailed =
    personalMissing && state.status === "error" && (state.error?.code !== "upstream_timeout" || gaveUp);
  const personalPending = personalMissing && !personalFailed;

  return (
    <Page
      title={`Proposal #${id}`}
      subtitle={chainName}
      breadcrumbs={[{ label: "Governance", href: "/governance" }, { label: `${chainName} #${id}` }]}
      access="public"
    >
      {proposal ? (
        <ProposalBody
          proposal={proposal}
          chainName={chainName}
          errors={data?.errors ?? null}
          updatedAt={state.updatedAt ?? data?.updatedAt ?? null}
          refreshing={state.refreshing}
          personalPending={personalPending}
          personalFailed={personalFailed}
          onRetry={state.refetch}
        />
      ) : state.status === "error" && state.error && (state.error.code !== "upstream_timeout" || gaveUp) ? (
        state.error.code === "proposal_not_found" ? (
          <Card>
            <EmptyState
              icon="governance"
              title={`No proposal #${id} on ${chainName}`}
              body="The chain does not have a proposal with this number."
              action={
                <Button href="/governance" size="sm" iconLeft="arrowLeft">
                  All proposals
                </Button>
              }
            />
          </Card>
        ) : (
          <Card>
            <InlineError
              title="This proposal could not be loaded"
              message={state.error.message}
              onRetry={state.refetch}
              retrying={state.refreshing}
            />
          </Card>
        )
      ) : (
        <ProposalSkeleton />
      )}
    </Page>
  );
}

/**
 * A cold read can outlast the route's budget: it answers 503
 * `upstream_timeout` while the read keeps filling the server cache. Ask
 * again a few times instead of showing an error for something that is
 * about to be there.
 */
function useStillLoadingRetry(active: boolean, refetch: () => void): boolean {
  const [attempts, setAttempts] = useState(0);
  useEffect(() => {
    if (!active || attempts >= MAX_RETRIES) return;
    const timer = window.setTimeout(() => {
      setAttempts((n) => n + 1);
      refetch();
    }, RETRY_MS);
    return () => window.clearTimeout(timer);
  }, [active, attempts, refetch]);
  // True once the retries are spent: the error is shown after all.
  return active && attempts >= MAX_RETRIES;
}

function ProposalBody({
  proposal,
  chainName,
  errors,
  updatedAt,
  refreshing,
  personalPending,
  personalFailed,
  onRetry,
}: {
  proposal: ProposalDetail;
  chainName: string;
  errors: ProposalDetailResponse["errors"] | null;
  updatedAt: number | null;
  refreshing: boolean;
  /** The wallet's own read is on its way: the vote card waits for it. */
  personalPending: boolean;
  /** The wallet's own read failed: the public read stays, with the reason and Retry. */
  personalFailed: boolean;
  onRetry: () => void;
}) {
  const now = useNow();
  const token = stakeTokenOf(proposal.chainId);
  const outcome = outcomeOf(proposal, now);
  const voting = proposal.status === "voting";

  return (
    <>
      <Hero proposal={proposal} chainName={chainName} outcome={outcome} errors={errors} now={now} />

      {/* Two columns from 1280 px. The right one (your vote, then the facts)
          spans the tally and description rows as one block, so each side
          stacks at its own height instead of every row stretching to the
          taller card; the second row is the flexible one, so any slack sits
          under the description, never between tally and description. On
          narrower screens the reading order is the DOM's. */}
      <div className="grid grid-cols-1 gap-[var(--d-gap)] xl:grid-cols-12 xl:grid-rows-[auto_1fr] xl:items-start">
        <div className="min-w-0 xl:col-span-7 2xl:col-span-8">
          {proposal.status === "deposit" ? (
            <DepositCard proposal={proposal} now={now} />
          ) : (
            <TallyCard proposal={proposal} outcome={outcome} token={token} updatedAt={updatedAt} refreshing={refreshing} />
          )}
        </div>
        <div className="flex min-w-0 flex-col gap-[var(--d-gap)] xl:col-span-5 xl:row-span-2 2xl:col-span-4">
          <Card id="vote" as="section" aria-label="Your vote" className="scroll-mt-24" pending={refreshing && !personalPending}>
            <CardHeader title="Your vote" icon="wallet" subtitle={voting ? `Vote with your stake on ${chainName}` : undefined} />
            {personalPending ? (
              <div className="flex flex-col gap-3" aria-busy>
                <Skeleton className="h-[74px] w-full rounded-[12px]" />
                <div className="grid grid-cols-2 gap-2">
                  <Skeleton className="h-[76px] rounded-[12px]" />
                  <Skeleton className="h-[76px] rounded-[12px]" />
                  <Skeleton className="h-[76px] rounded-[12px]" />
                  <Skeleton className="h-[76px] rounded-[12px]" />
                </div>
              </div>
            ) : (
              <>
                {/* Voting does not need this read (the vote is built from the
                    wallet's own address): the options stay open under it. */}
                {personalFailed && voting ? (
                  <InlineError
                    title="Your vote couldn't be read"
                    message="Your voting power and current vote did not load. You can still vote."
                    onRetry={onRetry}
                  />
                ) : null}
                <VoteFlow proposal={proposal} />
              </>
            )}
          </Card>
          <DetailsCard proposal={proposal} chainName={chainName} token={token} now={now} />
        </div>
        <div className="min-w-0 xl:col-span-7 2xl:col-span-8">
          <DescriptionCard proposal={proposal} />
        </div>

        {proposal.validatorVotes && proposal.validatorVotes.length > 0 ? (
          <div className="min-w-0 xl:col-span-12">
            <ValidatorVotes chainId={proposal.chainId} votes={proposal.validatorVotes} pending={refreshing} />
          </div>
        ) : null}

        <div className="min-w-0 xl:col-span-12">
          <ProposalMessages messages={proposal.messages} truncated={proposal.messagesTruncated} />
        </div>
      </div>
    </>
  );
}

/* ------------------------------------------------------------------ hero */

function Hero({
  proposal,
  chainName,
  outcome,
  errors,
  now,
}: {
  proposal: ProposalDetail;
  chainName: string;
  outcome: Outcome;
  errors: ProposalDetailResponse["errors"] | null;
  now: number | null;
}) {
  const titleId = useId();
  const phone = useIsPhone();
  const steps = timelineSteps(proposal, outcome, now);
  // The author's opening sentences (the server's excerpt flattens headings
  // into the prose: "Summary Background On September…").
  const summary = useMemo(
    () => markdownExcerpt(descriptionWithoutTitle(proposal.description, proposal.title)) || summaryWithoutTitle(proposal.summary, proposal.title),
    [proposal.description, proposal.summary, proposal.title],
  );
  return (
    <Card variant="hero" as="section" aria-labelledby={titleId} className="gap-4">
      <div className="relative flex min-w-0 flex-wrap items-center gap-x-2.5 gap-y-2">
        <ChainLogo chainId={proposal.chainId} size={22} />
        <Link href={`/chains/${encodeURIComponent(proposal.chainId)}`} className="text-[13.5px] font-medium text-fg-muted transition-colors duration-[160ms] hover:text-fg">
          {chainName}
        </Link>
        <span className="font-mono text-[12.5px] text-fg-dim">#{proposal.id}</span>
        <Badge>{typeBadge(proposal)}</Badge>
        {proposal.expedited ? (
          <Badge tone="accent" icon="sparkle">
            Expedited
          </Badge>
        ) : null}
        <span className="ml-auto flex items-center gap-2">
          <PartialDataBadge errors={errors} />
          <StatusBadge tone={STATUS_TONE[proposal.status]} pulse={proposal.status === "voting"} size="md">
            {proposal.status === "voting" && outcome.kind === "ended-pending" ? "Tallying" : STATUS_LABEL[proposal.status]}
          </StatusBadge>
        </span>
      </div>

      <div className="relative flex min-w-0 flex-col gap-2">
        <h2 id={titleId} className="max-w-[60ch] text-balance text-[22px] font-semibold leading-[1.2] tracking-[-0.025em] text-fg sm:text-[26px]">
          {proposal.title}
        </h2>
        {summary ? <p className="line-clamp-3 max-w-[96ch] text-[14px] leading-relaxed text-fg-muted">{summary}</p> : null}
      </div>

      <div className="relative -mx-[var(--d-pad)] border-t border-[var(--d-hairline)] px-[var(--d-pad)] pt-4">
        <Stepper steps={steps} orientation={phone ? "vertical" : "horizontal"} />
      </div>
    </Card>
  );
}

function timelineSteps(proposal: ProposalDetail, outcome: Outcome, now: number | null): Step[] {
  const datetime = (at: number | null) => (at === null ? "—" : dateText(at, "datetime", now));
  const until = (at: number | null) => (at !== null && now !== null && at > now ? `in ${formatDuration((at - now) / 1000)}` : null);
  return proposalTimeline(proposal).map((step) => {
    let description: ReactNode = null;
    switch (step.key) {
      case "submitted":
        description = datetime(step.at);
        break;
      case "deposit":
        description =
          step.state === "current"
            ? [step.at !== null ? `Ends ${dateText(step.at, "short", now)}` : null, until(step.at)].filter(Boolean).join(" · ")
            : step.note ?? (step.at !== null ? datetime(step.at) : "—");
        break;
      case "voting-start":
        description = step.at !== null ? datetime(step.at) : step.note;
        break;
      case "voting-end": {
        const left = step.state === "current" ? until(step.at) : null;
        description = (
          <>
            {datetime(step.at)}
            {left ? <span className="block font-medium text-[var(--z-warning)]">{left}</span> : null}
          </>
        );
        break;
      }
      case "result":
        description =
          step.state === "todo"
            ? proposal.status === "voting"
              ? outcome.kind === "passing"
                ? "Passing as of now"
                : outcome.kind === "failing"
                  ? "Failing as of now"
                  : "Pending"
              : "—"
            : step.at !== null
              ? dateText(step.at, "short", now)
              : null;
        break;
    }
    return { label: step.label, state: step.state, description };
  });
}

/* ------------------------------------------------------------------ deposit */

function DepositCard({ proposal, now }: { proposal: ProposalDetail; now: number | null }) {
  const deposit = depositState({ totalDeposit: proposal.deposit.total, minDeposit: proposal.deposit.min });
  const chain = chainById(proposal.chainId);
  const native = Boolean(chain && deposit.denom === chain.coinMinimalDenom);
  const decimals = native && chain ? chain.coinDecimals : null;
  const symbol = native && chain ? chain.coinDenom : undefined;
  const ratio = deposit.ratio;
  const end = proposal.depositEndTime ? Date.parse(proposal.depositEndTime) : null;
  const left = end !== null && now !== null && end > now ? formatDuration((end - now) / 1000) : null;
  return (
    <Card as="section" aria-label="Deposit">
      <CardHeader title="Deposit" subtitle="Voting opens when deposits reach the minimum" icon="hourglass" />
      <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
        <span className="text-[24px] font-semibold tracking-[-0.03em] text-fg">
          <TokenAmount amount={deposit.total} decimals={decimals} symbol={symbol} compact masked={false} />
        </span>
        <span className="text-[13.5px] text-fg-dim">
          of <TokenAmount amount={deposit.min} decimals={decimals} symbol={symbol} compact masked={false} /> minimum
        </span>
        {ratio !== null ? <span className="ml-auto text-[14px] font-medium tabular-nums text-fg">{pct(Math.min(ratio, 1), 0)}</span> : null}
      </div>
      <ProgressBar value={ratio !== null ? Math.min(1, ratio) * 100 : 0} size="md" tone="neutral" label="Deposit raised of the minimum" />
      <KeyValueList
        items={[
          { key: "end", label: "Deposit period ends", value: end !== null ? dateText(end, "datetime", now) : "—", sub: left ? `in ${left}` : undefined },
          {
            key: "missing",
            label: "Still needed",
            value: deposit.missing !== null ? <TokenAmount amount={deposit.missing} decimals={decimals} symbol={symbol} compact masked={false} /> : "—",
          },
        ]}
      />
      <p className="text-[12px] leading-[1.55] text-fg-dim">
        If the minimum is not reached in time, the proposal is dropped; depending on the chain&apos;s settings its deposits can be burned. Depositing from Zunia is not available yet.
      </p>
    </Card>
  );
}

/* ------------------------------------------------------------------ text */

/** `isSafeExternalHref` as a plain boolean: its type guard narrows a non-link string to `never`. */
const isExternalLink = (value: string): boolean => isSafeExternalHref(value);

/** Long texts open folded at about two screens, with the rest a click away. */
const FOLD_CHARS = 1_600;

/** Veto share at which voters are clearly flagging a proposal as spam or harmful. */
const FLAGGED_VETO = 0.25;

function DescriptionCard({ proposal }: { proposal: ProposalDetail }) {
  const [open, setOpen] = useState(false);
  // The header above already shows the title: an opening "# <title>" goes.
  const text = useMemo(() => descriptionWithoutTitle(proposal.description, proposal.title).trim(), [proposal.description, proposal.title]);
  const long = text.length > FOLD_CHARS;
  const bodyId = useId();
  const metadataText = meaningfulMetadata(proposal.metadata);
  const metadataLink = isExternalLink(metadataText) ? metadataText : null;
  const veto = tallyShares(proposal.tally)?.veto ?? 0;
  const unvetted = proposal.status === "deposit" && (proposal.deposit.progress ?? 0) < 0.1;
  return (
    <Card as="section" aria-label="Description">
      <CardHeader
        title="Description"
        icon="list"
        // The proposer's link, as unvetted as the text under it: `ugc`, like
        // the description's own links (see Markdown).
        actions={
          metadataLink ? (
            <ExternalLink href={metadataLink} ugc className="text-[12.5px]">
              Metadata
            </ExternalLink>
          ) : null
        }
      />
      {veto >= FLAGGED_VETO ? (
        <Callout tone="danger" icon="shield" title="Voters flag this proposal as spam or harmful">
          No with veto is {pct(veto)} of the votes. Proposals like this often advertise fake airdrops: do not follow their links or
          connect your wallet to sites they mention.
        </Callout>
      ) : unvetted ? (
        <Callout tone="warning" icon="shield" title="Unvetted proposal">
          It has collected little deposit so far, and nobody has reviewed it. Do not follow its links to claim anything.
        </Callout>
      ) : null}
      {text ? (
        <div className="relative">
          <div id={bodyId} className={cn(long && !open && "max-h-[560px] overflow-hidden")}>
            <Markdown source={text} baseLevel={3} />
          </div>
          {long && !open ? (
            <div aria-hidden className="pointer-events-none absolute inset-x-0 bottom-0 h-28 bg-gradient-to-b from-transparent to-[var(--d-card)]" />
          ) : null}
        </div>
      ) : (
        <p className="text-[13px] text-fg-dim">This proposal has no description on chain.</p>
      )}
      {long ? (
        <Button
          size="sm"
          variant="secondary"
          className="self-start"
          aria-expanded={open}
          aria-controls={bodyId}
          iconRight={open ? "chevronUp" : "chevronDown"}
          onClick={() => setOpen((value) => !value)}
        >
          {open ? "Show less" : "Show the full description"}
        </Button>
      ) : null}
    </Card>
  );
}

function DetailsCard({
  proposal,
  chainName,
  token,
  now,
}: {
  proposal: ProposalDetail;
  chainName: string;
  token: { symbol: string; decimals: number | null };
  now: number | null;
}) {
  const date = (iso: string | null) => {
    const at = iso ? Date.parse(iso) : Number.NaN;
    return Number.isFinite(at) && at > 0 ? dateText(at, "datetime", now) : "—";
  };
  const deposit = depositState({ totalDeposit: proposal.deposit.total, minDeposit: proposal.deposit.min });
  const chain = chainById(proposal.chainId);
  const native = Boolean(chain && deposit.denom === chain.coinMinimalDenom);
  // The wrapper of a legacy proposal says nothing; its content's type does.
  const types = [...new Set(proposal.messageTypes.filter((type) => type !== "MsgExecLegacyContent"))];
  const typeText = types.length ? types.map(typeLabel).join(", ") : typeLabel(proposal.type);
  const votingEnd = proposal.votingEndTime ? Date.parse(proposal.votingEndTime) : null;
  const rawMetadata = meaningfulMetadata(proposal.metadata);
  // Plain-text metadata only (a link is shown in the description's header),
  // and not a placeholder such as "Not Used".
  const metadata = isExternalLink(rawMetadata) ? "" : rawMetadata;
  const voting: KeyValueItem[] =
    proposal.status === "deposit"
      ? [{ key: "voting", label: "Voting", value: <span className="text-fg-dim">Opens when the deposit is met</span> }]
      : [
          { key: "voting-start", label: "Voting opened", value: date(proposal.votingStartTime) },
          {
            key: "voting-end",
            label: proposal.status === "voting" ? "Voting closes" : "Voting closed",
            value: date(proposal.votingEndTime),
            sub:
              proposal.status === "voting" && votingEnd !== null && now !== null && votingEnd > now
                ? `in ${formatDuration((votingEnd - now) / 1000)}`
                : undefined,
          },
        ];
  return (
    <Card as="section" aria-label="Details">
      <CardHeader title="Details" icon="info" />
      <KeyValueList
        divided
        items={[
          {
            key: "network",
            label: "Network",
            value: (
              <span className="inline-flex items-center gap-1.5">
                <ChainLogo chainId={proposal.chainId} size={16} />
                {chainName}
              </span>
            ),
          },
          { key: "type", label: types.length > 1 ? "Types" : "Type", value: typeText },
          { key: "submitted", label: "Submitted", value: date(proposal.submitTime) },
          ...voting,
          {
            key: "deposit",
            label: "Deposit",
            value:
              deposit.total !== null ? (
                <TokenAmount amount={deposit.total} decimals={native && chain ? chain.coinDecimals : null} symbol={native ? token.symbol : undefined} compact masked={false} />
              ) : (
                "—"
              ),
            // Only while collecting: past that stage the deposit was enough
            // by definition, and today's minimum may differ from the one
            // that applied (params change; expedited minimums are higher).
            sub: proposal.status === "deposit" && deposit.ratio !== null ? `${pct(Math.min(deposit.ratio, 9.99), 0)} of the minimum` : undefined,
          },
          {
            key: "proposer",
            label: "Proposer",
            value: proposal.proposer ? <AddressText address={proposal.proposer} /> : <span className="text-fg-dim">Not recorded</span>,
          },
          ...(metadata
            ? [
                {
                  key: "metadata",
                  label: "Metadata",
                  value: (
                    <span className="line-clamp-2 break-all font-mono text-[12px] text-fg-muted" title={metadata.slice(0, 500)}>
                      {metadata.slice(0, 120)}
                    </span>
                  ),
                },
              ]
            : []),
          { key: "api", label: "Gov module", value: <span className="font-mono text-[12.5px]">{proposal.api}</span> },
        ]}
      />
    </Card>
  );
}

/* ------------------------------------------------------------------ loading */

function ProposalSkeleton() {
  return (
    <div className="flex flex-col gap-[var(--d-gap)]" aria-busy aria-label="Loading proposal">
      <div className="d-card flex flex-col gap-4 p-[var(--d-pad)]">
        <div className="flex items-center gap-2">
          <Skeleton circle width={22} />
          <Skeleton className="h-3.5 w-24" />
          <Skeleton className="h-5 w-32 rounded-[6px]" />
          <Skeleton className="ml-auto h-6 w-20 rounded-full" />
        </div>
        <Skeleton className="h-7 w-[70%]" />
        <SkeletonText lines={2} />
        <div className="flex gap-6 border-t border-[var(--d-hairline)] pt-4">
          {Array.from({ length: 5 }, (_, i) => (
            <div key={i} className="flex flex-1 flex-col gap-2">
              <Skeleton circle width={22} />
              <Skeleton className="h-3 w-[70%]" />
            </div>
          ))}
        </div>
      </div>
      <div className="grid grid-cols-1 gap-[var(--d-gap)] xl:grid-cols-12">
        <div className="d-card flex flex-col gap-3 p-[var(--d-pad)] xl:col-span-7 2xl:col-span-8">
          <Skeleton className="h-4 w-28" />
          <Skeleton className="h-16 w-full rounded-[12px]" />
          <Skeleton className="h-3.5 w-full rounded-[4px]" />
          <SkeletonText lines={4} />
        </div>
        <div className="d-card flex flex-col gap-3 p-[var(--d-pad)] xl:col-span-5 2xl:col-span-4">
          <Skeleton className="h-4 w-24" />
          <Skeleton className="h-[74px] w-full rounded-[12px]" />
          <div className="grid grid-cols-2 gap-2">
            <Skeleton className="h-[76px] rounded-[12px]" />
            <Skeleton className="h-[76px] rounded-[12px]" />
          </div>
        </div>
      </div>
    </div>
  );
}
