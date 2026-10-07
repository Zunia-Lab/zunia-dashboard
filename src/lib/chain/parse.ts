/**
 * Narrowing for LCD payloads, which arrive as `unknown`.
 *
 * Public nodes run many SDK versions behind many gateways, and the same field
 * shows up as a string on one chain, a number on another and a base64 blob on
 * a third. Every reader in `@/lib/chain/*` goes through these helpers so a
 * surprising payload becomes `null` (shown as "—" with a reason) instead of a
 * `NaN`, a thrown error, or worst of all a confident wrong number.
 *
 * Pure and dependency-free: imported by the server and by `node --test`.
 */

import type { Coin } from "./types";

export function rec(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

export function arr(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

/** A non-empty string after trimming, or null. */
export function str(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed ? trimmed : null;
}

export function bool(value: unknown): boolean | null {
  if (typeof value === "boolean") return value;
  if (value === "true") return true;
  if (value === "false") return false;
  return null;
}

/** A path segment from a payload, e.g. `a.b.c`. */
export function pick(value: unknown, path: readonly string[]): unknown {
  let current: unknown = value;
  for (const key of path) {
    const record = rec(current);
    if (!record) return undefined;
    current = record[key];
  }
  return current;
}

const DECIMAL = /^-?\d+(\.\d+)?$/;
const BASE64 = /^[A-Za-z0-9+/]+={0,2}$/;

function decodeBase64Ascii(value: string): string | null {
  if (value.length % 4 !== 0 || !BASE64.test(value)) return null;
  try {
    if (typeof atob === "function") return atob(value);
  } catch {
    return null;
  }
  return null;
}

/**
 * A cosmos `Dec` as a number.
 *
 * Accepts `"0.334000000000000000"`, `"1"`, a JSON number, and the base64 form
 * some gateways emit for gogoproto `bytes`-typed decimals (the ASCII digits of
 * the value × 10¹⁸, e.g. `"MzM0MDAwMDAwMDAwMDAwMDAw"` for 0.334).
 */
export function parseDec(value: unknown): number | null {
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  const text = str(value);
  if (!text) return null;
  if (DECIMAL.test(text)) {
    const parsed = Number(text);
    return Number.isFinite(parsed) ? parsed : null;
  }
  const ascii = decodeBase64Ascii(text);
  if (ascii && /^\d+$/.test(ascii)) {
    const parsed = Number(ascii) / 1e18;
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

/** An integer that fits a JS number (heights, counts, windows). */
export function parseIntSafe(value: unknown): number | null {
  if (typeof value === "number") return Number.isSafeInteger(value) ? value : null;
  const text = str(value);
  if (!text || !/^-?\d+$/.test(text)) return null;
  const parsed = Number(text);
  return Number.isSafeInteger(parsed) ? parsed : null;
}

/**
 * A base-unit amount as an integer string, decimals truncated.
 *
 * Rewards arrive as `"503521.100598716310000000"`; only whole base units can
 * ever be withdrawn, so the fraction is dropped rather than rounded up.
 */
export function intString(value: unknown): string | null {
  const text = typeof value === "number" && Number.isFinite(value) ? String(value) : str(value);
  if (!text || !DECIMAL.test(text) || text.startsWith("-")) return null;
  const whole = text.split(".")[0] ?? "0";
  const normalised = whole.replace(/^0+(?=\d)/, "");
  return normalised || "0";
}

/** Base-unit amount as a bigint (decimals truncated), or null. */
export function toBigInt(value: unknown): bigint | null {
  const text = intString(value);
  return text === null ? null : BigInt(text);
}

/** Sum of base-unit amounts; unreadable entries count as zero. */
export function sumAmounts(values: ReadonlyArray<string | null | undefined>): string {
  let total = BigInt(0);
  for (const value of values) {
    const parsed = toBigInt(value);
    if (parsed !== null) total += parsed;
  }
  return total.toString();
}

/** `a ÷ b` for big amounts, as a float; null when either is unknown or b is 0. */
export function ratio(
  numerator: string | number | bigint | null | undefined,
  denominator: string | number | bigint | null | undefined,
): number | null {
  if (numerator === null || numerator === undefined) return null;
  if (denominator === null || denominator === undefined) return null;
  const n = Number(numerator);
  const d = Number(denominator);
  if (!Number.isFinite(n) || !Number.isFinite(d) || d <= 0) return null;
  return n / d;
}

/** A protobuf Duration as seconds: `"1209600s"`, `"0.5s"`, or `{ seconds }`. */
export function parseDurationSeconds(value: unknown): number | null {
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  const text = str(value);
  if (text) {
    const match = /^(\d+(?:\.\d+)?)s$/.exec(text);
    if (match) return Number(match[1]);
    if (/^\d+$/.test(text)) return Number(text);
    return null;
  }
  const record = rec(value);
  if (record) {
    const seconds = parseIntSafe(record.seconds);
    if (seconds === null) return null;
    const nanos = parseIntSafe(record.nanos) ?? 0;
    return seconds + nanos / 1e9;
  }
  return null;
}

/**
 * An ISO timestamp, or null for the sentinels chains use for "never"
 * (`1970-01-01T00:00:00Z`, Go's zero time `0001-01-01T00:00:00Z`).
 */
export function parseTime(value: unknown): string | null {
  const text = str(value);
  if (!text) return null;
  const at = Date.parse(text);
  if (!Number.isFinite(at) || at <= 86_400_000) return null;
  return text;
}

/** `[{denom, amount}]` with amounts truncated to whole base units. */
export function coins(value: unknown): Coin[] {
  const out: Coin[] = [];
  for (const item of arr(value)) {
    const record = rec(item);
    const denom = str(record?.denom);
    const amount = intString(record?.amount);
    if (denom && amount !== null) out.push({ denom, amount });
  }
  return out;
}

/** Last path segment of a type URL: `/cosmos.bank.v1beta1.MsgSend` → `MsgSend`. */
export function shortTypeName(typeUrl: string): string {
  const tail = typeUrl.split(/[./]/).filter(Boolean).pop();
  return tail ?? typeUrl;
}

/** `pagination.next_key` when there is a next page. */
export function nextKey(payload: unknown): string | null {
  return str(pick(payload, ["pagination", "next_key"]));
}

/** A website from `description.website`: http(s) only, else null. */
export function safeWebsite(raw: unknown): string | null {
  const value = str(raw);
  if (!value) return null;
  try {
    const url = new URL(value.includes("://") ? value : `https://${value}`);
    if (url.protocol !== "http:" && url.protocol !== "https:") return null;
    return url.href;
  } catch {
    return null;
  }
}

/** Trims a free-text field to `max` characters (chain strings are unbounded). */
export function clip(value: string | null, max: number): string | null {
  if (value === null) return null;
  return value.length > max ? `${value.slice(0, max - 1)}…` : value;
}
