"use client";

/**
 * Figures: Money, TokenAmount, Percent, Delta, BigNumber, AnimatedNumber and
 * the StatTile that combines them.
 *
 * All formatting goes through src/lib/format.ts, so these components only add
 * what text cannot: privacy (amounts read "••••" while the user hides
 * balances; the default comes from PrefsProvider and can be overridden per
 * use), an honest "—" with its reason for unknown values, and the full figure
 * on hover when a compact one is shown.
 *
 * What is masked: anything that reveals how much the user holds (fiat values,
 * token amounts, absolute deltas). What is not: prices, percentages and
 * relative changes, which say nothing about the size of a position.
 */

import Link from "next/link";
import { useEffect, useId, useRef, useState, type ReactNode } from "react";
import { Icon, type IconName } from "@/components/icons";
import { cn } from "@/lib/cn";
import {
  MASK,
  NO_VALUE,
  formatAmount,
  formatFiat,
  formatPercent,
  formatTokenAmount,
  type TokenAmountOptions,
} from "@/lib/format";
import { usePrefs } from "@/providers/PrefsProvider";
import { Skeleton } from "./Feedback";
import { InfoTip } from "./Overlay";
import { useReducedMotion } from "./hooks";

/** Privacy default: the prefs' hideAmounts unless the caller decides. */
function useMasked(masked: boolean | undefined): boolean {
  const { hideAmounts } = usePrefs();
  return masked ?? hideAmounts;
}

/** "—" with its reason on hover and for screen readers. */
function Unknown({ reason, className }: { reason?: string; className?: string }) {
  return (
    <span className={cn("text-fg-dim", className)} title={reason}>
      <span aria-hidden>{NO_VALUE}</span>
      <span className="sr-only">{reason ? `Unavailable: ${reason}` : "Unavailable"}</span>
    </span>
  );
}

function Masked({ className }: { className?: string }) {
  return (
    <span className={cn("tracking-[0.08em]", className)}>
      <span aria-hidden>{MASK}</span>
      <span className="sr-only">Hidden</span>
    </span>
  );
}

/* ------------------------------------------------------------------ money */

export interface MoneyProps {
  value: number | null | undefined;
  /** ISO code; default: the user's currency preference. */
  currency?: string;
  /** k / M / B from a thousand up; the exact figure shows on hover. */
  compact?: boolean;
  /** Fixed fraction digits instead of the smart precision. */
  precision?: number;
  /** "+$12.50" for positive values. */
  signed?: boolean;
  /** Override the privacy default (prefs.hideAmounts). */
  masked?: boolean;
  /** Why the value is unknown (shown with the "—"). */
  reason?: string;
  /** Tween between values (450 ms; instant under reduced motion). */
  animate?: boolean;
  className?: string;
}

/** A fiat value: "$1,234.56", "$0.0287", compact "$12.4k". */
export function Money({ value, currency, compact, precision, signed, masked, reason, animate, className }: MoneyProps) {
  const prefs = usePrefs();
  const hidden = useMasked(masked);
  const code = currency ?? prefs.currency;
  if (value === null || value === undefined || !Number.isFinite(value)) return <Unknown reason={reason} className={className} />;
  if (hidden) return <Masked className={className} />;
  const format = (n: number) => formatFiat(n, code, { compact, precision, signed });
  const full = compact ? formatFiat(value, code, { precision, signed }) : undefined;
  return (
    <span className={className} title={full !== format(value) ? full : undefined}>
      {animate ? <AnimatedNumber value={value} format={format} /> : format(value)}
    </span>
  );
}

/* ------------------------------------------------------------------ token amount */

export interface TokenAmountProps extends Omit<TokenAmountOptions, "signed"> {
  /**
   * Base units (an integer string or bigint) when `decimals` is given,
   * otherwise an amount already in display units (number or decimal string).
   */
  amount: number | string | bigint | null | undefined;
  /**
   * Present when `amount` is in base units: the token's exponent, or null
   * when nobody knows it (the amount then reads "N base units").
   */
  decimals?: number | null;
  /** Ticker after the amount, in dim text. Never masked. */
  symbol?: string;
  signed?: boolean;
  masked?: boolean;
  reason?: string;
  className?: string;
  symbolClassName?: string;
}

/**
 * A token amount, cut never rounded up: "12.345678 ATOM", "1.23M OSMO",
 * "12,340,000 base units". Masked with the privacy setting; the ticker stays.
 */
