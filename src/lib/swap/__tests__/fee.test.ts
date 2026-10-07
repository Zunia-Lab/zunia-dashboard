/**
 * Zunia's swap commission as src/lib/swap/fee.ts works it out, builds it and
 * checks it. Ported from zunia-extension lib/__tests__/swap-fee.test.ts
 * @ 1453e7a (vitest → node:test; bigint literals written as `BigInt(…)`
 * because this repo targets ES2017). Every test injects its own treasury map,
 * so the tests do not change meaning when the shipped one changes.
 */

import "./json-modules";
import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { bech32 } from "@scure/base";

import { SWAP_FEE_BPS } from "@/config/fees";
import {
  BANK_SEND_TYPE_URL,
  buildSwapFeeMsg,
  feeFromWire,
  feeRateText,
  feeToWire,
  readSwapFeeMsg,
  sameSwapFee,
  swapFeeFor,
  swapFeeIssues,
  swapFeeRecipient,
  swapFeeRecipientProblem,
  type SwapFee,
  type SwapFeeRecipients,
} from "../fee";
import type { MsgJson } from "../types";

const b = (value: number | string): bigint => BigInt(value);

/** A bech32 address with `prefix`, `bytes` long, every byte `fill`. */
const address = (prefix: string, fill: number, bytes = 20): string =>
  bech32.encode(prefix, bech32.toWords(new Uint8Array(bytes).fill(fill)));

const OSMO_TREASURY = address("osmo", 0x5a);
const HUB_TREASURY = address("cosmos", 0x5a);
const INJ_TREASURY = address("inj", 0x5b);
const ME = address("osmo", 1);
const SOMEONE = address("osmo", 7);

const RECIPIENTS: SwapFeeRecipients = {
  "osmosis-1": OSMO_TREASURY,
  "cosmoshub-4": HUB_TREASURY,
  "injective-1": INJ_TREASURY,
};

const NONE = (amount: bigint): SwapFee => ({ bps: 0, fee: b(0), net: amount, recipient: null });

