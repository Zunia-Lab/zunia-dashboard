/**
 * The dashboard's one formatting module: fiat, plain numbers, compact
 * magnitudes, token amounts, percentages, times, durations and identifiers.
 *
 * Every page and component formats through here so a figure reads the same on
 * Overview, in a table cell and in a toast. Rules the whole product follows:
 *
 * - **Unknown is not zero.** `null`, `undefined` and non-finite input render
 *   as {@link NO_VALUE} ("—"); the caller says why next to it.
 * - **Non-zero never reads as zero.** A price of $0.000012 keeps its digits
 *   (smart precision), and a dust balance that would print as "0.00" prints
 *   "<0.01" instead.
 * - **Token amounts are cut, never rounded up.** A balance of 0.9999999 never
 *   reads 1.00 and then fails at Max; digits come from integer arithmetic on
 *   base units, never from a float (18-decimal balances exceed 2^53).
 * - **Unknown decimals are not guessed.** A token whose exponent nobody knows
 *   is shown as "12,340,000 base units", never scaled or compacted.
 * - **Negatives use U+2212 (−)**, the same width as "+" and the digits in
 *   Space Grotesk, so signed columns line up; the chart kit does the same.
 *
 * Locale is en-US throughout (spec: "Numbers: en-US formatting"). Pure module:
 * no React, no I/O, safe to import from node:test.
 *
 * Partly ported from zunia-extension lib/format.ts and lib/token-amount.ts
 * @ 1453e7a (smart small-price precision, the cut-not-round amount policy,
 * "base units" for unknown decimals, relative-time wording).
 */

/** U+2212 MINUS SIGN: as wide as "+" and the figures, unlike the hyphen. */
export const MINUS = "\u2212";

/** What every surface shows when a figure is unknown. */
export const NO_VALUE = "\u2014";

/** What an amount reads while the user hides balances (PrefsProvider.mask). */
export const MASK = "\u2022\u2022\u2022\u2022";

/** The words after a raw amount whose decimals are unknown. */
export const BASE_UNITS = "base units";

const LOCALE = "en-US";

/* -------------------------------------------------------------------------- */
/* Intl caches                                                                 */
/* -------------------------------------------------------------------------- */

const numberFormats = new Map<string, Intl.NumberFormat>();

function numberFormat(minFraction: number, maxFraction: number): Intl.NumberFormat {
  const key = `${minFraction}:${maxFraction}`;
  let format = numberFormats.get(key);
  if (!format) {
    format = new Intl.NumberFormat(LOCALE, {
      minimumFractionDigits: minFraction,
      maximumFractionDigits: maxFraction,
    });
    numberFormats.set(key, format);
  }
  return format;
}

const significantFormats = new Map<number, Intl.NumberFormat>();

function significantFormat(digits: number): Intl.NumberFormat {
  let format = significantFormats.get(digits);
  if (!format) {
    format = new Intl.NumberFormat(LOCALE, { maximumSignificantDigits: digits });
    significantFormats.set(digits, format);
  }
  return format;
}

interface CurrencyInfo {
  symbol: string;
  /** ISO 4217 minor units: 2 for USD/EUR/GBP, 0 for JPY. */
  minor: number;
}

const currencyInfos = new Map<string, CurrencyInfo>();

function currencyInfo(currency: string): CurrencyInfo {
  const code = currency.trim().toUpperCase();
  let info = currencyInfos.get(code);
  if (info) return info;
  try {
    const format = new Intl.NumberFormat(LOCALE, {
      style: "currency",
      currency: code,
      currencyDisplay: "narrowSymbol",
    });
    const symbol = format.formatToParts(0).find((part) => part.type === "currency")?.value ?? code;
    info = {
      // An alphabetic symbol ("CHF") needs a space before the digits.
      symbol: /[A-Za-z]$/.test(symbol) ? `${symbol}\u00a0` : symbol,
      minor: format.resolvedOptions().maximumFractionDigits ?? 2,
    };
  } catch {
    // Not an ISO code Intl knows: show the code itself rather than a "$" that
    // would claim a currency the number is not in.
    info = { symbol: `${code}\u00a0`, minor: 2 };
  }
  currencyInfos.set(code, info);
  return info;
}

