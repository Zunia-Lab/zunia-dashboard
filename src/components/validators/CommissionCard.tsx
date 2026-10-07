"use client";

/**
 * How commission is spread across the active set today, against the most
 * each validator may charge within 30 days under its own published limits
 * (max rate and max daily change; research V2). Two bars per bracket: the
 * shift from the first to the second is the commission risk a delegator
 * takes by picking at today's rate.
 */

import { useMemo } from "react";
import { BarChart, type BarDatum, type TickFormatter } from "@/components/charts";
import { Card, CardBody, CardHeader, InlineError } from "@/components/ui";
import type { ValidatorRow } from "@/lib/data/validators";
import { steepCommissionRise } from "@/components/staking/model";

/** Commission brackets (upper bounds, inclusive). */
const BRACKETS = [
  { id: "le5", label: "≤ 5%", max: 0.05 },
  { id: "le10", label: "5–10%", max: 0.1 },
  { id: "le20", label: "10–20%", max: 0.2 },
  { id: "gt20", label: "> 20%", max: Infinity },
] as const;

const SERIES = [
  { id: "now", label: "Today" },
  { id: "d30", label: "Highest within 30 days" },
];

/** Stable formatters for the chart (module level: no redraw per render). */
const countText = (value: number) => `${Math.round(value)} validator${Math.round(value) === 1 ? "" : "s"}`;
const countTick: TickFormatter = (value) => String(Math.round(value));

function bracketOf(rate: number): (typeof BRACKETS)[number]["id"] {
  return (BRACKETS.find((bracket) => rate <= bracket.max + 1e-9) ?? BRACKETS[BRACKETS.length - 1]).id;
}

export interface CommissionCardProps {
  /** The active (bonded) validators; null while the set loads. */
  active: ValidatorRow[] | null;
  chainName: string;
  /** The set could not be read. */
  error: string | null;
  onRetry: () => void;
  pending: boolean;
  className?: string;
}

export function CommissionCard({ active, chainName, error, onRetry, pending, className }: CommissionCardProps) {
  const rows = useMemo(() => active ?? [], [active]);
  const spread = useMemo<BarDatum[]>(
    () =>
      BRACKETS.map((bracket) => ({
        x: bracket.id,
        label: bracket.label,
        values: {
          now: rows.filter((row) => bracketOf(row.commission.rate) === bracket.id).length,
          d30: rows.filter((row) => bracketOf(row.commission.reachable30d) === bracket.id).length,
        },
      })),
    [rows],
  );
  const canRise = rows.filter((row) => row.commission.reachable30d - row.commission.rate >= 0.05 - 1e-9).length;
  const steep = rows.filter((row) => steepCommissionRise(row.commission.rate, row.commission.reachable30d)).length;
  const fixed = rows.filter((row) => row.commission.reachable30d <= row.commission.rate + 1e-9).length;

  return (
    <Card as="section" aria-label="Commission" className={className} pending={pending}>
      <CardHeader
        title="Commission"
        subtitle="Active validators: today vs the most each can charge in 30 days"
        info="Each validator sets its commission within limits fixed when it was created: a hard cap and a largest change per day. The second bar counts where every validator could be 30 days from now if it raised its rate as fast as its own limits allow."
      />
      <CardBody className="flex flex-col gap-3">
        {error && !active ? (
          <InlineError message={error} onRetry={onRetry} />
        ) : (
          <BarChart
            data={spread}
            series={SERIES}
            layout="grouped"
            xType="category"
            height={176}
            valueFormatter={countText}
            tickFormatter={countTick}
            title="Active validators by commission bracket"
            ariaLabel={`Active validators on ${chainName} by commission: ${spread
              .map((d) => `${d.label} ${d.values.now ?? 0} today, ${d.values.d30 ?? 0} at most within 30 days`)
              .join("; ")}.`}
            loading={!active}
          />
        )}
        {active && rows.length > 0 ? (
          <p className="text-[12.5px] leading-snug text-fg-dim">
            <span className="font-medium text-fg">{canRise}</span> of {rows.length} can raise their rate by 5 points or more within 30 days
            {steep > 0 ? (
              <>
                ; <span className="font-medium text-[var(--z-warning)]">{steep}</span> could reach 25% or climb 15 points
              </>
            ) : null}
            ;{" "}
            {fixed > 0 ? (
              <>
                <span className="font-medium text-fg">{fixed}</span> {fixed === 1 ? "has" : "have"} a fixed rate
              </>
            ) : (
              "none has a fixed rate"
            )}
            .
          </p>
        ) : null}
      </CardBody>
    </Card>
  );
}
