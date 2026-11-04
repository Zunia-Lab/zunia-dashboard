"use client";

/**
 * One section of the Insights page ("Do now", "Opportunities", "Risks") as a
 * card holding a list, and the row each insight becomes in it.
 *
 * A row reads the way a decision does: how serious and what about (severity
 * in words and colour, the kind, the chain), the fact and its numbers, then
 * the headline figure and the one action. The "why" stays folded: it is how
 * the figure was measured, there for the reader who wants to check it, and
 * it comes after the action so it never pushes the button down on a phone.
 *
 * Rows lay themselves out on the list's own width (a container query): the
 * figure and the action sit in a column on the right when there is room, and
 * under the text otherwise; the kind's icon tile only shows where it does
 * not cost the text a sixth of a phone's width.
 */

import { useState } from "react";
import { Icon } from "@/components/icons";
import type { IconName } from "@/components/icons";
import { INSIGHT_ICON, SEVERITY_ICON, SEVERITY_TONE } from "@/components/overview/InsightCard";
import { Badge, Button, Card, CardBody, CardHeader, ChainLogo, Disclosure, EmptyState, IconButton, Skeleton, TONE_SOFT } from "@/components/ui";
import { findChain } from "@/lib/chains";
import { cn } from "@/lib/cn";
import { INSIGHT_KIND_LABEL, SEVERITY_LABEL, type Insight, type InsightGroup } from "@/lib/insights/rules";
import { GROUP_ANCHOR, GROUP_LABEL } from "./model";

const GROUP_COPY: Readonly<Record<InsightGroup, { subtitle: string; icon: IconName; emptyTitle: string; emptyBody: string }>> = {
  "do-now": {
    subtitle: "Rewards worth claiming, votes closing, unlocks due, and anything critical",
    icon: "clock",
    emptyTitle: "Nothing to do right now",
    emptyBody: "No rewards past the claim fee, no votes waiting on you and nothing unlocking this week.",
  },
  opportunities: {
    subtitle: "Measured gains you can act on",
    icon: "trendingUp",
    emptyTitle: "No idle balance worth staking",
    emptyBody: "Balances that could earn their chain's staking APR show up here, with the yield they would make.",
  },
  risks: {
    subtitle: "Validators, chains, concentration, pricing and grants worth a look",
    icon: "shield",
    emptyTitle: "No risks found",
    emptyBody: "Your validators are active and signing, no grant can move your funds, and no chain you hold value on has stalled.",
  },
};

export interface InsightGroupCardProps {
  group: InsightGroup;
  items: readonly Insight[];
  /** First read with nothing to show yet. */
  loading: boolean;
  /** The list belongs to the previous scope while the new one loads: dimmed. */
  pending: boolean;
  /** A read is in flight behind the current list. */
  refreshing: boolean;
  /** Some reads failed: an empty list is "nothing in what loaded", not "nothing". */
  partial: boolean;
  /**
   * Rows shown before "Show N more". The list is most severe first, so what
   * folds away is the context, never a warning above it.
   */
  limit?: number;
  /** Found in this section but hidden by the reader. */
  hidden?: number;
  /** Hides an insight: its close button, and opening its action. */
  onDismiss?: (insight: Insight) => void;
  className?: string;
}

export function InsightGroupCard({ group, items, loading, pending, refreshing, partial, limit, hidden: cleared = 0, onDismiss, className }: InsightGroupCardProps) {
  const copy = GROUP_COPY[group];
  const titleId = `insights-${GROUP_ANCHOR[group]}-title`;
  const [expanded, setExpanded] = useState(false);
  const cut = limit !== undefined && !expanded && items.length > limit + 1 ? limit : items.length;
  const hidden = items.length - cut;
  return (
    <Card
      as="section"
      id={GROUP_ANCHOR[group]}
      aria-labelledby={titleId}
      pending={pending}
      className={cn("scroll-mt-[calc(var(--d-sticky-top)+16px)]", className)}
    >
      <CardHeader
        id={titleId}
        icon={copy.icon}
        title={
          <span className="inline-flex items-center gap-2">
            {GROUP_LABEL[group]}
            {items.length > 0 ? (
              <Badge size="sm" tone={group === "do-now" ? "accent" : "neutral"} className="tabular-nums">
                {items.length}
              </Badge>
            ) : null}
          </span>
        }
        subtitle={copy.subtitle}
        refreshing={refreshing && !pending}
      />
      <CardBody flush>
        {loading && items.length === 0 ? (
          <RowSkeletons count={group === "do-now" ? 3 : 2} />
        ) : items.length === 0 && cleared > 0 ? (
          <div className="border-t border-[var(--d-hairline)] px-[var(--d-pad)]">
            <EmptyState
              inline
              icon="success"
              title="All cleared"
              body={`${cleared} hidden here until ${cleared === 1 ? "it becomes" : "they become"} more urgent, or for a week if ${cleared === 1 ? "it still holds" : "they still hold"}.`}
            />
          </div>
        ) : items.length === 0 ? (
          <div className="border-t border-[var(--d-hairline)] px-[var(--d-pad)]">
            <EmptyState
              inline
              icon={partial ? "info" : "success"}
              title={partial ? "Nothing found in what loaded" : copy.emptyTitle}
              body={partial ? "Some reads failed, so this list may be missing items. The badge at the top says which." : copy.emptyBody}
            />
          </div>
        ) : (
          <>
            <ul className="@container divide-y divide-[var(--d-hairline)] border-t border-[var(--d-hairline)]">
              {items.slice(0, cut).map((insight) => (
                <InsightRow key={insight.id} insight={insight} onDismiss={onDismiss ? () => onDismiss(insight) : undefined} />
              ))}
            </ul>
            {hidden > 0 || expanded ? (
              <div className="border-t border-[var(--d-hairline)] px-[var(--d-pad)] py-2">
                <Button
                  size="sm"
                  variant="ghost"
                  iconRight={expanded ? "chevronUp" : "chevronDown"}
                  onClick={() => setExpanded((value) => !value)}
                  aria-expanded={expanded}
                  className="-ml-2"
                >
                  {expanded ? "Show fewer" : `Show ${hidden} more`}
                </Button>
              </div>
            ) : null}
          </>
        )}
      </CardBody>
    </Card>
  );
}