/** The narrow symbol for a currency code: "$", "€", "£", "¥", "CHF ". */
export function currencySymbol(currency = "usd"): string {
  return currencyInfo(currency).symbol;
}

/* -------------------------------------------------------------------------- */
/* Shared number helpers                                                       */
/* -------------------------------------------------------------------------- */

function isNumber(value: number | null | undefined): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

/** Drops trailing fraction zeros past `keep` digits: ("0.500", 2) → "0.50". */
function trimFraction(text: string, keep: number): string {
  const dot = text.indexOf(".");
  if (dot === -1) return text;
  let end = text.length;
  while (end > dot + 1 + keep && text[end - 1] === "0") end -= 1;
  if (end === dot + 1) end = dot;
  return text.slice(0, end);
}

/** Inserts en-US thousands separators into a string of digits. */
function groupDigits(digits: string): string {
  return digits.replace(/\B(?=(\d{3})+(?!\d))/g, ",");
}

/**
 * Fraction digits that show `significant` significant figures of `abs`
 * (0 < abs < 1), so 0.0287 keeps "0.0287" and 0.000012 keeps "0.000012".
 */
function smallFractionDigits(abs: number, significant: number): number {
  return significant - 1 - Math.floor(Math.log10(abs));
}

/** The smallest positive number the small-value path will still print. */
const SMALLEST_SHOWN = 1e-8;
const SMALLEST_SHOWN_TEXT = "0.00000001";

const COMPACT_UNITS: ReadonlyArray<readonly [size: number, suffix: string]> = [
  [1e12, "T"],
  [1e9, "B"],
  [1e6, "M"],
  [1e3, "k"],
];

/**
 * `abs` (≥ 0) in compact form with `digits` significant figures, trailing
 * zeros trimmed: 12,431 → "12.4k", 999,960 → "1M" (the unit is chosen from
 * the rounded value, so a number never reads "1000k"). Null when `abs` is
 * below a thousand and no unit applies.
 */
function compactMagnitude(abs: number, digits: number): string | null {
  const rounded = Number(abs.toPrecision(digits));
  const unit = COMPACT_UNITS.find(([size]) => rounded >= size);
  if (!unit) return null;
  const [size, suffix] = unit;
  const scaled = Number((abs / size).toPrecision(digits));
  return `${significantFormat(digits).format(scaled)}${suffix}`;
}

function signOf(value: number, signed: boolean | undefined): string {
  if (value < 0) return MINUS;
  return signed && value > 0 ? "+" : "";
}

/* -------------------------------------------------------------------------- */
/* Fiat                                                                        */
/* -------------------------------------------------------------------------- */

export interface FiatOptions {
  /** k / M / B / T from a thousand up: "$12.4k", "$1.24M". */
  compact?: boolean;
  /** Fixed fraction digits, overriding the smart precision below. */
  precision?: number;
  /** "+$12.50" for positive values (negatives always carry "−"). */
  signed?: boolean;
}

/**
 * A fiat value: "$1,234.56", "$0.0287", "$0.000012", compact "$12.4k".
 *
 * Smart precision: the currency's minor units from 1 up; below 1, three
 * significant figures (never fewer than the minor units), so a three-cent
 * price stays "$0.0287" instead of "$0.03" and SAF's sub-cent price keeps its
 * meaning. Below $0.00000001 it reads "<$0.00000001", never "$0.00".
 */
