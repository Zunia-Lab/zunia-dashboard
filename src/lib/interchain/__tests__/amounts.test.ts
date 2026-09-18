/**
 * Amount conversion, which decides how much leaves the account.
 *
 * The invariant under test everywhere here: nothing rounds up and nothing goes
 * through `Number`. A display that rounds a balance up lets someone try to send
 * more than they hold; a base-unit amount that goes through a float loses
 * digits above 2^53, which an 18-decimal token passes at nine whole coins.
 */

import assert from "node:assert/strict";
import { test } from "node:test";

import {
  exceeds,
  formatToken,
  formatUnits,
  fromBaseUnits,
  isPositiveAmount,
  rateLine,
  toBaseUnits,
} from "../amounts";

test("toBaseUnits scales by the token's exponent", () => {
  assert.equal(toBaseUnits("1", 6), "1000000");
  assert.equal(toBaseUnits("1.5", 6), "1500000");
  assert.equal(toBaseUnits("0.000001", 6), "1");
  assert.equal(toBaseUnits(".5", 6), "500000");
  assert.equal(toBaseUnits("12", 0), "12");
});

test("toBaseUnits refuses more precision than the token has", () => {
  // Truncating here would send a different amount from the one on screen.
  assert.equal(toBaseUnits("1.0000001", 6), null);
  assert.equal(toBaseUnits("0.5", 0), null);
});

test("toBaseUnits refuses anything that is not a plain decimal", () => {
  for (const input of ["", ".", "-1", "1e6", "1,5", "abc", " 1.2.3 "]) {
    assert.equal(toBaseUnits(input, 6), null, `expected null for ${input}`);
  }
});

test("toBaseUnits keeps full precision past 2^53", () => {
  // 10 million whole units of an 18-decimal token: unrepresentable as a double.
  const base = toBaseUnits("10000000.000000000000000001", 18);
  assert.equal(base, "10000000000000000000000001");
});

test("fromBaseUnits round-trips exactly", () => {
  for (const [amount, decimals] of [
    ["1000000", 6],
    ["1", 18],
    ["10000000000000000000000001", 18],
    ["0", 6],
  ] as const) {
    const display = fromBaseUnits(amount, decimals);
    assert.equal(
      toBaseUnits(display, decimals),
      // A zero balance parses back as "0", not "".
      amount === "0" ? "0" : amount,
    );
  }
});

test("formatUnits truncates rather than rounds", () => {
  // 0.9999999 with four shown digits must not become 1.0000.
  assert.equal(formatUnits("9999999", 7, 4), "0.9999");
  assert.equal(formatUnits("1234567890", 6, 2), "1,234.56");
  assert.equal(formatUnits("1000000", 6, 6), "1");
});

test("formatToken appends the symbol and omits it when there is none", () => {
  assert.equal(formatToken("1500000", 6, "ATOM"), "1.5 ATOM");
  assert.equal(formatToken("1500000", 6, ""), "1.5");
});

test("isPositiveAmount rejects zero and non-integers", () => {
  assert.equal(isPositiveAmount("1"), true);
  assert.equal(isPositiveAmount("0"), false);
  assert.equal(isPositiveAmount("000"), false);
  assert.equal(isPositiveAmount("1.5"), false);
  assert.equal(isPositiveAmount(""), false);
});

test("exceeds compares base units without a float", () => {
  assert.equal(exceeds("10000000000000000000000002", "10000000000000000000000001"), true);
  assert.equal(exceeds("10000000000000000000000001", "10000000000000000000000001"), false);
  assert.equal(exceeds("not-a-number", "1"), false);
});

test("rateLine expresses the rate in display units", () => {
  // 1 ATOM (6dp) in, 8.42 OSMO (6dp) out.
  assert.equal(
    rateLine({
      inputAmount: "1000000",
      inputDecimals: 6,
      inputSymbol: "ATOM",
      outputAmount: "8420000",
      outputDecimals: 6,
      outputSymbol: "OSMO",
    }),
    "1 ATOM ≈ 8.42 OSMO",
  );
});

test("rateLine handles a decimal mismatch between the two tokens", () => {
  // 1 ATOM (6dp) in, 2 of an 18-decimal token out.
  assert.equal(
    rateLine({
      inputAmount: "1000000",
      inputDecimals: 6,
      inputSymbol: "ATOM",
      outputAmount: "2000000000000000000",
      outputDecimals: 18,
      outputSymbol: "WETH",
    }),
    "1 ATOM ≈ 2 WETH",
  );
});

test("rateLine returns null rather than dividing by zero", () => {
  assert.equal(
    rateLine({
      inputAmount: "0",
      inputDecimals: 6,
      inputSymbol: "ATOM",
      outputAmount: "1",
      outputDecimals: 6,
      outputSymbol: "OSMO",
    }),
    null,
  );
});
