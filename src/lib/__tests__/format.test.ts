/**
 * The dashboard's formatting rules. Prices in this ecosystem are small (OSMO
 * around three cents, SAF a fraction of a cent), so the cases that matter are
 * at both ends: a three-cent price must keep its digits, a whale balance must
 * compact, a dust balance must never read as zero, and nothing about a token
 * amount may round up.
 */

import assert from "node:assert/strict";
import { test } from "node:test";

import {
  BASE_UNITS,
  MINUS,
  NO_VALUE,
  currencySymbol,
  formatAmount,
  formatCompact,
  formatDate,
  formatDuration,
  formatFiat,
  formatNumber,
  formatPercent,
  formatRelativeTime,
  formatTokenAmount,
  sanitizeDecimalInput,
  shortenAddress,
  shortenHash,
} from "../format";

test("formatFiat: two decimals from 1 up, grouped", () => {
  assert.equal(formatFiat(1234.5), "$1,234.50");
  assert.equal(formatFiat(1.79), "$1.79");
  assert.equal(formatFiat(1), "$1.00");
  assert.equal(formatFiat(0), "$0.00");
  assert.equal(formatFiat(-12.5), `${MINUS}$12.50`);
});

test("formatFiat: small prices keep three significant figures", () => {
  assert.equal(formatFiat(0.028734), "$0.0287");
  assert.equal(formatFiat(0.000012), "$0.000012");
  assert.equal(formatFiat(0.00028), "$0.00028");
  assert.equal(formatFiat(0.5), "$0.50");
  assert.equal(formatFiat(0.999), "$0.999");
  assert.equal(formatFiat(0.0000000001), "<$0.00000001");
  assert.equal(formatFiat(-0.0287), `${MINUS}$0.0287`);
});

test("formatFiat: compact from a thousand up, unit chosen after rounding", () => {
  assert.equal(formatFiat(12_431, "usd", { compact: true }), "$12.4k");
  assert.equal(formatFiat(1_240_000, "usd", { compact: true }), "$1.24M");
  assert.equal(formatFiat(3_100_000_000, "usd", { compact: true }), "$3.1B");
  assert.equal(formatFiat(999_960, "usd", { compact: true }), "$1M");
  assert.equal(formatFiat(1500, "usd", { compact: true }), "$1.5k");
  // Below a thousand compact changes nothing: cents still matter there.
  assert.equal(formatFiat(523.12, "usd", { compact: true }), "$523.12");
  assert.equal(formatFiat(0.0287, "usd", { compact: true }), "$0.0287");
});

test("formatFiat: signed, precision, currencies and unknowns", () => {
  assert.equal(formatFiat(12.5, "usd", { signed: true }), "+$12.50");
  assert.equal(formatFiat(-12.5, "usd", { signed: true }), `${MINUS}$12.50`);
  assert.equal(formatFiat(0, "usd", { signed: true }), "$0.00");
  assert.equal(formatFiat(1234.5678, "usd", { precision: 0 }), "$1,235");
  assert.equal(formatFiat(0.004, "usd", { precision: 2 }), "<$0.01");
  assert.equal(formatFiat(12.5, "eur"), "€12.50");
  assert.equal(formatFiat(12.5, "GBP"), "£12.50");
  assert.equal(formatFiat(1234.5, "jpy"), "¥1,235");
  assert.equal(formatFiat(12.5, "chf"), "CHF\u00a012.50");
  assert.equal(formatFiat(null), NO_VALUE);
  assert.equal(formatFiat(undefined), NO_VALUE);
  assert.equal(formatFiat(Number.NaN), NO_VALUE);
  assert.equal(formatFiat(Number.POSITIVE_INFINITY), NO_VALUE);
  assert.equal(currencySymbol("usd"), "$");
});

test("formatNumber: grouping, fraction bounds, no false zeros", () => {
  assert.equal(formatNumber(1234.5678), "1,234.57");
  assert.equal(formatNumber(42), "42");
  assert.equal(formatNumber(42, { minFraction: 2 }), "42.00");
  assert.equal(formatNumber(1234.5678, { maxFraction: 0 }), "1,235");
  assert.equal(formatNumber(0.0042), "0.0042");
  assert.equal(formatNumber(-0.0042), `${MINUS}0.0042`);
  assert.equal(formatNumber(3, { signed: true }), "+3");
  assert.equal(formatNumber(-3.5), `${MINUS}3.5`);
  assert.equal(formatNumber(0, { signed: true }), "0");
  assert.equal(formatNumber(12_431, { compact: true }), "12.4k");
  assert.equal(formatNumber(null), NO_VALUE);
});

