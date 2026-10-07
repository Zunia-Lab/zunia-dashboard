"use client";

/**
 * How far back the list goes, chain by chain, judged against the date range
 * on screen, and what the strip's ▲▼ compare with.
 *
 * Public nodes keep a window of history (the Hub's Keplr node a few weeks,
 * Osmosis a few months, Safrochain everything since genesis), so a count or a
 * fee total over "30 days" is only a 30-day figure where the node kept 30
 * days. This banner says where that holds and where it does not, next to the
 * figures it qualifies. A complete chain is said to be complete: silence
 * would read as "unknown".
 *
 * Chains with the same verdict share one entry ("Cosmos Hub, Celestia and
 * Akash · no transactions"), worst news first, so five networks read as two
 * phrases rather than a column of five on a phone.
 */

import type { ReactNode } from "react";
import { Icon } from "@/components/icons";
import { Callout, InfoTip, LogoStack, chainById } from "@/components/ui";
import { cn } from "@/lib/cn";
import { formatDate } from "@/lib/format";
import { joinNames } from "@/lib/notifications/text";
import { coverageGroups, historyComplete, type ComparisonState, type CoverageTone, type CoverageView } from "./view";

export interface CoverageNoteProps {
  views: readonly CoverageView[];
  /** Start of the date range (null for all time). */
  since: number | null;
  /** "the last 30 days". */
  rangePhrase: string;
  /** Older pages are loading on their own to complete the range. */
  loadingMore: boolean;
  /** Scoped chains the wallet has no address for. */
  unavailable: readonly string[];
  /** Scoped chains past the per-request account cap. */
  truncated: readonly string[];
  /** The previous period the strip compares with (null for all time). */
  comparison: { state: ComparisonState; from: number; to: number } | null;
  className?: string;
}

const DOT: Readonly<Record<CoverageTone, string>> = {
  good: "bg-[var(--z-success)]",
  pending: "bg-fg-dim",
  limited: "bg-[var(--z-warning)]",
  bad: "bg-[var(--z-danger)]",
};

function nameOf(chainId: string): string {
  return chainById(chainId)?.chainName ?? chainId;
}

/**
 * One verdict: the status dot first, then the chains and what holds for them,
 * as running text, so a long entry wraps like a sentence on a phone instead
 * of stranding its dot at the end of a line.
 */
function Entry({ tone, chainIds, text, extra }: { tone: CoverageTone; chainIds: readonly string[]; text: string; extra?: ReactNode }) {
  const names = chainIds.map(nameOf);
  return (
    <li className="flex min-w-0 items-start gap-2 text-[12.5px] leading-[20px]">
      <span aria-hidden className={cn("mt-[7px] size-1.5 shrink-0 rounded-full", DOT[tone])} />
      <span className="min-w-0">
        <LogoStack
          items={chainIds.map((id) => ({ src: chainById(id)?.iconUrl, label: nameOf(id) }))}
          size={16}
          max={3}
          label={names.join(", ")}
          className="mr-1.5 align-[-3px]"
        />
        <span className="font-medium text-fg" title={names.length > 3 ? names.join(", ") : undefined}>
          {joinNames(names, 3)}
        </span>
        <span className="text-fg-muted"> · {text}</span>
        {extra ? <span className="ml-1 inline-flex align-[-2px]">{extra}</span> : null}
      </span>
    </li>
  );
}

export function CoverageNote({ views, since, rangePhrase, loadingMore, unavailable, truncated, comparison, className }: CoverageNoteProps) {
  if (views.length === 0 && unavailable.length === 0 && truncated.length === 0) return null;
  const groups = coverageGroups(views, since);
  const total = views.length;
  const count = (tone: CoverageTone) => groups.filter((group) => group.tone === tone).reduce((sum, group) => sum + group.chainIds.length, 0);
  const limited = count("limited") + count("bad");
  const pending = count("pending");
  const notRead = unavailable.length + truncated.length;
  // The same verdict the strip reads to print a known zero (`historyComplete`):
  // the banner and the figures under it never disagree about completeness.
  const allGood = historyComplete(views, since, notRead);
  const everyComplete = views.every((view) => view.state === "complete" || view.state === "empty");

  const title = allGood
    ? everyComplete
      ? total === 1
        ? "Complete history on this network"
        : `Complete history on all ${total} networks`
      : `Complete for ${rangePhrase} on ${total === 1 ? "this network" : `all ${total} networks`}`
    : limited > 0
      ? `History is limited on ${limited} of ${total} ${total === 1 ? "network" : "networks"}`
      : pending > 0
        ? loadingMore
          ? "Loading older transactions…"
          : since === null
            ? "Older history isn't loaded yet"
            : `Loaded part of ${rangePhrase}`
        : "Some networks were not read";

  const period = comparison ? `${formatDate(comparison.from, "short")} – ${formatDate(comparison.to, "short")}` : null;
  const days = comparison ? Math.round((comparison.to - comparison.from) / 86_400_000) : 0;
  const versus =
    comparison?.state.state === "ready" ? (
      <span>
        <span aria-hidden>▲▼ </span>
        <span className="sr-only">Changes </span>vs the {days} days before · <span className="text-fg-muted">{period}</span>
      </span>
    ) : comparison?.state.state === "uncovered" ? (
      <span>
        No comparison with {period}: {joinNames(comparison.state.chainIds.map(nameOf), 2)}{" "}
        {comparison.state.chainIds.length === 1 ? "isn't" : "aren't"} complete that far back
      </span>
    ) : null;

  return (
    // Good news stays quiet: a neutral panel with a green check, not a green
    // block competing with the figures under it.
    <Callout
      tone="neutral"
      icon={null}
      title={
        <span className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1">
          <span className="inline-flex items-center gap-2">
            <Icon name={allGood ? "success" : "clock"} size={17} className={allGood ? "text-[var(--z-success)]" : "text-fg-muted"} />
            {title}
          </span>
          {versus ? <span className="pl-[25px] text-[12.5px] font-normal text-fg-dim sm:pl-0">{versus}</span> : null}
        </span>
      }
      className={className}
    >
      <ul className="mt-1.5 flex flex-wrap gap-x-6 gap-y-1 pl-[25px]">
        {groups.map((group) => (
          <Entry
            key={`${group.tone}|${group.text}`}
            tone={group.tone}
            chainIds={group.chainIds}
            text={group.text}
            extra={
              group.notes.length > 0 ? (
                <InfoTip
                  size={12}
                  label={`Why: ${group.chainIds.map(nameOf).join(", ")}`}
                  content={
                    <ul className="flex max-w-[280px] flex-col gap-1.5 text-[12.5px] leading-snug text-fg-muted">
                      {group.notes.map((note) => (
                        <li key={note.chainId}>
                          <span className="font-medium text-fg">{nameOf(note.chainId)}</span>: {note.note}
                        </li>
                      ))}
                    </ul>
                  }
                />
              ) : undefined
            }
          />
        ))}
        {unavailable.length > 0 ? <Entry tone="pending" chainIds={unavailable} text="not read · your wallet shared no address" /> : null}
        {truncated.length > 0 ? (
          <li className="text-[12.5px] leading-[20px] text-fg-muted">
            {truncated.length} more {truncated.length === 1 ? "network" : "networks"} not read (24 per request); pick one in the rail to read it
          </li>
        ) : null}
      </ul>
    </Callout>
  );
}
