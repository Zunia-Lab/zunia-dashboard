/**
 * Gas and fee arithmetic: exact, rounded up, decimals-aware.
 *
 * The figures are the ones seen live on 2026-10-07: a 1-uatom MsgSend
 * simulated at 87,731 gas on cosmoshub-4 and at 53,309 gas on safrochain-1.
 */
import assert from "node:assert/strict";
import { test } from "node:test";

import { computeFee, fallbackGasLimit, feeTiers, formatUnits, gasLimitFromSimulation, NoGasPriceError } from "../fees";

const HUB = { chainId: "cosmoshub-4", chainName: "Cosmos Hub", feeMinimalDenom: "uatom", feeDenom: "ATOM", feeDecimals: 6, gasPriceStep: { low: 0.005, average: 0.025, high: 0.03 } };
const SAFRO = { chainId: "safrochain-1", chainName: "Safrochain", feeMinimalDenom: "usaf", feeDenom: "SAF", feeDecimals: 6, gasPriceStep: { low: 0.05, average: 0.075, high: 0.1 } };
const DYM = { chainId: "dymension_1100-1", feeMinimalDenom: "adym", feeDecimals: 18, gasPriceStep: { low: 20000000000, average: 20000000000, high: 20000000000 } };

test("gas limit is ceil(gas used × 1.4)", () => {
  assert.equal(gasLimitFromSimulation("87731"), 122_824); // 122,823.4 → up
  assert.equal(gasLimitFromSimulation("53309"), 74_633); // 74,632.6 → up
  assert.equal(gasLimitFromSimulation(100_000, 1.5), 150_000);
  assert.throws(() => gasLimitFromSimulation("0"));
});

test("tiny simulations are floored at a usable limit, huge ones capped", () => {
  assert.equal(gasLimitFromSimulation("10"), 50_000);
  assert.equal(gasLimitFromSimulation("99999999999"), 10_000_000);
});

test("fee = ceil(gas limit × gas price) in the fee denom, with an exact display amount", () => {
  const hub = computeFee(HUB, 122_824, "average");
  assert.deepEqual(hub.amount, [{ denom: "uatom", amount: "3071" }]); // 3,070.6 → up
  assert.equal(hub.display, "0.003071");
  assert.equal(hub.symbol, "ATOM");
  assert.equal(hub.gasLimit, "122824");
  const safro = computeFee(SAFRO, 74_633, "average");
  assert.deepEqual(safro.amount, [{ denom: "usaf", amount: "5598" }]); // 5,597.475 → up
  assert.equal(safro.display, "0.005598");
});

test("18-decimal fee tokens stay exact (no float drift at 2e10 per gas)", () => {
  const fee = computeFee(DYM, 200_000, "average");
  assert.deepEqual(fee.amount, [{ denom: "adym", amount: "4000000000000000" }]);
  assert.equal(fee.display, "0.004");
});

test("fractional prices below 1e-7 are expanded, not rounded to zero", () => {
  const chain = { chainId: "x", feeMinimalDenom: "ux", feeDecimals: 6, gasPriceStep: { low: 1e-8, average: 1e-8, high: 1e-8 } };
  assert.deepEqual(computeFee(chain, 1_000_000).amount, [{ denom: "ux", amount: "1" }]); // 0.01 → up to 1
});

test("a zero-price chain pays an empty fee, never a 0-denom coin", () => {
  const chain = { chainId: "centauri-1", feeMinimalDenom: "ppica", feeDecimals: 12, gasPriceStep: { low: 0, average: 0, high: 0 } };
  assert.deepEqual(computeFee(chain, 200_000).amount, []);
});

test("a chain without published gas prices is refused, not guessed", () => {
  assert.throws(() => computeFee({ chainId: "kaiyo-1", chainName: "Kujira", feeMinimalDenom: "ukuji", feeDecimals: 6 }, 100_000), NoGasPriceError);
  assert.equal(feeTiers({ chainId: "kaiyo-1", feeMinimalDenom: "ukuji", feeDecimals: 6 }, 100_000), null);
});

test("all three tiers at once", () => {
  const tiers = feeTiers(HUB, 200_000)!;
  assert.deepEqual(
    [tiers.low.amount[0]!.amount, tiers.average.amount[0]!.amount, tiers.high.amount[0]!.amount],
    ["1000", "5000", "6000"],
  );
});

test("formatUnits trims and pads exactly", () => {
  assert.equal(formatUnits("1", 6), "0.000001");
  assert.equal(formatUnits("1000000", 6), "1");
  assert.equal(formatUnits("1234500", 6), "1.2345");
  assert.equal(formatUnits("0", 6), "0");
  assert.equal(formatUnits("42", 0), "42");
});

test("fallback gas: the costliest message in full, the rest at a quarter", () => {
  const send = { typeUrl: "/cosmos.bank.v1beta1.MsgSend" };
  const claim = { typeUrl: "/cosmos.distribution.v1beta1.MsgWithdrawDelegatorReward" };
  assert.equal(fallbackGasLimit([send]), 150_000);
  assert.equal(fallbackGasLimit([claim, claim, claim]), 800_000 + 200_000 * 2);
  assert.equal(fallbackGasLimit([send, claim]), 800_000 + Math.ceil(150_000 / 4));
});