test("formatCompact matches the chart kit's default formatter", () => {
  assert.equal(formatCompact(0), "0");
  assert.equal(formatCompact(0.028734), "0.0287");
  assert.equal(formatCompact(1.7912), "1.79");
  assert.equal(formatCompact(124.4), "124");
  assert.equal(formatCompact(12_431), "12.4k");
  assert.equal(formatCompact(1_240_000), "1.24M");
  assert.equal(formatCompact(3_100_000_000), "3.1B");
  assert.equal(formatCompact(2_500_000_000_000), "2.5T");
  assert.equal(formatCompact(-12_431), `${MINUS}12.4k`);
  assert.equal(formatCompact(12_431, { signed: true }), "+12.4k");
  assert.equal(formatCompact(Number.NaN), NO_VALUE);
});

test("formatTokenAmount: base units to display, cut never rounded up", () => {
  assert.equal(formatTokenAmount("12345678", 6), "12.345678");
  assert.equal(formatTokenAmount("999999", 6, { maxFraction: 2 }), "0.99");
  assert.equal(formatTokenAmount("1999999", 6, { maxFraction: 0 }), "1");
  assert.equal(formatTokenAmount("1000000", 6), "1");
  assert.equal(formatTokenAmount("1500000", 6, { minFraction: 2 }), "1.50");
  assert.equal(formatTokenAmount("1234567000000", 6), "1,234,567");
  assert.equal(formatTokenAmount(BigInt("12345678"), 6), "12.345678");
  assert.equal(formatTokenAmount(12_345_678, 6), "12.345678");
  assert.equal(formatTokenAmount("0", 6), "0");
  assert.equal(formatTokenAmount("-2500000", 6), `${MINUS}2.5`);
  assert.equal(formatTokenAmount("2500000", 6, { signed: true }), "+2.5");
  assert.equal(formatTokenAmount("42", 0), "42");
});

test("formatTokenAmount: 18 decimals past 2^53 stay exact", () => {
  assert.equal(formatTokenAmount("1234567890123456789", 18), "1.234567");
  assert.equal(formatTokenAmount("1234567890123456789012", 18, { maxFraction: 4 }), "1,234.5678");
});

test("formatTokenAmount: compact is cut too", () => {
  assert.equal(formatTokenAmount("1234567890000", 6, { compact: true }), "1.23M");
  assert.equal(formatTokenAmount("1999999999999", 6, { compact: true }), "1.99M");
  assert.equal(formatTokenAmount("12345678", 6, { compact: true }), "12.34");
  assert.equal(formatTokenAmount("999999999", 6, { compact: true }), "999.99");
  assert.equal(formatTokenAmount("1000000000", 6, { compact: true }), "1k");
});

test("formatTokenAmount: dust never reads as zero", () => {
  assert.equal(formatTokenAmount("1", 6), "0.000001");
  assert.equal(formatTokenAmount("1", 6, { maxFraction: 2 }), "<0.01");
  assert.equal(formatTokenAmount("1", 18), "<0.000001");
  assert.equal(formatTokenAmount("-1", 18), `${MINUS}<0.000001`);
});

test("formatTokenAmount: unknown decimals show base units, never a guess", () => {
  assert.equal(formatTokenAmount("12340000", null), `12,340,000 ${BASE_UNITS}`);
  assert.equal(formatTokenAmount("1", null), "1 base unit");
  assert.equal(formatTokenAmount("12340000", -1), `12,340,000 ${BASE_UNITS}`);
  assert.equal(formatTokenAmount("12340000", 1.5), `12,340,000 ${BASE_UNITS}`);
});

test("formatTokenAmount: input that is not base units is unknown", () => {
  assert.equal(formatTokenAmount("1.5", 6), NO_VALUE);
  assert.equal(formatTokenAmount("abc", 6), NO_VALUE);
  assert.equal(formatTokenAmount(1.5, 6), NO_VALUE);
  assert.equal(formatTokenAmount(null, 6), NO_VALUE);
});

test("formatAmount: display units with the same cut policy", () => {
  assert.equal(formatAmount(0.9999999), "0.999999");
  assert.equal(formatAmount(0.1), "0.1");
  assert.equal(formatAmount("12.345678901234567890"), "12.345678");
  assert.equal(formatAmount("1234567.891", { compact: true }), "1.23M");
  assert.equal(formatAmount(12.5, { minFraction: 2 }), "12.50");
  assert.equal(formatAmount(-3.25), `${MINUS}3.25`);
  assert.equal(formatAmount(0.0000001), "<0.000001");
  assert.equal(formatAmount(".5"), "0.5");
  assert.equal(formatAmount(2e21), "2,000,000,000,000,000,000,000");
  assert.equal(formatAmount("abc"), NO_VALUE);
  assert.equal(formatAmount("."), NO_VALUE);
  assert.equal(formatAmount(Number.NaN), NO_VALUE);
  assert.equal(formatAmount(null), NO_VALUE);
});

