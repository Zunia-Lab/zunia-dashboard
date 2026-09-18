/**
 * Narrowing what comes back from `/api/interchain/*`.
 *
 * The payload left this application one request ago, which is exactly why it is
 * checked: a proxy, an offline service worker, or a stale deploy can put
 * something else on the wire, and a component that renders a half-typed row
 * shows the user "undefined" where an amount should be. Worse, a plan with no
 * hops or a trace with a fabricated status would be acted on.
 *
 * The rule these assert: a row that does not narrow is dropped, and a response
 * that does not narrow becomes a failure with a code — never a partial success.
 */

import assert from "node:assert/strict";
import { test } from "node:test";

import {
  readBalance,
  readChannelCheck,
  readChannelOption,
  readFailure,
  readPlanCandidate,
  readPlanResponse,
  readQuote,
  readRoutePlan,
  readSwapConfig,
  readTraceResponse,
  readTxStatusResponse,
} from "../wire";

const PLAN = {
  sourceChainId: "cosmoshub-4",
  destChainId: "osmosis-1",
  inputDenom: "uatom",
  outputDenom: "uosmo",
  hops: [
    {
      chainId: "cosmoshub-4",
      channelId: "channel-141",
      port: "transfer",
      counterpartyChainId: "osmosis-1",
      kind: "transfer",
    },
  ],
  memo: "",
  warnings: [],
  estimatedDurationSeconds: 60,
  requiresPfm: false,
  requiresIbcHooks: false,
};

test("readFailure recognises an envelope and keeps a known code", () => {
  assert.deepEqual(readFailure({ ok: false, code: "no-route", message: "x" }), {
    ok: false,
    code: "no-route",
    message: "x",
  });
});

test("readFailure downgrades a code this build does not know", () => {
  // An unknown discriminant must not reach a switch that branches on it.
  const failure = readFailure({ ok: false, code: "teapot", message: "x" });
  assert.equal(failure?.code, "server-error");
});

test("readFailure ignores a success body", () => {
  assert.equal(readFailure({ ok: true }), null);
});

test("readRoutePlan rejects a plan with no hops", () => {
  // A hopless plan cannot be signed or tracked; treating it as readable would
  // put an empty route into a confirm screen.
  assert.equal(readRoutePlan({ ...PLAN, hops: [] }), null);
  assert.equal(readRoutePlan({ ...PLAN, hops: "nope" }), null);
  assert.equal(readRoutePlan(null), null);
});

test("readRoutePlan defaults a hop kind it does not recognise", () => {
  const plan = readRoutePlan({
    ...PLAN,
    hops: [{ ...PLAN.hops[0], kind: "teleport" }],
  });
  assert.equal(plan?.hops[0]?.kind, "transfer");
});

test("readPlanCandidate drops a candidate whose plan is unreadable", () => {
  assert.equal(readPlanCandidate({ id: "a", plan: { hops: [] } }), null);
});

test("readPlanCandidate keeps venue and denom nulls distinct from missing", () => {
  const candidate = readPlanCandidate({
    id: "a",
    strategy: "ibc-swap",
    plan: PLAN,
    venue: { chainId: "osmosis-1", contractAddress: "osmo1abc" },
    venueInputDenom: null,
    venueDenomReason: "the counterparty is unknown",
  });
  assert.equal(candidate?.venue?.chainId, "osmosis-1");
  // A null denom is the signal that the candidate is unquotable, so it must not
  // become an empty string that reads as a real denom.
  assert.equal(candidate?.venueInputDenom, null);
  assert.equal(candidate?.venueDenomReason, "the counterparty is unknown");
});

test("readPlanCandidate treats a half-declared venue as no venue", () => {
  const candidate = readPlanCandidate({
    id: "a",
    plan: PLAN,
    venue: { chainId: "osmosis-1" },
  });
  assert.equal(candidate?.venue, null);
});

test("readPlanResponse drops unreadable candidates and keeps the rest", () => {
  const response = readPlanResponse({
    ok: true,
    candidates: [{ id: "bad" }, { id: "good", plan: PLAN }],
    warnings: ["a warning", 7],
    outputDenom: "ibc/ABC",
  });
  assert.equal(response.ok, true);
  if (!response.ok) return;
  assert.equal(response.candidates.length, 1);
  assert.equal(response.candidates[0]?.id, "good");
  assert.deepEqual(response.warnings, ["a warning"]);
  assert.equal(response.outputDenom, "ibc/ABC");
});

test("readPlanResponse turns an unreadable body into a failure", () => {
  const response = readPlanResponse({ candidates: [] });
  assert.equal(response.ok, false);
  if (response.ok) return;
  assert.equal(response.code, "malformed-response");
});

