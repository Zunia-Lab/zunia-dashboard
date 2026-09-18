/**
 * The approval screen must describe the bytes it is about to sign.
 *
 * These tests pin the property that makes `describeNftTransfer` a security
 * control rather than a caption: the sentences come from decoding the built
 * message, the decoded body is the body that goes into the amino builder, and
 * anything that cannot be fully accounted for is refused instead of narrated.
 */

import assert from "node:assert/strict";
import { test } from "node:test";

import {
  buildNftTransferMsg,
  decodeBase64Utf8,
  jsonToBase64,
  type ChainInfoLike,
  type JsonObject,
  type NftTransferRequest,
} from "@zunialab/interchain";
import { describeBuiltNftMsg, describeNftTransfer } from "../describe";
import { msgExecuteContract } from "@/lib/tx/amino-tx";
import { msgProtoBytes } from "@/lib/tx/amino-tx";

const JUNO: ChainInfoLike = {
  chainId: "juno-1",
  chainName: "Juno",
  bech32Prefix: "juno",
  coinType: 118,
  network: "mainnet",
  coinDenom: "JUNO",
  coinMinimalDenom: "ujuno",
  coinDecimals: 6,
  feeDenom: "JUNO",
  feeMinimalDenom: "ujuno",
  feeDecimals: 6,
  features: ["cosmwasm"],
};

const STARGAZE: ChainInfoLike = {
  ...JUNO,
  chainId: "stargaze-1",
  chainName: "Stargaze",
  bech32Prefix: "stars",
  coinDenom: "STARS",
  coinMinimalDenom: "ustars",
  feeDenom: "STARS",
  feeMinimalDenom: "ustars",
};

const NO_WASM: ChainInfoLike = {
  ...JUNO,
  chainId: "cosmoshub-4",
  chainName: "Cosmos Hub",
  bech32Prefix: "cosmos",
  features: ["ibc-transfer"],
};

const OWNER = "juno1v9xk3cq5wr6c0dhwqfwmxq0lqzpp4gh42yqxlq";
const FRIEND = "juno1zqx8dm0lqqzflzvpsjuqxhqfqf5dtgclqxctwq";
const COLLECTION = "juno1fkj2rsdt2swpm4gz85cpqjcpqmtfqf9lqsqvzq";
const BRIDGE = "juno1qgzcqwlxjq5dppqgqjqcqvqmqvqsqgqcqxqjqq";
const STARS_FRIEND = "stars1zqx8dm0lqqzflzvpsjuqxhqfqf5dtgclq8u3xh";

/** A fixed clock, so the ICS721 timeout is a value the assertions can name. */
const NOW = () => 1_700_000_000_000;

function sameChain(): NftTransferRequest {
  return {
    chainId: "juno-1",
    collectionAddress: COLLECTION,
    tokenId: "42",
    sender: OWNER,
    recipient: FRIEND,
  };
}

function crossChain(): NftTransferRequest {
  return {
    chainId: "juno-1",
    collectionAddress: COLLECTION,
    tokenId: "42",
    sender: OWNER,
    recipient: STARS_FRIEND,
    destChainId: "stargaze-1",
    channelId: "channel-3",
    bridgeContract: BRIDGE,
  };
}

test("a same-chain transfer names the token, the collection and the recipient", () => {
  const result = describeNftTransfer(JUNO, sameChain(), {
    collectionName: "Zunia Test Apes",
  });
  assert.equal(result.ok, true);
  if (!result.ok) return;

  assert.equal(result.action.kind, "transfer_nft");
  assert.equal(result.action.tokenId, "42");
  assert.equal(result.action.recipient, FRIEND);
  assert.equal(result.action.contract, COLLECTION);
  assert.deepEqual(result.action.executeMsg, {
    transfer_nft: { recipient: FRIEND, token_id: "42" },
  });

  const text = result.action.statements.map((line) => line.text).join(" ");
  assert.match(text, /Token 42/);
  assert.match(text, /Zunia Test Apes/);
  assert.match(text, new RegExp(FRIEND));
  // "no undo" is a warning, not a blocker.
  assert.equal(result.action.risk, "notice");
});

test("the described body is byte-for-byte the body that gets signed", () => {
  const request = sameChain();
  const built = buildNftTransferMsg(JUNO, request);
  const result = describeNftTransfer(JUNO, request);
  assert.equal(result.ok, true);
  if (!result.ok) return;

  // The decode round-trips exactly, key order included: what the screen
  // described is character-for-character the payload the engine built.
  assert.equal(
    JSON.stringify(result.action.executeMsg),
    decodeBase64Utf8(String(built.value.msg)),
  );

  // And that same body is what the amino builder is handed, so the proto bytes
  // the chain receives carry the JSON these sentences were written from.
  const proto = msgProtoBytes(
    msgExecuteContract({
      sender: result.action.sender,
      contract: result.action.contract,
      msg: result.action.executeMsg,
    }),
  );
  assert.equal(proto.typeUrl, "/cosmwasm.wasm.v1.MsgExecuteContract");
  const wire = new TextDecoder().decode(proto.value);
  assert.ok(wire.includes('"transfer_nft"'));
  assert.ok(wire.includes(FRIEND));
  assert.ok(wire.includes('"42"'));
});

