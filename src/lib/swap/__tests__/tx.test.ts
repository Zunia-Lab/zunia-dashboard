/**
 * The transaction a reviewed swap signs (src/lib/swap/tx.ts `buildSwapTx`)
 * and the check that runs on it right before signing (`checkSwapTx`), for
 * every path that signs: `pool`, `pool-deliver`, and `contract` (one
 * transfer from another chain to Skip's entry point on Osmosis).
 *
 * Each path is built from a frozen review and must check clean; then every
 * way a message could say something the review did not (another fee address,
 * another amount, edited bytes, an extra message, another channel, a stale
 * price…) must be refused. Ported in spirit from zunia-extension
 * swap-screen.test.ts and pool-swap-screen.test.ts @ 1453e7a (their checks run
 * on the extension's planner objects; these run on the dashboard's messages).
 */

import "./json-modules";
import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { bech32 } from "@scure/base";

import { SWAP_FEE_RECIPIENTS } from "@/config/fees";
import { SKIP_ENTRY_POINT } from "@/config/interchain";
import { msgProtoBytes } from "@/lib/tx/amino-tx";
import { toHex } from "@/lib/tx/bytes";
import { resolveTxMemo } from "@/lib/tx/memo";
import type { TxMessage } from "@/lib/tx/types";
import { EXTRA_MESSAGES, HEIGHT_TIMEOUT, PRICE_EXPIRED, UNREADABLE_SWAP } from "../checks";
import { feeToWire, swapFeeFor } from "../fee";
import { toTxMessage, viewOf } from "../messages";
import { POOL_SPLIT_SWAP_TYPE_URL, POOL_SWAP_TYPE_URL, TRANSFER_TYPE_URL } from "../pool";
import type { SwapReview } from "../review";
import { readSkipSwapMemo } from "../skip";
import { buildSwapTx, checkSwapTx, SwapBuildError, swapMemoContext, timeoutAfter } from "../tx";
import type { MsgJson } from "../types";
import type { SwapQuoteOk } from "../wire";

const address = (prefix: string, fill: number) => bech32.encode(prefix, bech32.toWords(new Uint8Array(20).fill(fill)));
const OSMO_ME = address("osmo", 7);
const HUB_ME = address("cosmos", 7);
const INJ_ME = address("inj", 9);
const NOBLE_ME = address("noble", 7);
const SAFRO_ME = address("addr_safro", 7);
const SOMEONE = address("osmo", 3);

const SKIP = SKIP_ENTRY_POINT;
const SKIP_CONTRACT = { address: SKIP, verified: true, label: "Skip Swap Entry Point", codeId: "1241" };
const SAF = "ibc/DBAA4846F611A7603EFCE6F9F46F4F561D48B1F492A576022F000614A17089CE";
const ALL_USDC = "factory/osmo147h5x9pcj7lm0cttlaefx6sqq5vdfnmwfcqxkmjd7exqm9gc7grqhr75m0/alloyed/allUSDC";
const USDC_N = "ibc/498A0751C798A0D9A389AA3691123DADA57DAA4FE165D5C75894505B876BA6E4";
const USDC_INJ = "ibc/794C7D7F3B857713878A3A1927251FA6AC1EEE520424C1F6FAFE9BA26D476138";
const USDC_INJ_ERC20 = "erc20:0xa00C59fF5a080D2b954d0c75e46E22a0c371235a";
const ATOM = "ibc/27394FB092D2ECCD56123C74F36E4C1F926001CEADA9CA97EA622B25F41E5EB2";

const NOW = 1_791_330_000_000;

const OSMO_SIDE = { chainId: "osmosis-1", chainName: "Osmosis", denom: "uosmo", ticker: "OSMO", proven: true, decimals: 6, osmosisDenom: "uosmo" };

