/**
 * The memo the dashboard signs when the user leaves the field empty
 * (`../memo`): one phrase per kind of transaction, named only by what is
 * proven, always printable ASCII without `&<>`, at most 256 characters, and
 * never written anywhere but the transaction body. Cases mirror zunia-extension
 * lib/__tests__/tx-memo.test.ts, in the dashboard's words and tag.
 */
import "../../swap/__tests__/json-modules";
import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { bech32 } from "@scure/base";

import { buildRevokeAllowance, buildRevokeGrant, buildSetWithdrawAddress } from "@/components/insights/revoke";
import { buildSwapFeeMsg } from "@/lib/swap/fee";
import { toTxMessage } from "@/lib/swap/messages";
import type { TokenIdentity } from "@/lib/token/types";
import { msgSend } from "../amino-tx";
import { toHex } from "../bytes";
import { describeTxMemo, defaultTxMemo, isSafeMemoText, MAX_TX_MEMO_CHARS, resolveTxMemo, withTag, ZUNIA_DASHBOARD_TAG } from "../memo";
import {
  buildDelegate,
  buildExecuteContract,
  buildRedelegate,
  buildSend,
  buildTransfer,
  buildUndelegate,
  buildVote,
  buildWithdrawReward,
  txMessageFromAmino,
} from "../messages";
import { poolSwapTxMessage, POOL_SPLIT_SWAP_TYPE_URL, POOL_SWAP_TYPE_URL } from "../osmosis";
import type { MemoToken, SignRequest, TxMemoContext, TxMessage } from "../types";

const TAG = ` - ${ZUNIA_DASHBOARD_TAG}`;
const address = (prefix: string, fill: number, bytes = 20) => bech32.encode(prefix, bech32.toWords(new Uint8Array(bytes).fill(fill)));
const HUB_ME = address("cosmos", 7);
const OSMO_ME = address("osmo", 7);
const NOBLE_ME = address("noble", 7);
const HUB_VALOPER = address("cosmosvaloper", 9);
const HUB_VALOPER_2 = address("cosmosvaloper", 10);
const XCS = "osmo1uwk8xc6q0s6t5qcpr6rht3sczu6du83xq8pwxjua0hfj5hzcnh3sqxwvxs";
const CW721 = address("osmo", 3, 32);
const TREASURY = address("osmo", 0x5a);

/** Noble USDC on Osmosis (`transfer/channel-750/uusdc`). */
const USDC_N = "ibc/498A0751C798A0D9A389AA3691123DADA57DAA4FE165D5C75894505B876BA6E4";
/** ATOM on Osmosis (`transfer/channel-0/uatom`). */
const ATOM_ON_OSMOSIS = "ibc/27394FB092D2ECCD56123C74F36E4C1F926001CEADA9CA97EA622B25F41E5EB2";
/** A voucher nothing names. */
const UNLISTED = "ibc/0123456789ABCDEF0123456789ABCDEF0123456789ABCDEF0123456789ABCDEF";

/** An identity as the API hands it to a page (only the fields the memo reads matter). */
function identity(chainId: string, denom: string, ticker: string, extra: Partial<TokenIdentity> = {}): TokenIdentity {
  return { key: `${chainId}:${denom}`, chainId, denom, kind: "ibc", ticker, name: ticker, decimals: 6, provenance: "table", proven: true, listed: true, ...extra };
}

const USDC_N_ID = identity("osmosis-1", USDC_N, "USDC.n");
const ATOM_ON_OSMOSIS_ID = identity("osmosis-1", ATOM_ON_OSMOSIS, "ATOM");

function memoOf(chainId: string, messages: TxMessage[], memoContext?: TxMemoContext, memo?: string): string {
  return resolveTxMemo({ chainId, messages, ...(memoContext ? { memoContext } : {}), ...(memo !== undefined ? { memo } : {}) });
}

const send = (from: string, to: string, denom: string) => buildSend({ fromAddress: from, toAddress: to, amount: [{ denom, amount: "1" }] });
const transfer = (params: { denom: string; sender: string; receiver: string; memo?: string; channel?: string }) =>
  buildTransfer({
    sourceChannel: params.channel ?? "channel-141",
    token: { denom: params.denom, amount: "1000" },
    sender: params.sender,
    receiver: params.receiver,
    ...(params.memo ? { memo: params.memo } : {}),
    timeoutTimestamp: "1791202200000000000",
  });