test("readQuote refuses a quote with no output amount", () => {
  assert.equal(readQuote({ inputAmount: "1" }), null);
});

test("readQuote keeps an unreported impact null rather than zero", () => {
  const quote = readQuote({
    outputAmount: "100",
    inputAmount: "1000",
    minReceived: "95",
    priceImpact: null,
    poolFee: null,
  });
  // A confident zero for "the venue did not say" is the defect this whole flow
  // was rebuilt to remove.
  assert.equal(quote?.priceImpact, null);
  assert.equal(quote?.poolFee, null);
});

test("readQuote rejects a non-integer amount rather than passing it on", () => {
  const quote = readQuote({ outputAmount: "1.5", inputAmount: "-3" });
  assert.equal(quote?.outputAmount, "0");
  assert.equal(quote?.inputAmount, "0");
});

test("readTraceResponse keeps only failure kinds this build handles", () => {
  const response = readTraceResponse({
    ok: true,
    trace: {
      sourceChainId: "cosmoshub-4",
      destChainId: "osmosis-1",
      sourceTxHash: "ABC",
      status: "failed",
      failure: "swap-delivery-failed",
      hops: [
        { chainId: "cosmoshub-4", status: "acknowledged" },
        { chainId: "nope" },
        { status: "received" },
      ],
      recovery: {
        chainId: "osmosis-1",
        contractAddress: null,
        recoveryAddress: "osmo1abc",
        ready: false,
        executeMsgJson: '{"recover":{}}',
      },
    },
  });
  assert.equal(response.ok, true);
  if (!response.ok) return;
  assert.equal(response.trace.failure, "swap-delivery-failed");
  // The row without a chain id is dropped; the one with an unknown status keeps
  // its chain and falls back to `unknown`.
  assert.equal(response.trace.hops.length, 2);
  assert.equal(response.trace.hops[1]?.status, "unknown");
  // `ready: false` must survive: it is what disables the recover button with a
  // reason instead of offering a control that cannot be built.
  assert.equal(response.trace.recovery?.ready, false);
  assert.equal(response.trace.recovery?.contractAddress, null);
});

test("readTraceResponse drops a failure kind it does not model", () => {
  const response = readTraceResponse({
    ok: true,
    trace: {
      sourceChainId: "a",
      destChainId: "b",
      sourceTxHash: "ABC",
      failure: "eaten-by-a-grue",
      hops: [{ chainId: "a", status: "pending" }],
    },
  });
  assert.equal(response.ok, true);
  if (!response.ok) return;
  assert.equal(response.trace.failure, null);
});

test("readSwapConfig requires the fields a disabled control needs", () => {
  assert.equal(readSwapConfig({ available: false }), null);
  const config = readSwapConfig({
    available: false,
    chainId: "osmosis-1",
    configKey: "ZUNIA_XCS_CONTRACT",
    reason: "not set",
  });
  assert.equal(config?.reason, "not set");
  assert.equal(config?.chainName, "osmosis-1");
});

test("readChannelOption and readChannelCheck fall back to safe states", () => {
  const option = readChannelOption({ channelId: "channel-0", state: "weird" });
  assert.equal(option?.state, "unknown");
  assert.equal(option?.portId, "transfer");
  assert.equal(readChannelOption({ portId: "transfer" }), null);

  // A check with no message cannot be rendered; the field hint prints it.
  assert.equal(readChannelCheck({ ok: true }), null);
  const check = readChannelCheck({ ok: true, message: "Open · osmosis-1" });
  assert.equal(check?.message, "Open · osmosis-1");
});

test("readBalance keeps an unnamed voucher unnamed", () => {
  const balance = readBalance({
    denom: "ibc/27394FB0",
    amount: "12",
    isIbc: true,
    symbol: null,
    decimals: null,
    traceError: "no trace",
  });
  assert.equal(balance?.symbol, null);
  assert.equal(balance?.decimals, null);
  assert.equal(balance?.traceError, "no trace");
  // A non-integer amount becomes "0" rather than reaching BigInt() and throwing
  // inside a render.
  assert.equal(readBalance({ denom: "uatom", amount: 12 })?.amount, "0");
});

test("readTxStatusResponse defaults an unknown state to not-found", () => {
  const response = readTxStatusResponse({
    ok: true,
    status: { txHash: "ABC", state: "sideways" },
  });
  assert.equal(response.ok, true);
  if (!response.ok) return;
  // not-found keeps polling; anything else would settle on a state the chain
  // never reported.
  assert.equal(response.status.state, "not-found");
});