export function formatFiat(
  value: number | null | undefined,
  currency = "usd",
  options: FiatOptions = {},
): string {
  if (!isNumber(value)) return NO_VALUE;
  const { symbol, minor } = currencyInfo(currency);
  const sign = signOf(value, options.signed);
  const abs = Math.abs(value);

  if (options.compact) {
    const compact = compactMagnitude(abs, 3);
    if (compact) return `${sign}${symbol}${compact}`;
  }

  if (options.precision !== undefined) {
    const digits = clampDigits(options.precision);
    const text = numberFormat(digits, digits).format(abs);
    // Fixed precision may still swallow a non-zero value ($0.004 at 2 digits).
    if (abs > 0 && Number(text.replace(/,/g, "")) === 0) {
      return `${sign}<${symbol}${minimumAtDigits(digits)}`;
    }
    return `${sign}${symbol}${text}`;
  }

  if (abs === 0) return `${symbol}${numberFormat(minor, minor).format(0)}`;
  if (abs >= 1) return `${sign}${symbol}${numberFormat(minor, minor).format(abs)}`;
  if (abs < SMALLEST_SHOWN) return `${sign}<${symbol}${SMALLEST_SHOWN_TEXT}`;

  const digits = Math.min(8, Math.max(minor, smallFractionDigits(abs, 3)));
  const text = trimFraction(abs.toFixed(digits), minor);
  return `${sign}${symbol}${text}`;
}

function clampDigits(digits: number): number {
  return Number.isInteger(digits) ? Math.min(12, Math.max(0, digits)) : 2;
}

/** "0.01" for 2 digits, "1" for 0: the smallest step a precision can show. */
function minimumAtDigits(digits: number): string {
  return digits > 0 ? `0.${"0".repeat(digits - 1)}1` : "1";
}

/* -------------------------------------------------------------------------- */
/* Plain numbers                                                               */
/* -------------------------------------------------------------------------- */

export interface NumberOptions {
  /** Most fraction digits shown (default 2). */
  maxFraction?: number;
  /** Fewest fraction digits shown (default 0). */
  minFraction?: number;
  /** Delegate to {@link formatCompact}. */
  compact?: boolean;
  /** "+" before positive values. */
  signed?: boolean;
}

/**
 * A plain en-US number: "1,234.57", "42", "−3.5".
 *
 * A non-zero value that `maxFraction` would print as zero keeps two
 * significant figures instead (0.0042 at 2 digits reads "0.0042", not
 * "0.00"); below 0.00000001 it reads "<0.00000001".
 */
export function formatNumber(value: number | null | undefined, options: NumberOptions = {}): string {
  if (!isNumber(value)) return NO_VALUE;
  if (options.compact) return formatCompact(value, { signed: options.signed });
  const maxFraction = clampDigits(options.maxFraction ?? 2);
  const minFraction = Math.min(maxFraction, clampDigits(options.minFraction ?? 0));
  const sign = signOf(value, options.signed);
  const abs = Math.abs(value);
  const text = numberFormat(minFraction, maxFraction).format(abs);
  if (abs > 0 && Number(text.replace(/,/g, "")) === 0) {
    if (abs < SMALLEST_SHOWN) return `${sign}<${SMALLEST_SHOWN_TEXT}`;
    const digits = Math.min(8, smallFractionDigits(abs, 2));
    return `${sign}${trimFraction(abs.toFixed(digits), minFraction)}`;
  }
  return `${abs === 0 ? "" : sign}${text}`;
}

export interface CompactOptions {
  /** Significant figures (default 3). */
  digits?: number;
  signed?: boolean;
}

/**
 * Compact magnitude with three significant figures: "0.0287", "1.79",
 * "124", "12.4k", "1.24M", "3.1B". Same output as the chart kit's default
 * formatter, so an axis and the table under it agree.
 */
