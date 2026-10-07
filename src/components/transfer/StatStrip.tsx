"use client";

/**
 * The strip of figures at the top of a transfer page: one card, up to four
 * bare tiles split by hairlines (two by two on phones). Each tile says what
 * its figure covers in its sub line; a figure the reads cannot back is "—"
 * with the reason.
 */

import { Children, type ReactNode } from "react";
import { Card, StatTile, type StatTileProps } from "@/components/ui";
import { cn } from "@/lib/cn";

/**
 * `pending`: a refetch is in flight; the figures stay on screen, dimmed
 * (spec §3), instead of flashing back to skeletons.
 */
export function StatStrip({ children, pending, className }: { children: ReactNode; pending?: boolean; className?: string }) {
  const cells = Children.toArray(children);
  return (
    <Card padding="none" pending={pending} className={cn("grid gap-0 grid-cols-2 lg:grid-cols-4", className)}>
      {cells.map((cell, index) => (
        <div
          key={index}
          className={cn(
            "d-card-body min-w-0 border-[var(--d-hairline)] px-[var(--d-pad)] py-3.5",
            // Phones and tablets: 2 × 2 — a right rule on the left column, a bottom rule on the first row.
            index % 2 === 0 && "border-r",
            index < 2 && "max-lg:border-b",
            // Desktop: one row, a rule between cells.
            "lg:border-b-0",
            index < cells.length - 1 ? "lg:border-r" : "lg:border-r-0",
          )}
        >
          {cell}
        </div>
      ))}
    </Card>
  );
}

/** A tile for the strip (bare: the strip is the card). */
export function Stat(props: Omit<StatTileProps, "bare">) {
  return <StatTile {...props} bare />;
}

/**
 * One of the two stacks of a transfer page's side column. On tablets the
 * column is two stacks side by side, so cards of different heights never
 * leave a hole in a shared row; on phones and beside the form (one column)
 * the stacks dissolve (`display: contents`) and the cards fall into one list
 * in DOM order, which is also the tab order: put the stacks' cards in the
 * order they should read.
 */
export const SIDE_STACK = "flex min-w-0 flex-col gap-[var(--d-gap)] max-md:contents lg:contents";
