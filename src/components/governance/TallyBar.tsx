"use client";

/**
 * The tally of a proposal as two aligned instruments:
 *
 * 1. Votes: one 100% bar of the votes cast, Yes · No · No with veto ·
 *    Abstain, with the pass line marked. Abstain is drawn last because it
 *    only counts toward quorum: the decisive votes then form one run from
 *    the left, and the pass line sits at the threshold of that run, so "Yes
 *    reaches past the line" reads directly as "Yes clears the threshold".
 * 2. Turnout: a thin meter of the staked voting power that has voted, with
 *    the quorum marked.
 *
 * Colours are a diverging pair, not status colours: blue for Yes, orange for
 * No, a hatched orange for No with veto (a stronger No, same family), grey
 * for Abstain. A governance tool should not paint one side of a vote as the
 * "good" one, and green / red already mean up / down across the dashboard.
 * The pair and the grey pass the dataviz validator in both themes (worst
 * CVD ΔE 11.5 dark / 12.5 light, all pairs); the hatch is the second channel
 * between No and No with veto; every figure is printed in the legend, so no
 * value depends on colour or hover.
 */

import { useId, useState, type CSSProperties } from "react";
import { cn } from "@/lib/cn";
import type { ProposalRow, VoteOptionName } from "@/lib/chain/types";
import { formatTokenAmount } from "@/lib/format";
import { VOTE_LABEL, VOTE_ORDER, VOTE_SHORT } from "./model";
import { passLine, pct, stackParts, tallyShares, TURNOUT_WITHHELD, turnoutWithheld } from "./rules";

/** Segment fills. Veto is No's hue with a 135° hatch (the CVD / print relief). */
export const VOTE_FILL: Record<VoteOptionName, string> = {
  yes: "var(--viz-2)",
  no: "var(--viz-1)",
  veto: "repeating-linear-gradient(135deg, var(--viz-1) 0 3px, color-mix(in srgb, var(--viz-1) 42%, var(--viz-surface)) 3px 5px)",
  abstain: "var(--viz-other)",
};

/** A split (weighted) vote: half Yes, half No, as a two-tone fill. */
export const SPLIT_FILL = "linear-gradient(90deg, var(--viz-2) 50%, var(--viz-1) 50%)";

/** The mark-shaped key for a vote option (legends, the vote form, badges). */
export function VoteSwatch({ option, className }: { option: VoteOptionName | "none" | "weighted"; className?: string }) {
  const fill = option === "none" ? "var(--d-glass-2)" : option === "weighted" ? SPLIT_FILL : VOTE_FILL[option];
  return (
    <span
      aria-hidden
      className={cn("inline-block size-2.5 shrink-0 rounded-[3px]", option === "none" && "shadow-[inset_0_0_0_1px_var(--d-hairline-strong)]", className)}
      style={{ background: fill }}
    />
  );
}

type TallyRow = Pick<
  ProposalRow,
  "tally" | "turnout" | "turnoutEstimate" | "quorum" | "threshold" | "vetoThreshold" | "status" | "tallyKind"
>;

export interface TallyBarProps {
  row: TallyRow;
  /** `compact` for cards; `full` for the proposal page (amounts, labelled markers). */
  size?: "compact" | "full";
  /** Staking token, to print amounts in the full legend. */
  token?: { symbol: string; decimals: number | null } | null;
  /** Colour of the surface the bar sits on (its 2px gaps are cut in it). */
  surface?: string;
  className?: string;
}

