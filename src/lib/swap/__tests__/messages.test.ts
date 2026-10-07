/**
 * Signable swap messages (src/lib/swap/messages.ts): each carries protobuf
 * bytes and an amino document derived from one view, and `viewOf` reads a
 * message back only when the two still agree byte for byte.
 */

import "./json-modules";
import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { bech32 } from "@scure/base";

import { msgProtoBytes } from "@/lib/tx/amino-tx";
import { buildSwapFeeMsg } from "../fee";
import { EXECUTE_CONTRACT_TYPE_URL, toTxMessage, viewOf } from "../messages";
import { buildPoolSwapMsg, TRANSFER_TYPE_URL } from "../pool";
import type { MsgJson } from "../types";

const address = (prefix: string, fill: number) => bech32.encode(prefix, bech32.toWords(new Uint8Array(20).fill(fill)));
const OSMO_ME = address("osmo", 7);
const INJ_ME = address("inj", 9);
const USDC_INJ = "ibc/794C7D7F3B857713878A3A1927251FA6AC1EEE520424C1F6FAFE9BA26D476138";

const TRANSFER: MsgJson = {
  typeUrl: TRANSFER_TYPE_URL,
  value: {
    source_port: "transfer",
    source_channel: "channel-122",
    token: { denom: USDC_INJ, amount: "351087" },
    sender: OSMO_ME,
    receiver: INJ_ME,
    timeout_height: {},
    timeout_timestamp: "1791330600000000000",
  },
};

describe("toTxMessage", () => {
  test("writes MsgTransfer's amino in CosmJS's shape: an empty height kept, an empty memo left out", () => {
    const msg = toTxMessage(TRANSFER, "Send");
    assert.equal(msg.typeUrl, TRANSFER_TYPE_URL);
    assert.equal(msg.summary, "Send");
    assert.deepEqual(msg.amino, {
      type: "cosmos-sdk/MsgTransfer",
      value: {
        source_port: "transfer",
        source_channel: "channel-122",
        token: { denom: USDC_INJ, amount: "351087" },
        sender: OSMO_ME,
        receiver: INJ_ME,
        timeout_height: {},
        timeout_timestamp: "1791330600000000000",
      },
    });
    // The protobuf still carries the (zero) height, as ibc-go's non-nullable field requires.
    assert.deepEqual(msg.value, msgProtoBytes(msg.amino!).value);
    const withMemo = toTxMessage({ ...TRANSFER, value: { ...TRANSFER.value, memo: '{"wasm":{}}' } });
    assert.equal(withMemo.amino?.value.memo, '{"wasm":{}}');
  });

  test("encodes the fee send and the contract call through the shared amino encoder", () => {
    const fee = toTxMessage(buildSwapFeeMsg({ sender: OSMO_ME, recipient: address("osmo", 1), denom: "uosmo", amount: BigInt(50_000) }));
    assert.equal(fee.amino?.type, "cosmos-sdk/MsgSend");
    assert.deepEqual(fee.value, msgProtoBytes(fee.amino!).value);
    const call = toTxMessage({
      typeUrl: EXECUTE_CONTRACT_TYPE_URL,
      value: { sender: OSMO_ME, contract: address("osmo", 2), msg: { osmosis_swap: { b: 1, a: 2 } }, funds: [{ denom: "uosmo", amount: "1" }] },
    });
    assert.equal(call.amino?.type, "wasm/MsgExecuteContract");
    // The execute body is signed with sorted keys, in the bytes and the document alike.
    assert.ok(new TextDecoder().decode(call.value).includes('{"osmosis_swap":{"a":2,"b":1}}'));
  });

  test("refuses a type the swap does not sign, or a value it cannot encode", () => {
    assert.throws(() => toTxMessage({ typeUrl: "/cosmos.bank.v1beta1.MsgMultiSend", value: {} }));
    assert.throws(() => toTxMessage({ ...TRANSFER, value: { ...TRANSFER.value, token: "uosmo" } }));
    assert.throws(() => toTxMessage({ typeUrl: EXECUTE_CONTRACT_TYPE_URL, value: { sender: OSMO_ME, contract: OSMO_ME, msg: "x", funds: [] } }));
  });
});

describe("viewOf", () => {
  const swap = toTxMessage(
    buildPoolSwapMsg({
      sender: OSMO_ME,
      denom: "uosmo",
      routes: [{ hops: [{ poolId: "3498", tokenOutDenom: USDC_INJ }], inAmount: "9950000" }],
      minOut: "351087",
    }),
  );

  test("reads back exactly what was built", () => {
    assert.deepEqual(viewOf(toTxMessage(TRANSFER)), { typeUrl: TRANSFER_TYPE_URL, value: toTxMessage(TRANSFER).amino!.value });
    assert.equal(viewOf(swap)?.value.token_out_min_amount, "351087");
  });

  test("returns a copy the caller cannot edit through", () => {
    const view = viewOf(swap)!;
    (view.value as Record<string, unknown>).token_out_min_amount = "1";
    assert.equal(viewOf(swap)?.value.token_out_min_amount, "351087");
  });

  test("refuses a message whose bytes, amino document or names disagree", () => {
    const flipped = new Uint8Array(swap.value);
    flipped[3] = (flipped[3] ?? 0) ^ 0xff;
    assert.equal(viewOf({ ...swap, value: flipped }), null);
    assert.equal(viewOf({ ...swap, amino: { ...swap.amino!, value: { ...swap.amino!.value, sender: INJ_ME } } }), null);
    assert.equal(viewOf({ ...swap, amino: { ...swap.amino!, type: "osmosis/poolmanager/split-amount-in" } }), null);
    assert.equal(viewOf({ ...swap, typeUrl: "/osmosis.gamm.v1beta1.MsgSwapExactAmountIn" }), null);
    assert.equal(viewOf({ typeUrl: swap.typeUrl, value: swap.value }), null);
    assert.equal(viewOf(undefined), null);
    // An extra amino field the encoder ignores is still read (and refused by the readers' exact-key rules).
    const transfer = toTxMessage(TRANSFER);
    assert.equal(viewOf({ ...transfer, amino: { ...transfer.amino!, value: { ...transfer.amino!.value, extra: 1 } } })?.value.extra, 1);
  });
});