function quoteBase(overrides: Partial<SwapQuoteOk>): SwapQuoteOk {
  return {
    updatedAt: NOW,
    path: "pool",
    estimate: false,
    signingChainId: "osmosis-1",
    amountIn: "9950000",
    amountOut: "351505",
    minOut: "347989",
    minOutKind: "exact",
    priceImpact: 0.0159,
    effectiveFee: 0.8,
    spotPrice: 0.0354,
    rate: { toPerFrom: "0.0353271", fromPerTo: "28.3069" },
    decimals: { from: 6, to: 6 },
    route: {
      pools: [{ id: "1464", tokenOutDenom: USDC_N, spread: 0.01, takerFee: 0.8 }],
      splits: [{ inAmount: "9950000", outAmount: "351505", pools: [{ id: "1464", tokenOutDenom: USDC_N }] }],
    },
    venueInputDenom: "uosmo",
    venueOutputDenom: USDC_N,
    slippagePercent: 1,
    quotedAt: NOW,
    expiresAt: NOW + 20_000,
    warnings: [],
    ...overrides,
  };
}

function review(overrides: Partial<SwapReview> & Pick<SwapReview, "path" | "quote">): SwapReview {
  const signingChain = overrides.quote.signingChainId;
  const amountUnits = overrides.amountUnits ?? "10000000";
  return {
    id: 1,
    from: OSMO_SIDE,
    to: { chainId: "osmosis-1", chainName: "Osmosis", denom: USDC_N, ticker: "USDC.n", proven: true, decimals: 6, osmosisDenom: USDC_N },
    amountUnits,
    fee: feeToWire(swapFeeFor(signingChain, BigInt(amountUnits))),
    slippagePercent: 1,
    signer: OSMO_ME,
    recipient: OSMO_ME,
    recoveryAddress: OSMO_ME,
    frozenAt: NOW,
    ...overrides,
  };
}

const POOL = review({ path: "pool", quote: quoteBase({}) });

const DELIVER = review({
  path: "pool-deliver",
  to: { chainId: "injective-1", chainName: "Injective", denom: USDC_INJ_ERC20, ticker: "USDC.inj", proven: true, decimals: 6, osmosisDenom: USDC_INJ },
  recipient: INJ_ME,
  quote: quoteBase({
    path: "pool-deliver",
    amountOut: "354634",
    minOut: "351087",
    venueOutputDenom: USDC_INJ,
    route: {
      pools: [{ id: "3498", tokenOutDenom: USDC_INJ }],
      splits: [
        { inAmount: "5970000", outAmount: "211491", pools: [{ id: "3498", tokenOutDenom: USDC_INJ }] },
        { inAmount: "3980000", outAmount: "143143", pools: [{ id: "3586", tokenOutDenom: USDC_INJ }] },
      ],
    },
    delivery: { destChainId: "injective-1", channelId: "channel-122", port: "transfer", arrivalDenom: USDC_INJ_ERC20, kind: "unwind", clientStatus: "active" },
  }),
});

const CONTRACT_FROM_HUB = review({
  path: "contract",
  from: { chainId: "cosmoshub-4", chainName: "Cosmos Hub", denom: "uatom", ticker: "ATOM", proven: true, decimals: 6, osmosisDenom: ATOM },
  to: OSMO_SIDE,
  amountUnits: "1000000",
  signer: HUB_ME,
  recipient: OSMO_ME,
  recoveryAddress: OSMO_ME,
  quote: quoteBase({
    path: "contract",
    signingChainId: "cosmoshub-4",
    amountIn: "995000",
    amountOut: "50000000",
    minOut: "49500000",
    venueInputDenom: ATOM,
    venueOutputDenom: "uosmo",
    route: {
      pools: [{ id: "1", tokenOutDenom: "uosmo" }],
      splits: [{ inAmount: "995000", outAmount: "50000000", pools: [{ id: "1", tokenOutDenom: "uosmo" }] }],
    },
    contract: SKIP_CONTRACT,
    inbound: { sourceChainId: "cosmoshub-4", channelId: "channel-141", port: "transfer", venueChannelId: "channel-0", kind: "wrap", clientStatus: "active" },
  }),
});