/** The packet memo the swap's contract path signs from the Hub (ibc-hooks into crosschain-swaps). */
const XCS_PACKET_MEMO = JSON.stringify({
  wasm: {
    contract: XCS,
    msg: {
      osmosis_swap: {
        output_denom: "uosmo",
        slippage: { twap: { slippage_percentage: "1", window_seconds: 10 } },
        receiver: OSMO_ME,
        on_failed_delivery: { local_recovery_addr: OSMO_ME },
        next_memo: null,
      },
    },
  },
});

const swapCall = (sold: string, bought: string, funds = [{ denom: sold, amount: "63000000" }]) =>
  buildExecuteContract({
    sender: OSMO_ME,
    contract: XCS,
    msg: {
      osmosis_swap: {
        output_denom: bought,
        slippage: { twap: { slippage_percentage: "1", window_seconds: 10 } },
        receiver: HUB_ME,
        on_failed_delivery: { local_recovery_addr: OSMO_ME },
        next_memo: null,
      },
    },
    funds,
  });

const poolSwap = (sold: string, bought: string) =>
  poolSwapTxMessage(POOL_SWAP_TYPE_URL, {
    sender: OSMO_ME,
    routes: [
      { pool_id: "1464", token_out_denom: USDC_N },
      { pool_id: "1", token_out_denom: bought },
    ],
    token_in: { denom: sold, amount: "1000000" },
    token_out_min_amount: "1",
  });

const splitSwap = (sold: string, bought: string, other = bought) =>
  poolSwapTxMessage(POOL_SPLIT_SWAP_TYPE_URL, {
    sender: OSMO_ME,
    routes: [
      { pools: [{ pool_id: "3498", token_out_denom: bought }], token_in_amount: "6000000" },
      { pools: [{ pool_id: "3586", token_out_denom: other }], token_in_amount: "4000000" },
    ],
    token_in_denom: sold,
    token_out_min_amount: "1",
  });

const fee = (denom: string) => toTxMessage(buildSwapFeeMsg({ sender: OSMO_ME, recipient: TREASURY, denom, amount: BigInt(315_000) }));
const nft = (action: "transfer_nft" | "send_nft", tokenId: string) =>
  buildExecuteContract({
    sender: OSMO_ME,
    contract: CW721,
    msg: action === "transfer_nft" ? { transfer_nft: { recipient: OSMO_ME, token_id: tokenId } } : { send_nft: { contract: XCS, token_id: tokenId, msg: "e30=" } },
  });

/* ------------------------------------------------------------------ every family */