test("a chain without the cosmwasm feature refuses to build at all", () => {
  const result = describeNftTransfer(NO_WASM, {
    ...sameChain(),
    chainId: "cosmoshub-4",
    collectionAddress: "cosmos1fkj2rsdt2swpm4gz85cpqjcpqmtfqf9lq0h2h5",
    sender: "cosmos1v9xk3cq5wr6c0dhwqfwmxq0lqzpp4gh42w6ntt",
    recipient: "cosmos1zqx8dm0lqqzflzvpsjuqxhqfqf5dtgclqcsdlg",
  });
  assert.equal(result.ok, false);
  if (result.ok) return;
  assert.match(result.message, /cosmwasm/);
});

test("a recipient on the wrong chain is refused before anything is described", () => {
  const result = describeNftTransfer(JUNO, {
    ...sameChain(),
    recipient: STARS_FRIEND,
  });
  assert.equal(result.ok, false);
  if (result.ok) return;
  assert.match(result.message, /Recipient/);
  assert.match(result.message, /juno/);
});

test("an ICS721 transfer says the destination gets a voucher, not the token", () => {
  const result = describeNftTransfer(JUNO, crossChain(), {
    destChain: STARGAZE,
    bridgeContract: BRIDGE,
    chainName: (id) => (id === "stargaze-1" ? "Stargaze" : id),
    now: NOW,
  });
  assert.equal(result.ok, true);
  if (!result.ok) return;

  assert.equal(result.action.kind, "ics721");
  assert.equal(result.action.bridgeContract, BRIDGE);
  assert.equal(result.action.channelId, "channel-3");
  assert.equal(result.action.recipient, STARS_FRIEND);

  const text = result.action.statements.map((line) => line.text).join(" ");
  assert.match(text, /voucher/i);
  assert.match(text, /escrowed|locks it/i);
  assert.match(text, /channel-3/);

  // The inner IbcOutgoingMsg is shown, decoded, not as base64.
  assert.ok(result.action.innerJson);
  const inner = JSON.parse(result.action.innerJson!) as Record<string, unknown>;
  assert.equal(inner.receiver, STARS_FRIEND);
  assert.equal(inner.channel_id, "channel-3");

  // 10 minutes from the fixed clock, in nanoseconds.
  assert.equal(
    result.action.timeoutNanos,
    String((1_700_000_000_000 + 600_000) * 1_000_000),
  );
});

test("a send_nft aimed anywhere but the configured bridge is refused", () => {
  const result = describeNftTransfer(
    JUNO,
    { ...crossChain(), bridgeContract: COLLECTION },
    {
      destChain: STARGAZE,
      // The operator configured a different bridge; the payload names another.
      bridgeContract: BRIDGE,
      now: NOW,
    },
  );
  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.equal(result.action.kind, "unknown");
  assert.equal(result.action.risk, "danger");
  assert.match(
    result.action.statements[0]!.text,
    /not the cw-ics721 bridge this deployment configured/,
  );
});

test("a cross-chain request with no bridge configured cannot be built", () => {
  const request = crossChain();
  const result = describeNftTransfer(
    JUNO,
    { ...request, bridgeContract: undefined },
    { destChain: STARGAZE },
  );
  assert.equal(result.ok, false);
  if (result.ok) return;
  assert.match(result.message, /bridge contract/i);
});

test("a cross-chain request with no channel cannot be built", () => {
  const result = describeNftTransfer(
    JUNO,
    { ...crossChain(), channelId: undefined },
    { destChain: STARGAZE },
  );
  assert.equal(result.ok, false);
  if (result.ok) return;
  assert.match(result.message, /channel/i);
});

test("a receiver on the wrong destination chain is refused", () => {
  const result = describeNftTransfer(
    JUNO,
    { ...crossChain(), recipient: FRIEND },
    { destChain: STARGAZE, bridgeContract: BRIDGE },
  );
  assert.equal(result.ok, false);
  if (result.ok) return;
  assert.match(result.message, /Recipient/);
  assert.match(result.message, /stars/);
});

test("an empty token id is refused", () => {
  const result = describeNftTransfer(JUNO, { ...sameChain(), tokenId: "" });
  assert.equal(result.ok, false);
  if (result.ok) return;
  assert.match(result.message, /Token id/i);
});

/* -------------------------------------------------------------------------- *
 * Payloads the engine would never build
 * -------------------------------------------------------------------------- *
 * These go through `describeBuiltNftMsg` directly. They are the branches that
 * matter if the engine's builders ever change shape, or if something other than
 * the engine assembles the message — and a refusal branch nobody has exercised
 * is a refusal branch nobody knows works.
 */

function executeMsg(body: JsonObject): ReturnType<typeof buildNftTransferMsg> {
  return {
    typeUrl: "/cosmwasm.wasm.v1.MsgExecuteContract",
    value: {
      sender: OWNER,
      contract: COLLECTION,
      msg: jsonToBase64(body),
      funds: [],
    },
  };
}