describe("the fee on a swap", () => {
  test("is 50 basis points of the amount sold, with the rest swapped", () => {
    assert.equal(SWAP_FEE_BPS, 50);
    assert.deepEqual(swapFeeFor("osmosis-1", b(63_000_000), RECIPIENTS), {
      bps: 50,
      fee: b(315_000),
      net: b(62_685_000),
      recipient: OSMO_TREASURY,
    });
    assert.deepEqual(swapFeeFor("cosmoshub-4", b(1_000_000), RECIPIENTS), {
      bps: 50,
      fee: b(5_000),
      net: b(995_000),
      recipient: HUB_TREASURY,
    });
  });

  test("rounds down, so rounding only ever favours the user", () => {
    assert.deepEqual([swapFeeFor("osmosis-1", b(1_999), RECIPIENTS).fee, swapFeeFor("osmosis-1", b(1_999), RECIPIENTS).net], [b(9), b(1_990)]);
    assert.deepEqual([swapFeeFor("osmosis-1", b(2_000), RECIPIENTS).fee, swapFeeFor("osmosis-1", b(2_000), RECIPIENTS).net], [b(10), b(1_990)]);
    assert.deepEqual([swapFeeFor("osmosis-1", b(2_001), RECIPIENTS).fee, swapFeeFor("osmosis-1", b(2_001), RECIPIENTS).net], [b(10), b(1_991)]);
  });

  test("charges nothing on dust too small to carry one base unit of fee", () => {
    for (const amount of [b(1), b(2), b(100), b(199)]) {
      assert.deepEqual(swapFeeFor("osmosis-1", amount, RECIPIENTS), NONE(amount));
    }
    assert.deepEqual(swapFeeFor("osmosis-1", b(200), RECIPIENTS), { bps: 50, fee: b(1), net: b(199), recipient: OSMO_TREASURY });
    assert.deepEqual(swapFeeFor("osmosis-1", b(0), RECIPIENTS), NONE(b(0)));
    assert.deepEqual(swapFeeFor("osmosis-1", b(-5_000), RECIPIENTS), NONE(b(-5_000)));
  });

  test("works in bigint at any size, far past what a double holds", () => {
    assert.deepEqual(swapFeeFor("injective-1", b("1499999999999999999"), RECIPIENTS), {
      bps: 50,
      fee: b("7499999999999999"),
      net: b("1492500000000000000"),
      recipient: INJ_TREASURY,
    });
    const huge = b(10) ** b(40) + b(12_345);
    const { fee, net } = swapFeeFor("osmosis-1", huge, RECIPIENTS);
    assert.equal(fee, (huge * b(50)) / b(10_000));
    assert.equal(fee, b(5) * b(10) ** b(37) + b(61));
    assert.equal(fee + net, huge);
  });

  test("always splits the whole amount: fee and swap add up to what the user pays", () => {
    for (let amount = b(1); amount < b(5_000); amount += b(7)) {
      const { fee, net } = swapFeeFor("osmosis-1", amount, RECIPIENTS);
      assert.equal(fee + net, amount);
      assert.equal(fee, (amount * b(50)) / b(10_000));
      assert.ok(net > b(0));
    }
  });

  test("charges nothing on a chain with no treasury, and never from an inherited key", () => {
    assert.deepEqual(swapFeeFor("noble-1", b(1_000_000), RECIPIENTS), NONE(b(1_000_000)));
    assert.deepEqual(swapFeeFor("osmosis-1", b(1_000_000), {}), NONE(b(1_000_000)));
    for (const key of ["__proto__", "constructor", "toString", "hasOwnProperty"]) {
      assert.equal(swapFeeRecipient(key, RECIPIENTS), null);
      assert.deepEqual(swapFeeFor(key, b(1_000_000), RECIPIENTS), NONE(b(1_000_000)));
    }
  });

  test("charges nothing at a rate that is not a whole number of basis points below 100%", () => {
    const quarter = swapFeeFor("osmosis-1", b(1_000_000), RECIPIENTS, 25);
    assert.equal(quarter.bps, 25);
    assert.equal(quarter.fee, b(2_500));
    for (const bps of [0, -50, 10_000, 20_000, 2.5, Number.NaN, Number.POSITIVE_INFINITY]) {
      assert.deepEqual(swapFeeFor("osmosis-1", b(1_000_000), RECIPIENTS, bps), NONE(b(1_000_000)));
    }
  });

  test("says its rate in percent, from whole numbers", () => {
    assert.equal(feeRateText(50), "0.5%");
    assert.equal(feeRateText(SWAP_FEE_BPS), "0.5%");
    assert.equal(feeRateText(25), "0.25%");
    assert.equal(feeRateText(5), "0.05%");
    assert.equal(feeRateText(10), "0.1%");
    assert.equal(feeRateText(100), "1%");
    assert.equal(feeRateText(150), "1.5%");
  });

  test("is the same fee only when every part is", () => {
    const fee = swapFeeFor("osmosis-1", b(63_000_000), RECIPIENTS);
    assert.equal(sameSwapFee(fee, { ...fee }), true);
    assert.equal(sameSwapFee(fee, { ...fee, fee: fee.fee + b(1) }), false);
    assert.equal(sameSwapFee(fee, { ...fee, net: fee.net - b(1) }), false);
    assert.equal(sameSwapFee(fee, { ...fee, recipient: SOMEONE }), false);
    assert.equal(sameSwapFee(fee, { ...fee, bps: 49 }), false);
  });

  test("travels as JSON and is read back only in its exact shape", () => {
    const fee = swapFeeFor("osmosis-1", b(63_000_000), RECIPIENTS);
    const wire = feeToWire(fee);
    assert.deepEqual(wire, { bps: 50, fee: "315000", net: "62685000", recipient: OSMO_TREASURY });
    assert.deepEqual(feeFromWire(JSON.parse(JSON.stringify(wire))), fee);
    for (const bad of [null, { ...wire, fee: "01" }, { ...wire, fee: 315000 }, { ...wire, extra: 1 }, { ...wire, bps: 2.5 }]) {
      assert.equal(feeFromWire(bad), null);
    }
  });
});