function InsightRow({ insight, onDismiss }: { insight: Insight; onDismiss?: () => void }) {
  const tone = SEVERITY_TONE[insight.severity];
  const chainName = insight.chainId ? (findChain(insight.chainId)?.chainName ?? insight.chainId) : null;
  const titleId = `insight-${insight.id.replace(/[^a-zA-Z0-9_-]/g, "-")}`;
  const aside = Boolean(insight.metric || insight.action);
  const why = Boolean(insight.why);
  return (
    <li>
      <article aria-labelledby={titleId} className="flex gap-3.5 px-[var(--d-pad)] py-4">
        <span
          aria-hidden
          className={cn(
            "mt-px hidden size-9 shrink-0 items-center justify-center rounded-[10px] @min-[480px]:flex",
            TONE_SOFT[tone],
            tone === "neutral" && "text-fg-muted",
          )}
        >
          <Icon name={INSIGHT_ICON[insight.kind]} size={17} />
        </span>
        <div
          className={cn(
            "grid min-w-0 flex-1 grid-cols-1 gap-y-3",
            aside && "@min-[560px]:grid-cols-[minmax(0,1fr)_168px] @min-[560px]:gap-x-6",
            aside && why && "@min-[560px]:gap-y-2.5",
          )}
        >
          <div className="min-w-0 @min-[560px]:col-start-1 @min-[560px]:row-start-1">
            <p className="flex min-h-5 flex-wrap items-center gap-x-2 gap-y-1 text-[12.5px] text-fg-dim">
              <Badge tone={tone} size="sm" icon={SEVERITY_ICON[insight.severity]}>
                {SEVERITY_LABEL[insight.severity]}
              </Badge>
              <span>{INSIGHT_KIND_LABEL[insight.kind]}</span>
              {insight.chainId && chainName ? (
                <span className="inline-flex min-w-0 items-center gap-1.5">
                  <span aria-hidden className="text-fg-faint">
                    ·
                  </span>
                  <ChainLogo chainId={insight.chainId} size={14} />
                  <span className="truncate">{chainName}</span>
                </span>
              ) : null}
              {onDismiss ? <IconButton label="Hide this insight" icon="close" size="sm" variant="ghost" className="-my-1 ml-auto" onClick={onDismiss} /> : null}
            </p>
            <h3 id={titleId} className="mt-2 text-[15px] font-medium leading-snug tracking-[-0.012em] text-fg">
              {insight.title}
            </h3>
            <p className="mt-1 max-w-[76ch] text-[13.5px] leading-[1.55] text-fg-muted">{insight.body}</p>
          </div>
          {aside ? (
            <div
              className={cn(
                "flex items-end justify-between gap-3",
                "@min-[560px]:col-start-2 @min-[560px]:row-start-1 @min-[560px]:flex-col @min-[560px]:items-end @min-[560px]:justify-start",
                why && "@min-[560px]:row-span-2",
              )}
            >
              {insight.metric ? (
                <div className="min-w-0 @min-[560px]:text-right">
                  <div className="truncate text-[11.5px] text-fg-dim">{insight.metric.label}</div>
                  <div className="truncate text-[18px] font-semibold leading-tight tabular-nums tracking-[-0.02em] text-fg" title={insight.metric.value}>
                    {insight.metric.value}
                  </div>
                </div>
              ) : (
                <span />
              )}
              {insight.action ? (
                <Button
                  size="sm"
                  variant={insight.severity === "critical" ? "primary" : "secondary"}
                  href={insight.action.href}
                  iconRight="arrowRight"
                  className="shrink-0"
                  onClick={onDismiss}
                >
                  {insight.action.label}
                </Button>
              ) : null}
            </div>
          ) : null}
          {insight.why ? (
            <Disclosure summary="Why this shows" className="min-w-0 @min-[560px]:col-start-1 @min-[560px]:row-start-2">
              <p className="max-w-[76ch] text-[12.5px] leading-[1.55] text-fg-dim">{insight.why}</p>
            </Disclosure>
          ) : null}
        </div>
      </article>
    </li>
  );
}

function RowSkeletons({ count }: { count: number }) {
  return (
    <ul aria-hidden className="@container divide-y divide-[var(--d-hairline)] border-t border-[var(--d-hairline)]">
      {Array.from({ length: count }, (_, i) => (
        <li key={i} className="flex gap-3.5 px-[var(--d-pad)] py-4">
          <Skeleton className="hidden size-9 shrink-0 rounded-[10px] @min-[480px]:block" />
          <div className="flex min-w-0 flex-1 flex-col gap-2">
            <div className="flex items-center gap-2">
              <Skeleton className="h-5 w-[78px] rounded-[6px]" />
              <Skeleton className="h-3 w-16" />
            </div>
            <Skeleton className="h-4 w-[62%]" />
            <Skeleton className="h-3 w-[88%]" />
            <Skeleton className="h-3 w-[46%]" />
          </div>
          <div className="hidden w-[120px] shrink-0 flex-col items-end gap-2 @min-[560px]:flex">
            <Skeleton className="h-3 w-14" />
            <Skeleton className="h-5 w-20" />
            <Skeleton className="mt-1 h-8 w-24 rounded-[10px]" />
          </div>
        </li>
      ))}
    </ul>
  );
}
