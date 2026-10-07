/**
 * Swaps in Osmosis's own pools (src/lib/swap/pool.ts): the order a router
 * quote makes, the floor, the poolmanager message built from it and read back
 * strictly, and the reader for the transfer that sends the output on.
 *
 * Ported from zunia-extension lib/__tests__/pool-swap.test.ts @ 1453e7a (the
 * pure half; the extension's fake-LCD planning tests have no counterpart here
 * because planning moved to the server). The numbers are the Osmosis router's
 * real answer for 10 OSMO to USDC.inj on 2026-10-06: split 60/40 across pools
 * 3498 and 3586.
 */

import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { bech32 } from "@scure/base";

import {
  buildPoolSwapMsg,
  hasHeightTimeout,
  MAX_POOL_HOPS,
  MAX_POOL_SPLITS,
  POOL_SPLIT_SWAP_TYPE_URL,
  POOL_SWAP_TYPE_URL,
  poolMinOut,
  poolRouteText,
  poolRoutesOf,
  readDeliveryTransfer,
  readPoolSwapMsg,
  readTimeoutHeight,
  sameRoutes,
  TRANSFER_TYPE_URL,
  type PoolRoute,
} from "../pool";

const USDC_INJ = "ibc/794C7D7F3B857713878A3A1927251FA6AC1EEE520424C1F6FAFE9BA26D476138";
const USDC_N = "ibc/498A0751C798A0D9A389AA3691123DADA57DAA4FE165D5C75894505B876BA6E4";

const address = (prefix: string, fill: number) => bech32.encode(prefix, bech32.toWords(new Uint8Array(20).fill(fill)));
const OSMO_ME = address("osmo", 7);
const INJ_ME = address("inj", 7);

function quoteOf(splits: { pools: [string, string][]; inAmount: string; outAmount: string }[], outputDenom = USDC_INJ) {
  return {
    outputDenom,
    splits: splits.map((split) => ({
      pools: split.pools.map(([poolId, tokenOutDenom]) => ({ poolId, tokenOutDenom })),
      inAmount: split.inAmount,
    })),
  };
}

const SPLIT = quoteOf([
  { pools: [["3498", USDC_INJ]], inAmount: "6000000", outAmount: "212554" },
  { pools: [["3586", USDC_INJ]], inAmount: "4000000", outAmount: "142080" },
]);
const SPLIT_ROUTES: PoolRoute[] = [
  { hops: [{ poolId: "3498", tokenOutDenom: USDC_INJ }], inAmount: "6000000" },
  { hops: [{ poolId: "3586", tokenOutDenom: USDC_INJ }], inAmount: "4000000" },
];
const TWO_HOPS: PoolRoute[] = [
  {
    hops: [
      { poolId: "3497", tokenOutDenom: USDC_N },
      { poolId: "1464", tokenOutDenom: "uosmo" },
    ],
    inAmount: "1000000",
  },
];

describe("the router's order", () => {
  test("takes every split for exactly the amount sold", () => {
    assert.deepEqual(poolRoutesOf(SPLIT, "10000000"), SPLIT_ROUTES);
    const single = quoteOf([{ pools: [["3586", USDC_INJ]], inAmount: "9950000", outAmount: "350000" }]);
    assert.deepEqual(poolRoutesOf(single, "9950000"), [
      { hops: [{ poolId: "3586", tokenOutDenom: USDC_INJ }], inAmount: "9950000" },
    ]);
  });

  test("refuses an order that would sell another amount, or that the chain would refuse", () => {
    assert.equal(poolRoutesOf(SPLIT, "9999999"), null);
    assert.equal(poolRoutesOf(quoteOf([{ pools: [["1", USDC_N]], inAmount: "5", outAmount: "1" }]), "5"), null);
    assert.equal(
      poolRoutesOf(
        quoteOf([
          { pools: [["3586", USDC_INJ]], inAmount: "5", outAmount: "1" },
          { pools: [["3586", USDC_INJ]], inAmount: "5", outAmount: "1" },
        ]),
        "10",
      ),
      null,
    );
    assert.equal(poolRoutesOf(quoteOf([{ pools: [["0", USDC_INJ]], inAmount: "5", outAmount: "1" }]), "5"), null);
    assert.equal(
      poolRoutesOf(
        quoteOf([
          { pools: [["1", USDC_INJ]], inAmount: "5", outAmount: "1" },
          { pools: [["2", USDC_INJ]], inAmount: "0", outAmount: "0" },
        ]),
        "5",
      ),
      null,
    );
    assert.equal(poolRoutesOf(quoteOf([{ pools: [], inAmount: "5", outAmount: "1" }]), "5"), null);
    const long = quoteOf([
      {
        pools: Array.from({ length: MAX_POOL_HOPS + 1 }, (_, i) => [String(i + 1), USDC_INJ] as [string, string]),
        inAmount: "5",
        outAmount: "1",
      },
    ]);
    assert.equal(poolRoutesOf(long, "5"), null);
    const wide = quoteOf(
      Array.from({ length: MAX_POOL_SPLITS + 1 }, (_, i) => ({
        pools: [[String(i + 1), USDC_INJ]] as [string, string][],
        inAmount: "1",
        outAmount: "1",
      })),
    );
    assert.equal(poolRoutesOf(wide, String(MAX_POOL_SPLITS + 1)), null);
  });

  test("floors the output at the slippage, rounding down, and never at nothing", () => {
    // ⌊354634 × (100e6 − 1e6) / 100e6⌋ and at 0.5%.
    assert.equal(poolMinOut({ outputAmount: "354634" }, 1), "351087");
    assert.equal(poolMinOut({ outputAmount: "354634" }, 0.5), "352860");
    assert.equal(poolMinOut({ outputAmount: "354634" }, 3), "343994");
    assert.equal(poolMinOut({ outputAmount: "1" }, 1), null);
    assert.equal(poolMinOut({ outputAmount: "0" }, 1), null);
    assert.equal(poolMinOut({ outputAmount: "x" }, 1), null);
    assert.equal(poolMinOut({ outputAmount: "354634" }, 101), null);
  });

  test("says the route in words", () => {
    assert.equal(poolRouteText(SPLIT_ROUTES), "2 routes: pool 3498 (60%) and pool 3586 (40%)");
    assert.equal(poolRouteText(TWO_HOPS), "pools 3497 → 1464");
    assert.equal(poolRouteText([{ hops: [{ poolId: "3586", tokenOutDenom: USDC_INJ }], inAmount: "1" }]), "pool 3586");
  });
});

