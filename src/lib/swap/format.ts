/**
 * The few amount renderings the swap engine writes into sentences: review
 * problems, message summaries, the default memo, and a quote's rate.
 *
 * Exact and never rounded up (the dashboard's amount policy, see
 * src/lib/interchain/amounts.ts): a displayed amount re-parses to at most what
 * it stands for. A token whose decimals are unknown is written in base units
 * and says so, rather than at a guessed scale.
 */

import { formatUnits } from "@/lib/interchain/amounts";

/** What an amount is written with: the token's ticker and exponent (`null` when unknown). */
export interface AmountLabel {
  readonly ticker: string;
  readonly decimals: number | null;
}

/** `12.5 OSMO`, or `12500000 base units of IBC·498A` when the exponent is unknown. */
export function tickerAmount(amount: string | bigint, label: AmountLabel): string {
  const base = typeof amount === "bigint" ? amount.toString() : amount;
  if (!/^\d+$/.test(base)) return `${base} ${label.ticker}`;
  if (label.decimals === null || !Number.isInteger(label.decimals) || label.decimals < 0) {
    return `${base} base units of ${label.ticker}`;
  }
  return `${formatUnits(base, label.decimals, Math.min(label.decimals, 8))} ${label.ticker}`;
}

/**
 * A positive ratio as a short decimal: six significant digits after any
 * leading zeros, never exponent notation (`0.0000003514`, `28.4516`).
 */
export function ratioText(value: number): string | null {
  if (!Number.isFinite(value) || value <= 0) return null;
  if (value >= 1e15) return value.toFixed(0);
  const magnitude = Math.floor(Math.log10(value));
  const decimals = Math.max(0, Math.min(20, 5 - magnitude));
  const fixed = value.toFixed(decimals);
  return fixed.includes(".") ? fixed.replace(/0+$/, "").replace(/\.$/, "") : fixed;
}

/**
 * A quote's own rate in display units, both ways (`toPerFrom`: how much of the
 * To one From buys). `null` on a side whose decimals are unknown, or when
 * either amount is zero: an unscaled ratio would be off by orders of magnitude.
 */
export function rateOf(
  amountIn: string,
  decimalsIn: number | null,
  amountOut: string,
  decimalsOut: number | null,
): { toPerFrom: string | null; fromPerTo: string | null } {
  const none = { toPerFrom: null, fromPerTo: null };
  if (decimalsIn === null || decimalsOut === null) return none;
  if (!/^\d+$/.test(amountIn) || !/^\d+$/.test(amountOut)) return none;
  const input = Number(amountIn) / 10 ** decimalsIn;
  const output = Number(amountOut) / 10 ** decimalsOut;
  if (!(input > 0) || !(output > 0)) return none;
  return { toPerFrom: ratioText(output / input), fromPerTo: ratioText(input / output) };
}