export function formatCompact(value: number | null | undefined, options: CompactOptions = {}): string {
  if (!isNumber(value)) return NO_VALUE;
  if (value === 0) return "0";
  const digits = Math.min(6, Math.max(1, Math.round(options.digits ?? 3)));
  const sign = signOf(value, options.signed);
  const abs = Math.abs(value);
  const compact = compactMagnitude(abs, digits);
  if (compact) return `${sign}${compact}`;
  if (abs < SMALLEST_SHOWN) return `${sign}<${SMALLEST_SHOWN_TEXT}`;
  return `${sign}${significantFormat(digits).format(Number(abs.toPrecision(digits)))}`;
}

/* -------------------------------------------------------------------------- */
/* Token amounts                                                               */
/* -------------------------------------------------------------------------- */

export interface TokenAmountOptions {
  /**
   * Most fraction digits shown, cut (never rounded up). Default 6, or 2 with
   * `compact`. Trailing zeros are trimmed down to `minFraction`.
   */
  maxFraction?: number;
  /** Pad the fraction to at least this many digits, so a column lines up. */
  minFraction?: number;
  /** k / M / B / T from a thousand whole tokens up, also cut: "1.23M". */
  compact?: boolean;
  /** "+" before positive amounts. */
  signed?: boolean;
}

const TEN = BigInt(10);
const ZERO = BigInt(0);

/** A signed integer in canonical form, or null when `amount` is not one. */
function baseUnitsOf(amount: string | bigint | number): bigint | null {
  if (typeof amount === "bigint") return amount;
  if (typeof amount === "number") {
    if (!Number.isFinite(amount) || !Number.isInteger(amount)) return null;
    return BigInt(amount);
  }
  const text = amount.trim();
  return /^-?\d+$/.test(text) ? BigInt(text) : null;
}

/** A display exponent fit for integer arithmetic, or null when it is not one. */
function exponentOf(decimals: number): number | null {
  // 77 digits is the size of a uint256; anything past it is not an exponent.
  return Number.isInteger(decimals) && decimals >= 0 && decimals <= 77 ? decimals : null;
}

/**
 * Base units to a display amount, cut never rounded up:
 * `formatTokenAmount("12345678", 6)` → "12.345678",
 * `formatTokenAmount("1234567890000", 6, { compact: true })` → "1.23M",
 * `formatTokenAmount("12340000", null)` → "12,340,000 base units".
 *
 * `decimals: null` (or an exponent that cannot be one) means nobody knows the
 * token's exponent, so the raw integer is shown with its unit: scaling it by a
 * guess could make twelve tokens read as twelve million. Input that is not an
 * integer amount of base units renders {@link NO_VALUE}.
 */
export function formatTokenAmount(
  amount: string | bigint | number | null | undefined,
  decimals: number | null,
  options: TokenAmountOptions = {},
): string {
  if (amount === null || amount === undefined) return NO_VALUE;
  const units = baseUnitsOf(amount);
  if (units === null) return NO_VALUE;
  const negative = units < ZERO;
  const magnitude = negative ? -units : units;
  const sign = negative ? MINUS : options.signed && magnitude > ZERO ? "+" : "";

  const exponent = decimals === null ? null : exponentOf(decimals);
  if (exponent === null) {
    const unit = magnitude === BigInt(1) ? "base unit" : BASE_UNITS;
    return `${sign}${groupDigits(magnitude.toString())} ${unit}`;
  }

  const maxFraction = clampDigits(options.maxFraction ?? (options.compact ? 2 : 6));
  const minFraction = Math.min(maxFraction, clampDigits(options.minFraction ?? 0));

  let shift = 0;
  let suffix = "";
  if (options.compact) {
    const whole = magnitude / TEN ** BigInt(exponent);
    for (const [size, unit] of COMPACT_UNITS) {
      const unitExponent = Math.round(Math.log10(size));
      if (whole >= TEN ** BigInt(unitExponent)) {
        shift = unitExponent;
        suffix = unit;
        break;
      }
    }
  }

  const scale = TEN ** BigInt(exponent + shift);
  const whole = magnitude / scale;
  const fullFraction = exponent + shift > 0 ? (magnitude % scale).toString().padStart(exponent + shift, "0") : "";
  let fraction = fullFraction.slice(0, maxFraction);
  // Trim trailing zeros, then pad back to the minimum the caller asked for.
  fraction = fraction.replace(/0+$/, "");
  if (fraction.length < minFraction) fraction = fraction.padEnd(minFraction, "0");

  if (magnitude > ZERO && whole === ZERO && !/[1-9]/.test(fraction)) {
    // A dust amount: say how small, never "0".
    return `${sign}<${minimumAtDigits(maxFraction)}`;
  }

  const wholeText = suffix ? whole.toString() : groupDigits(whole.toString());
  return `${sign}${wholeText}${fraction ? `.${fraction}` : ""}${suffix}`;
}

