"use client";

/**
 * The planned IBC route, hop by hop: which chain the packet leaves, over
 * which channel, to which chain, and how much the dashboard knows about each
 * channel (verified open on both ends, a registry default nobody checked, a
 * channel typed by hand). Plus the engine's time estimate and, when the token
 * has to go home first, why.
 *
 * Everything here is the planner's answer (`/api/interchain/plan`), shown as
 * it is; nothing is inferred in the browser except the wording.
 */

import { Icon } from "@/components/icons";
import { Badge, Button, ChainLogo, InlineError, RelativeTime, Skeleton, type Tone } from "@/components/ui";
import { cn } from "@/lib/cn";
import { formatDuration } from "@/lib/format";
import type { AsyncStatus } from "@/lib/interchain/hooks";
import type { ChannelLinkWire, InterchainFailure, PlanCandidateWire, PlanResponseBody, RouteHopWire } from "@/lib/interchain/wire";
import type { HistoryChannel, RouteTiming } from "./logic";
import { chainName as nameOfChain } from "./names";

export interface ChannelVerdict {
  label: string;
  tone: Tone;
  detail: string;
}

/** What the planner knows about one channel, in words. */
export function channelVerdict(link: ChannelLinkWire | undefined): ChannelVerdict {
  if (!link) return { label: "Not checked", tone: "neutral", detail: "No channel record came with this hop." };
  if (link.state === "closed") return { label: "Closed", tone: "danger", detail: "This channel is closed: a packet sent on it would never arrive." };
  if (link.source === "manual") {
    // Not "you entered": the planner also reuses a channel typed in an earlier
    // session. What is certain is that nobody discovered it on chain.
    return {
      label: "Entered by hand",
      tone: "warning",
      detail: "Typed in by hand, not discovered on chain, and not verified: it is used as given. Check the channel before you send.",
    };
  }
  if (link.source === "verified" && link.state === "open") {
    return { label: "Verified · open", tone: "success", detail: "Read from both chains just now: the channel is open and connects these two networks." };
  }
  if (link.source === "seed") {
    return {
      label: "Registry default",
      tone: "warning",
      detail: "The channel the chain registry lists for this pair. It could not be checked on chain just now.",
    };
  }
  return { label: link.state === "open" ? "Open" : "Unconfirmed", tone: "neutral", detail: "The channel's state could not be confirmed." };
}

const chainName = (chainId: string | null | undefined) => nameOfChain(chainId, "Unknown chain");

/** Links matched to hops by the chain they leave and the channel (consumed as matched). */
function linksForHops(hops: readonly RouteHopWire[], links: readonly ChannelLinkWire[]): (ChannelLinkWire | undefined)[] {
  const pool = [...links];
  return hops.map((hop) => {
    const at = pool.findIndex((link) => link.sourceChainId === hop.chainId && link.channelId === hop.channelId);
    return at >= 0 ? pool.splice(at, 1)[0] : undefined;
  });
}

export interface RouteViewProps {
  status: AsyncStatus;
  data: PlanResponseBody | null;
  candidate: PlanCandidateWire | null;
  error: InterchainFailure | null;
  onRetry: () => void;
  /** Shown while there is nothing to plan yet. */
  idleText?: string;
  /** How long the user's own transfers on this route took (measured, from their history). */
  observed?: RouteTiming | null;
  className?: string;
}