export function TokenAmount({
  amount,
  decimals,
  symbol,
  compact,
  maxFraction,
  minFraction,
  signed,
  masked,
  reason,
  className,
  symbolClassName,
}: TokenAmountProps) {
  const hidden = useMasked(masked);
  if (amount === null || amount === undefined) return <Unknown reason={reason} className={className} />;
  const options = { compact, maxFraction, minFraction, signed };
  const text =
    decimals !== undefined
      ? formatTokenAmount(amount, decimals, options)
      : typeof amount === "bigint"
        ? formatTokenAmount(amount, 0, options)
        : formatAmount(amount, options);
  if (text === NO_VALUE) return <Unknown reason={reason} className={className} />;
  // Unknown decimals already carry their unit ("base units"): the ticker
  // after it would read as if the number were whole tokens.
  const showSymbol = symbol && !(decimals === null);
  return (
    <span className={cn("whitespace-nowrap", className)}>
      {hidden ? <Masked /> : text}
      {showSymbol ? <span className={cn("ml-[0.3em] text-fg-dim", symbolClassName)}>{symbol}</span> : null}
    </span>
  );
}

/* ------------------------------------------------------------------ percent */

export interface PercentProps {
  /** In percent units: 12.3 means 12.3%. */
  value: number | null | undefined;
  signed?: boolean;
  /** Fraction digits (default 2). */
  digits?: number;
  reason?: string;
  className?: string;
}

export function Percent({ value, signed, digits, reason, className }: PercentProps) {
  if (value === null || value === undefined || !Number.isFinite(value)) return <Unknown reason={reason} className={className} />;
  return <span className={className}>{formatPercent(value, { signed, digits })}</span>;
}

/* ------------------------------------------------------------------ share bar */

export interface ShareBarProps {
  /** Share in percent units (41.2 means 41.2%); null when unknown. */
  value: number | null | undefined;
  /** Bar width in px (default 56). */
  width?: number;
  /** Fraction digits of the figure (default 1). */
  digits?: number;
  /** Show the figure after the bar (default true). */
  showValue?: boolean;
  reason?: string;
  className?: string;
}

/**
 * A share of a total: a short bar plus its percentage ("Share" columns,
 * allocation legends, the scope list). The bar is decoration; the figure is
 * the information, so the bar is hidden from assistive tech. Unknown reads
 * "—" with an empty track, never a 0% bar.
 */
export function ShareBar({ value, width = 56, digits = 1, showValue = true, reason, className }: ShareBarProps) {
  const known = value !== null && value !== undefined && Number.isFinite(value);
  const fill = known ? Math.min(100, Math.max(0, value)) : 0;
  return (
    <span className={cn("inline-flex items-center justify-end gap-2", className)}>
      <span aria-hidden className="h-1.5 shrink-0 overflow-hidden rounded-full bg-[var(--d-glass-2)]" style={{ width }}>
        {/* A sliver for any non-zero share, so 0.04% still shows it is there. */}
        <span className="block h-full rounded-full bg-[var(--viz-accent,var(--z-accent))]" style={{ width: fill > 0 ? `max(2px, ${fill}%)` : 0 }} />
      </span>
      {showValue ? <Percent value={known ? value : null} digits={digits} reason={reason} className="min-w-[3.25rem] text-right text-[13px] tabular-nums text-fg-muted" /> : null}
    </span>
  );
}

/* ------------------------------------------------------------------ delta */

export interface DeltaProps {
  /** The change; null renders a neutral "—". `pct` values are in percent units. */
  value: number | null | undefined;
  /** `pct` (default): "+2.31%". `abs`: a fiat change, "+$1.2k", masked with privacy. */
  kind?: "pct" | "abs";
  /** Which direction is good news (default "up"); fees and commission are "down". */
  goodWhen?: "up" | "down";
  size?: "sm" | "md";
  /** `text` (default) for tables; `pill` for a tinted chip in tiles. */
  variant?: "text" | "pill";
  /** A dim period label after the figure: "24h", "7d". */
  period?: string;
  /** Fraction digits for `pct` (default 2). */
  digits?: number;
  currency?: string;
  /**
   * Formatter for non-fiat `abs` deltas ("3 validators"). It receives the
   * signed value; a "+" is prepended to positive ones.
   */
  format?: (value: number) => string;
  /**
   * A change that is neither good nor bad news (how many transactions, how
   * much was sent): the arrow and the sign stay, the status colour does not.
   */
  neutral?: boolean;
  masked?: boolean;
  reason?: string;
  className?: string;
}

/**
 * A signed change with arrow, sign and colour (and a word for screen
 * readers), so colour is never the only carrier. Zero and unknown are
 * neutral, and so is any change the caller marks `neutral`.
 */