/** 100 SAF sold on Safrochain for allUSDC on Osmosis: the pair the crosschain-swaps contract never had. */
const SAF_NET = swapFeeFor("safrochain-1", BigInt(100_000_000)).net.toString();
const CONTRACT_SAF = review({
  path: "contract",
  from: { chainId: "safrochain-1", chainName: "Safrochain", denom: "usaf", ticker: "SAF", proven: true, decimals: 6, osmosisDenom: SAF },
  to: { chainId: "osmosis-1", chainName: "Osmosis", denom: ALL_USDC, ticker: "allUSDC", proven: true, decimals: 6, osmosisDenom: ALL_USDC },
  amountUnits: "100000000",
  signer: SAFRO_ME,
  recipient: OSMO_ME,
  recoveryAddress: OSMO_ME,
  quote: quoteBase({
    path: "contract",
    signingChainId: "safrochain-1",
    amountIn: SAF_NET,
    amountOut: "47000",
    minOut: "46530",
    venueInputDenom: SAF,
    venueOutputDenom: ALL_USDC,
    route: {
      pools: [{ id: "3600", tokenOutDenom: ALL_USDC }],
      splits: [{ inAmount: SAF_NET, outAmount: "47000", pools: [{ id: "3600", tokenOutDenom: ALL_USDC }] }],
    },
    contract: SKIP_CONTRACT,
    inbound: { sourceChainId: "safrochain-1", channelId: "channel-1", port: "transfer", venueChannelId: "channel-110497", kind: "wrap", clientStatus: "active" },
  }),
});

/** ATOM on the Hub for USDC on Noble: swapped on Osmosis, then sent on over channel-750. */
const CONTRACT_TO_NOBLE = review({
  ...CONTRACT_FROM_HUB,
  to: { chainId: "noble-1", chainName: "Noble", denom: "uusdc", ticker: "USDC.n", proven: true, decimals: 6, osmosisDenom: USDC_N },
  recipient: NOBLE_ME,
  quote: {
    ...CONTRACT_FROM_HUB.quote,
    amountOut: "4500000",
    minOut: "4455000",
    venueOutputDenom: USDC_N,
    route: {
      pools: [{ id: "1464", tokenOutDenom: USDC_N }],
      splits: [{ inAmount: "995000", outAmount: "4500000", pools: [{ id: "1464", tokenOutDenom: USDC_N }] }],
    },
    delivery: { destChainId: "noble-1", channelId: "channel-750", port: "transfer", arrivalDenom: "uusdc", kind: "unwind", clientStatus: "active" },
  },
});

/** A message rebuilt from an edited view: bytes and amino agree, the content differs. */
function edited(msg: TxMessage, edit: (value: Record<string, unknown>) => Record<string, unknown>): TxMessage {
  const view = viewOf(msg);
  assert.ok(view, "the message must be readable before it is edited");
  return toTxMessage({ typeUrl: view.typeUrl, value: edit({ ...view.value }) } as MsgJson);
}

/**
 * The same transfer with a block-height timeout: amino document and protobuf
 * bytes built together, so the two still agree and only the check can refuse
 * it (the engine's own builder never writes a height).
 */
function withHeight(msg: TxMessage, height: Record<string, string>): TxMessage {
  const view = viewOf(msg);
  assert.ok(view);
  const amino = { type: "cosmos-sdk/MsgTransfer", value: { ...view.value, timeout_height: height } };
  const encoded = msgProtoBytes(amino);
  return { typeUrl: encoded.typeUrl, value: encoded.value, amino };
}

function check(r: SwapReview, messages: readonly TxMessage[], now = NOW + 1_000): string[] {
  return checkSwapTx(r, messages, { now });
}

