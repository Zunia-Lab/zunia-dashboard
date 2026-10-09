"use client";

/**
 * The top of the Insights page: one sentence that says what matters most
 * ("3 things to do now"), shortcuts to those actions, and under it the same
 * list cut by severity, with what each count is made of ("2 validators ·
 * 1 vote") and their mix as one bar.
 *
 * Two cuts of one list sit together here, so each is named: the sentence
 * counts the page's sections (do now, opportunities, risks), the strip counts
 * severities ("By severity"). A compounding reminder is an opportunity by
 * severity and a "do now" by section; without the label the two "4"s and
 * "3"s would read as numbers that do not add up.
 *
 * Severity colours are status colours (red, amber, green, grey: bad, watch,
 * good, context), each with its icon and its word, so the colour is never the
 * only carrier.
 */

import { useId } from "react";
import { Icon } from "@/components/icons";
import { INSIGHT_ICON, SEVERITY_ICON } from "@/components/overview/InsightCard";
import { Button, Card, InfoTip, PartialDataBadge, RelativeTime, Skeleton, Spinner, type PartialError } from "@/components/ui";
import { findChain } from "@/lib/chains";
import { cn } from "@/lib/cn";
import { SEVERITY_LABEL, type Insight, type InsightSeverity } from "@/lib/insights/rules";
import { SEVERITIES, kindBreakdown, stepLabel, type SummaryText } from "./model";

/** Status ink per severity: the bar's segments, the counters' icons, the per-network dots. */
export const SEVERITY_INK: Readonly<Record<InsightSeverity, string>> = {
  critical: "var(--z-danger)",
  warning: "var(--z-warning)",
  opportunity: "var(--z-success)",
  info: "var(--viz-neutral, var(--z-fg-dim))",
};

/**
 * What each severity means: the label's tooltip. Never the caption under a
 * count: worded as present-tense claims ("Funds or earnings at stake now"),
 * they would read as what a 0 is made of.
 */
const SEVERITY_MEANS: Readonly<Record<InsightSeverity, string>> = {
  critical: "Funds or earnings at stake now",
  warning: "Worth checking soon",
  opportunity: "A measured gain is available",
  info: "Context worth knowing",
};

export interface InsightsSummaryProps {
  items: readonly Insight[];
  /** Shortcuts to the first things to do (see `nextSteps`). */
  steps: readonly Insight[];
  counts: Record<InsightSeverity, number>;
  text: SummaryText;
  /** "All chains · 5 networks" or the selected chain's name. */
  scopeLabel: string;
  loading: boolean;
  refreshing: boolean;
  errors: PartialError[];
  /** When the balances behind the list were read (epoch ms). */
  updatedAt: number | null;
  /** Nothing was read: no count is shown, since a zero would claim a measurement. */
  failed?: boolean;
  /** Found but hidden by the reader. */
  hidden?: number;
  /** Hide every insight shown. */
  onClearAll?: () => void;
  /** Show the hidden ones again. */
  onRestore?: () => void;
  /** A shortcut was opened: its insight is hidden like a row's action. */
  onOpenStep?: (step: Insight) => void;
  /** The "By severity" strip (Pro); Lite keeps the sentence and the shortcuts. */
  severity?: boolean;
}