test("a payload that is not base64 JSON is refused, not narrated", () => {
  const action = describeBuiltNftMsg(
    {
      typeUrl: "/cosmwasm.wasm.v1.MsgExecuteContract",
      value: { sender: OWNER, contract: COLLECTION, msg: "not base64!!", funds: [] },
    },
    JUNO,
    sameChain(),
  );
  assert.equal(action.risk, "danger");
  assert.equal(action.kind, "unknown");
  assert.match(action.statements[0]!.text, /could not be decoded/);
});

test("an execute body with two actions is refused", () => {
  const action = describeBuiltNftMsg(
    executeMsg({
      transfer_nft: { recipient: FRIEND, token_id: "42" },
      approve_all: { operator: FRIEND },
    }),
    JUNO,
    sameChain(),
  );
  assert.equal(action.risk, "danger");
  assert.match(action.statements[0]!.text, /carries exactly one action/);
});

test("an approve is refused: it is not a transfer", () => {
  const action = describeBuiltNftMsg(
    executeMsg({ approve_all: { operator: FRIEND, expires: null } }),
    JUNO,
    sameChain(),
  );
  assert.equal(action.risk, "danger");
  assert.match(action.statements[0]!.text, /which is not a transfer/);
});

test("a transfer_nft carrying an unrecognised field is refused", () => {
  const action = describeBuiltNftMsg(
    executeMsg({
      transfer_nft: { recipient: FRIEND, token_id: "42", also_burn: true },
    }),
    JUNO,
    sameChain(),
  );
  assert.equal(action.risk, "danger");
  assert.match(action.statements[0]!.text, /also_burn/);
});

test("a payload moving a different token than the screen shows is refused", () => {
  const action = describeBuiltNftMsg(
    executeMsg({ transfer_nft: { recipient: FRIEND, token_id: "999" } }),
    JUNO,
    sameChain(),
  );
  assert.equal(action.risk, "danger");
  assert.match(action.statements[0]!.text, /token 999.*showing token 42/);
});

test("a payload sending to a different address than the screen shows is refused", () => {
  const action = describeBuiltNftMsg(
    executeMsg({
      transfer_nft: { recipient: "juno1attackerqwlxjq5dppqgqjqcqvqmqvqsqgqcqx", token_id: "42" },
    }),
    JUNO,
    sameChain(),
  );
  assert.equal(action.risk, "danger");
  assert.match(action.statements[0]!.text, /juno1attacker/);
});

test("a send_nft whose inner payload is not decodable is refused", () => {
  const action = describeBuiltNftMsg(
    executeMsg({
      send_nft: { contract: BRIDGE, token_id: "42", msg: "%%%not-base64%%%" },
    }),
    JUNO,
    crossChain(),
    { bridgeContract: BRIDGE },
  );
  assert.equal(action.risk, "danger");
  assert.match(action.statements[0]!.text, /cannot decode/);
});

test("an IbcOutgoingMsg with an unrecognised field is refused", () => {
  const action = describeBuiltNftMsg(
    executeMsg({
      send_nft: {
        contract: BRIDGE,
        token_id: "42",
        msg: jsonToBase64({
          receiver: STARS_FRIEND,
          channel_id: "channel-3",
          timeout: { timestamp: "1800000000000000000" },
          class_id_override: "something",
        }),
      },
    }),
    JUNO,
    crossChain(),
    { bridgeContract: BRIDGE },
  );
  assert.equal(action.risk, "danger");
  assert.match(action.statements[0]!.text, /class_id_override/);
  // The decoded inner payload is still shown, so the reader can see it.
  assert.ok(action.innerJson);
});

test("an IbcOutgoingMsg with no channel is refused", () => {
  const action = describeBuiltNftMsg(
    executeMsg({
      send_nft: {
        contract: BRIDGE,
        token_id: "42",
        msg: jsonToBase64({ receiver: STARS_FRIEND }),
      },
    }),
    JUNO,
    crossChain(),
    { bridgeContract: BRIDGE },
  );
  assert.equal(action.risk, "danger");
  assert.match(action.statements[0]!.text, /receiver and a channel/);
});

test("an ICS721 payload with no timeout says so rather than implying one", () => {
  const action = describeBuiltNftMsg(
    executeMsg({
      send_nft: {
        contract: BRIDGE,
        token_id: "42",
        msg: jsonToBase64({ receiver: STARS_FRIEND, channel_id: "channel-3" }),
      },
    }),
    JUNO,
    crossChain(),
    { bridgeContract: BRIDGE, chainName: () => "Stargaze" },
  );
  assert.equal(action.kind, "ics721");
  assert.equal(action.timeoutNanos, null);
  const text = action.statements.map((line) => line.text).join(" ");
  assert.match(text, /no packet timeout/);
  // Not a blocker — it is a thing the user is agreeing to, so it is a warning.
  assert.equal(action.risk, "notice");
});