export function TallyBar({ row, size = "compact", token, surface = "var(--d-card)", className }: TallyBarProps) {
  const id = useId();
  const [active, setActive] = useState<VoteOptionName | null>(null);
  const shares = tallyShares(row.tally);
  const full = size === "full";
  const approx = Boolean(row.turnoutEstimate);

  if (!shares) {
    return (
      <div className={cn("flex flex-col gap-2", className)}>
        <div aria-hidden className={cn("rounded-[4px] bg-[var(--d-glass-2)]", full ? "h-3.5" : "h-2")} />
        <p className="text-[12.5px] text-fg-dim">
          {row.tally ? "No votes yet." : row.status === "deposit" ? "Voting has not started." : "Tally unavailable."}
        </p>
      </div>
    );
  }

  const line = passLine(row.tally, row.threshold);
  const placed = stackParts(VOTE_ORDER.map((option) => ({ option, share: shares[option] })).filter((s) => s.share > 0));

  const summary =
    `Votes cast: ${VOTE_ORDER.map((o) => `${VOTE_LABEL[o]} ${pct(shares[o])}`).join(", ")}.` +
    (line !== null ? ` Yes needs to pass ${pct(line)} of the bar (the threshold of decisive votes).` : "") +
    (row.turnout !== null ? ` Turnout ${approx ? "about " : ""}${pct(row.turnout)} of staked voting power` : "") +
    (row.quorum !== null ? `, quorum ${pct(row.quorum)}.` : ".");

  return (
    <div className={cn("flex min-w-0 flex-col", full ? "gap-3" : "gap-2", className)} style={{ "--tally-gap": surface } as CSSProperties}>
      {full ? null : <CompactLegend shares={shares} active={active} onActive={setActive} />}

      {/* Votes bar with the pass line. */}
      <div className={cn("relative", full ? "pt-5" : "pt-[7px]")}>
        <div
          role="img"
          aria-label={summary}
          className={cn("relative w-full overflow-hidden rounded-[4px] bg-[var(--d-glass-2)]", full ? "h-3.5" : "h-2")}
        >
          {placed.map((segment, index) => (
            <span
              key={segment.option}
              onPointerEnter={() => setActive(segment.option)}
              onPointerLeave={() => setActive(null)}
              className="absolute inset-y-0 box-border transition-opacity duration-[160ms]"
              style={{
                left: `${segment.start * 100}%`,
                width: `max(2px, ${segment.share * 100}%)`,
                background: VOTE_FILL[segment.option],
                // The surface gap is cut into the segment's own left edge, so
                // every boundary stays exactly where its share puts it.
                borderLeft: index > 0 ? "2px solid var(--tally-gap)" : undefined,
                opacity: active && active !== segment.option ? 0.35 : 1,
              }}
            />
          ))}
        </div>
        {line !== null ? <PassMarker at={line} threshold={row.threshold} full={full} /> : null}
      </div>

      {full ? <FullLegend shares={shares} row={row} token={token ?? null} active={active} onActive={setActive} id={id} /> : null}

      <TurnoutMeter row={row} full={full} />
    </div>
  );
}

/** The pass line: a caret over the bar and a hairline through it. */
function PassMarker({ at, threshold, full }: { at: number; threshold: number | null; full: boolean }) {
  const left = `${Math.min(100, Math.max(0, at * 100))}%`;
  return (
    <span aria-hidden className="pointer-events-none absolute inset-y-0" style={{ left }}>
      <span
        className={cn(
          "absolute -translate-x-1/2 border-x-[4px] border-t-[5px] border-x-transparent border-t-fg",
          full ? "top-[9px]" : "top-0",
        )}
      />
      <span
        className={cn(
          "absolute bottom-0 w-[1.5px] -translate-x-1/2 bg-fg shadow-[0_0_0_1px_var(--tally-gap)]",
          full ? "top-[14px]" : "top-[5px]",
        )}
      />
      {full ? (
        // Beside the caret, on whichever side has room ("Pass line · 50%").
        <span
          className="absolute top-0 whitespace-nowrap font-mono text-[10.5px] uppercase leading-none tracking-[0.06em] text-fg-dim"
          style={at > 0.55 ? { right: 7 } : { left: 7 }}
        >
          Pass line{threshold !== null ? ` · ${pct(threshold)}` : ""}
        </span>
      ) : null}
    </span>
  );
}

function CompactLegend({
  shares,
  active,
  onActive,
}: {
  shares: NonNullable<ReturnType<typeof tallyShares>>;
  active: VoteOptionName | null;
  onActive: (option: VoteOptionName | null) => void;
}) {
  return (
    <ul className="flex min-w-0 flex-wrap items-center gap-x-3 gap-y-1 text-[12.5px] leading-none" aria-label="Votes cast by option">
      {VOTE_ORDER.map((option) => (
        <li
          key={option}
          className={cn("inline-flex items-center gap-1.5 whitespace-nowrap transition-opacity duration-[160ms]", active && active !== option && "opacity-40")}
          onPointerEnter={() => onActive(option)}
          onPointerLeave={() => onActive(null)}
        >
          <VoteSwatch option={option} />
          <span className="text-fg-dim">{VOTE_SHORT[option]}</span>
          <span className="font-medium tabular-nums text-fg">{pct(shares[option])}</span>
        </li>
      ))}
    </ul>
  );
}