describe("one phrase per kind of transaction", () => {
  const ctx = (tokens: MemoToken[], destinationChainId?: string): TxMemoContext => ({ tokens, ...(destinationChainId ? { destinationChainId } : {}) });
  const cases: Array<[string, string, TxMessage[], TxMemoContext | undefined, string]> = [
    // Sends: the coin as the page names it, or the chain's own coin by the catalog.
    ["send, voucher named by its identity", "osmosis-1", [send(OSMO_ME, OSMO_ME, USDC_N)], ctx([USDC_N_ID]), "Send USDC.n"],
    ["send, Noble's own USDC as its page names it", "noble-1", [send(NOBLE_ME, NOBLE_ME, "uusdc")], ctx([identity("noble-1", "uusdc", "USDC.n", { kind: "native" })]), "Send USDC.n"],
    ["send, the chain's own coin without a context", "cosmoshub-4", [send(HUB_ME, HUB_ME, "uatom")], undefined, "Send ATOM"],
    ["send, a voucher nobody named", "osmosis-1", [send(OSMO_ME, OSMO_ME, USDC_N)], undefined, "Send"],
    ["send, an identity that is not proven", "osmosis-1", [send(OSMO_ME, OSMO_ME, UNLISTED)], ctx([identity("osmosis-1", UNLISTED, "IBC·0123", { proven: false, provenance: "unknown" })]), "Send"],
    ["send, an unlisted local token", "osmosis-1", [send(OSMO_ME, OSMO_ME, `factory/${OSMO_ME}/USDC.n`)], ctx([identity("osmosis-1", `factory/${OSMO_ME}/USDC.n`, "USDC.n", { proven: false, listed: false })]), "Send"],
    ["send, a name given for another chain", "osmosis-1", [send(OSMO_ME, OSMO_ME, USDC_N)], ctx([{ ...USDC_N_ID, chainId: "cosmoshub-4" }]), "Send"],
    [
      "send of two coins names neither",
      "osmosis-1",
      [buildSend({ fromAddress: OSMO_ME, toAddress: OSMO_ME, amount: [{ denom: "uosmo", amount: "1" }, { denom: USDC_N, amount: "1" }] })],
      ctx([USDC_N_ID]),
      "Send",
    ],
    // IBC transfers: the token, and the chain the funds end up on.
    ["IBC transfer", "cosmoshub-4", [transfer({ denom: "uatom", sender: HUB_ME, receiver: OSMO_ME })], ctx([], "osmosis-1"), "IBC transfer of ATOM to Osmosis"],
    ["IBC transfer of a voucher", "osmosis-1", [transfer({ denom: USDC_N, sender: OSMO_ME, receiver: NOBLE_ME, channel: "channel-750" })], ctx([USDC_N_ID], "noble-1"), "IBC transfer of USDC.n to Noble"],
    [
      "IBC transfer over a packet-forward hop: the last receiver's chain",
      "osmosis-1",
      [transfer({ denom: USDC_N, sender: OSMO_ME, receiver: NOBLE_ME, channel: "channel-750", memo: JSON.stringify({ forward: { receiver: HUB_ME, port: "transfer", channel: "channel-4" } }) })],
      ctx([USDC_N_ID], "cosmoshub-4"),
      "IBC transfer of USDC.n to Cosmos Hub",
    ],
    [
      "IBC transfer over two hops, the second given as a string",
      "osmosis-1",
      [
        transfer({
          denom: USDC_N,
          sender: OSMO_ME,
          receiver: NOBLE_ME,
          memo: JSON.stringify({ forward: { receiver: "pfm", port: "transfer", channel: "channel-4", next: JSON.stringify({ forward: { receiver: OSMO_ME, port: "transfer", channel: "channel-1" } }) } }),
        }),
      ],
      ctx([USDC_N_ID], "osmosis-1"),
      "IBC transfer of USDC.n to Osmosis",
    ],
    ["IBC transfer whose receiver is not on the chain named", "cosmoshub-4", [transfer({ denom: "uatom", sender: HUB_ME, receiver: NOBLE_ME })], ctx([], "osmosis-1"), "IBC transfer of ATOM"],
    ["IBC transfer without a destination", "cosmoshub-4", [transfer({ denom: "uatom", sender: HUB_ME, receiver: OSMO_ME })], undefined, "IBC transfer of ATOM"],
    ["IBC transfer of a token nobody named", "osmosis-1", [transfer({ denom: UNLISTED, sender: OSMO_ME, receiver: HUB_ME })], ctx([], "cosmoshub-4"), "IBC transfer to Cosmos Hub"],
    ["IBC transfer to a chain the catalog does not know", "cosmoshub-4", [transfer({ denom: "uatom", sender: HUB_ME, receiver: OSMO_ME })], ctx([], "nowhere-1"), "IBC transfer of ATOM"],
    [
      "IBC transfer whose packet calls another contract",
      "cosmoshub-4",
      [transfer({ denom: "uatom", sender: HUB_ME, receiver: XCS, memo: JSON.stringify({ wasm: { contract: XCS, msg: { set_route: {} } } }) })],
      ctx([], "osmosis-1"),
      "IBC transfer of ATOM",
    ],
    ["IBC transfer with a plain-text packet memo", "cosmoshub-4", [transfer({ denom: "uatom", sender: HUB_ME, receiver: OSMO_ME, memo: "for the exchange" })], ctx([], "osmosis-1"), "IBC transfer of ATOM to Osmosis"],
    // Swaps, on every path, with Zunia's fee beside them.
    ["swap, contract path from the Hub (transfer that runs the contract)", "cosmoshub-4", [transfer({ denom: "uatom", sender: HUB_ME, receiver: XCS, memo: XCS_PACKET_MEMO }), send(HUB_ME, address("cosmos", 0x5a), "uatom")], ctx([], "osmosis-1"), "Swap ATOM to OSMO"],
    ["swap, contract path from Osmosis, fee after it", "osmosis-1", [swapCall("uosmo", ATOM_ON_OSMOSIS), fee("uosmo")], ctx([ATOM_ON_OSMOSIS_ID]), "Swap OSMO to ATOM"],
    ["swap, pool path, fee after it", "osmosis-1", [poolSwap("uosmo", USDC_N), fee("uosmo")], ctx([USDC_N_ID]), "Swap OSMO to USDC.n"],
    ["swap, split route", "osmosis-1", [splitSwap(USDC_N, "uosmo"), fee(USDC_N)], ctx([USDC_N_ID]), "Swap USDC.n to OSMO"],
    [
      "swap, pool-deliver: swap, fee, then the transfer home",
      "osmosis-1",
      [splitSwap("uosmo", ATOM_ON_OSMOSIS), fee("uosmo"), transfer({ denom: ATOM_ON_OSMOSIS, sender: OSMO_ME, receiver: HUB_ME, channel: "channel-0" })],
      ctx([ATOM_ON_OSMOSIS_ID], "cosmoshub-4"),
      "Swap OSMO to ATOM",
    ],
    ["swap whose output nobody named", "osmosis-1", [swapCall("uosmo", UNLISTED), fee("uosmo")], undefined, "Swap"],
    ["swap whose split routes end in different tokens", "osmosis-1", [splitSwap("uosmo", USDC_N, ATOM_ON_OSMOSIS)], ctx([USDC_N_ID, ATOM_ON_OSMOSIS_ID]), "Swap"],
    ["a swap call paying with two coins is no swap", "osmosis-1", [swapCall("uosmo", ATOM_ON_OSMOSIS, [{ denom: "uosmo", amount: "1" }, { denom: USDC_N, amount: "1" }])], ctx([ATOM_ON_OSMOSIS_ID, USDC_N_ID]), "Contract call"],
    ["fee send on its own", "osmosis-1", [fee("uosmo")], undefined, "Send OSMO"],
    // The contract's other call.
    ["recover a swap's output", "osmosis-1", [buildExecuteContract({ sender: OSMO_ME, contract: XCS, msg: { recover: {} } })], undefined, "Recover swap"],
    // Staking.
    ["stake", "cosmoshub-4", [buildDelegate({ delegatorAddress: HUB_ME, validatorAddress: HUB_VALOPER, amount: { denom: "uatom", amount: "1" } })], undefined, "Stake ATOM"],
    ["stake on Noble, as its staking page names the coin", "noble-1", [buildDelegate({ delegatorAddress: NOBLE_ME, validatorAddress: address("noblevaloper", 1), amount: { denom: "uusdc", amount: "1" } })], undefined, "Stake USDC"],
    ["stake of a coin that is not the chain's", "cosmoshub-4", [buildDelegate({ delegatorAddress: HUB_ME, validatorAddress: HUB_VALOPER, amount: { denom: "uosmo", amount: "1" } })], undefined, "Stake"],
    ["unstake", "cosmoshub-4", [buildUndelegate({ delegatorAddress: HUB_ME, validatorAddress: HUB_VALOPER, amount: { denom: "uatom", amount: "1" } })], undefined, "Unstake ATOM"],
    [
      "move stake",
      "cosmoshub-4",
      [buildRedelegate({ delegatorAddress: HUB_ME, validatorSrcAddress: HUB_VALOPER, validatorDstAddress: HUB_VALOPER_2, amount: { denom: "uatom", amount: "1" } })],
      undefined,
      "Move stake",
    ],
    ["claim from one validator", "cosmoshub-4", [buildWithdrawReward({ delegatorAddress: HUB_ME, validatorAddress: HUB_VALOPER })], undefined, "Claim rewards"],
    [
      "claim from several validators",
      "cosmoshub-4",
      [buildWithdrawReward({ delegatorAddress: HUB_ME, validatorAddress: HUB_VALOPER }), buildWithdrawReward({ delegatorAddress: HUB_ME, validatorAddress: HUB_VALOPER_2 })],
      undefined,
      "Claim rewards",
    ],
    [
      "claim and restake",
      "cosmoshub-4",
      [buildWithdrawReward({ delegatorAddress: HUB_ME, validatorAddress: HUB_VALOPER }), buildDelegate({ delegatorAddress: HUB_ME, validatorAddress: HUB_VALOPER, amount: { denom: "uatom", amount: "1" } })],
      undefined,
      "Claim rewards",
    ],
    // Governance, every option, both gov versions.
    ["vote yes", "cosmoshub-4", [buildVote({ proposalId: "42", voter: HUB_ME, option: "yes" })], undefined, "Vote Yes on proposal 42"],
    ["vote no", "cosmoshub-4", [buildVote({ proposalId: "42", voter: HUB_ME, option: "no" })], undefined, "Vote No on proposal 42"],
    ["vote abstain", "cosmoshub-4", [buildVote({ proposalId: "981", voter: HUB_ME, option: "abstain" })], undefined, "Vote Abstain on proposal 981"],
    ["vote no with veto", "cosmoshub-4", [buildVote({ proposalId: "42", voter: HUB_ME, option: "veto" })], undefined, "Vote No with veto on proposal 42"],
    ["vote, gov v1", "cosmoshub-4", [buildVote({ proposalId: "7", voter: HUB_ME, option: "yes", govVersion: "v1" })], undefined, "Vote Yes on proposal 7"],
    // NFTs: the id only when it is ASCII-safe.
    ["NFT transfer", "osmosis-1", [nft("transfer_nft", "e2e-1")], undefined, "Send NFT e2e-1"],
    ["NFT over ICS721", "osmosis-1", [nft("send_nft", "7")], undefined, "Send NFT 7"],
    ["NFT whose id holds '&'", "osmosis-1", [nft("transfer_nft", "rock & roll")], undefined, "Send NFT"],
    ["NFT whose id is not ASCII", "osmosis-1", [nft("transfer_nft", "café #1")], undefined, "Send NFT"],
    ["NFT whose id is too long", "osmosis-1", [nft("transfer_nft", "9".repeat(65))], undefined, "Send NFT"],
    // Everything else: the short type name, or "Signed".
    ["another contract call", "osmosis-1", [buildExecuteContract({ sender: OSMO_ME, contract: XCS, msg: { set_route: {} } })], undefined, "Contract call"],
    ["revoke an authz grant", "cosmoshub-4", [buildRevokeGrant({ granter: HUB_ME, grantee: address("cosmos", 2), msgTypeUrl: "/cosmos.bank.v1beta1.MsgSend" })], undefined, "Revoke"],
    ["revoke a fee allowance", "cosmoshub-4", [buildRevokeAllowance({ granter: HUB_ME, grantee: address("cosmos", 2) })], undefined, "Revoke allowance"],
    ["pay rewards to this account", "cosmoshub-4", [buildSetWithdrawAddress({ delegator: HUB_ME, withdrawAddress: HUB_ME })], undefined, "Set withdraw address"],
    ["a type whose name is not plain words", "cosmoshub-4", [{ typeUrl: "/x.y.Msg<b>", value: new Uint8Array([1]) }], undefined, "Signed"],
    ["nothing to name", "cosmoshub-4", [], undefined, "Signed"],
  ];

  for (const [name, chainId, messages, context, phrase] of cases) {
    test(name, () => {
      assert.equal(memoOf(chainId, messages, context), `${phrase}${TAG}`);
    });
  }

  test("the words, exactly", () => {
    assert.equal(memoOf("osmosis-1", [poolSwap("uosmo", ATOM_ON_OSMOSIS), fee("uosmo")], { tokens: [ATOM_ON_OSMOSIS_ID] }), "Swap OSMO to ATOM - by Zunia-dashboard");
    assert.equal(memoOf("noble-1", [send(NOBLE_ME, NOBLE_ME, "uusdc")], { tokens: [identity("noble-1", "uusdc", "USDC.n")] }), "Send USDC.n - by Zunia-dashboard");
  });
});

