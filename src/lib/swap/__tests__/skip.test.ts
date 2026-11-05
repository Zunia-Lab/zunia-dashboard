/**
 * The one-signature swap memo (src/lib/swap/skip.ts): written exactly as
 * Skip's entry point reads it (the deadline a bare u64), and read back only
 * when it is exactly that shape.
 */

import assert from "node:assert/strict";
import { describe, test } from "node:test";

import { SKIP_ENTRY_POINT } from "@/config/interchain";
import { buildSkipSwapMemo, readSkipSwapMemo, skipOperationsOf, skipBoughtDenom, type SkipSwapParams } from "../skip";

const SAF = "ibc/DBAA4846F611A7603EFCE6F9F46F4F561D48B1F492A576022F000614A17089CE";
const ALL_USDC = "factory/osmo147h5x9pcj7lm0cttlaefx6sqq5vdfnmwfcqxkmjd7exqm9gc7grqhr75m0/alloyed/allUSDC";
const HOLDER = "osmo1emc0hs8lp84f2dmsje9xth8r4hw655t9u422ns";
const SAFRO = "addr_safro1qyqszqgpqyqszqgpqyqszqgpqyqszqgpwdhzlz";
const DEADLINE = "1793866800000000000";

const ON_OSMOSIS: SkipSwapParams = {
  entryPoint: SKIP_ENTRY_POINT,
  operations: skipOperationsOf(SAF, [{ id: "3600", tokenOutDenom: ALL_USDC }]),
  minOut: { denom: ALL_USDC, amount: "46530" },
  timeoutNs: DEADLINE,
  postSwap: { kind: "transfer", toAddress: HOLDER },
};

const BACK_HOME: SkipSwapParams = {
  entryPoint: SKIP_ENTRY_POINT,
  operations: skipOperationsOf(ALL_USDC, [{ id: "3600", tokenOutDenom: SAF }]),
  minOut: { denom: SAF, amount: "208000000" },
  timeoutNs: DEADLINE,
  postSwap: { kind: "ibc-transfer", channelId: "channel-110497", receiver: SAFRO, recoverAddress: HOLDER },
};

describe("the memo Skip's entry point runs", () => {
  test("is compact JSON, keys in order, the deadline a bare number (it is a u64, past what a JS number holds)", () => {
    assert.equal(
      buildSkipSwapMemo(ON_OSMOSIS),
      `{"wasm":{"contract":"${SKIP_ENTRY_POINT}","msg":{"swap_and_action":{"user_swap":{"swap_exact_asset_in":{"swap_venue_name":"osmosis-poolmanager","operations":[{"pool":"3600","denom_in":"${SAF}","denom_out":"${ALL_USDC}"}]}},"min_asset":{"native":{"denom":"${ALL_USDC}","amount":"46530"}},"timeout_timestamp":${DEADLINE},"post_swap_action":{"transfer":{"to_address":"${HOLDER}"}},"affiliates":[]}}}}`,
    );
  });

  test("delivers one IBC hop on with the user's Osmosis address for a failed hop, and no memo on that hop", () => {
    const memo = buildSkipSwapMemo(BACK_HOME);
    assert.match(memo, /"post_swap_action":\{"ibc_transfer":\{"ibc_info":\{"source_channel":"channel-110497","receiver":"addr_safro1[^"]+","memo":"","recover_address":"osmo1emc0hs8l[^"]+"\}\}\}/);
    assert.deepEqual(readSkipSwapMemo(memo), BACK_HOME);
  });

  test("reads back exactly what it wrote", () => {
    assert.deepEqual(readSkipSwapMemo(buildSkipSwapMemo(ON_OSMOSIS)), ON_OSMOSIS);
    assert.equal(skipBoughtDenom(JSON.parse(buildSkipSwapMemo(ON_OSMOSIS)).wasm.msg), ALL_USDC);
  });

  test("chains the pools in order from the denom the tokens land as", () => {
    assert.deepEqual(skipOperationsOf(SAF, [
      { id: "3600", tokenOutDenom: ALL_USDC },
      { id: "1464", tokenOutDenom: "uosmo" },
    ]), [
      { pool: "3600", denomIn: SAF, denomOut: ALL_USDC },
      { pool: "1464", denomIn: ALL_USDC, denomOut: "uosmo" },
    ]);
  });

  test("will not write a route that does not end in the token bought, a zero minimum, or a deadline past a u64", () => {
    assert.throws(() => buildSkipSwapMemo({ ...ON_OSMOSIS, minOut: { denom: "uosmo", amount: "1" } }), /does not end in the token bought/);
    assert.throws(() => buildSkipSwapMemo({ ...ON_OSMOSIS, minOut: { denom: ALL_USDC, amount: "0" } }), /no minimum/);
    assert.throws(() => buildSkipSwapMemo({ ...ON_OSMOSIS, timeoutNs: "18446744073709551616" }), /deadline/);
    assert.throws(() => buildSkipSwapMemo({ ...ON_OSMOSIS, operations: [] }), /no route/);
  });
});

describe("a memo that is not exactly that shape is not read", () => {
  const memo = buildSkipSwapMemo(ON_OSMOSIS);
  const cases: Array<[string, string]> = [
    ["the deadline as a string", memo.replace(`"timeout_timestamp":${DEADLINE}`, `"timeout_timestamp":"${DEADLINE}"`)],
    ["an affiliate taking a cut", memo.replace(`"affiliates":[]`, `"affiliates":[{"basis_points_fee":"100","address":"${HOLDER}"}]`)],
    ["a sent_asset", memo.replace(`{"swap_and_action":{`, `{"swap_and_action":{"sent_asset":null,`)],
    ["another venue", memo.replace("osmosis-poolmanager", "astroport")],
    [
      "a pool route that does not chain",
      buildSkipSwapMemo({
        ...ON_OSMOSIS,
        operations: skipOperationsOf(SAF, [
          { id: "3600", tokenOutDenom: "uosmo" },
          { id: "1464", tokenOutDenom: ALL_USDC },
        ]),
      }).replace(`"pool":"1464","denom_in":"uosmo"`, `"pool":"1464","denom_in":"uion"`),
    ],
    ["whitespace", memo.replace(`{"wasm":`, `{ "wasm":`)],
    ["a duplicate key", memo.replace(`"affiliates":[]`, `"affiliates":[],"affiliates":[]`)],
    ["a second deadline", memo.replace(`"affiliates":[]`, `"affiliates":[],"timeout_timestamp":1`)],
    ["a crosschain-swaps call", `{"wasm":{"contract":"${SKIP_ENTRY_POINT}","msg":{"osmosis_swap":{"output_denom":"uosmo"}}}}`],
    ["a forward", `{"forward":{"receiver":"${HOLDER}","port":"transfer","channel":"channel-0"}}`],
  ];
  for (const [name, text] of cases) {
    test(`refuses ${name}`, () => {
      assert.equal(readSkipSwapMemo(text), null);
    });
  }

  test("refuses a memo on the last hop", () => {
    const home = buildSkipSwapMemo(BACK_HOME).replace(`"memo":""`, `"memo":"{\\"wasm\\":{}}"`);
    assert.equal(readSkipSwapMemo(home), null);
  });
});