function FullLegend({
  shares,
  row,
  token,
  active,
  onActive,
  id,
}: {
  shares: NonNullable<ReturnType<typeof tallyShares>>;
  row: TallyRow;
  token: { symbol: string; decimals: number | null } | null;
  active: VoteOptionName | null;
  onActive: (option: VoteOptionName | null) => void;
  id: string;
}) {
  const tally = row.tally;
  return (
    <table className="w-full text-[13.5px]" aria-describedby={`${id}-caption`}>
      <caption id={`${id}-caption`} className="sr-only">
        Votes cast by option: voting power and share of all votes
      </caption>
      <thead className="sr-only">
        <tr>
          <th scope="col">Option</th>
          <th scope="col">Voting power</th>
          <th scope="col">Share of votes</th>
        </tr>
      </thead>
      <tbody>
        {VOTE_ORDER.map((option) => (
          <tr
            key={option}
            onPointerEnter={() => onActive(option)}
            onPointerLeave={() => onActive(null)}
            className={cn(
              "border-b border-[var(--d-hairline)] transition-opacity duration-[160ms] last:border-b-0",
              active && active !== option && "opacity-45",
            )}
          >
            <th scope="row" className="py-2 pr-3 text-left font-normal">
              <span className="inline-flex items-center gap-2 text-fg-muted">
                <VoteSwatch option={option} className="size-3" />
                {VOTE_LABEL[option]}
              </span>
            </th>
            <td className="py-2 pr-3 text-right tabular-nums text-fg-muted">
              {/* Chain-wide tallies are public and say nothing about the
                  user's holdings: never masked. */}
              {tally && token ? (
                <>
                  {formatTokenAmount(tally[option], token.decimals, { compact: true })}
                  <span className="ml-1 text-fg-dim">{token.symbol}</span>
                </>
              ) : (
                <span className="text-fg-dim">—</span>
              )}
            </td>
            <td className="w-[4.5rem] py-2 text-right font-medium tabular-nums text-fg">{pct(shares[option], 2)}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

/** Staked voting power that has voted, with the quorum tick. */
function TurnoutMeter({ row, full }: { row: TallyRow; full: boolean }) {
  const approx = Boolean(row.turnoutEstimate);
  const turnout = row.turnout;
  const quorum = row.quorum;
  const met = turnout !== null && quorum !== null ? turnout >= quorum : null;
  const fill = turnout !== null ? Math.min(1, Math.max(0, turnout)) : 0;
  return (
    <div className={cn("flex min-w-0 items-center gap-3", full && "flex-wrap")}>
      <span className={cn("shrink-0 text-fg-dim", full ? "w-full text-[12.5px] sm:w-auto" : "text-[12px]")}>Turnout</span>
      <div className={cn("relative min-w-[80px] flex-1", full ? "py-[5px]" : "py-[3px]")} aria-hidden>
        <div className={cn("overflow-hidden rounded-full bg-[var(--d-glass-2)]", full ? "h-1.5" : "h-1")}>
          <div
            className="h-full rounded-full bg-[var(--viz-neutral)] transition-[width] duration-[450ms] ease-[var(--d-ease)]"
            style={{ width: `${fill * 100}%` }}
          />
        </div>
        {quorum !== null ? (
          <span
            className="absolute inset-y-0 w-[2px] -translate-x-1/2 rounded-full bg-fg shadow-[0_0_0_1.5px_var(--tally-gap)]"
            style={{ left: `${Math.min(100, quorum * 100)}%` }}
            title={`Quorum ${pct(quorum)}`}
          />
        ) : null}
      </div>
      <span className="shrink-0 whitespace-nowrap text-[12.5px] tabular-nums" title={turnoutWithheld(row) ? TURNOUT_WITHHELD : undefined}>
        <span className="font-medium text-fg">
          {approx && turnout !== null ? "≈ " : ""}
          {pct(turnout)}
        </span>
        <span className="text-fg-dim"> · quorum {pct(quorum)}</span>
        {met !== null ? <span className="sr-only">{met ? ", quorum reached" : ", below quorum"}</span> : null}
      </span>
    </div>
  );
}