/* ------------------------------------------------------------------ what is named */

describe("a token is named only when its identity is proven", () => {
  test("two identities for one denom that disagree name nothing", () => {
    const context = { tokens: [USDC_N_ID, { ...USDC_N_ID, ticker: "USDC.axl" }] };
    assert.equal(memoOf("osmosis-1", [send(OSMO_ME, OSMO_ME, USDC_N)], context), `Send${TAG}`);
    // The same name twice is still that name.
    assert.equal(memoOf("osmosis-1", [send(OSMO_ME, OSMO_ME, USDC_N)], { tokens: [USDC_N_ID, USDC_N_ID] }), `Send USDC.n${TAG}`);
  });

  test("the catalog names only a chain's own staking coin, on that chain, and never a voucher", () => {
    assert.equal(memoOf("osmosis-1", [send(OSMO_ME, OSMO_ME, "uatom")]), `Send${TAG}`);
    assert.equal(memoOf("osmosis-1", [send(OSMO_ME, OSMO_ME, "uosmo")]), `Send OSMO${TAG}`);
    // moo-1's staking coin is a voucher (INIT from Initia): the catalog does not prove it.
    const moo = "ibc/37A3FB4FED4CA04ED6D9E5DA36C6D27248645F0E22F585576A1488B8A89C5A50";
    assert.equal(memoOf("moo-1", [send(address("init", 1), address("init", 2), moo)]), `Send${TAG}`);
  });

  test("a name that is not ASCII-safe leaves the generic phrase; spaces are tidied", () => {
    for (const ticker of ["USDC·n", "ATOM&", "<b>", "US\u0000DC", "\u{1F680}", "x".repeat(33), "", "   "]) {
      assert.equal(memoOf("osmosis-1", [send(OSMO_ME, OSMO_ME, USDC_N)], { tokens: [{ ...USDC_N_ID, ticker }] }), `Send${TAG}`, JSON.stringify(ticker));
    }
    assert.equal(memoOf("osmosis-1", [send(OSMO_ME, OSMO_ME, USDC_N)], { tokens: [{ ...USDC_N_ID, ticker: "  USDC\t n " }] }), `Send USDC n${TAG}`);
  });

  test("a message whose amino form and bytes disagree names nothing", () => {
    const signed = send(OSMO_ME, OSMO_ME, UNLISTED);
    const shown = { ...signed, amino: msgSend({ fromAddress: OSMO_ME, toAddress: OSMO_ME, amount: [{ denom: USDC_N, amount: "1" }] }) };
    assert.equal(memoOf("osmosis-1", [shown], { tokens: [USDC_N_ID] }), `Send${TAG}`);
    // Without an amino form there is nothing to read the denom from.
    assert.equal(memoOf("osmosis-1", [{ typeUrl: signed.typeUrl, value: signed.value }], { tokens: [USDC_N_ID] }), `Send${TAG}`);
    assert.equal(memoOf("osmosis-1", [{ typeUrl: POOL_SWAP_TYPE_URL, value: poolSwap("uosmo", USDC_N).value }], { tokens: [USDC_N_ID] }), `Swap${TAG}`);
  });
});