describe("the poolmanager message", () => {
  test("is MsgSwapExactAmountIn for one route, with the whole input as token_in", () => {
    assert.deepEqual(buildPoolSwapMsg({ sender: OSMO_ME, denom: "uosmo", routes: TWO_HOPS, minOut: "28000000" }), {
      typeUrl: POOL_SWAP_TYPE_URL,
      value: {
        sender: OSMO_ME,
        routes: [
          { pool_id: "3497", token_out_denom: USDC_N },
          { pool_id: "1464", token_out_denom: "uosmo" },
        ],
        token_in: { denom: "uosmo", amount: "1000000" },
        token_out_min_amount: "28000000",
      },
    });
  });

  test("is MsgSplitRouteSwapExactAmountIn for a split order, each route with its share", () => {
    assert.deepEqual(buildPoolSwapMsg({ sender: OSMO_ME, denom: "uosmo", routes: SPLIT_ROUTES, minOut: "351087" }), {
      typeUrl: POOL_SPLIT_SWAP_TYPE_URL,
      value: {
        sender: OSMO_ME,
        routes: [
          { pools: [{ pool_id: "3498", token_out_denom: USDC_INJ }], token_in_amount: "6000000" },
          { pools: [{ pool_id: "3586", token_out_denom: USDC_INJ }], token_in_amount: "4000000" },
        ],
        token_in_denom: "uosmo",
        token_out_min_amount: "351087",
      },
    });
  });

  test("refuses to build a swap with no floor, a bad denom, routes that are not an order, or no signer", () => {
    assert.throws(() => buildPoolSwapMsg({ sender: OSMO_ME, denom: "uosmo", routes: SPLIT_ROUTES, minOut: "0" }));
    assert.throws(() => buildPoolSwapMsg({ sender: OSMO_ME, denom: "u", routes: SPLIT_ROUTES, minOut: "1" }));
    assert.throws(() => buildPoolSwapMsg({ sender: OSMO_ME, denom: "uosmo", routes: [], minOut: "1" }));
    assert.throws(() => buildPoolSwapMsg({ sender: "", denom: "uosmo", routes: SPLIT_ROUTES, minOut: "1" }));
  });

  test("reads back exactly what it built", () => {
    const single = buildPoolSwapMsg({ sender: OSMO_ME, denom: "uosmo", routes: TWO_HOPS, minOut: "28000000" });
    assert.deepEqual(readPoolSwapMsg(single), {
      split: false,
      sender: OSMO_ME,
      sold: { denom: "uosmo", amount: "1000000" },
      outputDenom: "uosmo",
      minOut: "28000000",
      routes: TWO_HOPS,
    });
    const split = buildPoolSwapMsg({ sender: OSMO_ME, denom: "uosmo", routes: SPLIT_ROUTES, minOut: "351087" });
    const read = readPoolSwapMsg(split);
    assert.equal(read?.split, true);
    assert.deepEqual(read?.sold, { denom: "uosmo", amount: "10000000" });
    assert.equal(read?.outputDenom, USDC_INJ);
    assert.equal(sameRoutes(read?.routes ?? [], SPLIT_ROUTES), true);
    assert.equal(sameRoutes(read?.routes ?? [], TWO_HOPS), false);
  });

  test("refuses to read a message with anything it would not show", () => {
    const base = buildPoolSwapMsg({ sender: OSMO_ME, denom: "uosmo", routes: SPLIT_ROUTES, minOut: "351087" });
    const value = base.value as Record<string, unknown>;
    const variants: Record<string, unknown>[] = [
      { ...value, extra: "x" },
      { ...value, token_out_min_amount: "0" },
      { ...value, token_out_min_amount: "007" },
      { ...value, token_out_min_amount: 351087 },
      { ...value, token_in_denom: "" },
      { ...value, routes: [] },
      { ...value, routes: [{ pools: [{ pool_id: "3498", token_out_denom: USDC_INJ, extra: 1 }], token_in_amount: "1" }] },
      { ...value, routes: [{ pools: [{ pool_id: 3498, token_out_denom: USDC_INJ }], token_in_amount: "1" }] },
      {
        ...value,
        routes: [
          { pools: [{ pool_id: "3498", token_out_denom: USDC_INJ }], token_in_amount: "1" },
          { pools: [{ pool_id: "3586", token_out_denom: USDC_N }], token_in_amount: "1" },
        ],
      },
    ];
    for (const variant of variants) {
      assert.equal(readPoolSwapMsg({ typeUrl: POOL_SPLIT_SWAP_TYPE_URL, value: variant }), null, JSON.stringify(variant));
    }
    assert.equal(readPoolSwapMsg({ typeUrl: "/osmosis.gamm.v1beta1.MsgSwapExactAmountIn", value }), null);
    assert.equal(readPoolSwapMsg({ typeUrl: POOL_SWAP_TYPE_URL, value }), null);
    assert.equal(readPoolSwapMsg(undefined), null);
  });
});

