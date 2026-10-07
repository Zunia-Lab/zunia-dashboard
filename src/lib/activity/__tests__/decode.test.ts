/**
 * Activity rows decoded from recorded transactions (./fixtures), read from
 * the side of the account each row belongs to. What is asserted is what a
 * user would see: the kind, the sentence, what entered and left the account
 * (never the network fee), who paid the fee, and the IBC packet facts.
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { decodeActivity, denomsOf } from "../decode";
import { isSwapTx } from "../describe";
import type { ActivityItem } from "../types";
import { ACCOUNTS, fixture, testContext } from "./helpers";

function decode(name: string, chainId: string, address: string): ActivityItem {
  const item = decodeActivity(fixture(name), address, testContext(chainId));
  assert.ok(item, `${name} should decode`);
  return item;
}

function legs(item: ActivityItem): string[] {
  return item.amounts.map((amount) => `${amount.direction} ${amount.amount} ${amount.identity.ticker}`);
}

describe("bank sends", () => {
  it("reads a send from the sender's side", () => {
    const item = decode("safro-send.json", "safrochain-1", ACCOUNTS.vinjan);
    assert.equal(item.kind, "send");
    assert.equal(item.success, true);
    assert.equal(item.summary, "Sent 17,000 SAF to addr_safro16c26…us4l");
    assert.deepEqual(legs(item), ["out 17000000000 SAF"]);
    assert.equal(item.counterparty, "addr_safro16c26mgp6k7r5l4h8p9n9mnx486rwxftj95us4l");
    assert.deepEqual(item.fee, { amount: "6545", denom: "usaf", symbol: "SAF", decimals: 6, key: "safrochain-1:usaf" });
    assert.equal(item.feePaid, true);
    assert.equal(item.signed, true);
    assert.equal(item.hash, "3C81D97E6F26643ED114185ECD7559C9E6C71646382D0874F867379CEAEED440");
    assert.equal(item.height, 2480090);
    assert.equal(item.time, "2026-09-12T02:16:38Z");
    assert.equal(item.address, ACCOUNTS.vinjan);
    assert.equal(item.primaryType, "MsgSend");
    assert.equal(item.messages, 1);
  });

  it("reads a receipt from the recipient's side, without the sender's fee", () => {
    const item = decode("safro-receive.json", "safrochain-1", ACCOUNTS.vinjan);
    assert.equal(item.kind, "receive");
    assert.equal(item.summary, "Received 5 SAF from addr_safro1hm5w…d3k8");
    assert.deepEqual(legs(item), ["in 5000000 SAF"]);
    assert.equal(item.feePaid, false);
    assert.equal(item.signed, false);
    assert.equal(item.memo, "thanks");
    assert.equal(item.counterparty, "addr_safro1hm5w3rm47prvr99lst35dx8q4lrugmhc3nd3k8");
  });
});

describe("IBC", () => {
  it("reads an outgoing transfer with its packet and the far chain", () => {
    const item = decode("safro-ibc-out.json", "safrochain-1", ACCOUNTS.winnode);
    assert.equal(item.kind, "ibc-out");
    assert.equal(item.summary, "Sent 3,490 SAF to osmo1jz4f…k9qy on Osmosis");
    assert.deepEqual(legs(item), ["out 3490000000 SAF"]);
    assert.deepEqual(item.ibc, {
      sourceChannel: "channel-1",
      destChainId: "osmosis-1",
      sequence: "105",
      destChannel: "channel-110497",
    });
    assert.equal(item.memo, "WinScan IBC Transfer");
  });

  it("reads a relayed delivery as the receiver's: the credited voucher, not the packet's denom", () => {
    const item = decode("safro-ibc-in.json", "safrochain-1", ACCOUNTS.vinjan);
    assert.equal(item.kind, "ibc-in");
    assert.equal(item.primaryType, "MsgRecvPacket");
    assert.equal(item.messages, 2);
    assert.equal(item.summary, "Received 0.00076 USDC.inj from inj1zdq2…dwz0 on Injective");
    assert.deepEqual(item.amounts.map((amount) => [amount.direction, amount.amount, amount.denom]), [
      ["in", "760", "ibc/1E180C085A3A2688CDF2A781E5990BE8AA92CE69CB62A8CC6BB9F5EE17DD5C38"],
    ]);
    assert.deepEqual(item.ibc, { sequence: "2", sourceChannel: "channel-495", destChannel: "channel-2", sourceChainId: "injective-1" });
    assert.equal(item.counterparty, "inj1zdq2ql5gua8mda627t5p3870c4xvykr6sfdwz0");
    // The relayer paid the fee.
    assert.equal(item.feePaid, false);
    assert.equal(item.signed, false);
  });

  it("reads a failed transfer: nothing moved, the fee was still paid", () => {
    const item = decode("safro-failed-transfer.json", "safrochain-1", ACCOUNTS.winnode);
    assert.equal(item.success, false);
    assert.equal(item.kind, "ibc-out");
    assert.equal(item.summary, "Failed to send 3,190 SAF to noble1jz4f…sawc on Osmosis");
    assert.deepEqual(item.amounts, []);
    assert.equal(item.feePaid, true);
    assert.deepEqual(item.fee, { amount: "37500", denom: "usaf", symbol: "SAF", decimals: 6, key: "safrochain-1:usaf" });
    // No packet left: no sequence to follow.
    assert.equal(item.ibc?.sequence, undefined);
  });
});

describe("swaps", () => {
  it("reads a Zunia pool swap with its fee and IBC delivery for the signer", () => {
    const item = decode("osmo-zunia-swap.json", "osmosis-1", ACCOUNTS.swapper);
    assert.equal(item.kind, "swap");
    assert.equal(item.summary, "Swapped 99.5 OSMO → 3.4945 USDC.inj and sent 3.4318 USDC.inj to inj138rm…h602 on Injective");
    // 99.5 OSMO swapped + 0.5 OSMO Zunia fee; the intermediate pool token is a pass-through and is left out.
    assert.deepEqual(legs(item), ["out 100000000 OSMO", "out 3431895 USDC.inj", "in 3494518 USDC.inj"]);
    assert.deepEqual(item.ibc, { sourceChannel: "channel-122", destChainId: "injective-1", sequence: "782901", destChannel: "channel-8" });
    assert.equal(item.memo, "Swap OSMO to USDC.inj · by Zunia-wallet");
    assert.equal(item.feePaid, true);
  });

  it("reads the same transaction as a Zunia fee receipt for the treasury", () => {
    const item = decode("osmo-zunia-swap.json", "osmosis-1", ACCOUNTS.treasury);
    assert.equal(item.kind, "receive");
    assert.equal(item.summary, "Received a Zunia swap fee of 0.5 OSMO from osmo1zva9…g8mm");
    assert.deepEqual(legs(item), ["in 500000 OSMO"]);
    assert.equal(item.feePaid, false);
    assert.equal(item.signed, false);
    assert.equal(item.counterparty, ACCOUNTS.swapper);
  });

  it("reads a split-route swap from the coins that moved, intermediates dropped", () => {
    const item = decode("osmo-split-swap.json", "osmosis-1", ACCOUNTS.splitter);
    assert.equal(item.kind, "swap");
    assert.equal(item.primaryType, "MsgSplitRouteSwapExactAmountIn");
    assert.deepEqual(item.amounts.map((amount) => [amount.direction, amount.amount, amount.denom]), [
      ["out", "770000000000000000000", "ibc/672406ADE4EDFD8C5EA7A0D0DD0C37E431DA7BD8393A15CD2CFDE3364917EB2A"],
      ["in", "268815958930523", "ibc/7C4D60AA95E5A7558B0A364860979CA34B7FF8AAF255B87AF9E879374470CEC0"],
    ]);
    // Unknown decimals read in base units, never scaled by a guess.
    assert.equal(
      item.summary,
      "Swapped 770,000,000,000,000,000,000 base units of IBC·6724 → 268,815,958,930,523 base units of IBC·7C4D",
    );
  });

  it("tells swap transactions apart", () => {
    const messages = (name: string) =>
      ((fixture(name) as { tx: { body: { messages: Record<string, unknown>[] } } }).tx.body.messages);
    assert.equal(isSwapTx(messages("osmo-zunia-swap.json")), true);
    assert.equal(isSwapTx(messages("osmo-split-swap.json")), true);
    assert.equal(isSwapTx(messages("safro-ibc-out.json")), false);
    assert.equal(isSwapTx(messages("osmo-delegate.json")), false);
  });
});

describe("staking", () => {
  it("reads a claim of rewards and commission with the amount received", () => {
    const item = decode("safro-claim.json", "safrochain-1", ACCOUNTS.vinjan);
    assert.equal(item.kind, "claim");
    assert.equal(item.summary, "Claimed 16,813.69 SAF in rewards and commission");
    assert.deepEqual(legs(item), ["in 16813691782 SAF"]);
  });

  it("reads an undelegation; the rewards it paid out are its only coin movement, and the sentence says so", () => {
    const item = decode("safro-undelegate.json", "safrochain-1", ACCOUNTS.vinjan);
    assert.equal(item.kind, "undelegate");
    assert.equal(item.summary, "Undelegated 5,000 SAF from addr_safrovaloper1t0aw…fdsq and received 1.4986 SAF in rewards");
    assert.deepEqual(legs(item), ["in 1498638 SAF"]);
    assert.equal(item.counterparty, "addr_safrovaloper1t0aw2zvghsdr7avfksgtsu090w8nvqpckefdsq");
  });

  it("files a validator's creation with delegations: its self-delegation is bonded stake", () => {
    const item = decode("safro-create-validator.json", "safrochain-1", ACCOUNTS.vinjan);
    assert.equal(item.kind, "delegate");
    assert.equal(item.summary, "Created validator “Vinjan.Inc” with a self-delegation of 9,000 SAF");
    assert.deepEqual(legs(item), ["out 9000000000 SAF"]);
    assert.equal(item.counterparty, "addr_safrovaloper1t0aw2zvghsdr7avfksgtsu090w8nvqpckefdsq");
    assert.equal(item.feePaid, true);
  });

  it("reads claim-then-delegate as a delegation and keeps both legs of the same amount", () => {
    const item = decode("osmo-delegate.json", "osmosis-1", ACCOUNTS.compounder);
    assert.equal(item.kind, "delegate");
    assert.equal(
      item.summary,
      "Delegated 8.666 OSMO to osmovaloper1rcv3…xhuh and claimed 8.666 OSMO in rewards from osmovaloper1rcv3…xhuh",
    );
    assert.deepEqual(legs(item), ["out 8666050 OSMO", "in 8666050 OSMO"]);
  });
});

describe("governance and permissions", () => {
  it("reads a gov v1 vote; the fee-market tip is not a coin movement", () => {
    const item = decode("hub-vote.json", "cosmoshub-4", ACCOUNTS.everstake);
    assert.equal(item.kind, "vote");
    assert.equal(item.summary, "Voted No with veto on proposal #1056");
    assert.equal(item.proposalId, "1056");
    assert.deepEqual(item.amounts, []);
    assert.equal(item.fee?.amount, "4000");
    assert.equal(item.feePaid, true);
  });

  it("reads an SDK 0.47 response from its per-message logs", () => {
    const item = decode("kava-vote-sdk47.json", "kava_2222-10", ACCOUNTS.kava);
    assert.equal(item.kind, "vote");
    assert.equal(item.summary, "Voted Yes on proposal #221");
    assert.deepEqual(item.amounts, []);
    assert.equal(item.feePaid, true);
    assert.equal(item.fee?.amount, "6849");
  });

  it("reads an authz grant", () => {
    const item = decode("hub-grant.json", "cosmoshub-4", ACCOUNTS.everstake);
    assert.equal(item.kind, "authz");
    assert.equal(item.summary, "Allowed cosmos1h8zf…x39r to vote");
    assert.equal(item.counterparty, "cosmos1h8zfr3ffkpe94adnqzktelzg2ajasa4ucpx39r");
  });
});

describe("authz: a bot acting for the account", () => {
  it("reads a compounding bot's claim per inner message: rewards and commission, the granter's kind", () => {
    const item = decode("safro-authz-claim.json", "safrochain-1", ACCOUNTS.granter);
    assert.equal(item.kind, "claim");
    assert.equal(item.via, ACCOUNTS.grantee);
    // 664.767852 SAF rewards + 1,282.784697 SAF commission, told apart by authz_msg_index.
    assert.equal(item.summary, "addr_safro1xx3j…9kqp acted for you: claimed 1,947.55 SAF in rewards and commission");
    assert.deepEqual(legs(item), ["in 1947552549 SAF"]);
    assert.equal(item.signed, false);
    assert.equal(item.feePaid, false, "the grantee paid the fee");
  });

  it("reads the bot's delegation for the granter, with the rewards it withdrew", () => {
    const item = decode("safro-authz-delegate.json", "safrochain-1", ACCOUNTS.granter);
    assert.equal(item.kind, "delegate");
    assert.equal(
      item.summary,
      "addr_safro1xx3j…9kqp acted for you: delegated 1,947.63 SAF to addr_safrovaloper1fvjk…qa98 and received 0.064551 SAF in rewards",
    );
    assert.deepEqual(legs(item), ["out 1947638283 SAF", "in 64551 SAF"]);
    assert.equal(item.counterparty, "addr_safrovaloper1fvjkhch8wuvhp2altf2zfs65vkza7s3nxpqa98");
  });

  it("reads the same transaction from the bot's side: what it ran, and the fee it paid", () => {
    const item = decode("safro-authz-claim.json", "safrochain-1", ACCOUNTS.grantee);
    assert.equal(item.kind, "authz");
    assert.equal(item.via, undefined);
    assert.equal(item.summary, "Ran 2 actions with an authz grant: claimed rewards from addr_safrovaloper1fvjk…qa98; claimed commission");
    assert.deepEqual(item.amounts, []);
    assert.equal(item.feePaid, true);
    assert.equal(item.signed, true);
  });

  it("does not split coins between inner messages when the node cannot attribute them", () => {
    // The same MsgExec without `authz_msg_index`: both claims share one pot of
    // coins, which must be counted once, not once per inner message.
    const body = fixture("safro-authz-claim.json") as { tx_response: Record<string, unknown> };
    const events = (body.tx_response.events as Array<{ type: string; attributes: Array<{ key: string; value: string }> }>).map((event) => ({
      ...event,
      attributes: event.attributes.filter((attribute) => attribute.key !== "authz_msg_index"),
    }));
    const item = decodeActivity({ ...body, tx_response: { ...body.tx_response, events } }, ACCOUNTS.granter, testContext("safrochain-1"));
    assert.ok(item);
    assert.equal(item.kind, "claim");
    assert.equal(item.summary, "addr_safro1xx3j…9kqp acted for you: claimed 1,947.55 SAF in rewards and commission");
    assert.deepEqual(legs(item), ["in 1947552549 SAF"]);
  });
});

describe("row facts", () => {
  it("links the explorer the registry names, never a guessed one", () => {
    assert.equal(
      decode("safro-send.json", "safrochain-1", ACCOUNTS.vinjan).explorerUrl,
      "https://explorer.safrochain.com/tx/3C81D97E6F26643ED114185ECD7559C9E6C71646382D0874F867379CEAEED440",
    );
    assert.equal(decode("kava-vote-sdk47.json", "kava_2222-10", ACCOUNTS.kava).explorerUrl, undefined);
  });

  it("matches a batch of transfers on one channel to their own packets on a flat event list", () => {
    // Two MsgTransfer on channel-1 in one transaction, events without msg_index
    // (old nodes): the second transfer's row must carry the second sequence.
    const body = fixture("safro-ibc-out.json") as { tx: { body: { messages: Record<string, unknown>[] } }; tx_response: Record<string, unknown> };
    const transfer = body.tx.body.messages[0];
    type RawEvent = { type: string; attributes: Array<{ key: string; value: string }> };
    const flat = (body.tx_response.events as RawEvent[]).map((event) => ({
      ...event,
      attributes: event.attributes.filter((attribute) => attribute.key !== "msg_index"),
    }));
    const firstSend = flat.find((event) => event.type === "send_packet");
    assert.ok(firstSend);
    const secondSend: RawEvent = {
      type: "send_packet",
      attributes: firstSend.attributes.map((attribute) => (attribute.key === "packet_sequence" ? { key: "packet_sequence", value: "106" } : attribute)),
    };
    const other = { ...transfer, sender: "addr_safro1hm5w3rm47prvr99lst35dx8q4lrugmhc3nd3k8" };
    const batch = {
      tx: { ...body.tx, body: { ...body.tx.body, messages: [other, transfer] } },
      tx_response: { ...body.tx_response, events: [...flat, secondSend], logs: [] },
    };
    const item = decodeActivity(batch, ACCOUNTS.winnode, testContext("safrochain-1"));
    assert.equal(item?.ibc?.sequence, "106");
  });
});

describe("response shapes", () => {
  it("accepts a bare search row as well as a GetTx body", () => {
    const body = fixture("safro-send.json") as { tx_response: unknown };
    const fromRow = decodeActivity(body.tx_response, ACCOUNTS.vinjan, testContext("safrochain-1"));
    const fromBody = decodeActivity(body, ACCOUNTS.vinjan, testContext("safrochain-1"));
    assert.deepEqual(fromRow, fromBody);
  });

  it("reads base64 event attributes without msg_index, adding the fee back", () => {
    // The Tendermint 0.34 spelling of the same transaction: every key and
    // value base64, no `msg_index`, no logs. The fee transfer is then among
    // the events and must be taken out of the account's movements.
    const body = fixture("safro-send.json") as { tx_response: Record<string, unknown> };
    const encode = (value: string) => btoa(value);
    const events = (body.tx_response.events as Array<{ type: string; attributes: Array<{ key: string; value: string }> }>).map((event) => ({
      type: event.type,
      attributes: event.attributes.filter((a) => a.key !== "msg_index").map((a) => ({ key: encode(a.key), value: encode(a.value) })),
    }));
    const legacy = { ...body.tx_response, events, logs: [] };
    const item = decodeActivity(legacy, ACCOUNTS.vinjan, testContext("safrochain-1"));
    assert.ok(item);
    assert.deepEqual(legs(item), ["out 17000000000 SAF"]);
    assert.equal(item.feePaid, true);
  });

  it("refuses what is not a transaction", () => {
    assert.equal(decodeActivity({}, ACCOUNTS.vinjan, testContext("safrochain-1")), null);
    assert.equal(decodeActivity({ txhash: "nope" }, ACCOUNTS.vinjan, testContext("safrochain-1")), null);
    assert.equal(decodeActivity(null, ACCOUNTS.vinjan, testContext("safrochain-1")), null);
  });

  it("collects the denoms worth naming before decoding", () => {
    const denoms = denomsOf(fixture("osmo-zunia-swap.json"), ACCOUNTS.swapper);
    assert.ok(denoms.includes("uosmo"));
    assert.ok(denoms.includes("ibc/794C7D7F3B857713878A3A1927251FA6AC1EEE520424C1F6FAFE9BA26D476138"));
    assert.ok(denoms.includes("ibc/D189335C6E4A68B513C10AB227BF1C1D38C746766278BA3EEB4FB14124F1D858"));
  });
});

describe("hostile shapes", () => {
  it("reads deeply nested authz MsgExec in bounded time", () => {
    const vote = { "@type": "/cosmos.gov.v1.MsgVote", proposal_id: "7", voter: ACCOUNTS.granter, option: "VOTE_OPTION_YES" };
    let message: Record<string, unknown> = vote;
    for (let depth = 0; depth < 12; depth++) {
      message = { "@type": "/cosmos.authz.v1beta1.MsgExec", grantee: ACCOUNTS.grantee, msgs: Array.from({ length: 6 }, () => message) };
    }
    const body = fixture("safro-authz-claim.json") as { tx: { body: Record<string, unknown> } };
    const raw = { ...body, tx: { ...body.tx, body: { ...body.tx.body, messages: [message] } } };
    const started = Date.now();
    const item = decodeActivity(raw, ACCOUNTS.granter, testContext("safrochain-1"));
    assert.ok(item);
    assert.ok(denomsOf(raw, ACCOUNTS.granter).length > 0);
    assert.ok(Date.now() - started < 1_000, `took ${Date.now() - started} ms`);
  });
});
