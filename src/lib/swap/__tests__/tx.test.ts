/**
 * The transaction a reviewed swap signs (src/lib/swap/tx.ts `buildSwapTx`)
 * and the check that runs on it right before signing (`checkSwapTx`), for
 * every path that signs: `pool`, `pool-deliver`, `contract` from another chain
 * and `contract` from Osmosis.
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
import { validateMemo } from "@zunialab/interchain";

import { SWAP_FEE_RECIPIENTS } from "@/config/fees";
import { msgProtoBytes } from "@/lib/tx/amino-tx";
import { toHex } from "@/lib/tx/bytes";
import { resolveTxMemo } from "@/lib/tx/memo";
import type { TxMessage } from "@/lib/tx/types";
import { EXTRA_MESSAGES, HEIGHT_TIMEOUT, PRICE_EXPIRED, UNREADABLE_SWAP } from "../checks";
import { buildSwapFeeMsg, feeToWire, swapFeeFor } from "../fee";
import { EXECUTE_CONTRACT_TYPE_URL, toTxMessage, viewOf } from "../messages";
import { POOL_SPLIT_SWAP_TYPE_URL, POOL_SWAP_TYPE_URL, TRANSFER_TYPE_URL } from "../pool";
import type { SwapReview } from "../review";
import { buildSwapTx, checkSwapTx, SwapBuildError, swapMemoContext, timeoutAfter } from "../tx";
import type { MsgJson } from "../types";
import type { SwapQuoteOk } from "../wire";

const address = (prefix: string, fill: number) => bech32.encode(prefix, bech32.toWords(new Uint8Array(20).fill(fill)));
const OSMO_ME = address("osmo", 7);
const HUB_ME = address("cosmos", 7);
const INJ_ME = address("inj", 9);
const AXL_ME = address("axelar", 7);
const SOMEONE = address("osmo", 3);

const XCS = "osmo1uwk8xc6q0s6t5qcpr6rht3sczu6du83xq8pwxjua0hfj5hzcnh3sqxwvxs";
const USDC_N = "ibc/498A0751C798A0D9A389AA3691123DADA57DAA4FE165D5C75894505B876BA6E4";
const USDC_INJ = "ibc/794C7D7F3B857713878A3A1927251FA6AC1EEE520424C1F6FAFE9BA26D476138";
const USDC_INJ_ERC20 = "erc20:0xa00C59fF5a080D2b954d0c75e46E22a0c371235a";
const USDC_AXL = "ibc/D189335C6E4A68B513C10AB227BF1C1D38C746766278BA3EEB4FB14124F1D858";
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
    minOutKind: "twap-estimate",
    venueInputDenom: ATOM,
    venueOutputDenom: "uosmo",
    route: { pools: [{ id: "1", tokenOutDenom: "uosmo" }] },
    contract: { address: XCS, verified: true, label: "CrossChainSwaps v1.2", codeId: "37" },
    inbound: { sourceChainId: "cosmoshub-4", channelId: "channel-141", port: "transfer", venueChannelId: "channel-0", kind: "wrap", clientStatus: "active" },
    twapWindowSeconds: 10,
  }),
});

const CONTRACT_FROM_OSMOSIS = review({
  path: "contract",
  to: { chainId: "axelar-dojo-1", chainName: "Axelar", denom: "uusdc", ticker: "USDC.axl", proven: true, decimals: 6, osmosisDenom: USDC_AXL },
  recipient: AXL_ME,
  quote: quoteBase({
    path: "contract",
    minOutKind: "twap-estimate",
    venueOutputDenom: USDC_AXL,
    route: { pools: [{ id: "678", tokenOutDenom: USDC_AXL }] },
    contract: { address: XCS, verified: true, label: "CrossChainSwaps v1.2", codeId: "37" },
    delivery: { destChainId: "axelar-dojo-1", channelId: "channel-208", port: "transfer", arrivalDenom: "uusdc", kind: "unwind", clientStatus: "active" },
    twapWindowSeconds: 10,
  }),
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

describe("contract, from another chain: one transfer whose memo calls the contract", () => {
  const tx = buildSwapTx(CONTRACT_FROM_HUB, { now: NOW });

  test("signs on the Hub: the transfer to the contract over the proved channel, then the fee there", () => {
    assert.equal(tx.chainId, "cosmoshub-4");
    assert.deepEqual(tx.messages.map((msg) => msg.typeUrl), [TRANSFER_TYPE_URL, "/cosmos.bank.v1beta1.MsgSend"]);
    const transfer = viewOf(tx.messages[0])!.value;
    assert.equal(transfer.receiver, XCS);
    assert.equal(transfer.source_channel, "channel-141");
    assert.deepEqual(transfer.token, { denom: "uatom", amount: "995000" });
    const memo = validateMemo(String(transfer.memo), { receiver: XCS });
    assert.equal(memo.kind, "xcs");
    assert.equal(memo.xcs?.outputDenom, "uosmo");
    assert.equal(memo.xcs?.receiver, OSMO_ME);
    assert.deepEqual(memo.xcs?.slippage, { kind: "twap", slippagePercentage: "1", windowSeconds: 10 });
    assert.deepEqual(memo.xcs?.onFailedDelivery, { kind: "local_recovery_addr", address: OSMO_ME });
    assert.deepEqual(viewOf(tx.messages[1])?.value, {
      from_address: HUB_ME,
      to_address: SWAP_FEE_RECIPIENTS["cosmoshub-4"],
      amount: [{ denom: "uatom", amount: "5000" }],
    });
    assert.deepEqual(check(CONTRACT_FROM_HUB, tx.messages), []);
  });

  test("refuses another payee, recovery address, contract, channel or tolerance in the memo", () => {
    const [transfer, fee] = tx.messages as [TxMessage, TxMessage];
    const withMemo = (patch: (swap: Record<string, unknown>) => void) =>
      edited(transfer, (value) => {
        const memo = JSON.parse(String(value.memo)) as { wasm: { contract: string; msg: { osmosis_swap: Record<string, unknown> } } };
        patch(memo.wasm.msg.osmosis_swap);
        return { ...value, memo: JSON.stringify(memo) };
      });
    const payee = withMemo((swap) => {
      swap.receiver = SOMEONE;
    });
    assert.match(check(CONTRACT_FROM_HUB, [payee, fee]).join("\n"), /would pay osmo1qvpsx…2u426e, which is not your address on Osmosis/);
    const recovery = withMemo((swap) => {
      swap.on_failed_delivery = { local_recovery_addr: SOMEONE };
    });
    assert.match(check(CONTRACT_FROM_HUB, [recovery, fee]).join("\n"), /recovery address .* is not your address on Osmosis/);
    const tolerance = withMemo((swap) => {
      swap.slippage = { twap: { slippage_percentage: "20", window_seconds: 10 } };
    });
    assert.match(check(CONTRACT_FROM_HUB, [tolerance, fee]).join("\n"), /price protection is not the 1% tolerance/);
    const route = withMemo((swap) => {
      swap.route = [{ pool_id: "1", token_out_denom: "uosmo" }];
    });
    assert.deepEqual(check(CONTRACT_FROM_HUB, [route, fee]), [UNREADABLE_SWAP]);
    const channel = edited(transfer, (value) => ({ ...value, source_channel: "channel-1" }));
    assert.match(check(CONTRACT_FROM_HUB, [channel, fee]).join("\n"), /leaves over channel-1, not over channel-141/);
    const notContract = edited(transfer, (value) => ({ ...value, receiver: OSMO_ME }));
    assert.match(check(CONTRACT_FROM_HUB, [notContract, fee]).join("\n"), /not addressed to the swap contract/);
  });

  test("refuses a block-height timeout on the transfer that carries the swap", () => {
    const [transfer, fee] = tx.messages as [TxMessage, TxMessage];
    assert.deepEqual(check(CONTRACT_FROM_HUB, [withHeight(transfer, { revision_height: "26000000" }), fee]), [HEIGHT_TIMEOUT]);
  });

  test("refuses a contract the venue check did not verify", () => {
    const unverified = { ...CONTRACT_FROM_HUB, quote: { ...CONTRACT_FROM_HUB.quote, contract: { ...CONTRACT_FROM_HUB.quote.contract!, verified: false } } };
    assert.throws(() => buildSwapTx(unverified, { now: NOW }), SwapBuildError);
    assert.match(check(unverified, tx.messages).join("\n"), /not the swap contract Zunia verified/);
  });

  test("will not build without a recovery address, or with a signer from another chain", () => {
    assert.throws(() => buildSwapTx({ ...CONTRACT_FROM_HUB, recoveryAddress: null }, { now: NOW }), /recovery address/);
    assert.throws(() => buildSwapTx({ ...CONTRACT_FROM_HUB, signer: OSMO_ME }, { now: NOW }), /not an address on Cosmos Hub/);
  });
});

describe("contract, from Osmosis: one contract call", () => {
  const tx = buildSwapTx(CONTRACT_FROM_OSMOSIS, { now: NOW });

  test("calls the contract with the net amount as its one coin, then pays the fee", () => {
    assert.deepEqual(tx.messages.map((msg) => msg.typeUrl), [EXECUTE_CONTRACT_TYPE_URL, "/cosmos.bank.v1beta1.MsgSend"]);
    const call = viewOf(tx.messages[0])!.value;
    assert.equal(call.contract, XCS);
    assert.deepEqual(call.funds, [{ denom: "uosmo", amount: "9950000" }]);
    assert.deepEqual(Object.keys(call.msg as object), ["osmosis_swap"]);
    assert.equal(tx.messages[0]?.amino?.type, "wasm/MsgExecuteContract");
    assert.deepEqual(check(CONTRACT_FROM_OSMOSIS, tx.messages), []);
  });

  test("refuses a second coin, another output, or a fee message that is not one", () => {
    const [call, fee] = tx.messages as [TxMessage, TxMessage];
    const twoCoins = edited(call, (value) => ({ ...value, funds: [{ denom: "uosmo", amount: "9950000" }, { denom: "uion", amount: "1" }] }));
    assert.deepEqual(check(CONTRACT_FROM_OSMOSIS, [twoCoins, fee]), [UNREADABLE_SWAP]);
    const other = edited(call, (value) => {
      const msg = JSON.parse(JSON.stringify(value.msg)) as { osmosis_swap: Record<string, unknown> };
      msg.osmosis_swap.output_denom = USDC_N;
      return { ...value, msg };
    });
    assert.match(check(CONTRACT_FROM_OSMOSIS, [other, fee]).join("\n"), /would buy ibc\/498A…6E4, not the USDC\.axl you picked/);
    const send = toTxMessage(buildSwapFeeMsg({ sender: OSMO_ME, recipient: SOMEONE, denom: "uosmo", amount: BigInt(50_000) }));
    assert.match(check(CONTRACT_FROM_OSMOSIS, [call, send]).join("\n"), /not Zunia's fee address on Osmosis/);
  });

  test("names the default memo after both tokens", () => {
    assert.equal(resolveTxMemo(buildSwapTx(CONTRACT_FROM_OSMOSIS, { now: NOW })), "Swap OSMO to USDC.axl - by Zunia-dashboard");
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
      ["contract from Osmosis", CONTRACT_FROM_OSMOSIS, "Swap OSMO to USDC.axl - by Zunia-dashboard"],
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
    assert.equal(validateMemo(String(packet), { receiver: XCS }).kind, "xcs");
  });
});