export function InsightsSummary({
  items,
  steps,
  counts,
  text,
  scopeLabel,
  loading,
  refreshing,
  errors,
  updatedAt,
  failed = false,
  hidden = 0,
  onClearAll,
  onRestore,
  onOpenStep,
  severity = true,
}: InsightsSummaryProps) {
  const headingId = useId();
  const total = items.length;
  const first = loading && total === 0;
  return (
    <Card as="section" variant="hero" aria-labelledby={headingId} className="gap-0">
      <div className="flex min-w-0 flex-col">
        <div className="flex min-h-5 flex-wrap items-center gap-x-2 gap-y-1">
          <span className="d-label">{scopeLabel}</span>
          {updatedAt ? <RelativeTime at={updatedAt} prefix="· Updated" className="text-[12px] text-fg-dim" /> : null}
          <PartialDataBadge errors={errors} />
          {refreshing && !loading ? (
            <>
              <Spinner size={12} className="text-fg-dim" />
              <span className="sr-only">Refreshing</span>
            </>
          ) : null}
          <span className="ml-auto flex items-center gap-1">
            {hidden > 0 && onRestore ? (
              <Button size="sm" variant="ghost" iconLeft="eye" onClick={onRestore} title="Show the insights you opened or cleared">
                {hidden} hidden
              </Button>
            ) : null}
            {total > 0 && onClearAll ? (
              <Button size="sm" variant="ghost" iconLeft="check" onClick={onClearAll}>
                Clear all
              </Button>
            ) : null}
          </span>
        </div>
        {first ? (
          <div aria-hidden className="mt-3 flex flex-col gap-3">
            <Skeleton className="h-8 w-[min(340px,80%)] rounded-[8px]" />
            <Skeleton className="h-3.5 w-[min(420px,95%)]" />
          </div>
        ) : (
          <>
            {/* The tip sits after the heading, not in it, so it is not read as part of the title. */}
            <div className="mt-2.5 text-[26px] leading-[1.1] @min-[760px]:text-[30px]">
              <h2 id={headingId} className="inline font-semibold tracking-[-0.035em] text-fg">
                {text.title}
              </h2>
              <InfoTip
                className="ml-2 align-middle"
                label="How insights work"
                content={
                  <span className="block max-w-[300px] text-[12.5px] leading-snug text-fg-muted">
                    Rules, not advice. Each insight is a fact measured from your balances, staking, votes, grants and each chain&apos;s
                    economics, with its numbers and how they were measured. The same reads always give the same list.
                  </span>
                }
              />
            </div>
            <p className="mt-2 max-w-[64ch] text-[14px] leading-relaxed text-fg-muted">{text.sub}</p>
            {steps.length > 0 ? (
              <ul aria-label="Next steps" className="mt-4 flex flex-wrap gap-2">
                {steps.map((step, index) => {
                  if (!step.action) return null;
                  const label = stepLabel(step, step.chainId ? (findChain(step.chainId)?.chainName ?? step.chainId) : null);
                  return (
                    <li key={step.id} className="min-w-0 max-w-full">
                      {/* One crimson shortcut at most: the first, when it is
                          critical. The rows below still give each critical
                          item its own primary action. The title shows a label
                          the button cuts short. */}
                      <Button
                        size="sm"
                        variant={index === 0 && step.severity === "critical" ? "primary" : "secondary"}
                        href={step.action.href}
                        iconLeft={INSIGHT_ICON[step.kind]}
                        title={label}
                        className="max-w-full"
                        onClick={onOpenStep ? () => onOpenStep(step) : undefined}
                      >
                        <span className="truncate">{label}</span>
                      </Button>
                    </li>
                  );
                })}
              </ul>
            ) : null}
          </>
        )}
        {first ? <span id={headingId} className="sr-only">Loading insights</span> : null}
      </div>

      {failed || !severity ? null : (
        <div className="mt-5 flex min-w-0 flex-col gap-3 border-t border-[var(--d-hairline)] pt-4">
          {/* The mix as one bar between the label and the total: a picture of
              the whole row, not of any one column under it. */}
          <div className="flex items-center gap-3">
            <span className="d-label shrink-0">By severity</span>
            <span className="min-w-0 flex-1">
              {first ? <Skeleton className="h-1.5 w-full rounded-full" /> : total > 0 ? <SeverityBar counts={counts} /> : <span className="block h-px bg-[var(--d-hairline)]" />}
            </span>
            {first ? null : (
              <span className="shrink-0 text-[12px] tabular-nums text-fg-dim">
                {total} {total === 1 ? "insight" : "insights"}
              </span>
            )}
          </div>
          <dl className="grid min-w-0 grid-cols-2 gap-x-6 gap-y-4 @min-[640px]:grid-cols-4">
            {SEVERITIES.map((severity) => {
              const count = counts[severity];
              const breakdown = kindBreakdown(
                items.filter((item) => item.severity === severity),
                2,
              );
              return (
                <div key={severity} className="min-w-0">
                  <dt className="flex items-center gap-1.5 text-[12.5px] font-medium text-fg-dim" title={SEVERITY_MEANS[severity]}>
                    <Icon name={SEVERITY_ICON[severity]} size={14} style={{ color: SEVERITY_INK[severity] }} className="shrink-0" />
                    {SEVERITY_LABEL[severity]}
                  </dt>
                  <dd className={cn("mt-1 text-[24px] font-semibold leading-none tabular-nums tracking-[-0.03em]", count === 0 ? "text-fg-faint" : "text-fg")}>
                    {first ? <Skeleton className="h-[22px] w-8 rounded-[6px]" /> : count}
                  </dd>
                  {/* The breakdown is empty exactly when the count is 0. "Found",
                      not "none right now": the strip also shows over partial
                      reads and while staking is still loading, so it claims
                      only what was read. */}
                  <dd className="mt-1.5 line-clamp-2 text-[12px] leading-snug text-fg-dim" title={breakdown || undefined}>
                    {first ? <Skeleton className="h-2.5 w-24" /> : breakdown || "None found"}
                  </dd>
                </div>
              );
            })}
          </dl>
        </div>
      )}
    </Card>
  );
}

/**
 * The mix as one bar, most severe on the left. Decorative: the counters under
 * it carry the numbers, so the bar is hidden from assistive tech.
 */
function SeverityBar({ counts }: { counts: Record<InsightSeverity, number> }) {
  return (
    <div aria-hidden className="flex h-1.5 w-full gap-[2px] overflow-hidden rounded-full">
      {SEVERITIES.filter((severity) => counts[severity] > 0).map((severity) => (
        <span
          key={severity}
          className="h-full min-w-[6px] first:rounded-l-full last:rounded-r-full"
          style={{ flexGrow: counts[severity], flexBasis: 0, background: SEVERITY_INK[severity] }}
        />
      ))}
    </div>
  );
}