describe("the treasury a chain pays", () => {
  test("is an address with the chain's own prefix, checksum included", () => {
    assert.equal(swapFeeRecipientProblem("osmosis-1", OSMO_TREASURY), null);
    assert.equal(swapFeeRecipientProblem("injective-1", INJ_TREASURY), null);
    // A contract (a DAO treasury) holds 32 bytes.
    assert.equal(swapFeeRecipientProblem("osmosis-1", address("osmo", 3, 32)), null);
  });

  test("is never another chain's address, which charges nothing rather than paying it", () => {
    const wrong: SwapFeeRecipients = { "cosmoshub-4": OSMO_TREASURY, "injective-1": HUB_TREASURY };
    assert.match(swapFeeRecipientProblem("cosmoshub-4", OSMO_TREASURY) ?? "", /prefix osmo, not cosmoshub-4's cosmos/);
    assert.equal(swapFeeRecipient("cosmoshub-4", wrong), null);
    assert.equal(swapFeeRecipient("injective-1", wrong), null);
    assert.deepEqual(swapFeeFor("cosmoshub-4", b(1_000_000), wrong), NONE(b(1_000_000)));
  });

  test("refuses a broken checksum, mixed or upper case, a wrong length and an unbundled chain", () => {
    const flipped = `${OSMO_TREASURY.slice(0, -1)}${OSMO_TREASURY.endsWith("q") ? "p" : "q"}`;
    assert.match(swapFeeRecipientProblem("osmosis-1", flipped) ?? "", /not a valid bech32/);
    assert.match(swapFeeRecipientProblem("osmosis-1", OSMO_TREASURY.toUpperCase()) ?? "", /lowercase/);
    assert.match(swapFeeRecipientProblem("osmosis-1", address("osmo", 1, 16)) ?? "", /16 bytes/);
    assert.match(swapFeeRecipientProblem("osmosis-1", "") ?? "", /not a valid bech32/);
    assert.match(swapFeeRecipientProblem("my-own-chain-1", OSMO_TREASURY) ?? "", /not a chain this release bundles/);
    for (const bad of [flipped, OSMO_TREASURY.toUpperCase(), address("osmo", 1, 16)]) {
      assert.equal(swapFeeRecipient("osmosis-1", { "osmosis-1": bad }), null);
    }
  });
});

describe("the message that pays it", () => {
  const paid = () => buildSwapFeeMsg({ sender: ME, recipient: OSMO_TREASURY, denom: "uosmo", amount: b(315_000) });

  test("is a bank send: from the signer, to the treasury, one coin", () => {
    assert.deepEqual(paid(), {
      typeUrl: "/cosmos.bank.v1beta1.MsgSend",
      value: { from_address: ME, to_address: OSMO_TREASURY, amount: [{ denom: "uosmo", amount: "315000" }] },
    });
    assert.equal(BANK_SEND_TYPE_URL, "/cosmos.bank.v1beta1.MsgSend");
    assert.equal(
      JSON.stringify(paid()),
      `{"typeUrl":"/cosmos.bank.v1beta1.MsgSend","value":{"from_address":"${ME}","to_address":"${OSMO_TREASURY}","amount":[{"denom":"uosmo","amount":"315000"}]}}`,
    );
  });

  test("is never built with nothing to pay or nobody to pay it", () => {
    const base = { sender: ME, recipient: OSMO_TREASURY, denom: "uosmo", amount: b(1) };
    assert.throws(() => buildSwapFeeMsg({ ...base, amount: b(0) }), /above zero/);
    assert.throws(() => buildSwapFeeMsg({ ...base, amount: b(-1) }), /above zero/);
    assert.throws(() => buildSwapFeeMsg({ ...base, recipient: "" }));
    assert.throws(() => buildSwapFeeMsg({ ...base, sender: "" }));
    assert.throws(() => buildSwapFeeMsg({ ...base, denom: "" }));
  });

  test("is read back exactly, and nothing it does not say is read as a fee", () => {
    assert.deepEqual(readSwapFeeMsg(paid()), { from: ME, to: OSMO_TREASURY, denom: "uosmo", amount: "315000" });
    const value = paid().value as Record<string, unknown>;
    const coin = { denom: "uosmo", amount: "315000" };
    const unreadable: unknown[] = [
      undefined,
      { typeUrl: "/cosmos.bank.v1beta1.MsgMultiSend", value },
      { typeUrl: "/cosmwasm.wasm.v1.MsgExecuteContract", value },
      { typeUrl: BANK_SEND_TYPE_URL, value: { ...value, amount: [coin, { denom: "uion", amount: "1" }] } },
      { typeUrl: BANK_SEND_TYPE_URL, value: { ...value, amount: [] } },
      { typeUrl: BANK_SEND_TYPE_URL, value: { ...value, amount: coin } },
      { typeUrl: BANK_SEND_TYPE_URL, value: { ...value, memo: "x" } },
      { typeUrl: BANK_SEND_TYPE_URL, value: { ...value, amount: [{ ...coin, extra: 1 }] } },
      { typeUrl: BANK_SEND_TYPE_URL, value: { to_address: OSMO_TREASURY, amount: [coin] } },
      { typeUrl: BANK_SEND_TYPE_URL, value: { ...value, to_address: "" } },
      { typeUrl: BANK_SEND_TYPE_URL, value: { ...value, from_address: 7 } },
      ...["0", "0315000", "315000.5", "-315000", "1e6", " 315000", ""].map((amount) => ({
        typeUrl: BANK_SEND_TYPE_URL,
        value: { ...value, amount: [{ denom: "uosmo", amount }] },
      })),
      { typeUrl: BANK_SEND_TYPE_URL, value: { ...value, amount: [{ denom: "uosmo", amount: 315000 }] } },
      { typeUrl: BANK_SEND_TYPE_URL, value: { ...value, amount: [{ denom: "", amount: "315000" }] } },
    ];
    for (const msg of unreadable) {
      assert.equal(readSwapFeeMsg(msg as MsgJson | undefined), null, JSON.stringify(msg));
    }
  });
});

describe("the check on a transaction's fee message", () => {
  const expected = { chainId: "osmosis-1", signer: ME, denom: "uosmo", amountUnits: b(63_000_000), recipients: RECIPIENTS } as const;
  const due = swapFeeFor("osmosis-1", b(63_000_000), RECIPIENTS);
  const send = (overrides: Partial<{ sender: string; recipient: string; denom: string; amount: bigint }> = {}) =>
    buildSwapFeeMsg({ sender: ME, recipient: OSMO_TREASURY, denom: "uosmo", amount: b(315_000), ...overrides });
  const read = (msg: MsgJson) => readSwapFeeMsg(msg);

  test("passes exactly the fee owed", () => {
    assert.deepEqual(swapFeeIssues(send(), expected), []);
  });

  test("refuses a fee to another address, in another denom, of another amount or from another account", () => {
    const elsewhere = send({ recipient: SOMEONE });
    assert.deepEqual(swapFeeIssues(elsewhere, expected), [{ kind: "recipient", paid: read(elsewhere), due }]);
    const ion = send({ denom: "uion" });
    assert.deepEqual(swapFeeIssues(ion, expected), [{ kind: "denom", paid: read(ion) }]);
    for (const amount of [b(314_999), b(315_001), b(630_000)]) {
      const other = send({ amount });
      assert.deepEqual(swapFeeIssues(other, expected), [{ kind: "amount", paid: read(other), due }]);
    }
    const theirs = send({ sender: SOMEONE });
    assert.deepEqual(swapFeeIssues(theirs, expected), [{ kind: "sender", paid: read(theirs) }]);
    const all = send({ sender: SOMEONE, recipient: SOMEONE, amount: b(1) });
    assert.deepEqual(
      swapFeeIssues(all, expected).map((issue) => issue.kind),
      ["sender", "recipient", "amount"],
    );
  });

  test("refuses a fee when none is owed, and a transaction that leaves out a fee that is", () => {
    assert.deepEqual(swapFeeIssues(send(), { ...expected, recipients: {} }), [{ kind: "not-due", paid: read(send()) }]);
    assert.deepEqual(swapFeeIssues(send({ amount: b(1) }), { ...expected, amountUnits: b(150) }), [
      { kind: "not-due", paid: read(send({ amount: b(1) })) },
    ]);
    assert.deepEqual(swapFeeIssues(undefined, expected), [{ kind: "missing", due }]);
    assert.deepEqual(swapFeeIssues(undefined, { ...expected, recipients: {} }), []);
    assert.deepEqual(swapFeeIssues(undefined, { ...expected, amountUnits: b(150) }), []);
  });

  test("refuses a second message it cannot read as a fee", () => {
    const call: MsgJson = { typeUrl: "/cosmwasm.wasm.v1.MsgExecuteContract", value: { sender: ME, contract: SOMEONE, msg: {}, funds: [] } };
    assert.deepEqual(swapFeeIssues(call, expected), [{ kind: "unreadable" }]);
    assert.deepEqual(swapFeeIssues(call, { ...expected, recipients: {} }), [{ kind: "unreadable" }]);
  });

  test("works the fee owed out again from the configuration, whatever the caller believes", () => {
    const moved: SwapFeeRecipients = { "osmosis-1": SOMEONE };
    assert.deepEqual(
      swapFeeIssues(send(), { ...expected, recipients: moved }).map((issue) => issue.kind),
      ["recipient"],
    );
  });
});