export function RouteView({ status, data, candidate, error, onRetry, idleText, observed, className }: RouteViewProps) {
  if (status === "idle") {
    return (
      <div className={cn("flex items-center gap-2.5 rounded-[var(--d-radius-inner)] border border-dashed border-[var(--d-hairline-strong)] px-3.5 py-3 text-[13px] text-fg-dim", className)}>
        <Icon name="route" size={16} className="shrink-0" />
        {idleText ?? "Pick a token, an amount and a recipient to plan the route."}
      </div>
    );
  }
  if (status === "loading") {
    return (
      <div className={cn("flex flex-col gap-3 rounded-[var(--d-radius-inner)] bg-[var(--d-card-2)] px-3.5 py-3", className)} aria-busy="true">
        <span className="sr-only">Planning the route</span>
        <div className="flex items-center gap-2 text-[12.5px] text-fg-dim">
          <span className="d-spinner" style={{ width: 12, height: 12, borderWidth: 1.5 }} aria-hidden />
          Checking channels on both chains…
        </div>
        <div className="flex items-center gap-3">
          <Skeleton circle width={24} />
          <Skeleton className="h-2.5" width="40%" />
        </div>
        <div className="flex items-center gap-3">
          <Skeleton circle width={24} />
          <Skeleton className="h-2.5" width="32%" />
        </div>
      </div>
    );
  }
  if (status === "error") {
    return (
      <InlineError
        title="The route could not be planned"
        message={error?.message ?? "The planner did not answer."}
        onRetry={onRetry}
        className={className}
      />
    );
  }
  if (!candidate) {
    const reason =
      data?.warnings[0] ??
      (data?.discoveryFailures[0]
        ? `Channel discovery failed: ${data.discoveryFailures[0].message}`
        : "No open channel path between these networks was found.");
    return (
      <div className={cn("flex items-start gap-2.5 rounded-[var(--d-radius-inner)] border border-[var(--z-warning-line)] bg-[var(--z-warning-fill)] px-3.5 py-3", className)}>
        <Icon name="warning" size={17} className="mt-px shrink-0 text-[var(--z-warning)]" />
        <div className="min-w-0 text-[13px] leading-[1.5]">
          <p className="font-medium text-fg">No route found</p>
          <p className="text-fg-muted">{/[.!?]$/.test(reason.trim()) ? reason.trim() : `${reason.trim()}.`} You can set the channel by hand below if you know it.</p>
        </div>
      </div>
    );
  }

  const plan = candidate.plan;
  const hops = plan.hops.filter((hop) => hop.channelId.length > 0);
  const links = linksForHops(hops, candidate.links);
  const verdicts = links.map((link) => channelVerdict(link));
  const worst: Tone = verdicts.some((v) => v.tone === "danger")
    ? "danger"
    : verdicts.some((v) => v.tone === "warning")
      ? "warning"
      : "success";
  const strategy = data?.denomStrategy;
  const nodes = [plan.sourceChainId, ...hops.map((hop) => hop.counterpartyChainId ?? plan.destChainId)];

  return (
    <div className={cn("flex flex-col gap-3 rounded-[var(--d-radius-inner)] bg-[var(--d-card-2)] px-3.5 py-3", className)}>
      <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1">
        <span className="flex items-center gap-1.5 text-[12.5px] font-medium text-fg-muted">
          <Icon name="route" size={15} className="text-fg-dim" />
          {hops.length === 1 ? "Direct · 1 hop" : `${hops.length} hops${plan.requiresPfm ? " · forwarded" : ""}`}
        </span>
        <span className="flex items-center gap-2 text-[12px] text-fg-dim">
          {observed ? (
            <span
              title={`Measured on your own transfers on this route: fastest ${formatDuration(observed.fastest)}, slowest ${formatDuration(observed.slowest)}.`}
            >
              <Icon name="clock" size={13} className="mr-1 inline-block align-[-2px]" />
              <span className="text-fg-muted">{formatDuration(observed.median)}</span> typical · your last {observed.count}
            </span>
          ) : (
            <span title="The engine's estimate per hop, not a measurement of this route">
              <Icon name="clock" size={13} className="mr-1 inline-block align-[-2px]" />~{formatDuration(Math.max(plan.estimatedDurationSeconds, 30))}
              <span className="ml-1 rounded-[4px] bg-[var(--d-glass-2)] px-1 font-mono text-[10.5px] text-fg-muted">est.</span>
            </span>
          )}
          <Badge tone={worst} size="sm" dot>
            {worst === "success" ? "Channels verified" : worst === "danger" ? "Closed channel" : "Not fully verified"}
          </Badge>
        </span>
      </div>

      <ol className="flex flex-col" aria-label="Route">
        {nodes.map((chainId, index) => {
          const hop = hops[index];
          const verdict = verdicts[index];
          const link = links[index];
          const last = index === nodes.length - 1;
          return (
            <li key={`${chainId}-${index}`} className="relative flex gap-3">
              <div className="flex flex-col items-center">
                <ChainLogo chainId={chainId} size={24} />
                {!last ? <span aria-hidden className="my-1 w-px flex-1 bg-[linear-gradient(var(--d-hairline-strong),var(--d-hairline-strong))]" /> : null}
              </div>
              <div className={cn("min-w-0 flex-1", !last && "pb-3")}>
                <p className="flex min-h-[24px] flex-wrap items-center gap-x-2 text-[13.5px] font-medium text-fg">
                  {chainName(chainId)}
                  <span className="font-mono text-[11px] font-normal text-fg-dim">
                    {index === 0 ? "sends" : last ? "receives" : "forwards"}
                  </span>
                </p>
                {hop && verdict ? (
                  <div className="mt-1 flex flex-wrap items-center gap-1.5 text-[12px] text-fg-dim">
                    <span className="rounded-[6px] border border-[var(--d-hairline-strong)] px-1.5 py-[1px] font-mono text-[11px] text-fg-muted">
                      {hop.port}/{hop.channelId}
                    </span>
                    {link?.counterpartyChannelId ? (
                      <>
                        <Icon name="arrowRight" size={11} />
                        <span className="rounded-[6px] border border-[var(--d-hairline-strong)] px-1.5 py-[1px] font-mono text-[11px] text-fg-muted">
                          {link.counterpartyChannelId}
                        </span>
                      </>
                    ) : null}
                    <Badge tone={verdict.tone} size="sm" title={verdict.detail}>
                      {verdict.label}
                    </Badge>
                  </div>
                ) : null}
              </div>
            </li>
          );
        })}
      </ol>

      {/* The engine's reasons can name a raw voucher denom (`ibc/27394FB0…`,
          68 characters with no break opportunity); without `min-w-0` and
          anywhere-wrapping it pushed past the card on phones and was cut off. */}
      {strategy && strategy.strategy !== "direct" && strategy.reason ? (
        <p className="flex gap-2 text-[12.5px] leading-snug text-fg-muted">
          <Icon name="info" size={14} className="mt-px shrink-0 text-fg-dim" />
          <span className="min-w-0 [overflow-wrap:anywhere]">{strategy.reason}</span>
        </p>
      ) : null}
      {plan.warnings.length > 0 ? (
        <ul className="flex flex-col gap-1">
          {plan.warnings.map((warning) => (
            <li key={warning} className="flex gap-2 text-[12.5px] leading-snug text-[var(--z-warning)]">
              <Icon name="warning" size={14} className="mt-px shrink-0" />
              <span className="min-w-0 [overflow-wrap:anywhere]">{warning}</span>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}

/**
 * When discovery finds no channel but the user's own history shows one
 * (their transfers between the two chains used it), offer it in one click.
 * It goes in as a channel set by hand: checked on both chains as it is
 * entered, and marked as such in the route.
 */
export function HistoryChannelHint({
  hint,
  fromChainId,
  toChainId,
  onUse,
}: {
  hint: HistoryChannel;
  fromChainId: string;
  toChainId: string;
  onUse: () => void;
}) {
  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-2 rounded-[var(--d-radius-inner)] border border-[var(--d-hairline-strong)] px-3.5 py-3">
      <Icon name="route" size={16} className="shrink-0 text-fg-dim" />
      <p className="min-w-0 flex-[1_1_16rem] text-[13px] leading-snug text-fg-muted">
        Your own transfers between {chainName(fromChainId)} and {chainName(toChainId)} used{" "}
        <span className="font-mono text-[12px] text-fg">{hint.channelId}</span> on {chainName(fromChainId)} ({hint.uses}×, last{" "}
        <RelativeTime at={hint.lastAt} />
        ).
      </p>
      <Button size="sm" variant="secondary" onClick={onUse}>
        Use {hint.channelId}
      </Button>
    </div>
  );
}