describe("pool: a swap in Osmosis's pools", () => {
  const tx = buildSwapTx(POOL, { now: NOW });

  test("signs on Osmosis: the poolmanager swap of the net amount, then the 0.5% fee", () => {
    assert.equal(tx.chainId, "osmosis-1");
    // The body memo the sign flow writes for it names the pair, never the fee beside it.
    assert.equal(resolveTxMemo(tx), "Swap OSMO to USDC.n - by Zunia-dashboard");
    assert.deepEqual(tx.messages.map((msg) => msg.typeUrl), [POOL_SWAP_TYPE_URL, "/cosmos.bank.v1beta1.MsgSend"]);
    assert.deepEqual(viewOf(tx.messages[0])?.value, {
      sender: OSMO_ME,
      routes: [{ pool_id: "1464", token_out_denom: USDC_N }],
      token_in: { denom: "uosmo", amount: "9950000" },
      token_out_min_amount: "347989",
    });
    assert.deepEqual(viewOf(tx.messages[1])?.value, {
      from_address: OSMO_ME,
      to_address: SWAP_FEE_RECIPIENTS["osmosis-1"],
      amount: [{ denom: "uosmo", amount: "50000" }],
    });
    assert.equal(tx.messages[0]?.amino?.type, "osmosis/poolmanager/swap-exact-amount-in");
    assert.match(tx.messages[0]?.summary ?? "", /Swap 9\.95 OSMO for at least 0\.347989 USDC\.n on Osmosis \(pool 1464\)/);
    assert.deepEqual(check(POOL, tx.messages), []);
  });

  test("refuses another fee address, amount or denom, and a missing or extra message", () => {
    const [swap, fee] = tx.messages as [TxMessage, TxMessage];
    const elsewhere = edited(fee, (value) => ({ ...value, to_address: SOMEONE }));
    assert.match(check(POOL, [swap, elsewhere]).join("\n"), /not Zunia's fee address on Osmosis/);
    const more = edited(fee, (value) => ({ ...value, amount: [{ denom: "uosmo", amount: "50001" }] }));
    assert.match(check(POOL, [swap, more]).join("\n"), /The Zunia fee is 0\.050001 OSMO, not the 0\.05 OSMO you reviewed/);
    assert.match(check(POOL, [swap]).join("\n"), /leaves out the 0\.05 OSMO Zunia fee/);
    assert.deepEqual(check(POOL, [swap, fee, fee]), [EXTRA_MESSAGES]);
  });

  test("refuses a swap of another amount, another floor, other pools, or from another account", () => {
    const [swap, fee] = tx.messages as [TxMessage, TxMessage];
    const cheaper = edited(swap, (value) => ({ ...value, token_out_min_amount: "1" }));
    assert.match(check(POOL, [cheaper, fee]).join("\n"), /The swap's minimum is 0\.000001 USDC\.n, not the 0\.347989 USDC\.n you reviewed/);
    const bigger = edited(swap, (value) => ({ ...value, token_in: { denom: "uosmo", amount: "10000000" } }));
    assert.match(check(POOL, [bigger, fee]).join("\n"), /spends 10 OSMO, not the 9\.95 OSMO you reviewed/);
    const rerouted = edited(swap, (value) => ({ ...value, routes: [{ pool_id: "1369", token_out_denom: USDC_N }] }));
    assert.match(check(POOL, [rerouted, fee]).join("\n"), /other pools, or other amounts/);
    const theirs = edited(swap, (value) => ({ ...value, sender: SOMEONE }));
    assert.match(check(POOL, [theirs, fee]).join("\n"), /would spend from osmo1qvpsx…2u426e, not from the account signing it/);
  });

  test("refuses a message whose bytes and amino document disagree", () => {
    const [swap, fee] = tx.messages as [TxMessage, TxMessage];
    const bytes = new Uint8Array(swap.value);
    bytes[bytes.length - 1] = (bytes[bytes.length - 1] ?? 0) ^ 1;
    assert.deepEqual(check(POOL, [{ ...swap, value: bytes }, fee]), [UNREADABLE_SWAP]);
    const amino = { ...swap, amino: { ...swap.amino!, value: { ...swap.amino!.value, token_out_min_amount: "1" } } };
    assert.deepEqual(check(POOL, [amino, fee]), [UNREADABLE_SWAP]);
    const noAmino: TxMessage = { typeUrl: fee.typeUrl, value: fee.value };
    assert.deepEqual(check(POOL, [swap, noAmino]), [EXTRA_MESSAGES]);
  });

  test("refuses an expired price, another chain, and a review that would deliver elsewhere", () => {
    assert.deepEqual(check(POOL, tx.messages, POOL.quote.expiresAt), [PRICE_EXPIRED]);
    assert.match(checkSwapTx(POOL, tx.messages, { now: NOW, chainId: "cosmoshub-4" }).join("\n"), /signs on osmosis-1, not on cosmoshub-4/);
    const elsewhere = { ...POOL, recipient: SOMEONE };
    assert.match(check(elsewhere, tx.messages).join("\n"), /Osmosis pays a swap to the account that signs it/);
  });

  test("refuses a fee in the review that is not the one Zunia charges", () => {
    const cheap = { ...POOL, fee: { ...POOL.fee, fee: "1", net: "9999999" } };
    assert.throws(() => buildSwapTx(cheap, { now: NOW }), SwapBuildError);
    assert.match(check(cheap, tx.messages).join("\n"), /not the one Zunia charges on Osmosis/);
  });

  test("signs a split order as MsgSplitRouteSwapExactAmountIn", () => {
    const split = buildSwapTx({ ...DELIVER, path: "pool", to: POOL.to, recipient: OSMO_ME, quote: { ...DELIVER.quote, path: "pool", delivery: undefined, venueOutputDenom: USDC_INJ } }, { now: NOW });
    assert.equal(split.messages[0]?.typeUrl, POOL_SPLIT_SWAP_TYPE_URL);
    assert.equal(split.messages[0]?.amino?.type, "osmosis/poolmanager/split-amount-in");
  });
});

describe("pool-deliver: the swap, the fee, and the floor sent home", () => {
  const tx = buildSwapTx(DELIVER, { now: NOW });

  test("adds the one-hop transfer of exactly the floor, last", () => {
    assert.deepEqual(tx.messages.map((msg) => msg.typeUrl), [POOL_SPLIT_SWAP_TYPE_URL, "/cosmos.bank.v1beta1.MsgSend", TRANSFER_TYPE_URL]);
    assert.deepEqual(viewOf(tx.messages[2])?.value, {
      source_port: "transfer",
      source_channel: "channel-122",
      token: { denom: USDC_INJ, amount: "351087" },
      sender: OSMO_ME,
      receiver: INJ_ME,
      timeout_height: {},
      timeout_timestamp: timeoutAfter(NOW),
    });
    assert.equal(timeoutAfter(NOW), (BigInt(NOW) * BigInt(1_000_000) + BigInt(600) * BigInt(1_000_000_000)).toString());
    assert.deepEqual(check(DELIVER, tx.messages), []);
  });

  test("refuses another amount, another receiver, a memo, another channel or a past timeout", () => {
    const [swap, fee, transfer] = tx.messages as [TxMessage, TxMessage, TxMessage];
    const more = edited(transfer, (value) => ({ ...value, token: { denom: USDC_INJ, amount: "354634" } }));
    assert.match(check(DELIVER, [swap, fee, more]).join("\n"), /sends 0\.354634 USDC\.inj, not the swap's minimum of 0\.351087 USDC\.inj/);
    const theirs = edited(transfer, (value) => ({ ...value, receiver: address("inj", 1) }));
    assert.match(check(DELIVER, [swap, fee, theirs]).join("\n"), /not your address on Injective/);
    const memo = edited(transfer, (value) => ({ ...value, memo: '{"forward":{}}' }));
    assert.match(check(DELIVER, [swap, fee, memo]).join("\n"), /carries a memo/);
    const channel = edited(transfer, (value) => ({ ...value, source_channel: "channel-1" }));
    assert.match(check(DELIVER, [swap, fee, channel]).join("\n"), /leaves over channel-1, not over channel-122/);
    const late = edited(transfer, (value) => ({ ...value, timeout_timestamp: (BigInt(NOW) * BigInt(1_000_000)).toString() }));
    assert.match(check(DELIVER, [swap, fee, late]).join("\n"), /timeout has already passed/);
    assert.deepEqual(check(DELIVER, [swap, fee, transfer, transfer]), [EXTRA_MESSAGES]);
    assert.match(check(DELIVER, [swap, fee]).join("\n"), /could not read the transfer/);
  });

  test("refuses a block-height timeout on the transfer, which Zunia never sets", () => {
    const [swap, fee, transfer] = tx.messages as [TxMessage, TxMessage, TxMessage];
    const height = withHeight(transfer, { revision_number: "1", revision_height: "100" });
    assert.notEqual(viewOf(height), null);
    assert.deepEqual(check(DELIVER, [swap, fee, height]), [HEIGHT_TIMEOUT]);
    // Amino's `{}` and an explicit zero height are both "no height timeout".
    assert.deepEqual(check(DELIVER, [swap, fee, withHeight(transfer, { revision_number: "0", revision_height: "0" })]), []);
  });

  test("will not build without a proved delivery for the To", () => {
    assert.throws(() => buildSwapTx({ ...DELIVER, quote: { ...DELIVER.quote, delivery: undefined } }, { now: NOW }), SwapBuildError);
    assert.throws(
      () => buildSwapTx({ ...DELIVER, quote: { ...DELIVER.quote, delivery: { ...DELIVER.quote.delivery!, arrivalDenom: "inj" } } }, { now: NOW }),
      SwapBuildError,
    );
  });
});

describe("contract: one transfer whose memo swaps on Osmosis and delivers", () => {
  const tx = buildSwapTx(CONTRACT_FROM_HUB, { now: NOW });

  test("signs on the Hub: the transfer to Skip's entry point over the proved channel, then the fee there", () => {
    assert.equal(tx.chainId, "cosmoshub-4");
    assert.deepEqual(tx.messages.map((msg) => msg.typeUrl), [TRANSFER_TYPE_URL, "/cosmos.bank.v1beta1.MsgSend"]);
    const transfer = viewOf(tx.messages[0])!.value;
    assert.equal(transfer.receiver, SKIP);
    assert.equal(transfer.source_channel, "channel-141");
    assert.deepEqual(transfer.token, { denom: "uatom", amount: "995000" });
    assert.equal(transfer.timeout_timestamp, timeoutAfter(NOW));
    const memo = readSkipSwapMemo(String(transfer.memo));
    assert.ok(memo);
    assert.equal(memo.entryPoint, SKIP);
    assert.deepEqual(memo.operations, [{ pool: "1", denomIn: ATOM, denomOut: "uosmo" }]);
    assert.deepEqual(memo.minOut, { denom: "uosmo", amount: "49500000" });
    assert.deepEqual(memo.postSwap, { kind: "transfer", toAddress: OSMO_ME });
    assert.equal(memo.timeoutNs, timeoutAfter(NOW, 15));
    assert.deepEqual(viewOf(tx.messages[1])?.value, {
      from_address: HUB_ME,
      to_address: SWAP_FEE_RECIPIENTS["cosmoshub-4"],
      amount: [{ denom: "uatom", amount: "5000" }],
    });
    assert.deepEqual(check(CONTRACT_FROM_HUB, tx.messages), []);
  });

  test("sells SAF on Safrochain for allUSDC on Osmosis in one signature, keeping the 0.5% fee as a send", () => {
    const saf = buildSwapTx(CONTRACT_SAF, { now: NOW });
    assert.equal(saf.chainId, "safrochain-1");
    assert.deepEqual(saf.messages.map((msg) => msg.typeUrl), [TRANSFER_TYPE_URL, "/cosmos.bank.v1beta1.MsgSend"]);
    const transfer = viewOf(saf.messages[0])!.value;
    assert.equal(transfer.source_channel, "channel-1");
    assert.equal(transfer.receiver, SKIP);
    assert.deepEqual(transfer.token, { denom: "usaf", amount: "99500000" });
    // The deadline is a bare number in the memo text, never a string.
    assert.match(String(transfer.memo), /"timeout_timestamp":\d{19},/);
    assert.deepEqual(readSkipSwapMemo(String(transfer.memo))?.operations, [{ pool: "3600", denomIn: SAF, denomOut: ALL_USDC }]);
    assert.deepEqual(viewOf(saf.messages[1])?.value, {
      from_address: SAFRO_ME,
      to_address: SWAP_FEE_RECIPIENTS["safrochain-1"],
      amount: [{ denom: "usaf", amount: "500000" }],
    });
    assert.deepEqual(check(CONTRACT_SAF, saf.messages), []);
  });

  test("delivers on another chain over the channel the quote proved, a failed hop paying the user's Osmosis address", () => {
    const noble = buildSwapTx(CONTRACT_TO_NOBLE, { now: NOW });
    const memo = readSkipSwapMemo(String(viewOf(noble.messages[0])!.value.memo));
    assert.deepEqual(memo?.postSwap, { kind: "ibc-transfer", channelId: "channel-750", receiver: NOBLE_ME, recoverAddress: OSMO_ME });
    assert.deepEqual(check(CONTRACT_TO_NOBLE, noble.messages), []);
    const [transfer, fee] = noble.messages as [TxMessage, TxMessage];
    const otherChannel = edited(transfer, (value) => ({ ...value, memo: String(value.memo).replace('"channel-750"', '"channel-1"') }));
    assert.match(check(CONTRACT_TO_NOBLE, [otherChannel, fee]).join("\n"), /leave Osmosis over channel-1, not over channel-750/);
    const otherRecovery = edited(transfer, (value) => ({ ...value, memo: String(value.memo).replace(`"recover_address":"${OSMO_ME}"`, `"recover_address":"${SOMEONE}"`) }));
    assert.match(check(CONTRACT_TO_NOBLE, [otherRecovery, fee]).join("\n"), /failed delivery would pay .* not your address on Osmosis/);
  });

  test("refuses another payee, pool, minimum, contract, channel or deadline", () => {
    const [transfer, fee] = tx.messages as [TxMessage, TxMessage];
    const withMemo = (replace: (memo: string) => string) => edited(transfer, (value) => ({ ...value, memo: replace(String(value.memo)) }));
    const payee = withMemo((memo) => memo.replace(`"to_address":"${OSMO_ME}"`, `"to_address":"${SOMEONE}"`));
    assert.match(check(CONTRACT_FROM_HUB, [payee, fee]).join("\n"), /would pay osmo1qvpsx…2u426e, which is not your address on Osmosis/);
    const pool = withMemo((memo) => memo.replace(`"pool":"1"`, `"pool":"2"`));
    assert.match(check(CONTRACT_FROM_HUB, [pool, fee]).join("\n"), /other pools than the route you reviewed/);
    const minimum = withMemo((memo) => memo.replace(`"amount":"49500000"`, `"amount":"1"`));
    assert.match(check(CONTRACT_FROM_HUB, [minimum, fee]).join("\n"), /minimum is .* not the .* you reviewed/);
    const deadline = withMemo((memo) => memo.replace(/"timeout_timestamp":\d+/, `"timeout_timestamp":${BigInt(NOW + 3 * 60 * 60_000) * BigInt(1_000_000)}`));
    assert.match(check(CONTRACT_FROM_HUB, [deadline, fee]).join("\n"), /deadline is not the one Zunia sets/);
    const affiliate = withMemo((memo) => memo.replace(`"affiliates":[]`, `"affiliates":[{"basis_points_fee":"100","address":"${SOMEONE}"}]`));
    assert.deepEqual(check(CONTRACT_FROM_HUB, [affiliate, fee]), [UNREADABLE_SWAP]);
    const channel = edited(transfer, (value) => ({ ...value, source_channel: "channel-1" }));
    assert.match(check(CONTRACT_FROM_HUB, [channel, fee]).join("\n"), /leaves over channel-1, not over channel-141/);
    const notContract = edited(transfer, (value) => ({ ...value, receiver: OSMO_ME }));
    assert.match(check(CONTRACT_FROM_HUB, [notContract, fee]).join("\n"), /not addressed to the swap contract/);
    const otherContract = withMemo((memo) => memo.replace(`"contract":"${SKIP}"`, `"contract":"${SOMEONE}"`));
    assert.match(check(CONTRACT_FROM_HUB, [otherContract, fee]).join("\n"), /not the swap contract Zunia verified/);
  });

  test("refuses a block-height timeout on the transfer that carries the swap", () => {
    const [transfer, fee] = tx.messages as [TxMessage, TxMessage];
    assert.deepEqual(check(CONTRACT_FROM_HUB, [withHeight(transfer, { revision_height: "26000000" }), fee]), [HEIGHT_TIMEOUT]);
  });

  test("refuses a contract the venue check did not verify", () => {
    const unverified = { ...CONTRACT_FROM_HUB, quote: { ...CONTRACT_FROM_HUB.quote, contract: { ...SKIP_CONTRACT, verified: false } } };
    assert.throws(() => buildSwapTx(unverified, { now: NOW }), SwapBuildError);
    assert.match(check(unverified, tx.messages).join("\n"), /not the swap contract Zunia verified/);
    const elsewhere = { ...CONTRACT_FROM_HUB, quote: { ...CONTRACT_FROM_HUB.quote, contract: { ...SKIP_CONTRACT, address: SOMEONE } } };
    assert.throws(() => buildSwapTx(elsewhere, { now: NOW }), SwapBuildError);
  });

  test("will not build without a recovery address, or with a signer from another chain", () => {
    assert.throws(() => buildSwapTx({ ...CONTRACT_FROM_HUB, recoveryAddress: null }, { now: NOW }), /Osmosis address/);
    assert.throws(() => buildSwapTx({ ...CONTRACT_FROM_HUB, signer: OSMO_ME }, { now: NOW }), /not an address on Cosmos Hub/);
  });

  test("names the default memo after both tokens", () => {
    assert.equal(resolveTxMemo(buildSwapTx(CONTRACT_SAF, { now: NOW })), "Swap SAF to allUSDC - by Zunia-dashboard");
  });
});

describe("the body memo a swap signs when the user writes none", () => {
  const SPLIT = { ...DELIVER, path: "pool" as const, to: POOL.to, recipient: OSMO_ME, quote: { ...DELIVER.quote, path: "pool" as const, delivery: undefined, venueOutputDenom: USDC_N, route: { pools: [{ id: "3498", tokenOutDenom: USDC_N }], splits: [{ inAmount: "5970000", outAmount: "1", pools: [{ id: "3498", tokenOutDenom: USDC_N }] }, { inAmount: "3980000", outAmount: "1", pools: [{ id: "3586", tokenOutDenom: USDC_N }] }] } } };

  test("names the pair on every path, the swap first and never the fee beside it", () => {
    const cases: Array<[string, SwapReview, string]> = [
      ["pool", POOL, "Swap OSMO to USDC.n - by Zunia-dashboard"],
      ["pool, split route", SPLIT, "Swap OSMO to USDC.n - by Zunia-dashboard"],
      ["pool-deliver", DELIVER, "Swap OSMO to USDC.inj - by Zunia-dashboard"],
      ["contract from the Hub", CONTRACT_FROM_HUB, "Swap ATOM to OSMO - by Zunia-dashboard"],
      ["contract to Noble", CONTRACT_TO_NOBLE, "Swap ATOM to USDC.n - by Zunia-dashboard"],
    ];
    for (const [name, reviewed, expected] of cases) {
      const tx = buildSwapTx(reviewed, { now: NOW });
      assert.equal(tx.messages[1]?.typeUrl, "/cosmos.bank.v1beta1.MsgSend", `${name}: the fee is signed beside the swap`);
      assert.equal(resolveTxMemo(tx), expected, name);
      // A memo the user wrote is kept as written, trimmed, never suffixed.
      assert.equal(resolveTxMemo({ ...tx, memo: "  my swap  " }), "my swap", name);
    }
  });

  test("says only 'Swap' when the review did not prove a side, and names nothing the messages do not carry", () => {
    const unproven = { ...POOL, to: { ...POOL.to, proven: false } };
    assert.equal(resolveTxMemo(buildSwapTx(unproven, { now: NOW })), "Swap - by Zunia-dashboard");
    const older = { ...POOL, to: { ...POOL.to, proven: undefined } };
    assert.equal(resolveTxMemo(buildSwapTx(older, { now: NOW })), "Swap - by Zunia-dashboard");
    // The context names denoms, not paths: the same names for another output say nothing.
    const tx = buildSwapTx(POOL, { now: NOW });
    const elsewhere = { ...tx, memoContext: swapMemoContext({ ...POOL, quote: { ...POOL.quote, venueOutputDenom: USDC_INJ } }) };
    assert.equal(resolveTxMemo(elsewhere), "Swap - by Zunia-dashboard");
  });

  test("names the From on the chain that signs and the To as Osmosis holds it", () => {
    assert.deepEqual(swapMemoContext(CONTRACT_FROM_HUB), {
      tokens: [
        { chainId: "cosmoshub-4", denom: "uatom", ticker: "ATOM", proven: true },
        { chainId: "osmosis-1", denom: "uosmo", ticker: "OSMO", proven: true },
      ],
    });
    assert.deepEqual(swapMemoContext(DELIVER).tokens?.[1], { chainId: "osmosis-1", denom: USDC_INJ, ticker: "USDC.inj", proven: true });
  });

  test("leaves the packet memo that runs the contract exactly as built", () => {
    const tx = buildSwapTx(CONTRACT_FROM_HUB, { now: NOW });
    const before = toHex(tx.messages[0]!.value);
    const packet = viewOf(tx.messages[0])!.value.memo;
    assert.equal(resolveTxMemo(tx), "Swap ATOM to OSMO - by Zunia-dashboard");
    assert.equal(toHex(tx.messages[0]!.value), before);
    assert.equal(viewOf(tx.messages[0])!.value.memo, packet);
    assert.ok(readSkipSwapMemo(String(packet)));
  });
});