/* ------------------------------------------------------------------ the user's memo */

describe("a memo the user wrote", () => {
  const msgs = [send(HUB_ME, HUB_ME, "uatom")];

  test("is kept exactly, trimmed, never suffixed", () => {
    assert.equal(memoOf("cosmoshub-4", msgs, undefined, "  rent  "), "rent");
    assert.equal(memoOf("cosmoshub-4", msgs, undefined, "a & b <c>"), "a & b <c>");
    assert.equal(memoOf("cosmoshub-4", msgs, undefined, "café · 104857"), "café · 104857");
    assert.deepEqual(describeTxMemo({ chainId: "cosmoshub-4", messages: msgs, memo: " 104857 " }), { memo: "104857", automatic: false });
  });

  test("left empty (or only spaces), is Zunia's default", () => {
    for (const memo of [undefined, "", "   ", "\n\t "]) {
      assert.deepEqual(describeTxMemo({ chainId: "cosmoshub-4", messages: msgs, ...(memo !== undefined ? { memo } : {}) }), { memo: `Send ATOM${TAG}`, automatic: true });
    }
    assert.equal(defaultTxMemo({ chainId: "cosmoshub-4", messages: msgs }), `Send ATOM${TAG}`);
  });
});

/* ------------------------------------------------------------------ never the packet memo */

