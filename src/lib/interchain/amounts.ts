/**
 * Base units in, display strings out.
 *
 * Every amount that touches a chain is an integer string of base units, because
 * a `number` loses digits above 2^53 and a token with 18 decimals passes that
 * with 9 whole coins. Nothing here converts through `Number` except the final
 * grouping of an already-truncated integer part.
 *
 * `usePortfolio.formatAmount` is the compact form for dashboards ("20.34k").
 * These are the exact forms for a transfer screen, where rounding a balance up
 * would let the user try to send more than they hold.
 */

/**
 * Parse a user-typed decimal into base units.
 *
 * Returns `null` — never a silently truncated value — when the input is not a
 * plain decimal or carries more fraction digits than the token has. Accepting
 * `1.0000001` on a 6-decimal token by dropping the tail would send a different
 * amount from the one on screen.
 */
export function toBaseUnits(input: string, decimals: number): string | null {
  const value = input.trim();
  if (value === "" || value === ".") return null;
  if (!/^\d*\.?\d*$/.test(value)) return null;
  if (!Number.isInteger(decimals) || decimals < 0 || decimals > 30) return null;
  const [whole = "0", fraction = ""] = value.split(".");
  if (fraction.length > decimals) return null;
  const digits = `${whole || "0"}${fraction.padEnd(decimals, "0")}`;
  // Strip leading zeros without going through Number.
  const trimmed = digits.replace(/^0+(?=\d)/, "");
  return trimmed;
}

/**
 * Render base units as a decimal string, exactly.
 *
 * Trailing zeros in the fraction are dropped, but nothing is rounded: the
 * output re-parses to the same base units.
 */
export function fromBaseUnits(base: string, decimals: number): string {
  const value = base.trim();
  if (!/^\d+$/.test(value)) return "0";
  if (!Number.isInteger(decimals) || decimals <= 0) return value;
  const padded = value.padStart(decimals + 1, "0");
  const whole = padded.slice(0, padded.length - decimals);
  const fraction = padded.slice(padded.length - decimals).replace(/0+$/, "");
  return fraction.length > 0 ? `${whole}.${fraction}` : whole;
}

/**
 * Render base units for reading: grouped thousands, at most `maxFraction`
 * decimals, and a leading `~` is the caller's job — this rounds down, so the
 * number shown is never more than the user has.
 */
export function formatUnits(
  base: string,
  decimals: number,
  maxFraction = 6,
): string {
  const exact = fromBaseUnits(base, decimals);
  const [whole = "0", fraction = ""] = exact.split(".");
  const grouped = whole.replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  if (fraction.length === 0 || maxFraction <= 0) return grouped;
  const cut = fraction.slice(0, maxFraction).replace(/0+$/, "");
  return cut.length > 0 ? `${grouped}.${cut}` : grouped;
}

/** `formatUnits` with the symbol appended, for a single label. */
export function formatToken(
  base: string,
  decimals: number,
  symbol: string,
  maxFraction = 6,
): string {
  const amount = formatUnits(base, decimals, maxFraction);
  return symbol ? `${amount} ${symbol}` : amount;
}

/** True when `base` is a positive integer amount. */
export function isPositiveAmount(base: string): boolean {
  return /^\d+$/.test(base) && base !== "0" && /[1-9]/.test(base);
}

/** `a > b` for two base-unit strings. Neither is converted to a number. */
export function exceeds(a: string, b: string): boolean {
  if (!/^\d+$/.test(a) || !/^\d+$/.test(b)) return false;
  return BigInt(a) > BigInt(b);
}

/**
 * A human rate line, e.g. `1 ATOM ≈ 8.4213 OSMO`.
 *
 * Returns `null` when either side is zero, rather than dividing by it or
 * printing an infinity. The panel then omits the rate row, which is the honest
 * answer to "we cannot express this yet".
 */
export function rateLine(params: {
  inputAmount: string;
  inputDecimals: number;
  inputSymbol: string;
  outputAmount: string;
  outputDecimals: number;
  outputSymbol: string;
}): string | null {
  if (!/^\d+$/.test(params.inputAmount) || !/^\d+$/.test(params.outputAmount)) {
    return null;
  }
  const zero = BigInt(0);
  const input = BigInt(params.inputAmount);
  const output = BigInt(params.outputAmount);
  if (input === zero || output === zero) return null;

  // Rate in display units = (out / 10^outDec) / (in / 10^inDec). Computed with
  // a fixed 6-digit scale in integer arithmetic so a large token pair does not
  // go through a float. Written as `BigInt(...)` rather than `1n` because this
  // package targets ES2017, where the literal syntax is not available.
  const scale = BigInt(1_000_000);
  const ten = BigInt(10);
  const numerator = output * ten ** BigInt(params.inputDecimals) * scale;
  const denominator = input * ten ** BigInt(params.outputDecimals);
  if (denominator === zero) return null;
  const scaled = numerator / denominator;
  const rate = fromBaseUnits(scaled.toString(), 6);
  const [whole = "0", fraction = ""] = rate.split(".");
  const shown = fraction.length > 0 ? `${whole}.${fraction.slice(0, 4)}` : whole;
  return `1 ${params.inputSymbol} ≈ ${shown} ${params.outputSymbol}`;
}
