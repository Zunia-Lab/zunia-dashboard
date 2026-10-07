"use client";

/**
 * How long the price on screen stays signable: a ring that empties over the
 * quote's 20 seconds, the seconds left, and a refresh button. The page asks
 * for a new price on its own when the ring runs out (useSwapQuote), so the
 * clock is information, not a chore.
 *
 * Not a live region: a countdown read aloud every second would drown
 * everything else. The accessible name carries the state instead.
 */

import { IconButton, Spinner } from "@/components/ui";
import { cn } from "@/lib/cn";
import { QUOTE_TTL_MS } from "@/lib/data/swap";

export type QuoteClockState = "idle" | "loading" | "live" | "refreshing" | "expired";

export interface QuoteClockProps {
  state: QuoteClockState;
  secondsLeft: number | null;
  onRefresh: () => void;
  className?: string;
}

const RADIUS = 7;
const CIRCUMFERENCE = 2 * Math.PI * RADIUS;
const TTL_SECONDS = Math.round(QUOTE_TTL_MS / 1000);

export function QuoteClock({ state, secondsLeft, onRefresh, className }: QuoteClockProps) {
  const left = secondsLeft ?? 0;
  const fraction = state === "live" ? Math.max(0, Math.min(1, left / TTL_SECONDS)) : state === "expired" ? 0 : 1;
  const text =
    state === "live"
      ? `${left}s`
      : state === "expired"
        ? "Expired"
        : state === "idle"
          ? "No price"
          : state === "loading"
            ? "Pricing"
            : "Updating";
  const label =
    state === "live"
      ? `Price valid for ${left} more seconds. Refresh the price`
      : state === "expired"
        ? "Price expired. Refresh the price"
        : state === "loading" || state === "refreshing"
          ? "Getting a new price"
          : "Refresh the price";
  return (
    <div className={cn("inline-flex items-center gap-1 rounded-full bg-[var(--d-glass)] py-0.5 pl-2 pr-0.5", className)}>
      {state === "loading" || state === "refreshing" ? (
        <Spinner size={14} className="text-fg-dim" />
      ) : (
        <svg width={18} height={18} viewBox="0 0 18 18" aria-hidden className="-rotate-90">
          <circle cx={9} cy={9} r={RADIUS} fill="none" stroke="var(--d-hairline-strong)" strokeWidth={2} />
          <circle
            cx={9}
            cy={9}
            r={RADIUS}
            fill="none"
            // Neutral while the price is good (a red ring reads as an alarm);
            // amber only in its last seconds, when it means something.
            stroke={state === "expired" || (state === "live" && left <= 5) ? "var(--z-warning)" : "var(--z-fg-muted)"}
            strokeWidth={2}
            strokeLinecap="round"
            strokeDasharray={CIRCUMFERENCE}
            strokeDashoffset={CIRCUMFERENCE * (1 - fraction)}
            className="transition-[stroke-dashoffset] duration-1000 ease-linear motion-reduce:transition-none"
          />
        </svg>
      )}
      <span
        className={cn(
          "min-w-[3.2em] font-mono text-[11px] font-medium tabular-nums tracking-[0.02em]",
          state === "expired" ? "text-[var(--z-warning)]" : "text-fg-muted",
        )}
      >
        {text}
      </span>
      <IconButton
        label={label}
        tooltip="Refresh the price"
        icon="refresh"
        size="sm"
        variant="ghost"
        disabled={state === "idle" || state === "loading" || state === "refreshing"}
        onClick={onRefresh}
        className="size-7 rounded-full"
      />
    </div>
  );
}
