/**
 * Event parsing: coin strings, the three response shapes, attribute pairing
 * in merged SDK 0.47 events, pass-throughs and the fee payer.
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { feePayerOf, flowsFor, inbound, listCoins, messageEvents, outbound, parseCoins, withoutPassThrough, type TxEvent } from "../events";

const ev = (type: string, pairs: Array<[string, string]>, msgIndex: number | null = 0): TxEvent => ({
  type,
  attributes: pairs.map(([key, value]) => ({ key, value })),
  msgIndex,
});

describe("parseCoins", () => {
  it("reads coin lists and skips what is not a coin", () => {
    assert.deepEqual(parseCoins("78179uosmo,3494518ibc/D189335C6E4A68B513C10AB227BF1C1D38C746766278BA3EEB4FB14124F1D858"), [
      { amount: "78179", denom: "uosmo" },
      { amount: "3494518", denom: "ibc/D189335C6E4A68B513C10AB227BF1C1D38C746766278BA3EEB4FB14124F1D858" },
    ]);
    assert.deepEqual(parseCoins("760erc20:0xa00C59fF5a080D2b954d0c75e46E22a0c371235a"), [
      { amount: "760", denom: "erc20:0xa00C59fF5a080D2b954d0c75e46E22a0c371235a" },
    ]);
    assert.deepEqual(parseCoins(""), []);
    assert.deepEqual(parseCoins("12.5uatom,abc,0042uosmo"), [{ amount: "42", denom: "uosmo" }]);
  });
});

describe("flowsFor", () => {
  it("pairs receivers and amounts in a merged event", () => {
    const merged = ev("coin_received", [
      ["receiver", "A"],
      ["amount", "5uatom"],
      ["receiver", "B"],
      ["amount", "7uatom"],
      ["receiver", "A"],
      ["amount", "1uatom,2uosmo"],
    ]);
    const flows = flowsFor([merged, ev("coin_spent", [["spender", "A"], ["amount", "3uosmo"]], 1)], "A");
    assert.deepEqual(listCoins(flows.total, "in"), [
      { denom: "uatom", amount: "6" },
      { denom: "uosmo", amount: "2" },
    ]);
    assert.deepEqual(listCoins(flows.byMessage.get(1), "out"), [{ denom: "uosmo", amount: "3" }]);
  });

  it("drops pass-through denoms per message, never across messages", () => {
    const events = [
      ev("coin_received", [["receiver", "A"], ["amount", "10hop"]], 0),
      ev("coin_spent", [["spender", "A"], ["amount", "10hop,4uosmo"]], 0),
      ev("coin_received", [["receiver", "A"], ["amount", "9out"]], 0),
    ];
    const flows = flowsFor(events, "A");
    assert.deepEqual(outbound(flows.byMessage.get(0)), [{ denom: "uosmo", amount: "4" }]);
    assert.deepEqual(inbound(flows.byMessage.get(0)), [{ denom: "out", amount: "9" }]);
    assert.equal(withoutPassThrough(flows.total).has("hop"), false);
  });
});

describe("messageEvents", () => {
  it("prefers SDK 0.47 logs, then msg_index, then everything", () => {
    const logs = { logs: [{ msg_index: 0, events: [{ type: "message", attributes: [{ key: "action", value: "x" }] }] }], events: [] };
    assert.equal(messageEvents(logs).source, "logs");
    const indexed = {
      logs: [],
      events: [
        { type: "tx", attributes: [{ key: "fee", value: "1uatom" }] },
        { type: "message", attributes: [{ key: "action", value: "x" }, { key: "msg_index", value: "0" }] },
      ],
    };
    const read = messageEvents(indexed);
    assert.equal(read.source, "msg_index");
    assert.deepEqual(read.events.map((event) => event.type), ["message"]);
    assert.equal(messageEvents({ events: [{ type: "tx", attributes: [] }] }).source, "flat");
  });

  it("decodes base64 attributes of old nodes", () => {
    const read = messageEvents({ events: [{ type: "transfer", attributes: [{ key: btoa("recipient"), value: btoa("cosmos1x") }, { key: "amount", value: "5uatom" }] }] });
    assert.deepEqual(read.events[0].attributes, [
      { key: "recipient", value: "cosmos1x" },
      { key: "amount", value: "5uatom" },
    ]);
  });
});

describe("feePayerOf", () => {
  const signerEvents = [ev("tx", [["acc_seq", "cosmos1signer/41"]], null)];

  it("follows fee grants, explicit payers, the reported payer, then the first signer", () => {
    assert.deepEqual(feePayerOf({ granter: "cosmos1granter", payer: "" }, signerEvents), {
      payer: "cosmos1granter",
      granter: "cosmos1granter",
      signer: "cosmos1signer",
    });
    assert.equal(feePayerOf({ granter: "", payer: "cosmos1payer" }, signerEvents).payer, "cosmos1payer");
    assert.equal(feePayerOf(null, [ev("tx", [["fee", "1uatom"], ["fee_payer", "cosmos1reported"]], null), ...signerEvents]).payer, "cosmos1reported");
    assert.equal(feePayerOf(null, signerEvents).payer, "cosmos1signer");
    assert.equal(feePayerOf(null, []).payer, null);
  });
});