/**
 * A token amount already in display units ("12.5" ATOM, a number or a
 * decimal string), with {@link formatTokenAmount}'s cut-never-round policy:
 * `formatAmount(0.9999999)` → "0.999999", never "1". A decimal string keeps
 * every digit it carries. A number is read as the shortest decimal that is
 * that float (`String(n)`: 2999.7 is "2999.7"), never its exact binary
 * expansion: `(2999.7).toFixed(20)` is "2999.69999999999981810106", and
 * cutting that printed "2,999.69" for an amount the user knows as 2,999.7.
 * Exponent notation ("1e-7", what `String(0.0000001)` produces) is expanded
 * exactly rather than rejected.
 */
export function formatAmount(value: number | string | null | undefined, options: TokenAmountOptions = {}): string {
  if (value === null || value === undefined) return NO_VALUE;
  let text: string;
  if (typeof value === "number") {
    if (!Number.isFinite(value)) return NO_VALUE;
    const abs = Math.abs(value);
    if (abs >= 1e21) {
      // Whole numbers that size print as "2e+21" with a fraction of none;
      // BigInt spells every digit.
      text = BigInt(Math.trunc(value)).toString();
    } else if (abs > 0 && abs < 1e-20) {
      // Dust at any precision a screen shows, kept non-zero ("<0.000001"):
      // a three-digit exponent ("5e-324") is past what expandExponent reads.
      text = `${value < 0 ? "-" : ""}0.${"0".repeat(19)}1`;
    } else {
      const shortest = String(value);
      text = expandExponent(shortest) ?? shortest;
    }
  } else {
    text = value.trim();
    text = expandExponent(text) ?? text;
  }
  const match = /^(-?)(\d*)(?:\.(\d*))?$/.exec(text);
  if (!match) return NO_VALUE;
  const [, minus, whole = "", fraction = ""] = match;
  if (whole === "" && fraction === "") return NO_VALUE;
  return formatTokenAmount(`${minus}${whole || "0"}${fraction}`, fraction.length, options);
}

/* -------------------------------------------------------------------------- */
/* Percentages                                                                 */
/* -------------------------------------------------------------------------- */

export interface PercentOptions {
  /** "+2.31%" for positive values. */
  signed?: boolean;
  /** Fraction digits (default 2). */
  digits?: number;
}

/**
 * A percentage given **in percent units** (12.3 means 12.3%, the way Numia's
 * `price_24h_change` and every APR on screen read): "12.30%", "+2.31%",
 * "−0.50%". A ratio must be multiplied by 100 first. Non-zero values that
 * would print as zero read "<0.01%"; from 1,000% up the fraction is dropped.
 */
export function formatPercent(value: number | null | undefined, options: PercentOptions = {}): string {
  if (!isNumber(value)) return NO_VALUE;
  const abs = Math.abs(value);
  const digits = abs >= 1000 ? 0 : clampDigits(options.digits ?? 2);
  const text = numberFormat(digits, digits).format(abs);
  const sign = signOf(value, options.signed);
  if (abs > 0 && Number(text.replace(/,/g, "")) === 0) {
    return `${sign}<${minimumAtDigits(digits)}%`;
  }
  return `${abs === 0 ? "" : sign}${text}%`;
}