describe("the transfer after the swap", () => {
  const value = {
    source_port: "transfer",
    source_channel: "channel-122",
    token: { denom: USDC_INJ, amount: "1" },
    sender: OSMO_ME,
    receiver: INJ_ME,
    timeout_height: { revision_number: "0", revision_height: "0" },
    timeout_timestamp: "1",
    memo: "",
  };

  test("reads a transfer whole, with an empty height or none, and the memo absent when empty", () => {
    assert.deepEqual(readDeliveryTransfer({ typeUrl: TRANSFER_TYPE_URL, value }), {
      sourcePort: "transfer",
      sourceChannel: "channel-122",
      token: { denom: USDC_INJ, amount: "1" },
      sender: OSMO_ME,
      receiver: INJ_ME,
      memo: "",
      timeoutTimestamp: "1",
      timeoutHeight: { revisionNumber: "0", revisionHeight: "0" },
    });
    const { memo: _memo, ...noMemo } = value;
    void _memo;
    assert.notEqual(readDeliveryTransfer({ typeUrl: TRANSFER_TYPE_URL, value: { ...noMemo, timeout_height: {} } }), null);
  });

  test("reads a height timeout as it is, so the check can refuse it", () => {
    const withHeight = readDeliveryTransfer({
      typeUrl: TRANSFER_TYPE_URL,
      value: { ...value, timeout_height: { revision_number: "1", revision_height: "48000000" } },
    });
    assert.deepEqual(withHeight?.timeoutHeight, { revisionNumber: "1", revisionHeight: "48000000" });
    assert.equal(hasHeightTimeout(withHeight!.timeoutHeight), true);
    // Amino omits a zero counter: `{revision_height}` alone is still a height.
    assert.deepEqual(readTimeoutHeight({ revision_height: "5" }), { revisionNumber: "0", revisionHeight: "5" });
    assert.deepEqual(readTimeoutHeight(undefined), { revisionNumber: "0", revisionHeight: "0" });
    assert.equal(hasHeightTimeout({ revisionNumber: "0", revisionHeight: "000" }), false);
    assert.equal(readTimeoutHeight({ revision_height: 5 }), null);
    assert.equal(readTimeoutHeight([]), null);
  });

  test("refuses a field it does not know or a timeout it cannot read", () => {
    assert.equal(readDeliveryTransfer({ typeUrl: TRANSFER_TYPE_URL, value: { ...value, extra: true } }), null);
    assert.equal(readDeliveryTransfer({ typeUrl: TRANSFER_TYPE_URL, value: { ...value, timeout_timestamp: 1 } }), null);
    assert.equal(
      readDeliveryTransfer({ typeUrl: TRANSFER_TYPE_URL, value: { ...value, timeout_height: { revision_number: "0", x: "1" } } }),
      null,
    );
    assert.equal(readDeliveryTransfer({ typeUrl: TRANSFER_TYPE_URL, value: { ...value, token: { denom: USDC_INJ, amount: "0" } } }), null);
    assert.equal(readDeliveryTransfer({ typeUrl: POOL_SWAP_TYPE_URL, value }), null);
  });
});