describe("the packet memo on a MsgTransfer", () => {
  /** Freezes the message all the way down: a write to it would throw. */
  function deepFreeze<T>(value: T): T {
    if (value && typeof value === "object" && !(value instanceof Uint8Array)) {
      for (const inner of Object.values(value)) deepFreeze(inner);
      Object.freeze(value);
    }
    return value;
  }

  test("is read to choose the phrase and never written: the message stays byte-identical", () => {
    const forward = JSON.stringify({ forward: { receiver: HUB_ME, port: "transfer", channel: "channel-4" } });
    for (const [packet, chainId, context, phrase] of [
      [XCS_PACKET_MEMO, "cosmoshub-4", { destinationChainId: "osmosis-1" }, "Swap ATOM to OSMO"],
      [forward, "osmosis-1", { tokens: [USDC_N_ID], destinationChainId: "cosmoshub-4" }, "IBC transfer of USDC.n to Cosmos Hub"],
    ] as const) {
      const msg = transfer({ denom: chainId === "osmosis-1" ? USDC_N : "uatom", sender: chainId === "osmosis-1" ? OSMO_ME : HUB_ME, receiver: chainId === "osmosis-1" ? NOBLE_ME : XCS, memo: packet });
      const bytes = toHex(msg.value);
      const amino = JSON.stringify(msg.amino);
      deepFreeze(msg);
      const request: SignRequest = { chainId, messages: [msg], memoContext: context };
      assert.equal(resolveTxMemo(request), `${phrase}${TAG}`);
      assert.equal(toHex(msg.value), bytes);
      assert.equal(JSON.stringify(msg.amino), amino);
      assert.equal(msg.amino?.value.memo, packet);
      // The body memo is a separate string: the packet memo is not in it.
      assert.ok(!resolveTxMemo(request).includes("{"));
    }
  });

  test("an empty one stays absent", () => {
    const msg = transfer({ denom: "uatom", sender: HUB_ME, receiver: OSMO_ME });
    resolveTxMemo({ chainId: "cosmoshub-4", messages: [msg], memoContext: { destinationChainId: "osmosis-1" } });
    assert.equal("memo" in (msg.amino?.value ?? {}), false);
  });
});