export function Delta({
  value,
  kind = "pct",
  goodWhen = "up",
  size = "sm",
  variant = "text",
  period,
  digits,
  currency,
  format,
  neutral,
  masked,
  reason,
  className,
}: DeltaProps) {
  const prefs = usePrefs();
  const hidden = useMasked(masked) && kind === "abs";
  const known = value !== null && value !== undefined && Number.isFinite(value);
  const direction = !known || value === 0 ? "flat" : value > 0 ? "up" : "down";
  const good = direction === "flat" || neutral ? null : direction === goodWhen;

  let text: string;
  if (!known) text = NO_VALUE;
  else if (kind === "pct") text = formatPercent(value, { signed: true, digits });
  else if (format) text = `${value > 0 ? "+" : ""}${format(value)}`;
  else text = formatFiat(value, currency ?? prefs.currency, { compact: Math.abs(value) >= 10_000, signed: true });

  // A neutral change that did happen reads a step stronger than "no change".
  const tone =
    good === null ? (direction === "flat" ? "text-fg-dim" : "text-fg-muted") : good ? "text-[var(--d-pos)]" : "text-[var(--d-neg)]";
  const pill =
    variant === "pill" &&
    (good === null
      ? "bg-[var(--d-glass-2)]"
      : good
        ? "bg-[var(--z-success-fill)]"
        : "bg-[var(--z-danger-fill)]");
  const iconSize = size === "sm" ? 10 : 12;

  return (
    <span
      className={cn(
        "inline-flex shrink-0 items-center gap-[3px] whitespace-nowrap font-medium tabular-nums leading-none",
        size === "sm" ? "text-[12.5px]" : "text-[14px]",
        tone,
        pill && cn("rounded-[6px] px-1.5", size === "sm" ? "h-5" : "h-6", pill),
        className,
      )}
    >
      {direction !== "flat" ? (
        <Icon name={direction === "up" ? "triUp" : "triDown"} size={iconSize} fill="currentColor" strokeWidth={1} className="shrink-0" />
      ) : null}
      {hidden ? <Masked /> : known ? <span>{text}</span> : <Unknown reason={reason} />}
      {direction !== "flat" ? <span className="sr-only">{direction === "up" ? "up" : "down"}</span> : null}
      {period ? <span className="ml-1 font-normal text-fg-dim">{period}</span> : null}
    </span>
  );
}

/* ------------------------------------------------------------------ animated number */

export interface AnimatedNumberProps {
  value: number;
  format: (value: number) => string;
  /** Tween length in ms (default 450). */
  duration?: number;
  /** Render "••••" instead (privacy). */
  masked?: boolean;
  className?: string;
}

const easeOutCubic = (t: number) => 1 - (1 - t) ** 3;

/**
 * Tweens from the previous value to the new one (spec §3: 450 ms). The first
 * render shows the real value at once: counting up from zero would show
 * numbers that were never true. Instant under reduced motion.
 */