/* -------------------------------------------------------------------------- */
/* Time                                                                        */
/* -------------------------------------------------------------------------- */

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

/**
 * "just now", "4 min ago", "3 h ago", "2 d ago", or a date past 30 days;
 * "in 5 min", "in 3 d" for moments ahead. Units are floored, so "2 h ago"
 * means at least two hours and a deadline never reads further away than it
 * is.
 */
export function formatRelativeTime(ms: number | null | undefined, now: number = Date.now()): string {
  if (!isNumber(ms) || !Number.isFinite(now)) return NO_VALUE;
  const diff = now - ms;
  const future = diff < 0;
  const abs = Math.abs(diff);
  if (abs < 45_000) return future ? "in under a minute" : "just now";
  let text: string;
  if (abs < HOUR) text = `${Math.max(1, Math.floor(abs / MINUTE))} min`;
  else if (abs < DAY) text = `${Math.floor(abs / HOUR)} h`;
  else if (abs < 30 * DAY) text = `${Math.floor(abs / DAY)} d`;
  else return formatDate(ms, "short", { now });
  return future ? `in ${text}` : `${text} ago`;
}

export type DateStyle = "short" | "long" | "datetime" | "time";

export interface DateOptions {
  /** IANA zone; defaults to the runtime's (the viewer's, in the browser). */
  timeZone?: string;
  /** "Now" for the same-year check of the short style. */
  now?: number;
}

const dateFormats = new Map<string, Intl.DateTimeFormat>();

function dateFormat(key: string, options: Intl.DateTimeFormatOptions): Intl.DateTimeFormat {
  let format = dateFormats.get(key);
  if (!format) {
    format = new Intl.DateTimeFormat(LOCALE, options);
    dateFormats.set(key, format);
  }
  return format;
}

/**
 * - `short`: "Oct 7" this year, "Oct 7, 2025" otherwise;
 * - `long`: "October 7, 2026";
 * - `datetime`: "Oct 7, 2026, 2:32 PM";
 * - `time`: "2:32 PM".
 */
export function formatDate(
  ms: number | null | undefined,
  style: DateStyle = "short",
  options: DateOptions = {},
): string {
  // ICU versions disagree on the space before AM/PM (U+0020 in some, U+202F
  // in others), so the server's string and the browser's could differ and
  // trip hydration. One no-break space everywhere keeps "2:32 PM" together.
  return dateText(ms, style, options).replace(/\s(?=[AP]M\b)/g, "\u00a0");
}

function dateText(ms: number | null | undefined, style: DateStyle, options: DateOptions): string {
  if (!isNumber(ms)) return NO_VALUE;
  const date = new Date(ms);
  if (Number.isNaN(date.getTime())) return NO_VALUE;
  const zone = options.timeZone;
  const tz = zone ? { timeZone: zone } : {};
  switch (style) {
    case "long":
      return dateFormat(`long:${zone}`, { year: "numeric", month: "long", day: "numeric", ...tz }).format(date);
    case "datetime":
      return dateFormat(`datetime:${zone}`, {
        year: "numeric",
        month: "short",
        day: "numeric",
        hour: "numeric",
        minute: "2-digit",
        ...tz,
      }).format(date);
    case "time":
      return dateFormat(`time:${zone}`, { hour: "numeric", minute: "2-digit", ...tz }).format(date);
    case "short":
    default: {
      const yearOf = dateFormat(`year:${zone}`, { year: "numeric", ...tz });
      const sameYear = yearOf.format(date) === yearOf.format(new Date(options.now ?? Date.now()));
      return sameYear
        ? dateFormat(`md:${zone}`, { month: "short", day: "numeric", ...tz }).format(date)
        : dateFormat(`ymd:${zone}`, { year: "numeric", month: "short", day: "numeric", ...tz }).format(date);
    }
  }
}

export interface DurationOptions {
  /** `short` (default): "3 h 20 min"; `long`: "3 hours 20 minutes". */
  style?: "short" | "long";
}