test("formatAmount: a number reads as the decimal it was written as, not its binary expansion", () => {
  // (2999.7).toFixed(20) is "2999.69999999999981810106": cutting that read 2,999.69.
  assert.equal(formatAmount(2999.7, { maxFraction: 2 }), "2,999.7");
  assert.equal(formatAmount(2999.7), "2,999.7");
  assert.equal(formatAmount(0.1 + 0.2), "0.3");
  // The float's own tail (…04 at the 17th digit) is past the 12 digits any format shows.
  assert.equal(formatAmount(0.1 + 0.2, { maxFraction: 12 }), "0.3");
  assert.equal(formatAmount(1e-7), "<0.000001");
  assert.equal(formatAmount(1e-7, { maxFraction: 8 }), "0.0000001");
  assert.equal(formatAmount(123456789.123), "123,456,789.123");
  assert.equal(formatAmount(1.005, { maxFraction: 2 }), "1");
  assert.equal(formatAmount(-0.07, { maxFraction: 2 }), `${MINUS}0.07`);
  assert.equal(formatAmount(1e21), "1,000,000,000,000,000,000,000");
  assert.equal(formatAmount(5e-324), "<0.000001");
});

test("formatAmount: exponent notation and sub-1e-20 dust stay honest", () => {
  // String(0.00000025) is "2.5e-7": expanded exactly, not rejected.
  assert.equal(String(0.00000025), "2.5e-7");
  assert.equal(formatAmount(String(0.00000025)), "<0.000001");
  assert.equal(formatAmount("2.5e-6"), "0.000002");
  assert.equal(formatAmount("1.5e3"), "1,500");
  assert.equal(formatAmount("-2.5E-3"), `${MINUS}0.0025`);
  // Non-zero never reads as zero, even past toFixed's 20 digits.
  assert.equal(formatAmount(1e-25), "<0.000001");
  assert.equal(formatAmount(-1e-25), `${MINUS}<0.000001`);
  assert.equal(formatAmount(0), "0");
});

test("formatPercent: percent units, signed, no false zeros", () => {
  assert.equal(formatPercent(12.3), "12.30%");
  assert.equal(formatPercent(12.3, { digits: 1 }), "12.3%");
  assert.equal(formatPercent(2.314, { signed: true }), "+2.31%");
  assert.equal(formatPercent(-0.5, { signed: true }), `${MINUS}0.50%`);
  assert.equal(formatPercent(-0.5), `${MINUS}0.50%`);
  assert.equal(formatPercent(0, { signed: true }), "0.00%");
  assert.equal(formatPercent(0.004), "<0.01%");
  assert.equal(formatPercent(-0.004, { signed: true }), `${MINUS}<0.01%`);
  assert.equal(formatPercent(12_345.6), "12,346%");
  assert.equal(formatPercent(null), NO_VALUE);
});

test("formatRelativeTime: floored units, past and future", () => {
  const now = Date.UTC(2026, 9, 7, 12, 0, 0);
  assert.equal(formatRelativeTime(now - 10_000, now), "just now");
  assert.equal(formatRelativeTime(now - 50_000, now), "1 min ago");
  assert.equal(formatRelativeTime(now - 2 * 60_000 - 59_000, now), "2 min ago");
  assert.equal(formatRelativeTime(now - 3 * 3_600_000 - 1, now), "3 h ago");
  assert.equal(formatRelativeTime(now - 2 * 86_400_000, now), "2 d ago");
  assert.equal(formatRelativeTime(now + 5 * 60_000, now), "in 5 min");
  assert.equal(formatRelativeTime(now + 10_000, now), "in under a minute");
  assert.equal(formatRelativeTime(now + 26 * 3_600_000, now), "in 1 d");
  assert.equal(formatRelativeTime(Date.UTC(2026, 7, 20, 12), now), "Aug 20");
  assert.equal(formatRelativeTime(null, now), NO_VALUE);
});

test("formatDate: styles, same-year short form", () => {
  const at = Date.UTC(2026, 9, 7, 14, 32);
  const options = { timeZone: "UTC", now: Date.UTC(2026, 11, 31) };
  assert.equal(formatDate(at, "short", options), "Oct 7");
  assert.equal(formatDate(at, "short", { timeZone: "UTC", now: Date.UTC(2027, 0, 2) }), "Oct 7, 2026");
  assert.equal(formatDate(at, "long", options), "October 7, 2026");
  assert.equal(formatDate(at, "datetime", options), "Oct 7, 2026, 2:32\u00a0PM");
  assert.equal(formatDate(at, "time", options), "2:32\u00a0PM");
  assert.equal(formatDate(Number.NaN), NO_VALUE);
});

