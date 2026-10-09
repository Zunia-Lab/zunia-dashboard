"use client";

/**
 * The strip of figures at the top of a transfer page: one card, up to four
 * bare tiles split by hairlines (two by two on phones). Each tile says what
 * its figure covers in its sub line; a figure the reads cannot back is "—"
 * with the reason.
 *
 * The columns follow the number of tiles (the Lite view passes fewer, as
 * `null` children), so a strip of two never ends in an empty half.
 */

import { Children, type ReactNode } from "react";
import { Card, StatTile, type StatTileProps } from "@/components/ui";
import { cn } from "@/lib/cn";

/** Literal classes (Tailwind only generates what it can read in the source). */
const DESKTOP_COLUMNS: Readonly<Record<number, string>> = { 1: "lg:grid-cols-1", 2: "lg:grid-cols-2", 3: "lg:grid-cols-3", 4: "lg:grid-cols-4" };

/**
 * `pending`: a refetch is in flight; the figures stay on screen, dimmed
 * (spec §3), instead of flashing back to skeletons.
 */
export function StatStrip({ children, pending, className }: { children: ReactNode; pending?: boolean; className?: string }) {
  const cells = Children.toArray(children);
  const count = cells.length;
  const rows = Math.ceil(count / 2);
  return (
    <Card padding="none" pending={pending} className={cn("grid gap-0 grid-cols-2", DESKTOP_COLUMNS[Math.min(4, Math.max(1, count))], className)}>
      {cells.map((cell, index) => {
        // An odd last tile takes the whole row on phones and tablets.
        const alone = count % 2 === 1 && index === count - 1;
        return (
          <div
            key={index}
            className={cn(
              "d-card-body min-w-0 border-[var(--d-hairline)] px-[var(--d-pad)] py-3.5",
              // Phones and tablets: two by two — a right rule on the left column, a bottom rule above the last row.
              index % 2 === 0 && !alone && "max-lg:border-r",
              alone && "max-lg:col-span-2",
              Math.floor(index / 2) < rows - 1 && "max-lg:border-b",
              // Desktop: one row, a rule between cells.
              index < count - 1 && "lg:border-r",
            )}
          >
            {cell}
          </div>
        );
      })}
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
