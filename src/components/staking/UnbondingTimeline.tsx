"use client";

/**
 * When stake comes back (research S2): every pending unbonding release and
 * redelegation lock across chains on one dated track, the next release
 * highlighted, with the list underneath.
 *
 * The track spans now → just past the last entry (`timelineWindow`), so a
 * week of releases spreads across the card instead of piling up against
 * "today". Ticks sit on local midnights. Labels take one of two lanes above
 * the axis and are left out when neither lane has room (the marker keeps a
 * tooltip, and the list below names every entry). Releases are filled dots;
 * locks are hollow, because nothing comes back when a lock ends — the stake
 * just becomes movable again.
 *
 * With nothing pending it shrinks to one line plus each network's unbonding
 * period: what unstaking would cost in waiting.
 */

import { useState } from "react";
import { useChartSize } from "@/components/charts";
import { Badge, Button, Card, CardBody, CardHeader, ChainLogo, Money, RelativeTime, TokenAmount, Tooltip, useNow } from "@/components/ui";
import { cn } from "@/lib/cn";
import { formatDate, formatFiat, MASK } from "@/lib/format";
import { usePrefs } from "@/providers/PrefsProvider";
import { DAY_MS, timelineWindow, unbondingPeriodText, wholeText, type ChainView, type UnbondingItem } from "./model";

interface Marker {
  key: string;
  at: number;
  kind: UnbondingItem["kind"];
  items: UnbondingItem[];
  next: boolean;
}

const LANES = 2;
/** Axis line, from the top of the track (px). */
const AXIS_Y = 56;

