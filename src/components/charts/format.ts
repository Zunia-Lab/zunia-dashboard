/**
 * Default number formatting for the chart kit.
 *
 * Callers own the real formatting (currency, token amounts) through
 * `valueFormatter` / `tickFormatter` props; these are the fallbacks a chart
 * uses when it is given nothing, so they stay unit-less. They are written by
 * hand rather than with `Intl`'s compact notation so the server and every
 * browser produce the same string (the aria summary is rendered on both), and
 * so thousands read "12.4k" the way the rest of the product writes them.
 */

/** U+2212: a real minus is as wide as the plus and the digits around it. */
export const MINUS = "−";

const UNITS = [
  { size: 1e12, suffix: "T" },
  { size: 1e9, suffix: "B" },
  { size: 1e6, suffix: "M" },
  { size: 1e3, suffix: "k" },
] as const;

const formatters = new Map<string, Intl.NumberFormat>();

function nf(key: string, options: Intl.NumberFormatOptions): Intl.NumberFormat {
  let f = formatters.get(key);
  if (!f) {
    f = new Intl.NumberFormat("en-US", options);
    formatters.set(key, f);
  }
  return f;
}

function significant(value: number, digits: number): string {
  return nf(`sig${digits}`, {
    maximumSignificantDigits: digits,
    useGrouping: false,
  }).format(value);
}

/** Rounds to `digits` significant digits without leaving the number domain. */
function roundSignificant(value: number, digits: number): number {
  return Number(value.toPrecision(digits));
}

/**
 * Compact, three significant digits: 0.0287, 1.79, 124, 12.4k, 1.24M, 3.1B.
 * Rounding that crosses a unit moves up a unit (999,960 is "1M", not "1000k").
 */
export function formatCompact(value: number, digits = 3): string {
  if (!Number.isFinite(value)) return "—";
  if (value === 0) return "0";
  const sign = value < 0 ? MINUS : "";
  const abs = Math.abs(value);
  // The unit comes from the rounded value, which is what moves 999,960 up.
  const rounded = roundSignificant(abs, digits);
  const unit = UNITS.find((u) => rounded >= u.size);
  if (!unit) return sign + significant(rounded, digits);
  const scaled = roundSignificant(abs / unit.size, digits);
  return sign + significant(scaled, digits) + unit.suffix;
}

/**
 * The fuller default for a hovered value: grouping and two decimals above 1,
 * four significant digits below it (prices like 0.02873 keep their meaning),
 * compact past a million.
 */
export function formatValue(value: number): string {
  if (!Number.isFinite(value)) return "—";
  if (value === 0) return "0";
  const sign = value < 0 ? MINUS : "";
  const abs = Math.abs(value);
  if (abs >= 1e6) return sign + formatCompact(abs, 3);
  if (abs >= 1) {
    return sign + nf("fixed2", { maximumFractionDigits: 2 }).format(abs);
  }
  return sign + nf("sig4", { maximumSignificantDigits: 4 }).format(abs);
}

/** A share of a whole, given as a fraction: 0.234 → "23.4%". */
export function formatShare(fraction: number): string {
  if (!Number.isFinite(fraction)) return "—";
  if (fraction > 0 && fraction < 0.001) return "<0.1%";
  if (fraction >= 0.9995 && fraction < 1) return ">99.9%";
  const pct = Math.abs(fraction * 100);
  const whole = pct === 100 || pct === 0;
  const text = nf(whole ? "pct0" : "pct1", {
    minimumFractionDigits: whole ? 0 : 1,
    maximumFractionDigits: whole ? 0 : 1,
  }).format(pct);
  return (fraction < 0 ? MINUS : "") + text + "%";
}

/** A signed change, given as a fraction: 0.124 → "+12.4%", −0.03 → "−3.0%". */
export function formatSignedPercent(fraction: number): string {
  if (!Number.isFinite(fraction)) return "—";
  const pct = Math.abs(fraction * 100);
  const text = nf("pct1fixed", {
    minimumFractionDigits: 1,
    maximumFractionDigits: 1,
  }).format(pct);
  if (text === "0.0") return "0.0%";
  return (fraction < 0 ? MINUS : "+") + text + "%";
}

/**
 * A tick formatter for one axis. Every label gets the same unit and the same
 * number of decimals, derived from the tick step, so a column of labels lines
 * up and never shows "12k, 12.5k, 13k". Thousands only go compact from 10k
 * up: "1,500" reads better than "1.5k" on an axis that tops out there.
 */
export function makeTickFormat(
  ticks: readonly number[],
  step: number,
): (value: number) => string {
  let maxAbs = 0;
  for (const t of ticks) maxAbs = Math.max(maxAbs, Math.abs(t));
  const unit =
    maxAbs >= 1e4 ? (UNITS.find((u) => maxAbs >= u.size) ?? null) : null;
  const size = unit?.size ?? 1;
  const suffix = unit?.suffix ?? "";
  const relative = Math.abs(step) / size;
  const decimals =
    Number.isFinite(relative) && relative > 0
      ? Math.min(8, Math.max(0, -Math.floor(Math.log10(relative) + 1e-9)))
      : 0;
  const f = nf(`tick${decimals}`, {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  });
  return (value: number) => {
    if (!Number.isFinite(value)) return "—";
    const scaled = Math.abs(value) / size;
    const text = f.format(scaled);
    if (Number(text.replace(/,/g, "")) === 0) return "0";
    return (value < 0 ? MINUS : "") + text + suffix;
  };
}

/**
 * Puts a unit around a formatted number, outside its sign, the way the rest
 * of the product writes money: ("−50", "$") is "−$50", ("12.5", "", "%") is
 * "12.5%". Wrapping a signed label by hand ("$" + "−50") would read "$−50".
 */
export function affixUnit(text: string, prefix = "", suffix = ""): string {
  const sign = text.startsWith(MINUS) || text.startsWith("-") || text.startsWith("+") ? text[0] : "";
  return `${sign}${prefix}${text.slice(sign.length)}${suffix}`;
}