const DURATION_UNITS: ReadonlyArray<readonly [seconds: number, short: string, long: string]> = [
  [86_400, "d", "day"],
  [3_600, "h", "hour"],
  [60, "min", "minute"],
  [1, "s", "second"],
];

/**
 * A length of time in seconds, two units at most: "21 d", "3 h 20 min",
 * "45 s", "5.8 s" (a block time keeps one decimal under ten seconds). With
 * `style: "long"`: "21 days", "3 hours 20 minutes".
 */
export function formatDuration(seconds: number | null | undefined, options: DurationOptions = {}): string {
  if (!isNumber(seconds) || seconds < 0) return NO_VALUE;
  const long = options.style === "long";
  const name = (count: number, unit: (typeof DURATION_UNITS)[number]) =>
    long ? `${count} ${unit[2]}${count === 1 ? "" : "s"}` : `${count} ${unit[1]}`;

  if (seconds < 10) {
    const rounded = Math.round(seconds * 10) / 10;
    const text = Number.isInteger(rounded) ? String(rounded) : rounded.toFixed(1);
    return long ? `${text} second${rounded === 1 ? "" : "s"}` : `${text} s`;
  }

  let rest = Math.round(seconds);
  const parts: string[] = [];
  for (const unit of DURATION_UNITS) {
    if (parts.length === 2) break;
    const count = Math.floor(rest / unit[0]);
    rest -= count * unit[0];
    if (count > 0) parts.push(name(count, unit));
    // Two units means adjacent units: "2 d 4 h", never "2 d 30 s".
    else if (parts.length === 1) break;
  }
  return parts.join(" ");
}

/* -------------------------------------------------------------------------- */
/* Identifiers                                                                 */
/* -------------------------------------------------------------------------- */

const BECH32 = /^([a-z][a-z0-9_-]*)1[02-9ac-hj-np-z]{6,}$/;

/**
 * "cosmos1gv86…vy4f": the head, an ellipsis, the tail.
 *
 * Bech32-aware: the head never stops inside the human-readable prefix, which
 * is how "addr_safro1gv86…" used to come out as "addr_saf…" and lose both the
 * chain and the address. At least the prefix, the separator and four data
 * characters are kept; `head` is the minimum. Short strings stay whole.
 */
export function shortenAddress(address: string | null | undefined, head = 8, tail = 4): string {
  if (!address) return NO_VALUE;
  const value = address.trim();
  const match = BECH32.exec(value);
  const lead = match ? Math.max(head, match[1].length + 1 + 4) : head;
  if (value.length <= lead + tail + 1) return value;
  return `${value.slice(0, lead)}\u2026${value.slice(-tail)}`;
}

/** "A1B2C3…9F0E" for a transaction hash. */
export function shortenHash(hash: string | null | undefined, head = 6, tail = 4): string {
  if (!hash) return NO_VALUE;
  const value = hash.trim();
  if (value.length <= head + tail + 1) return value;
  return `${value.slice(0, head)}\u2026${value.slice(-tail)}`;
}

/* -------------------------------------------------------------------------- */
/* Amount input                                                                */
/* -------------------------------------------------------------------------- */

const MAX_INPUT_LENGTH = 40;

/**
 * Exponent notation spelled out by moving the decimal point along the digit
 * string (exact, no float): "1e-7" \u2192 "0.0000001", "1.5E3" \u2192 "1500",
 * "-2.5e-3" \u2192 "-0.0025". Null when `text` is not a number in exponent
 * notation. The exponent is capped at two digits, which covers every token
 * exponent (18 at most in practice) without letting "1e999999" build a
 * million-character string.
 */