export function AnimatedNumber({ value, format, duration = 450, masked, className }: AnimatedNumberProps) {
  const reduced = useReducedMotion();
  const [display, setDisplay] = useState(value);
  const shownRef = useRef(value);

  useEffect(() => {
    const from = shownRef.current;
    if (reduced || from === value || !Number.isFinite(from)) {
      shownRef.current = value;
      return;
    }
    let frame = 0;
    const start = performance.now();
    const tick = (now: number) => {
      // Clamped at both ends: a frame's timestamp is the time the frame
      // began, a little before `start` when this effect ran after that frame
      // had begun, and a negative t eases to a value past `from`, on the
      // wrong side of it, for one frame. A zero duration is the end.
      const t = duration > 0 ? Math.min(1, Math.max(0, (now - start) / duration)) : 1;
      const next = from + (value - from) * easeOutCubic(t);
      shownRef.current = next;
      setDisplay(next);
      if (t < 1) frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [value, reduced, duration]);

  if (masked) return <Masked className={className} />;
  // Reduced motion, or a frame where the tween has not started yet.
  const shown = reduced ? value : display;
  return (
    <span className={className}>
      <span aria-hidden>{format(shown)}</span>
      <span className="sr-only">{format(value)}</span>
    </span>
  );
}

/* ------------------------------------------------------------------ big number */

export interface BigNumberProps {
  value: ReactNode;
  loading?: boolean;
  /** `hero` 44px (48 wide, 34 phone), `lg` 32px, `md` 24px (KPI). */
  size?: "hero" | "lg" | "md";
  className?: string;
}

const BIG_SIZE = {
  hero: "text-[length:var(--d-type-hero)] tracking-[-0.04em]",
  lg: "text-[32px] tracking-[-0.035em]",
  md: "text-[length:var(--d-type-kpi)] tracking-[-0.03em]",
} as const;

/** One large standalone figure (proportional digits, spec §3). */
export function BigNumber({ value, loading, size = "hero", className }: BigNumberProps) {
  return (
    <div className={cn("font-semibold leading-[1.05] text-fg [font-variant-numeric:proportional-nums]", BIG_SIZE[size], className)}>
      {/* Inline, so the placeholder sits in a line of the figure's own font
          and line height: the block is exactly as tall loading as loaded.
          (As a block it was 0.82em tall, a third of the line, and the
          Overview hero jumped 30 px when its figure landed.) */}
      {loading ? <Skeleton className="inline-block h-[0.82em] w-[5.5ch] rounded-[8px]" /> : value}
    </div>
  );
}

/* ------------------------------------------------------------------ stat tile */

export type StatTone = "default" | "accent" | "positive" | "negative" | "warning";

export interface StatTileProps {
  label: ReactNode;
  /** The figure: usually a <Money/>, <TokenAmount/> or <Percent/>. */
  value: ReactNode;
  /** A dim line under the value: a count, a source, a reason. */
  sub?: ReactNode;
  delta?: {
    value: number | null;
    kind: "pct" | "abs";
    goodWhen?: "up" | "down";
    /** "24h", "7d". */
    period?: string;
    /** Neither direction is good or bad news: no status colour (see Delta). */
    neutral?: boolean;
  };
  /** A small trend line (oldest first). Shape only, no axes. */
  trend?: number[];
  /**
   * A visual at the right of the figure (a meter, a logo stack), in the
   * trend line's place: it stays out of `value`, so the figure keeps its
   * size and truncation.
   */
  trailing?: ReactNode;
  loading?: boolean;
  /**
   * A refresh is in flight: the figures stay on screen at 60%, like a
   * pending Card's body (spec §3: refetch keeps the previous frame).
   */
  pending?: boolean;
  /**
   * Makes the tile a link. With an `action` as well, the link is laid over
   * the tile and the action sits above it, so a "Claim all" click never
   * navigates and no button ends up nested inside an <a>.
   */
  href?: string;
  /** An (i) next to the label. */
  info?: ReactNode;
  /**
   * `accent` highlights an actionable figure (claimable rewards) with the
   * brand bloom; `positive` / `negative` / `warning` tint the trend line, and
   * `warning` also puts a dot before the label (needs attention).
   */
  tone?: StatTone;
  icon?: IconName;
  /**
   * A control in the tile's corner, e.g. a "Claim all" button. It is centred
   * on the label line and may overhang it, so a 32px button never pushes
   * the figure down out of line with the tiles next to it.
   */
  action?: ReactNode;
  /** Render without card chrome, to sit several tiles inside one card. */
  bare?: boolean;
  className?: string;
}


const TONE_TREND: Record<StatTone, string> = {
  default: "var(--viz-accent, var(--z-accent))",
  accent: "var(--viz-accent, var(--z-accent))",
  positive: "var(--d-pos)",
  negative: "var(--d-neg)",
  warning: "var(--z-warning)",
};

/** A KPI tile: label, value, delta, optional trend (or trailing visual) and action. */
export function StatTile({
  label,
  value,
  sub,
  delta,
  trend,
  trailing,
  loading,
  pending,
  href,
  info,
  tone = "default",
  icon,
  action,
  bare,
  className,
}: StatTileProps) {
  const labelId = useId();
  // A link laid over the whole tile when the tile also holds controls (the
  // action, the (i) button): wrapping them in the <a> would nest
  // interactive content and make their clicks navigate. The controls are
  // lifted above the overlay.
  const overlay = Boolean(href && (action || info));
  const body = (
    <>
      <div className="flex min-h-[20px] items-center gap-1.5">
        {/* Only "needs attention" earns a dot. A red dot before an accent
            tile's label read as "down", the same mark as a negative tile's,
            and the figure's own colour and signed delta already say
            positive or negative. */}
        {tone === "warning" ? <span aria-hidden className="size-1.5 shrink-0 rounded-full bg-[var(--z-warning)]" /> : null}
        {icon ? <Icon name={icon} size={15} className="shrink-0 text-fg-dim" /> : null}
        <span id={labelId} className="truncate text-[12.5px] font-medium text-fg-dim">
          {label}
        </span>
        {info ? (
          <InfoTip
            content={info}
            size={13}
            label={typeof label === "string" ? `About ${label}` : undefined}
            className={overlay ? "relative z-[1]" : undefined}
          />
        ) : null}
        {/* A fixed 20px box, centred: a taller control overhangs the label
            line evenly instead of growing it. */}
        {action ? <span className="relative z-[1] ml-auto flex h-5 shrink-0 items-center">{action}</span> : null}
      </div>
      <div
        className={cn(
          "mt-2 flex min-w-0 items-end justify-between gap-3 transition-opacity duration-[160ms] ease-[var(--d-ease)]",
          pending && "opacity-60",
        )}
      >
        <div className="min-w-0">
          <div className="truncate text-[length:var(--d-type-kpi)] font-semibold leading-[1.15] tracking-[-0.03em] text-fg">
            {loading ? <Skeleton className="my-[3px] h-[22px] w-[7ch] rounded-[7px]" /> : value}
          </div>
          {(delta || sub) && !loading ? (
            <div className="mt-1.5 flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1 text-[12.5px] leading-none text-fg-dim">
              {delta ? (
                <Delta value={delta.value} kind={delta.kind} goodWhen={delta.goodWhen} period={delta.period} neutral={delta.neutral} />
              ) : null}
              {sub ? <span className="min-w-0 truncate">{sub}</span> : null}
            </div>
          ) : loading && (delta || sub) ? (
            <Skeleton className="mt-2 h-3 w-[10ch]" />
          ) : null}
        </div>
        {loading ? null : trailing ? (
          <div className="flex shrink-0 items-end">{trailing}</div>
        ) : trend && trend.length > 1 ? (
          <TrendLine values={trend} color={TONE_TREND[tone]} />
        ) : null}
      </div>
    </>
  );

  const classes = cn(
    "relative flex min-w-0 flex-col text-left",
    !bare && "d-card p-[var(--d-pad)] [overflow:clip]",
    !bare && tone === "accent" && "d-card-hero",
    href && "transition-[border-color,background-color] duration-[160ms] hover:border-[var(--d-hairline-strong)] hover:bg-[var(--d-card-hover)]",
    className,
  );
  const busy = pending || undefined;
  if (href && overlay) {
    return (
      <div className={classes} aria-busy={busy}>
        <Link
          href={href}
          aria-labelledby={labelId}
          className="absolute inset-0 z-0 rounded-[inherit] focus-visible:outline-offset-[-2px]"
        />
        {body}
      </div>
    );
  }
  if (href) {
    return (
      <Link href={href} className={classes} aria-busy={busy}>
        {body}
      </Link>
    );
  }
  return (
    <div className={classes} aria-busy={busy}>
      {body}
    </div>
  );
}

/**
 * The tile's trend: a 72×28 line with a soft wash, scaled to its own min/max
 * (a portfolio moving from $10,000 to $10,300 must not draw flat). Decorative:
 * the tile's figures carry the information.
 */
function TrendLine({ values, color }: { values: number[]; color: string }) {
  const id = useId().replace(/[^a-zA-Z0-9_-]/g, "");
  const width = 72;
  const height = 28;
  const finite = values.filter((v) => Number.isFinite(v));
  if (finite.length < 2) return null;
  const min = Math.min(...finite);
  const max = Math.max(...finite);
  const span = max - min || 1;
  const step = width / (values.length - 1);
  const points = values.map((v, i) => [i * step, Number.isFinite(v) ? 2 + (height - 4) * (1 - (v - min) / span) : null] as const);
  let line = "";
  let started = false;
  let segments = 0;
  for (const [x, y] of points) {
    if (y === null) {
      started = false;
      continue;
    }
    if (!started) segments += 1;
    line += `${started ? "L" : "M"}${x.toFixed(1)} ${y.toFixed(1)}`;
    started = true;
  }
  // The wash closes down to the baseline under the line's own first and last
  // x; with gaps in the data (several segments) it would bridge them, so
  // only the line is drawn then.
  const drawn = points.filter((point) => point[1] !== null);
  const firstX = drawn[0]?.[0] ?? 0;
  const lastX = drawn[drawn.length - 1]?.[0] ?? width;
  const area = segments === 1 ? `${line}L${lastX.toFixed(1)} ${height}L${firstX.toFixed(1)} ${height}Z` : null;
  return (
    <svg width={width} height={height} viewBox={`0 0 ${width} ${height}`} aria-hidden className="shrink-0 overflow-visible">
      <defs>
        <linearGradient id={`trend-${id}`} x1="0" x2="0" y1="0" y2="1">
          <stop offset="0%" stopColor={color} stopOpacity={0.18} />
          <stop offset="100%" stopColor={color} stopOpacity={0} />
        </linearGradient>
      </defs>
      {area ? <path d={area} fill={`url(#trend-${id})`} /> : null}
      <path d={line} fill="none" stroke={color} strokeWidth={1.5} strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}
