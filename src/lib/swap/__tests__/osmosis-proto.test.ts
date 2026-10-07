/**
 * The poolmanager encoding (src/lib/tx/osmosis.ts) against the osmojs-pinned
 * golden vectors zunia-core signs with
 * (fixtures/poolmanager-vectors.json, copied from
 * zunia-core/tests/vectors/cosmos-signing.json @ 11741e5).
 *
 * A one-byte disagreement is a signature that verifies against nothing, which
 * the chain reports as an opaque "unauthorized". Each case is checked both
 * ways: the protobuf bytes byte for byte, and the amino document (sorted-key
 * JSON, as CosmJS serialises a sign doc) value for value, with the engine's
 * builder producing the value from routes rather than copying the fixture.
 */

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, test } from "node:test";

import { sortKeysDeep } from "@/lib/tx/bytes";
import {
  encodePoolSwap,
  encodeSplitRouteSwapExactAmountIn,
  encodeSwapExactAmountIn,
  OsmosisEncodeError,
  POOL_SPLIT_SWAP_AMINO_TYPE,
  POOL_SPLIT_SWAP_TYPE_URL,
  POOL_SWAP_AMINO_TYPE,
  POOL_SWAP_TYPE_URL,
  poolSwapAmino,
  poolSwapTxMessage,
} from "@/lib/tx/osmosis";
import { buildPoolSwapMsg, readPoolSwapMsg, type PoolRoute } from "../pool";

interface Vector {
  readonly name: string;
  readonly type_url: string;
  readonly amino_type: string;
  readonly msg_proto_hex: string;
  readonly amino_sign_doc: string;
}

const VECTORS = (
  JSON.parse(readFileSync(join(import.meta.dirname, "fixtures/poolmanager-vectors.json"), "utf8")) as {
    cases: Vector[];
  }
).cases;

function hex(bytes: Uint8Array): string {
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
}

function vector(name: string): Vector & { value: Record<string, unknown> } {
  const found = VECTORS.find((entry) => entry.name === name);
  assert.ok(found, `vector ${name} missing`);
  const doc = JSON.parse(found.amino_sign_doc) as { msgs: { type: string; value: Record<string, unknown> }[] };
  assert.equal(doc.msgs.length, 1);
  assert.equal(doc.msgs[0]?.type, found.amino_type);
  return { ...found, value: doc.msgs[0]!.value };
}

/** Routes as the engine holds them, from a vector's amino value. */
function routesOf(value: Record<string, unknown>, split: boolean): PoolRoute[] {
  const raw = value.routes as Record<string, unknown>[];
  if (!split) {
    const tokenIn = value.token_in as { amount: string };
    return [
      {
        hops: raw.map((hop) => ({ poolId: String(hop.pool_id), tokenOutDenom: String(hop.token_out_denom) })),
        inAmount: tokenIn.amount,
      },
    ];
  }
  return raw.map((route) => ({
    hops: (route.pools as Record<string, unknown>[]).map((hop) => ({
      poolId: String(hop.pool_id),
      tokenOutDenom: String(hop.token_out_denom),
    })),
    inAmount: String(route.token_in_amount),
  }));
}

describe("the poolmanager golden vectors", () => {
  test("the fixture holds the three osmojs cases", () => {
    assert.deepEqual(
      VECTORS.map((entry) => entry.name),
      ["msg_swap_exact_amount_in", "msg_swap_exact_amount_in_multi_hop", "msg_split_route_swap_exact_amount_in"],
    );
  });

  for (const [name, split] of [
    ["msg_swap_exact_amount_in", false],
    ["msg_swap_exact_amount_in_multi_hop", false],
    ["msg_split_route_swap_exact_amount_in", true],
  ] as const) {
    test(`${name}: built from routes, the bytes and the amino document are osmojs's`, () => {
      const v = vector(name);
      const built = buildPoolSwapMsg({
        sender: String(v.value.sender),
        denom: split ? String(v.value.token_in_denom) : String((v.value.token_in as { denom: string }).denom),
        routes: routesOf(v.value, split),
        minOut: String(v.value.token_out_min_amount),
      });
      assert.equal(built.typeUrl, v.type_url);
      // Protobuf, byte for byte.
      assert.equal(hex(encodePoolSwap(built.typeUrl, built.value)), v.msg_proto_hex);
      // Amino: the name, and the value as the sign doc serialises it.
      const amino = poolSwapAmino(built.typeUrl, built.value);
      assert.equal(amino.type, v.amino_type);
      assert.equal(JSON.stringify(sortKeysDeep(amino.value)), JSON.stringify(sortKeysDeep(v.value)));
      // And the signable message carries both, read back to the same swap.
      const message = poolSwapTxMessage(built.typeUrl, built.value);
      assert.equal(hex(message.value), v.msg_proto_hex);
      assert.deepEqual(readPoolSwapMsg({ typeUrl: built.typeUrl, value: message.amino!.value }), readPoolSwapMsg(built));
    });
  }

  test("type URLs and amino names are Osmosis's", () => {
    assert.equal(POOL_SWAP_TYPE_URL, "/osmosis.poolmanager.v1beta1.MsgSwapExactAmountIn");
    assert.equal(POOL_SPLIT_SWAP_TYPE_URL, "/osmosis.poolmanager.v1beta1.MsgSplitRouteSwapExactAmountIn");
    assert.equal(POOL_SWAP_AMINO_TYPE, "osmosis/poolmanager/swap-exact-amount-in");
    assert.equal(POOL_SPLIT_SWAP_AMINO_TYPE, "osmosis/poolmanager/split-amount-in");
  });
});

describe("the encoder refuses what it would otherwise coerce", () => {
  const single = vector("msg_swap_exact_amount_in").value;
  const split = vector("msg_split_route_swap_exact_amount_in").value;

  test("an unknown or missing field, a wrong type, a pool id that is not one", () => {
    const bad: unknown[] = [
      { ...single, extra: 1 },
      { ...single, token_out_min_amount: 350000 },
      { ...single, token_out_min_amount: "-1" },
      { ...single, routes: [] },
      { ...single, routes: [{ pool_id: 3586, token_out_denom: "uosmo" }] },
      { ...single, routes: [{ pool_id: "0", token_out_denom: "uosmo" }] },
      { ...single, routes: [{ pool_id: "18446744073709551616", token_out_denom: "uosmo" }] },
      { ...single, token_in: { denom: "uosmo" } },
      { ...single, sender: "" },
    ];
    for (const value of bad) {
      assert.throws(() => encodeSwapExactAmountIn(value), OsmosisEncodeError, JSON.stringify(value));
    }
    assert.throws(() => encodeSplitRouteSwapExactAmountIn({ ...split, routes: [{ pools: [], token_in_amount: "1" }] }), OsmosisEncodeError);
    assert.throws(() => encodeSplitRouteSwapExactAmountIn({ ...split, token_in: {} }), OsmosisEncodeError);
    assert.throws(() => encodePoolSwap("/osmosis.gamm.v1beta1.MsgSwapExactAmountIn", single), OsmosisEncodeError);
  });

  test("the largest uint64 pool id still encodes", () => {
    const bytes = encodeSwapExactAmountIn({ ...single, routes: [{ pool_id: "18446744073709551615", token_out_denom: "uosmo" }] });
    assert.ok(bytes.length > 0);
  });
});