test("formatDuration: two adjacent units at most", () => {
  assert.equal(formatDuration(21 * 86_400), "21 d");
  assert.equal(formatDuration(3 * 3_600 + 20 * 60), "3 h 20 min");
  assert.equal(formatDuration(2 * 86_400 + 30), "2 d");
  assert.equal(formatDuration(90), "1 min 30 s");
  assert.equal(formatDuration(45), "45 s");
  assert.equal(formatDuration(5.83), "5.8 s");
  assert.equal(formatDuration(0), "0 s");
  assert.equal(formatDuration(21 * 86_400, { style: "long" }), "21 days");
  assert.equal(formatDuration(3_600 + 60, { style: "long" }), "1 hour 1 minute");
  assert.equal(formatDuration(1, { style: "long" }), "1 second");
  assert.equal(formatDuration(-5), NO_VALUE);
  assert.equal(formatDuration(null), NO_VALUE);
});

test("shortenAddress keeps the bech32 prefix whole", () => {
  assert.equal(shortenAddress("cosmos1gv86dp8wmnmmatdckgr5xkevnpmy4662csvy4f"), "cosmos1gv86\u2026vy4f");
  assert.equal(shortenAddress("osmo1gv86dp8wmnmmatdckgr5xkevnpmy4662stl5rm"), "osmo1gv86\u2026l5rm");
  assert.equal(
    shortenAddress("addr_safro1gv86dp8wmnmmatdckgr5xkevnpmy4662qudn7e"),
    "addr_safro1gv86\u2026dn7e",
  );
  assert.equal(shortenAddress("0x52908400098527886E0F7030069857D2E4169EE7", 6, 4), "0x5290\u20269EE7");
  assert.equal(shortenAddress("short"), "short");
  assert.equal(shortenAddress(""), NO_VALUE);
});

test("shortenHash", () => {
  assert.equal(shortenHash("A1B2C3D4E5F60718293A4B5C6D7E8F9012345678"), "A1B2C3\u20265678");
  assert.equal(shortenHash("ABC"), "ABC");
  assert.equal(shortenHash(null), NO_VALUE);
});

test("sanitizeDecimalInput: digits, one separator, both separators accepted", () => {
  assert.equal(sanitizeDecimalInput("12.5"), "12.5");
  assert.equal(sanitizeDecimalInput("12,5"), "12.5");
  assert.equal(sanitizeDecimalInput("1,234.56"), "1234.56");
  assert.equal(sanitizeDecimalInput("1.234,56"), "1234.56");
  assert.equal(sanitizeDecimalInput("1,234,567"), "1234567");
  assert.equal(sanitizeDecimalInput("1 234.5"), "1234.5");
  assert.equal(sanitizeDecimalInput("1.2."), "1.2");
  assert.equal(sanitizeDecimalInput("1.234."), "1.234");
  assert.equal(sanitizeDecimalInput("abc12x.3y"), "12.3");
  assert.equal(sanitizeDecimalInput("-5"), "5");
  assert.equal(sanitizeDecimalInput(""), "");
});

test("sanitizeDecimalInput: leading zeros, bare separator, decimals cap (cut)", () => {
  assert.equal(sanitizeDecimalInput("0007"), "7");
  assert.equal(sanitizeDecimalInput("00"), "0");
  assert.equal(sanitizeDecimalInput("0.50"), "0.50");
  assert.equal(sanitizeDecimalInput("."), "0.");
  assert.equal(sanitizeDecimalInput(",5"), "0.5");
  assert.equal(sanitizeDecimalInput("1.23456789", 6), "1.234567");
  assert.equal(sanitizeDecimalInput("1.99999999", 2), "1.99");
  assert.equal(sanitizeDecimalInput("5.5", 0), "5");
  assert.equal(sanitizeDecimalInput("5.", 0), "5");
  assert.equal(sanitizeDecimalInput("1.5", null), "1.5");
  assert.equal(sanitizeDecimalInput("9".repeat(60)).length, 40);
});

test("sanitizeDecimalInput: exponent notation is expanded, never letter-stripped", () => {
  // Stripping the letters would turn 0.0000001 into "17" (170 million times more).
  assert.equal(sanitizeDecimalInput("1e-7"), "0.0000001");
  assert.equal(sanitizeDecimalInput(String(0.0000001), 6), "0.000000");
  assert.equal(sanitizeDecimalInput("2.5e-3", 6), "0.0025");
  assert.equal(sanitizeDecimalInput("1.5E3"), "1500");
  assert.equal(sanitizeDecimalInput("1e21"), "1000000000000000000000");
  // The ambiguous lone "1,234" reads as the smaller amount (1.234).
  assert.equal(sanitizeDecimalInput("1,234"), "1.234");
});