/* ------------------------------------------------------------------ ASCII and length */

/** A small deterministic PRNG (mulberry32), so a failure replays. */
function prng(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const HOSTILE = [
  "ATOM",
  "USDC.n",
  "a & b",
  "<script>alert(1)</script>",
  "x>y",
  "USDC·n",
  "café",
  " ",
  " line",
  "\u0000",
  "tab\there",
  "new\nline",
  "\u{1F680}",
  "\uD83D",
  "‮evil",
  "​zero",
  " nbsp ",
  " ".repeat(10),
  "x".repeat(300),
  "- by Zunia-dashboard",
  '"quoted" \\ back',
  "~!@#$%^*()_+{}|:?",
  "IBC·498A",
  "",
];

function randomText(next: () => number): string {
  const ranges: Array<[number, number]> = [
    [0x00, 0x1f],
    [0x20, 0x7e],
    [0x20, 0x7e],
    [0x7f, 0xff],
    [0x2000, 0x206f],
    [0xd800, 0xdfff],
    [0x1f300, 0x1f6ff],
  ];
  let text = "";
  const length = Math.floor(next() * 80);
  for (let i = 0; i < length; i++) {
    const [low, high] = ranges[Math.floor(next() * ranges.length)]!;
    text += String.fromCodePoint(low + Math.floor(next() * (high - low + 1)));
  }
  return text;
}

describe("every default memo", () => {
  function assertSafe(memo: string, what: string): void {
    assert.ok(/^[\x20-\x7e]+$/.test(memo), `${what}: printable ASCII only, got ${JSON.stringify(memo)}`);
    assert.ok(!/[&<>]/.test(memo), `${what}: no & < >, got ${JSON.stringify(memo)}`);
    assert.ok(memo.length <= MAX_TX_MEMO_CHARS, `${what}: at most 256 characters`);
    assert.ok(new TextEncoder().encode(memo).length <= 256, `${what}: at most 256 bytes`);
    assert.ok(memo.endsWith(TAG), `${what}: ends with the tag`);
    assert.ok(isSafeMemoText(memo), what);
  }

  /** Every family, with `text` wherever a stranger or a table could put text. */
  function requestsWith(text: string): Array<[string, Pick<SignRequest, "chainId" | "messages" | "memoContext">]> {
    const named = { tokens: [{ ...USDC_N_ID, ticker: text }, { chainId: "osmosis-1", denom: "uosmo", ticker: text, proven: true }], destinationChainId: text };
    const out: Array<[string, Pick<SignRequest, "chainId" | "messages" | "memoContext">]> = [
      ["send", { chainId: "osmosis-1", messages: [send(OSMO_ME, OSMO_ME, USDC_N)], memoContext: named }],
      ["transfer", { chainId: "osmosis-1", messages: [transfer({ denom: USDC_N, sender: OSMO_ME, receiver: HUB_ME })], memoContext: { ...named, destinationChainId: "cosmoshub-4" } }],
      ["swap", { chainId: "osmosis-1", messages: [poolSwap("uosmo", USDC_N), fee("uosmo")], memoContext: named }],
      ["contract swap", { chainId: "osmosis-1", messages: [swapCall("uosmo", USDC_N), fee("uosmo")], memoContext: named }],
      ["vote", { chainId: "cosmoshub-4", messages: [buildVote({ proposalId: "18446744073709551615", voter: HUB_ME, option: "veto" })] }],
    ];
    try {
      out.push(["nft", { chainId: "osmosis-1", messages: [nft("transfer_nft", text)] }]);
      out.push(["ics721", { chainId: "osmosis-1", messages: [nft("send_nft", text)] }]);
    } catch {
      // A token id the builder refuses never reaches a memo.
    }
    try {
      out.push(["other contract", { chainId: "osmosis-1", messages: [buildExecuteContract({ sender: OSMO_ME, contract: XCS, msg: { [text || "x"]: {} } })] }]);
    } catch {
      // Same.
    }
    out.push(["unknown type", { chainId: "cosmoshub-4", messages: [{ typeUrl: `/x.y.Msg${text}`, value: new Uint8Array(0) }] }]);
    out.push([
      "hostile amino",
      { chainId: "cosmoshub-4", messages: [txMessageFromAmino({ type: "cosmos-sdk/MsgVote", value: { proposal_id: "1", voter: HUB_ME, option: 4 } }, text)] },
    ]);
    return out;
  }

  test("is printable ASCII without & < >, within 256 characters, whatever the names", () => {
    for (const text of HOSTILE) {
      for (const [what, request] of requestsWith(text)) assertSafe(defaultTxMemo(request), `${what} with ${JSON.stringify(text)}`);
    }
    const next = prng(0x2bad5eed);
    for (let i = 0; i < 400; i++) {
      const text = randomText(next);
      for (const [what, request] of requestsWith(text)) assertSafe(defaultTxMemo(request), `${what} with ${JSON.stringify(text)}`);
    }
  });

  test("is cut with '...' when a phrase is ever too long, the tag kept whole", () => {
    const room = MAX_TX_MEMO_CHARS - TAG.length;
    assert.equal(withTag("x".repeat(room)), `${"x".repeat(room)}${TAG}`);
    assert.equal(withTag("x".repeat(room)).length, MAX_TX_MEMO_CHARS);
    const cut = withTag("y".repeat(room + 1));
    assert.equal(cut.length, MAX_TX_MEMO_CHARS);
    assert.equal(cut, `${"y".repeat(room - 3)}...${TAG}`);
    assert.equal(withTag("z ".repeat(300)).length <= MAX_TX_MEMO_CHARS, true);
    assert.ok(withTag("z ".repeat(300)).endsWith(`z...${TAG}`));
  });
});
