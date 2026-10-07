/**
 * The transaction detail (`parseTxDetail`) over recorded transactions: the
 * neutral reading of every message, packets, coin movements, the failure
 * text, and the bounds that keep a relayer's huge message small.
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { parseTxDetail } from "../decode";
import { sanitizeJson } from "../sanitize";
import { ACCOUNTS, fixture, testContext } from "./helpers";

const NOW = Date.UTC(2026, 9, 7);

describe("parseTxDetail", () => {
  it("reads a Zunia swap neutrally, with its packet and explorer link", () => {
    const detail = parseTxDetail(fixture("osmo-zunia-swap.json"), testContext("osmosis-1"), { now: NOW });
    assert.ok(detail);
    assert.equal(detail.updatedAt, NOW);
    assert.equal(detail.success, true);
    assert.equal(detail.code, undefined);
    assert.equal(detail.gasUsed, 565195);
    assert.equal(detail.gasWanted, 781786);
    assert.equal(detail.signer, ACCOUNTS.swapper);
    assert.equal(detail.feePayer, ACCOUNTS.swapper);
    assert.deepEqual(detail.fee, { amount: "78179", denom: "uosmo", symbol: "OSMO", decimals: 6, key: "osmosis-1:uosmo" });
    assert.deepEqual(
      detail.messages.map((message) => [message.type, message.summary]),
      [
        ["MsgSwapExactAmountIn", "Swapped 99.5 OSMO for USDC.inj"],
        ["MsgSend", "Paid the Zunia swap fee of 0.5 OSMO"],
        ["MsgTransfer", "Sent 3.4318 USDC.inj over IBC from osmo1zva9…g8mm to inj138rm…h602"],
      ],
    );
    assert.deepEqual(detail.packets, [
      {
        stage: "send",
        sequence: "782901",
        sourcePort: "transfer",
        sourceChannel: "channel-122",
        destPort: "transfer",
        destChannel: "channel-8",
        counterpartyChainId: "injective-1",
        denom: "transfer/channel-122/erc20:0xa00C59fF5a080D2b954d0c75e46E22a0c371235a",
        amount: "3431895",
        sender: ACCOUNTS.swapper,
        receiver: "inj138rmrzrvu5kwy8guw3ckvs872rwsw547vch602",
        timeoutTimestamp: "1791324150977000000",
      },
    ]);
    assert.equal(
      detail.explorerUrl,
      "https://www.mintscan.io/osmosis/transactions/7B5E447B64067CF2E5E31D4921927156C3F9B9B913E06895239E0795D72B57F3",
    );
    // The fee transfer is the first movement and belongs to no message.
    assert.equal(detail.movements[0].msgIndex, null);
    assert.equal(detail.movements[0].from, ACCOUNTS.swapper);
    assert.equal(detail.movements[0].amount, "78179");
    assert.ok(detail.events.some((event) => event.type === "token_swapped" && event.count === 2));
    assert.equal(detail.forAddress, undefined);
  });

  it("adds the row of an involved account, and null for an uninvolved one", () => {
    const forTreasury = parseTxDetail(fixture("osmo-zunia-swap.json"), testContext("osmosis-1"), { address: ACCOUNTS.treasury });
    assert.equal(forTreasury?.forAddress?.kind, "receive");
    assert.deepEqual(forTreasury?.forAddress?.amounts.map((amount) => amount.amount), ["500000"]);
    const stranger = parseTxDetail(fixture("osmo-zunia-swap.json"), testContext("osmosis-1"), { address: ACCOUNTS.compounder });
    assert.equal(stranger?.forAddress, null);
  });

  it("reads a relayed delivery: the packet, its acknowledgement and the far chain", () => {
    const detail = parseTxDetail(fixture("safro-ibc-in.json"), testContext("safrochain-1"), { address: ACCOUNTS.vinjan });
    assert.ok(detail);
    assert.deepEqual(
      detail.messages.map((message) => message.summary),
      [
        "Updated IBC client 07-tendermint-2",
        "Delivered 760 base units of erc20:0xa00C…71235a from inj1zdq2…dwz0 to addr_safro1t0aw…z4ps",
      ],
    );
    assert.equal(detail.packets.length, 1);
    assert.equal(detail.packets[0].stage, "receive");
    assert.equal(detail.packets[0].ack, "success");
    assert.equal(detail.packets[0].counterpartyChainId, "injective-1");
    assert.equal(detail.forAddress?.summary, "Received 0.00076 USDC.inj from inj1zdq2…dwz0 on Injective");
    // A 90 KB relayer transaction (headers, proofs) stays small once bounded.
    assert.ok(JSON.stringify(detail).length < 40_000, `detail is ${JSON.stringify(detail).length} bytes`);
  });

  it("explains a failed transaction in the chain's words, trimmed", () => {
    const detail = parseTxDetail(fixture("safro-failed-transfer.json"), testContext("safrochain-1"));
    assert.ok(detail);
    assert.equal(detail.success, false);
    assert.equal(detail.code, 40);
    assert.equal(detail.codespace, "channel");
    assert.ok(detail.rawLog?.startsWith("failed to execute message; message index: 0: invalid packet timeout"));
    assert.ok((detail.rawLog?.length ?? 0) <= 400);
    assert.deepEqual(detail.packets, []);
    assert.ok(detail.messages[0].summary.startsWith("Failed to send 3,190 SAF over IBC from addr_safro1jz4f…yzax"));
    assert.equal(detail.explorerUrl, "https://explorer.safrochain.com/tx/011EAA786B806EC38938F6A022F174ACEACE910364ED3600C1ED5F69EA64659A");
  });

  it("has no explorer link for a chain the registry names none for", () => {
    const detail = parseTxDetail(fixture("kava-vote-sdk47.json"), testContext("kava_2222-10"));
    assert.ok(detail);
    assert.equal(detail.explorerUrl, undefined);
    assert.equal(detail.messages[0].summary, "Voted Yes on proposal #221");
  });
});

describe("sanitizeJson", () => {
  it("keeps the shape and marks every cut", () => {
    const out = sanitizeJson(
      { long: "x".repeat(600), list: Array.from({ length: 25 }, (_, i) => i), deep: { a: { b: { c: 1 } } } },
      { maxDepth: 2, maxArray: 20, maxString: 512, maxKeys: 40, maxNodes: 1_000 },
    ) as Record<string, unknown>;
    assert.equal(out.long, `${"x".repeat(512)}… (+88 characters)`);
    assert.equal((out.list as unknown[]).length, 21);
    assert.equal((out.list as unknown[])[20], "… 5 more items");
    assert.deepEqual(out.deep, { a: "[object with 1 fields omitted]" });
  });

  it("stops at the node budget", () => {
    const out = sanitizeJson(Array.from({ length: 10 }, () => ({ a: 1, b: 2 })), {
      maxDepth: 8,
      maxArray: 20,
      maxString: 512,
      maxKeys: 40,
      maxNodes: 5,
    }) as unknown[];
    assert.ok(JSON.stringify(out).includes("[omitted: too large to show]"));
  });
});
