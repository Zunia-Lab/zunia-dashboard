"use client";

/**
 * Detail blocks: KeyValueList (the label / value rows of review cards, tx
 * and validator details) and Disclosure (folded "Transaction details", raw
 * JSON, an insight's "why").
 *
 * Both exist so every page lays these out the same way: review cards are
 * where a user checks what they are about to sign, and they should read
 * identically on Send, Swap, Stake and Vote.
 */

import type { ReactNode } from "react";
import { Icon } from "@/components/icons";
import { cn } from "@/lib/cn";
import { InfoTip } from "./Overlay";

/* ------------------------------------------------------------------ key / value */

export interface KeyValueItem {
  /** Stable React key (default: the row's index). */
  key?: string;
  label: ReactNode;
  value: ReactNode;
  /** An (i) after the label: how the figure is computed, where it comes from. */
  info?: ReactNode;
  /** A dim line under the value ("≈ $12.40", "after the 0.5% Zunia fee"). */
  sub?: ReactNode;
  /** A stronger value (totals, "You receive"). */
  emphasis?: boolean;
}

export interface KeyValueListProps {
  items: KeyValueItem[];
  /** Hairlines between rows (review cards). */
  divided?: boolean;
  /** Label above value instead of side by side (narrow columns, long values). */
  stacked?: boolean;
  className?: string;
}

/**
 * Label / value rows as a description list: labels dim on the left, values
 * right-aligned with tabular digits so amounts line up. Values wrap (long
 * addresses, memos) rather than overflow.
 */
export function KeyValueList({ items, divided, stacked, className }: KeyValueListProps) {
  return (
    <dl className={cn("flex min-w-0 flex-col text-[13.5px]", divided ? "divide-y divide-[var(--d-hairline)]" : "gap-2", className)}>
      {items.map((item, index) => (
        <div
          key={item.key ?? index}
          className={cn(
            "flex min-w-0",
            stacked ? "flex-col gap-0.5" : "items-baseline justify-between gap-4",
            divided && "py-2.5 first:pt-0 last:pb-0",
          )}
        >
          <dt className="flex min-w-0 shrink-0 items-center gap-1 text-fg-dim">
            {item.label}
            {item.info ? <InfoTip content={item.info} size={13} /> : null}
          </dt>
          <dd className={cn("min-w-0 break-words tabular-nums", stacked ? "text-left" : "text-right", item.emphasis ? "font-semibold text-fg" : "text-fg")}>
            {item.value}
            {item.sub ? <span className="mt-0.5 block text-[12px] font-normal text-fg-dim">{item.sub}</span> : null}
          </dd>
        </div>
      ))}
    </dl>
  );
}

/* ------------------------------------------------------------------ disclosure */

export interface DisclosureProps {
  /** The always-visible line ("Transaction details", "Why?"). */
  summary: ReactNode;
  children: ReactNode;
  defaultOpen?: boolean;
  /** Told when the user opens or closes it. */
  onOpenChange?: (open: boolean) => void;
  /** `plain` (default): a text toggle. `inset`: a nested block with a frame. */
  variant?: "plain" | "inset";
  className?: string;
}

/**
 * A native <details>: keyboard, screen readers and find-in-page work without
 * script, and the folded content is still in the document. Problems a user
 * must see before signing are never put in one.
 */
export function Disclosure({ summary, children, defaultOpen, onOpenChange, variant = "plain", className }: DisclosureProps) {
  const inset = variant === "inset";
  return (
    <details
      open={defaultOpen}
      onToggle={(event) => onOpenChange?.(event.currentTarget.open)}
      className={cn("group min-w-0", inset && "rounded-[var(--d-radius-inner)] bg-[var(--d-card-2)]", className)}
    >
      <summary
        className={cn(
          "flex cursor-pointer list-none items-center gap-1.5 text-[13px] font-medium text-fg-muted transition-colors duration-[160ms] hover:text-fg",
          "[&::-webkit-details-marker]:hidden",
          // The plain summary is a ~20px line of text: d-hit gives it a 44px
          // target on touch screens without moving anything.
          inset ? "rounded-[var(--d-radius-inner)] px-3.5 py-2.5" : "d-hit w-fit rounded-[6px]",
        )}
      >
        <Icon name="chevronRight" size={14} strokeWidth={2} className="shrink-0 transition-transform duration-[160ms] group-open:rotate-90" />
        {summary}
      </summary>
      <div className={cn("min-w-0 text-[13px] text-fg-muted", inset ? "px-3.5 pb-3.5" : "pt-2")}>{children}</div>
    </details>
  );
}