function dayKey(at: number): string {
  const d = new Date(at);
  return `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;
}

/** One marker per day and kind; the one holding the next release is flagged. */
function groupMarkers(timeline: readonly UnbondingItem[], nextKey: string | null): Marker[] {
  const groups = new Map<string, Marker>();
  for (const item of timeline) {
    const key = `${item.kind}:${dayKey(item.at)}`;
    const existing = groups.get(key);
    if (existing) {
      existing.items.push(item);
      if (item.key === nextKey) existing.next = true;
    } else {
      groups.set(key, { key, at: item.at, kind: item.kind, items: [item], next: item.key === nextKey });
    }
  }
  return [...groups.values()].sort((a, b) => a.at - b.at);
}

/** Approximate label width at 11.5px tabular figures, plus padding. */
function labelWidth(text: string): number {
  return text.length * 6.4 + 12;
}

/**
 * Labels into lanes, greedy left to right; the next release is placed first
 * so it always gets the top lane. A label that fits no lane is left out (its
 * marker keeps a tooltip).
 */
function placeLabels(
  markers: readonly Marker[],
  width: number,
  start: number,
  span: number,
  textOf: (marker: Marker) => string,
): Array<{ marker: Marker; x: number; lane: number | null; text: string; left: number }> {
  if (!width) return [];
  const ends = Array.from({ length: LANES }, () => -Infinity);
  const order = [...markers].sort((a, b) => Number(b.next) - Number(a.next) || a.at - b.at);
  return order.map((marker) => {
    const x = ((marker.at - start) / span) * width;
    const text = textOf(marker);
    const w = labelWidth(text);
    const left = Math.min(Math.max(0, x - w / 2), Math.max(0, width - w));
    let lane: number | null = null;
    for (let i = 0; i < LANES; i += 1) {
      if (left > (ends[i] ?? -Infinity) + 6) {
        lane = i;
        ends[i] = left + w;
        break;
      }
    }
    return { marker, x, lane, text, left };
  });
}

/** Local midnights from the day after `start`, every `stepDays`, clear of the end. */
function midnightTicks(start: number, end: number, stepDays: number): number[] {
  const out: number[] = [];
  const day = new Date(start);
  day.setHours(24, 0, 0, 0);
  while (day.getTime() < end - stepDays * DAY_MS * 0.45) {
    out.push(day.getTime());
    day.setDate(day.getDate() + stepDays);
  }
  return out;
}

export interface UnbondingTimelineProps {
  timeline: UnbondingItem[];
  chains: ChainView[];
  currency: string;
  unbondingDays: (chainId: string) => number | null;
  /** The answer on screen belongs to the previous scope (dimmed). */
  pending: boolean;
  /** Full-width card: the list runs in two columns on wide screens. */
  wide?: boolean;
}

export function UnbondingTimeline({ timeline, chains, currency, unbondingDays, pending, wide = false }: UnbondingTimelineProps) {
  const now = useNow();
  const { hideAmounts } = usePrefs();
  const [ref, size] = useChartSize<HTMLDivElement>();
  const [showAll, setShowAll] = useState(false);

  const releases = timeline.filter((item) => item.kind === "unbonding");
  const locks = timeline.length - releases.length;
  const nextKey = releases[0]?.key ?? null;
  const oneChain = new Set(timeline.map((item) => item.chainId)).size === 1;

  /** "1,035 SAF" in one chain, "$4.20" across chains, "3 entries" when unpriced. */
  const amountText = (items: UnbondingItem[]): string => {
    if (hideAmounts) return MASK;
    if (oneChain && items[0]) {
      const total = items.reduce((sum, item) => sum + (item.whole ?? 0), 0);
      return `${wholeText(total, { maxFraction: total < 1 ? 4 : 2, compact: total >= 10_000 })} ${items[0].symbol}`;
    }
    const values = items.map((item) => item.value);
    if (values.every((value) => value !== null)) return formatFiat(values.reduce<number>((sum, v) => sum + (v ?? 0), 0), currency, { compact: true });
    return `${items.length} entr${items.length === 1 ? "y" : "ies"}`;
  };

  const frame = timelineWindow(
    now ?? timeline[0]?.at ?? 0,
    timeline.map((item) => item.at),
    size.width ? Math.max(3, Math.floor(size.width / 96)) : 6,
  );
  const { start, end } = frame;
  const span = Math.max(1, end - start);

  const markers = groupMarkers(timeline, nextKey);
  // Cheap (a handful of markers), so placed on every render: it depends on
  // the measured width and on how amounts read (privacy, currency).
  const placed = placeLabels(markers, size.width, start, span, (marker) =>
    `${marker.next ? "Next · " : ""}${formatDate(marker.at, "short")} · ${amountText(marker.items)}`,
  );
  // Ticks clear of the "Today" caption at the left edge.
  const ticks = midnightTicks(start, end, frame.stepDays).filter((t) => !size.width || ((t - start) / span) * size.width > 56);

  const within = (days: number) => {
    const limit = start + days * DAY_MS;
    const items = releases.filter((item) => item.at <= limit);
    return items.length ? amountText(items) : null;
  };
  const week = within(7);
  const month = within(30);

  const periods = chains
    .map((chain) => ({ chain, text: unbondingPeriodText(unbondingDays(chain.chainId)) }))
    .filter((entry): entry is { chain: ChainView; text: string } => entry.text !== null);

  const visible = wide ? 6 : 4;
  const list = showAll ? timeline : timeline.slice(0, visible);

  if (timeline.length === 0) {
    return (
      <Card as="section" aria-label="Unbonding" pending={pending}>
        <CardHeader title="Unbonding" subtitle="Nothing on its way back" />
        <CardBody className="flex flex-col gap-3">
          <p className="text-[12.5px] leading-snug text-fg-dim">
            Unstaked tokens wait out the network&apos;s unbonding period, earning nothing, before they are spendable.
          </p>
          {periods.length ? (
            <ul className="flex flex-wrap gap-1.5" aria-label="Unbonding period by network">
              {periods.map(({ chain, text }) => (
                <li key={chain.chainId}>
                  <Badge size="md" tone="neutral" icon={<ChainLogo chainId={chain.chainId} size={14} />}>
                    {chain.chainName} · {text}
                  </Badge>
                </li>
              ))}
            </ul>
          ) : null}
        </CardBody>
      </Card>
    );
  }

  return (
    <Card as="section" aria-label="Unbonding" pending={pending}>
      <CardHeader
        title="Unbonding"
        subtitle={`${releases.length} release${releases.length === 1 ? "" : "s"}${locks > 0 ? ` · ${locks} move lock${locks === 1 ? "" : "s"}` : ""} · next ${
          releases[0] ? formatDate(releases[0].at, "short") : "—"
        }`}
        actions={
          releases.length ? (
            <dl className="flex items-center gap-4 text-[12.5px]">
              <div className="flex items-baseline gap-1.5">
                <dt className="text-fg-dim">Next 7 days</dt>
                <dd className="font-medium tabular-nums text-fg">{week ?? "—"}</dd>
              </div>
              <div className="flex items-baseline gap-1.5">
                <dt className="text-fg-dim">30 days</dt>
                <dd className="font-medium tabular-nums text-fg">{month ?? "—"}</dd>
              </div>
            </dl>
          ) : null
        }
      />
      <CardBody className="flex flex-col gap-4">
        <div
          ref={ref}
          className="relative h-[84px] w-full select-none"
          role="img"
          aria-label={`Timeline: ${releases.length} unbonding release${releases.length === 1 ? "" : "s"}${
            releases[0] ? `, next on ${formatDate(releases[0].at, "long")}` : ""
          }${locks > 0 ? `, ${locks} move lock${locks === 1 ? "" : "s"}` : ""}.`}
        >
          {/* Axis */}
          <div aria-hidden className="absolute inset-x-0 h-px bg-[var(--d-hairline-strong)]" style={{ top: AXIS_Y }} />
          {/* Today */}
          <span aria-hidden className="absolute left-0 size-[10px] -translate-y-1/2 rounded-full bg-fg-dim" style={{ top: AXIS_Y }} />
          <span aria-hidden className="absolute left-0 font-mono text-[10.5px] text-fg-dim" style={{ top: AXIS_Y + 10 }}>
            Today
          </span>
          {/* Ticks on local midnights */}
          {ticks.map((t) => {
            const x = ((t - start) / span) * 100;
            return (
              <div key={t} aria-hidden className="absolute flex -translate-x-1/2 flex-col items-center" style={{ left: `${x}%`, top: AXIS_Y - 4 }}>
                <span className="h-2 w-px bg-[var(--d-hairline-strong)]" />
                <span className="mt-1 whitespace-nowrap font-mono text-[10.5px] text-fg-dim">{formatDate(t, "short")}</span>
              </div>
            );
          })}
          {/* Markers and labels */}
          {placed.map(({ marker, x, lane, text, left }) => {
            const lock = marker.kind === "redelegation";
            const dot = marker.next ? 14 : 10;
            const labelTop = lane === 0 ? 0 : 22;
            const tip = (
              <span className="flex flex-col gap-1">
                <span className="font-medium text-fg">
                  {lock ? "Move lock ends" : "Unbonding release"} · {formatDate(marker.at, "datetime")}
                </span>
                {marker.items.slice(0, 4).map((item) => (
                  <span key={item.key} className="text-fg-muted">
                    {item.chainName} · {item.validator.moniker}:{" "}
                    <TokenAmount amount={item.balance} decimals={item.decimals} symbol={item.symbol} maxFraction={2} />
                  </span>
                ))}
                {marker.items.length > 4 ? <span className="text-fg-dim">and {marker.items.length - 4} more</span> : null}
              </span>
            );
            return (
              <div key={marker.key}>
                {lane !== null ? (
                  <>
                    <span
                      aria-hidden
                      className={cn(
                        "absolute whitespace-nowrap rounded-[6px] px-1.5 py-0.5 text-[11.5px] leading-tight tabular-nums",
                        marker.next
                          ? "bg-[var(--d-accent-soft)] font-medium text-[var(--d-accent-text)]"
                          : lock
                            ? "text-fg-dim"
                            : "text-fg-muted",
                      )}
                      style={{ top: labelTop, left }}
                    >
                      {text}
                    </span>
                    <span
                      aria-hidden
                      className="absolute w-px bg-[var(--d-hairline-strong)]"
                      style={{ left: x, top: labelTop + 18, height: Math.max(0, AXIS_Y - (labelTop + 18) - dot / 2) }}
                    />
                  </>
                ) : null}
                <Tooltip content={tip}>
                  <span
                    tabIndex={0}
                    aria-label={`${lock ? "Move lock ends" : "Release"} ${formatDate(marker.at, "long")}: ${text}`}
                    className={cn(
                      "absolute -translate-x-1/2 -translate-y-1/2 rounded-full focus-visible:outline-offset-2",
                      lock
                        ? "border-2 border-dashed border-fg-dim bg-[var(--d-card)]"
                        : marker.next
                          ? "bg-[image:var(--z-accent-gradient)] shadow-[0_0_0_3px_var(--d-card),0_0_0_5px_var(--d-accent-line)]"
                          : "bg-fg-muted shadow-[0_0_0_2px_var(--d-card)]",
                    )}
                    style={{ left: Math.max(dot / 2 + 2, x), top: AXIS_Y, width: dot, height: dot }}
                  />
                </Tooltip>
              </div>
            );
          })}
        </div>

        <ul className={cn("grid grid-cols-1", wide && "lg:grid-cols-2 lg:gap-x-8")} aria-label="Unbonding entries">
          {list.map((item) => (
            <li key={item.key} className="flex items-center gap-3 border-t border-[var(--d-hairline)] py-2.5 text-[13.5px]">
              <span className="w-[84px] shrink-0">
                <span className={cn("block font-medium tabular-nums", item.key === nextKey ? "text-[var(--d-accent-text)]" : "text-fg")}>
                  {formatDate(item.at, "short")}
                </span>
                <RelativeTime at={item.at} className="block text-[12px] text-fg-dim" />
              </span>
              <ChainLogo chainId={item.chainId} size={20} />
              <span className="min-w-0 flex-1">
                <span className="block truncate text-fg">
                  {item.kind === "redelegation" && item.from ? `${item.from.moniker} → ${item.validator.moniker}` : item.validator.moniker}
                </span>
                <span className="block truncate text-[12px] text-fg-dim">
                  {item.chainName} · {item.kind === "redelegation" ? "move lock ends (stays staked)" : "release"}
                </span>
              </span>
              <span className="flex shrink-0 flex-col items-end leading-tight">
                <TokenAmount amount={item.balance} decimals={item.decimals} symbol={item.symbol} maxFraction={2} />
                {item.kind === "unbonding" ? <Money value={item.value} currency={currency} className="text-[12px] text-fg-dim" /> : null}
              </span>
            </li>
          ))}
        </ul>
        {timeline.length > visible ? (
          <Button
            variant="ghost"
            size="sm"
            className="-mt-2 self-start"
            onClick={() => setShowAll((value) => !value)}
            iconRight={showAll ? "chevronUp" : "chevronDown"}
          >
            {showAll ? "Show fewer" : `Show all ${timeline.length}`}
          </Button>
        ) : null}
      </CardBody>
    </Card>
  );
}