function expandExponent(text: string): string | null {
  const match = /^([+-]?)(\d*)(?:\.(\d*))?[eE]([+-]?\d{1,2})$/.exec(text);
  if (!match) return null;
  const [, sign, intPart = "", fracPart = "", exponentText = "0"] = match;
  if (intPart === "" && fracPart === "") return null;
  const digits = `${intPart}${fracPart}`;
  // Where the decimal point lands inside `digits` once the exponent applies.
  const point = intPart.length + Number(exponentText);
  let whole: string;
  let fraction: string;
  if (point <= 0) {
    whole = "0";
    fraction = `${"0".repeat(-point)}${digits}`;
  } else if (point >= digits.length) {
    whole = `${digits}${"0".repeat(point - digits.length)}`;
    fraction = "";
  } else {
    whole = digits.slice(0, point);
    fraction = digits.slice(point);
  }
  whole = whole.replace(/^0+(?=\d)/, "");
  return `${sign === "-" ? "-" : ""}${whole}${fraction ? `.${fraction}` : ""}`;
}

/**
 * What an amount field may hold after a keystroke or a paste: digits and at
 * most one ".", leading zeros dropped, and no more fraction digits than the
 * token has (`decimals`), cut rather than rounded.
 *
 * Both "." and "," are accepted as the decimal separator. When both appear
 * (a pasted "1,234.56" or "1.234,56") the last one is the decimal separator
 * and the other is grouping. A single kind repeated with groups of exactly
 * three digits ("1,234,567") is grouping; otherwise the first separator wins
 * and later ones are dropped, which is what a stray second "." while typing
 * should do. A lone "1,234" therefore reads 1.234: of the two readings it is
 * the smaller amount, so a wrong guess under-sends instead of sending a
 * thousand times too much. `decimals: 0` allows no fraction at all.
 *
 * A whole value in exponent notation ("1e-7", "2.5e3", what `String(n)`
 * gives for small and large numbers, e.g. a Max computed as a float) is
 * expanded exactly first; stripping its letters instead would turn
 * 0.0000001 into 17.
 */
export function sanitizeDecimalInput(raw: string, decimals?: number | null): string {
  let text = raw.replace(/[\s\u00a0'_]/g, "").slice(0, MAX_INPUT_LENGTH * 2);
  text = expandExponent(text) ?? text;
  const lastDot = text.lastIndexOf(".");
  const lastComma = text.lastIndexOf(",");

  if (lastDot !== -1 && lastComma !== -1) {
    const decimalSep = lastDot > lastComma ? "." : ",";
    const groupSep = decimalSep === "." ? "," : ".";
    text = text.split(groupSep).join("");
    const at = text.lastIndexOf(decimalSep);
    text = `${text.slice(0, at).split(decimalSep).join("")}.${text.slice(at + 1)}`;
  } else {
    const sep = lastDot !== -1 ? "." : lastComma !== -1 ? "," : null;
    if (sep) {
      const groups = text.split(sep);
      const isGrouping =
        groups.length > 2 && groups.slice(1).every((group) => /^\d{3}$/.test(group)) && /^\d{1,3}$/.test(groups[0]);
      text = isGrouping ? groups.join("") : `${groups[0]}.${groups.slice(1).join("")}`;
    }
  }

  // Digits and the first "." only.
  let seenDot = false;
  let out = "";
  for (const char of text) {
    if (char >= "0" && char <= "9") out += char;
    else if (char === "." && !seenDot) {
      seenDot = true;
      out += ".";
    }
  }

  let [whole = "", fraction] = out.split(".");
  whole = whole.replace(/^0+(?=\d)/, "");
  if (fraction !== undefined) {
    if (whole === "") whole = "0";
    const limit = decimals === null || decimals === undefined ? undefined : Math.max(0, Math.floor(decimals));
    if (limit === 0) return whole.slice(0, MAX_INPUT_LENGTH);
    if (limit !== undefined) fraction = fraction.slice(0, limit);
    return `${whole}.${fraction}`.slice(0, MAX_INPUT_LENGTH);
  }
  return whole.slice(0, MAX_INPUT_LENGTH);
}
