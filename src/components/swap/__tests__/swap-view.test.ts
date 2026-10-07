/**
 * The swap page's pure readings: ../swap-view.ts (deep links, default rows,
 * Max and its fee reserve, the form's button, the route, the tracking plan)
 * and ../swap-analysis.ts (the costs, what the wallet can swap, past rates,
 * the implied rate series).
 */

import "../../../lib/swap/__tests__/json-modules";
import assert from "node:assert/strict";
import { describe, test } from "node:test";

import type { ActivityAmount } from "@/lib/activity/types";
import type { AssetOption } from "@/lib/swap/assets";
import { swapFeeFor } from "@/lib/swap/fee";
import type { SwapQuotePrice } from "@/lib/swap/wire";
import type { XcsRouteTable } from "@/lib/swap/xcs";

import {
  allInCost,
  compactRatio,
  costBreakdown,
  executedRate,
  ratioSeries,
  sampleTolerance,
  seriesChange,
  seriesRange,
  swappableSummary,
} from "../swap-analysis";
import {
  ageText,
  blockedLabel,
  defaultFromKey,
  defaultToKey,
  failedAt,
  feeForNet,
  feeReserve,
  formCta,
  fractionDigits,
  impactView,
  indicativeAmount,
  indicativeUnits,
  listedVenueDenoms,
  marketRate,
  opensInOneSignature,
  pathCopy,
  quoteMatchesPair,
  readSwapLink,
  receiveView,
  resolveLinkedOption,
  routeSpread,
  sellStanding,
  shareText,
  signSteps,
  spendableUnits,
  splitViews,
  swapHref,
  swapLinkKey,
  trackingPlan,
  versus,
  type CtaInput,
} from "../swap-view";

const ATOM_OSMO = "ibc/27394FB092D2ECCD56123C74F36E4C1F926001CEADA9CA97EA622B25F41E5EB2";
const USDC_N = "ibc/498A0751C798A0D9A389AA3691123DADA57DAA4FE165D5C75894505B876BA6E4";

function option(
  chainId: string,
  denom: string,
  ticker: string,
  osmosisDenom: string | null,
  extra: Partial<AssetOption> & { identityKey?: string; origin?: [string, string] } = {},
): AssetOption {
  const { identityKey, origin, ...rest } = extra;
  return {
    key: `${chainId}:${denom}`,
    chainId,
    chainName: chainId === "osmosis-1" ? "Osmosis" : chainId === "cosmoshub-4" ? "Cosmos Hub" : chainId,
    denom,
    identity: {
      key: identityKey ?? `${chainId}:${denom}`,
      chainId,
      denom,
      kind: "native",
      ticker,
      name: ticker,
      decimals: 6,
      provenance: "native",
      proven: true,
      ...(origin ? { originChainId: origin[0], originDenom: origin[1] } : {}),
    },
    ticker,
    decimals: 6,
    amount: "100000000",
    held: true,
    osmosisDenom,
    price: null,
    liquidity: null,
    verified: true,
    executable: "unknown",
    disabledReason: null,
    searchOnly: false,
    testnet: false,
    ...rest,
  };
}

const OSMO = option("osmosis-1", "uosmo", "OSMO", "uosmo");
const USDC = option("osmosis-1", USDC_N, "USDC.n", USDC_N);
const ATOM_HUB = option("cosmoshub-4", "uatom", "ATOM", ATOM_OSMO, { identityKey: "cosmoshub-4:uatom" });
const ATOM_ON_OSMO = option("osmosis-1", ATOM_OSMO, "ATOM", ATOM_OSMO, {
  identityKey: "cosmoshub-4:uatom",
  origin: ["cosmoshub-4", "uatom"],
  held: false,
  amount: "0",
});
const SAF = option("safrochain-1", "usaf", "SAF", null);

describe("deep links", () => {
  test("reads well-formed keys and amounts, drops the rest", () => {
    assert.deepEqual(readSwapLink({ from: "osmosis-1:uosmo", to: `osmosis-1:${USDC_N}`, amount: "12,5" }), {
      from: "osmosis-1:uosmo",
      to: `osmosis-1:${USDC_N}`,
      amount: "12.5",
    });
    assert.deepEqual(readSwapLink({ from: "osmosis-1", to: "javascript:alert(1)", amount: "1e9" }), {
      from: null,
      to: null,
      amount: null,
    });
    assert.equal(readSwapLink({ amount: "0" }).amount, null);
    assert.equal(readSwapLink({ from: ["cosmoshub-4:uatom", "x"] }).from, "cosmoshub-4:uatom");
    assert.equal(readSwapLink({ from: "injective-1:erc20:0xa00C" }).from, "injective-1:erc20:0xa00C");
  });

  test("keys and hrefs", () => {
    assert.equal(swapLinkKey({ from: "a:b", to: null, amount: "1" }), "a:b||1");
    assert.equal(swapHref(null, null), "/swap");
    assert.equal(swapHref("osmosis-1:uosmo", `osmosis-1:${USDC_N}`), `/swap?from=osmosis-1%3Auosmo&to=osmosis-1%3Aibc%2F${USDC_N.slice(4)}`);
  });

  test("resolves a row key exactly, else the asset by identity on its own chain first", () => {
    const rows = [OSMO, ATOM_ON_OSMO, ATOM_HUB];
    assert.equal(resolveLinkedOption(rows, "osmosis-1:uosmo")?.key, OSMO.key);
    assert.equal(resolveLinkedOption(rows, "cosmoshub-4:uatom")?.key, ATOM_HUB.key);
    assert.equal(resolveLinkedOption([OSMO, ATOM_ON_OSMO], "cosmoshub-4:uatom")?.key, ATOM_ON_OSMO.key);
    assert.equal(resolveLinkedOption(rows, "juno-1:ujuno"), undefined);
    assert.equal(resolveLinkedOption(rows, null), undefined);
    const disabled = { ...ATOM_ON_OSMO, disabledReason: "no" };
    assert.equal(resolveLinkedOption([disabled], "cosmoshub-4:uatom"), undefined);
  });
});

describe("default rows", () => {
  const listed = listedVenueDenoms([
    { osmosisDenom: "uosmo", tradable: true },
    { osmosisDenom: USDC_N, tradable: true },
    { osmosisDenom: ATOM_OSMO, tradable: true },
    { osmosisDenom: "ibc/OFF", tradable: false },
  ]);

  test("standing of held rows", () => {
    assert.equal(sellStanding(OSMO, listed), "tradable");
    assert.equal(sellStanding(SAF, listed), "not-traded");
    assert.equal(sellStanding(option("osmosis-1", "ibc/OFF", "OFF", "ibc/OFF"), listed), "unlisted");
    assert.equal(sellStanding(option("osmosis-1", "ibc/OFF", "OFF", "ibc/OFF"), null), "tradable");
  });

  test("From: the largest tradable holding on Osmosis, else the largest tradable one, else the first", () => {
    const value = new Map([
      [ATOM_HUB.key, 500],
      [USDC.key, 14],
      [OSMO.key, 0.3],
      [SAF.key, 900],
    ]);
    const valueOf = (o: AssetOption) => value.get(o.key) ?? null;
    assert.equal(defaultFromKey([SAF, ATOM_HUB, USDC, OSMO], listed, valueOf), USDC.key);
    assert.equal(defaultFromKey([SAF, ATOM_HUB, OSMO], listed, valueOf), ATOM_HUB.key);
    assert.equal(defaultFromKey([SAF], listed, valueOf), SAF.key);
    assert.equal(defaultFromKey([], listed, valueOf), null);
  });

  test("From: a pair signed once before a two-step one, whatever the one-unit floor", () => {
    const TIA = option("celestia", "utia", "TIA", "ibc/TIA", { chainName: "Celestia" });
    const value = new Map([
      [TIA.key, 0.89],
      [ATOM_HUB.key, 0.63],
      [OSMO.key, 0.06],
      [USDC.key, 0],
    ]);
    const valueOf = (o: AssetOption) => value.get(o.key) ?? null;
    const twoSteps = new Set([TIA.key]);
    const once = (o: AssetOption) => !twoSteps.has(o.key);
    const tiaListed = new Set([...listed, "ibc/TIA"]);
    // TIA is worth the most, but only swaps after moving to Osmosis.
    assert.equal(defaultFromKey([TIA, ATOM_HUB, OSMO], tiaListed, valueOf, once), ATOM_HUB.key);
    assert.equal(defaultFromKey([TIA, OSMO], tiaListed, valueOf, once), OSMO.key);
    // Unpriced holdings do not count as an opening amount.
    assert.equal(defaultFromKey([TIA, USDC], tiaListed, valueOf, once), TIA.key);
    // Without the route's answer, the largest priced holding, as before.
    assert.equal(defaultFromKey([TIA, ATOM_HUB, OSMO], tiaListed, valueOf), TIA.key);
    // An Osmosis holding worth a unit or more still comes first.
    assert.equal(defaultFromKey([TIA, ATOM_HUB, OSMO], tiaListed, (o) => (o.key === OSMO.key ? 2 : (value.get(o.key) ?? null)), once), OSMO.key);
  });

  test("the opening pair is signed once unless the route table says otherwise", () => {
    const table: XcsRouteTable = {
      xcsContract: "osmo1xcs",
      swapContract: "osmo1router",
      routes: [
        { input: ATOM_OSMO, output: "uosmo", poolIds: ["1"] },
        { input: "uosmo", output: ATOM_OSMO, poolIds: ["1"] },
      ],
      readAt: 0,
    };
    const tia = option("celestia", "utia", "TIA", "ibc/TIA");
    const osmoOnHub = option("cosmoshub-4", "ibc/OSMOHUB", "OSMO", "uosmo");
    assert.equal(opensInOneSignature(OSMO, table, ATOM_OSMO), true);
    assert.equal(opensInOneSignature(ATOM_HUB, table, ATOM_OSMO), true);
    assert.equal(opensInOneSignature(tia, table, ATOM_OSMO), false);
    assert.equal(opensInOneSignature(osmoOnHub, table, ATOM_OSMO), true);
    assert.equal(opensInOneSignature(osmoOnHub, { ...table, routes: table.routes.slice(0, 1) }, ATOM_OSMO), false);
    assert.equal(opensInOneSignature(SAF, table, ATOM_OSMO), false);
    // No table yet, or no name for ATOM on Osmosis: the contract is presumed.
    assert.equal(opensInOneSignature(tia, null, ATOM_OSMO), true);
    assert.equal(opensInOneSignature(osmoOnHub, table, null), true);
  });

  test("To: OSMO on Osmosis, ATOM when selling OSMO, never disabled or the From", () => {
    const buy = [OSMO, USDC, ATOM_ON_OSMO];
    assert.equal(defaultToKey(USDC, buy), OSMO.key);
    assert.equal(defaultToKey(OSMO, buy), ATOM_ON_OSMO.key);
    assert.equal(defaultToKey(OSMO, [OSMO, { ...ATOM_ON_OSMO, disabledReason: "x" }, USDC]), USDC.key);
    assert.equal(defaultToKey(undefined, buy), null);
    assert.equal(defaultToKey(OSMO, [OSMO]), null);
  });
});

describe("amounts", () => {
  const osmosis = { chainId: "osmosis-1", feeMinimalDenom: "uosmo", feeDecimals: 6, gasPriceStep: { low: 0.03, average: 0.1, high: 0.16 } };

  test("fee reserve only for the fee token, 1.5x a measured fee, else a fixed estimate", () => {
    assert.equal(feeReserve(USDC_N, osmosis, null), null);
    assert.deepEqual(feeReserve("uosmo", osmosis, { denom: "uosmo", amount: BigInt(41_001) }), { units: BigInt(61_502), measured: true });
    assert.deepEqual(feeReserve("uosmo", osmosis, null), { units: BigInt(100_000), measured: false });
    assert.deepEqual(feeReserve("uosmo", osmosis, { denom: "uatom", amount: BigInt(5) }), { units: BigInt(100_000), measured: false });
    assert.equal(feeReserve("uosmo", { ...osmosis, gasPriceStep: undefined }, null), null);
    assert.equal(feeReserve("uosmo", undefined, null), null);
  });

  test("spendable never goes below zero", () => {
    assert.equal(spendableUnits(BigInt(1_000_000), { units: BigInt(100_000), measured: false }), BigInt(900_000));
    assert.equal(spendableUnits(BigInt(50_000), { units: BigInt(100_000), measured: false }), BigInt(0));
    assert.equal(spendableUnits(BigInt(7), null), BigInt(7));
  });

  test("share text is exact and cut", () => {
    assert.equal(shareText(BigInt(8_261_739), 50, 6), "4.130869");
    assert.equal(shareText(BigInt(8_261_739), 100, 6), "8.261739");
    assert.equal(shareText(BigInt(3), 25, 6), "");
    assert.equal(shareText(BigInt(1_000), 25, null), "250");
  });

  test("fraction digits by magnitude", () => {
    assert.equal(fractionDigits("2863715500", 6), 2);
    assert.equal(fractionDigits("19400", 6), 6);
    assert.equal(fractionDigits("54456500", 6), 4);
    assert.equal(fractionDigits("1", null), 6);
  });

  test("indicative amount: two significant digits of about 100 worth, one token unpriced", () => {
    assert.equal(indicativeUnits(6, 0.0356), BigInt(2_800_000_000));
    assert.equal(indicativeUnits(6, 1.78), BigInt(56_000_000));
    assert.equal(indicativeUnits(8, 62_000), BigInt(160_000));
    assert.equal(indicativeUnits(6, null), BigInt(1_000_000));
    assert.equal(indicativeUnits(null, 1), null);
    assert.equal(indicativeUnits(0, 1e9), BigInt(1));
  });

  test("indicative amount: the whole balance when it is worth less than the usual one", () => {
    // 2.46 TIA at 0.362: worth 0.89, so the balance itself.
    assert.deepEqual(indicativeAmount(6, 0.362, BigInt(2_460_000)), { units: BigInt(2_460_000), ofBalance: true });
    // Enough for the usual amount: the usual amount.
    assert.deepEqual(indicativeAmount(6, 0.0356, BigInt(5_000_000_000)), { units: BigInt(2_800_000_000), ofBalance: false });
    // Dust, an unpriced token, no balance: the usual amount.
    assert.deepEqual(indicativeAmount(6, 0.0356, BigInt(100)), { units: BigInt(2_800_000_000), ofBalance: false });
    assert.deepEqual(indicativeAmount(6, null, BigInt(500_000)), { units: BigInt(1_000_000), ofBalance: false });
    assert.deepEqual(indicativeAmount(6, 1, BigInt(0)), { units: BigInt(100_000_000), ofBalance: false });
    assert.equal(indicativeAmount(null, 1, BigInt(5)), null);
  });

  test("a quote's own fee from what it sold", () => {
    // Osmosis has a treasury: 0.5% of what is spent.
    for (const spent of [BigInt(2_900_000_000), BigInt(500_000), BigInt(50_000_000), BigInt(199), BigInt(200), BigInt(201), BigInt(12_345_678_901)]) {
      const fee = swapFeeFor("osmosis-1", spent);
      const back = feeForNet("osmosis-1", fee.net.toString());
      assert.ok(back, `inverse of ${spent}`);
      assert.equal(back.net, fee.net);
      const gap = back.net + back.fee - spent;
      assert.ok(gap >= BigInt(-1) && gap <= BigInt(1), `spent ${spent} read back as ${back.net + back.fee}`);
    }
    // Every amount from 1 to 20,000 units reads back to a fee that sells exactly it.
    for (let spent = 1; spent <= 20_000; spent += 1) {
      const fee = swapFeeFor("osmosis-1", BigInt(spent));
      assert.equal(feeForNet("osmosis-1", fee.net.toString())?.net, fee.net, `spent ${spent}`);
    }
    // A chain with no treasury takes no fee: what was sold is what was spent.
    assert.deepEqual(feeForNet("example-1", "1000"), swapFeeFor("example-1", BigInt(1000)));
    assert.equal(swapFeeFor("example-1", BigInt(1000)).fee, BigInt(0));
    assert.equal(feeForNet("osmosis-1", "0"), null);
    assert.equal(feeForNet("osmosis-1", "1.5"), null);
  });
});

describe("the form's button", () => {
  const base: CtaInput = {
    holdingsLoading: false,
    sellCount: 3,
    from: OSMO,
    to: ATOM_ON_OSMO,
    amountText: "10",
    amountUnits: BigInt(10_000_000),
    slippageValid: true,
    requestReady: true,
    quote: { loading: false, stale: false, refreshing: false, error: null, blocked: null, current: { path: "pool", expiresAt: 2_000 } },
    feeShort: false,
    now: 1_000,
  };

  test("first problem first", () => {
    assert.equal(formCta({ ...base, from: undefined, holdingsLoading: true }).label, "Loading your balances…");
    assert.equal(formCta({ ...base, from: undefined, sellCount: 0 }).label, "Nothing to swap here");
    assert.equal(formCta({ ...base, to: undefined }).label, "Choose a token to receive");
    assert.deepEqual(formCta({ ...base, to: { disabledReason: "Same token." } }), {
      label: "Pair unavailable",
      reason: "Same token.",
      action: null,
      busy: false,
    });
    assert.equal(formCta({ ...base, from: SAF }).label, "Not traded on Osmosis");
    assert.equal(formCta({ ...base, from: SAF, to: undefined }).label, "Not traded on Osmosis");
    assert.equal(formCta({ ...base, amountText: " " }).label, "Enter an amount");
    assert.equal(formCta({ ...base, amountUnits: null }).label, "Enter a valid amount");
    assert.equal(formCta({ ...base, amountUnits: BigInt(200_000_000) }).label, "Insufficient OSMO balance");
    assert.equal(formCta({ ...base, slippageValid: false }).label, "Check the slippage tolerance");
    assert.equal(formCta({ ...base, requestReady: false }).label, "Amount too small");
  });

  test("price states", () => {
    const q = base.quote;
    assert.deepEqual(formCta({ ...base, quote: { ...q, current: null, blocked: { code: "not-traded", message: "SAF is not traded." } } }), {
      label: "Not traded on Osmosis",
      reason: "SAF is not traded.",
      action: null,
      busy: false,
    });
    assert.equal(formCta({ ...base, quote: { ...q, current: null, error: { message: "Router down" } } }).action, "retry");
    assert.equal(formCta({ ...base, quote: { ...q, current: null, loading: true } }).label, "Getting the best price…");
    assert.equal(formCta({ ...base, quote: { ...q, current: null, stale: true, refreshing: true } }).label, "Updating the price…");
    assert.equal(formCta({ ...base, quote: { ...q, refreshing: true } }).busy, true);
    assert.equal(formCta({ ...base, now: 2_000 }).label, "Price expired");
    const short = formCta({ ...base, feeShort: true });
    assert.equal(short.label, "Need fee room");
    // The form has no gas-speed control: the reason points at Max instead.
    assert.match(short.reason ?? "", /Max keeps room/);
    assert.doesNotMatch(short.reason ?? "", /gas speed/);
    assert.deepEqual(formCta(base), { label: "Review swap", reason: null, action: "review", busy: false });
    const move = formCta({ ...base, quote: { ...q, current: { path: "move-first", expiresAt: 2_000 } } });
    assert.equal(move.action, "move-first");
    assert.equal(move.label, "Step 1: move OSMO to Osmosis");
  });

  test("every blocked code has a label", () => {
    for (const code of ["testnet", "same-token", "no-pool-route", "delivery-unavailable", "inbound-unavailable", "route-unpriced"] as const) {
      assert.ok(blockedLabel(code).length > 0);
    }
  });
});

describe("reading a quote", () => {
  test("impact words follow the shared thresholds", () => {
    assert.deepEqual(impactView(0.2), { level: "normal", label: "Low", tone: "success" });
    assert.equal(impactView(-0.1).label, "In your favour");
    assert.equal(impactView(1.5).tone, "warning");
    assert.equal(impactView(7).label, "High");
    assert.equal(impactView(null).tone, "neutral");
  });

  test("market rate and comparisons", () => {
    assert.equal(marketRate(0.0356, 1.78), 0.0356 / 1.78);
    assert.equal(marketRate(null, 1), null);
    assert.equal(marketRate(1, 0), null);
    assert.ok(Math.abs((versus(0.99, 1) ?? 0) + 1) < 1e-9);
    assert.equal(versus(1, null), null);
  });

  test("all-in cost against market prices", () => {
    const cost = allInCost({ spentUnits: "10000000", fromDecimals: 6, fromPrice: 2, receivedUnits: "19500000", toDecimals: 6, toPrice: 1 });
    assert.ok(cost);
    assert.equal(cost.payValue, 20);
    assert.equal(cost.receiveValue, 19.5);
    assert.ok(Math.abs(cost.percent + 2.5) < 1e-9);
    assert.equal(allInCost({ spentUnits: "1", fromDecimals: null, fromPrice: 2, receivedUnits: "1", toDecimals: 6, toPrice: 1 }), null);
    assert.equal(allInCost({ spentUnits: "1", fromDecimals: 6, fromPrice: null, receivedUnits: "1", toDecimals: 6, toPrice: 1 }), null);
  });

  test("cost breakdown: each cost as a share of what is paid, and the market gap", () => {
    // 5 USDC paid at $1: 0.025 fee, 4.975 swapped; router: taker 0.1%, spread 0.18%, impact 0.19%.
    const cost = costBreakdown({
      spentUnits: "5000000",
      netUnits: "4975000",
      feeUnits: "25000",
      fromDecimals: 6,
      fromPrice: 1,
      takerPercent: 0.1,
      spreadPercent: 0.18,
      impactPercent: 0.19,
      networkValue: 0.0025,
      allInPercent: -0.61,
    });
    assert.ok(cost);
    const line = (id: string) => cost.lines.find((entry) => entry.id === id);
    assert.equal(line("zunia")?.percent, 0.5);
    assert.ok(Math.abs((line("zunia")?.value ?? 0) - 0.025) < 1e-12);
    // Router figures are of the amount swapped (99.5% of what is paid).
    assert.ok(Math.abs((line("taker")?.percent ?? 0) - 0.0995) < 1e-9);
    assert.ok(Math.abs((line("impact")?.value ?? 0) - 0.0094525) < 1e-9);
    assert.ok(Math.abs((line("network")?.percent ?? 0) - 0.05) < 1e-9);
    assert.ok(Math.abs(cost.totalPercent - (0.5 + 0.0995 + 0.1791 + 0.18905 + 0.05)) < 1e-9);
    assert.ok(Math.abs((cost.totalValue ?? 0) - 5 * (cost.totalPercent / 100)) < 1e-9);
    assert.deepEqual(cost.missing, []);
    // −0.61% all-in against 0.96765% of swap costs: the pools paid 0.35765% above the market source.
    assert.ok(Math.abs((cost.marketGap ?? 0) - 0.35765) < 1e-9);
  });

  test("cost breakdown without a price, an unmeasured network fee or a router figure", () => {
    const unpriced = costBreakdown({
      spentUnits: "1000",
      netUnits: "995",
      feeUnits: "5",
      fromDecimals: null,
      fromPrice: null,
      takerPercent: 0.1,
      spreadPercent: null,
      impactPercent: -0.05,
      networkValue: 0.01,
      allInPercent: null,
    });
    assert.ok(unpriced);
    assert.equal(unpriced.totalValue, null);
    assert.equal(unpriced.lines.find((line) => line.id === "zunia")?.value, null);
    // Valued in the fee token, so known, but not as a share of an unpriced amount.
    assert.equal(unpriced.lines.find((line) => line.id === "network")?.value, 0.01);
    assert.deepEqual(unpriced.missing, ["spread", "network"]);
    // A favourable impact lowers the total.
    assert.ok(Math.abs(unpriced.totalPercent - (0.5 + 0.0995 - 0.04975)) < 1e-9);
    assert.equal(unpriced.marketGap, null);
    // An unknown swap cost means no gap: it would absorb the unknown cost.
    const noSpread = costBreakdown({
      spentUnits: "5000000",
      netUnits: "4975000",
      feeUnits: "25000",
      fromDecimals: 6,
      fromPrice: 1,
      takerPercent: 0.1,
      spreadPercent: null,
      impactPercent: 0.1,
      networkValue: null,
      allInPercent: -0.5,
    });
    assert.equal(noSpread?.marketGap, null);
    assert.deepEqual(noSpread?.missing, ["spread", "network"]);
    assert.equal(costBreakdown({ spentUnits: "0", netUnits: "0", feeUnits: "0", fromDecimals: 6, fromPrice: 1, takerPercent: null, spreadPercent: null, impactPercent: null, networkValue: null, allInPercent: null }), null);
  });

  test("what the wallet can swap, by standing and place", () => {
    const listed = listedVenueDenoms([
      { osmosisDenom: "uosmo", tradable: true },
      { osmosisDenom: USDC_N, tradable: true },
      { osmosisDenom: ATOM_OSMO, tradable: true },
    ]);
    const unlisted = option("osmosis-1", "ibc/OFF", "OFF", "ibc/OFF");
    const value = new Map<string, number>([
      [USDC.key, 14.5],
      [OSMO.key, 0.3],
      [ATOM_HUB.key, 17],
      [SAF.key, 0.01],
    ]);
    const summary = swappableSummary([USDC, OSMO, ATOM_HUB, SAF, unlisted], listed, (o) => value.get(o.key) ?? null);
    assert.deepEqual(summary.tradable, { count: 3, value: 31.8, unpriced: 0 });
    assert.deepEqual(summary.onVenue, { count: 2, value: 14.8, unpriced: 0 });
    assert.deepEqual(summary.elsewhere, { count: 1, value: 17, unpriced: 0, chains: 1 });
    // Outside the list: not on Osmosis at all, or unlisted (still quotable), counted apart; the most valuable named first.
    assert.deepEqual(summary.notListed, { count: 2, value: 0.01, unpriced: 1, tickers: ["SAF", "OFF"], notTraded: 1, unlisted: 1 });
    const none = swappableSummary([], listed, () => null);
    assert.equal(none.tradable.value, null);
    assert.equal(none.notListed.count, 0);
  });

  test("a past swap's rate, from what moved", () => {
    const amounts: ActivityAmount[] = [
      { direction: "out", denom: USDC_N, amount: "5000000", identity: USDC.identity },
      { direction: "in", denom: "uosmo", amount: "144300000", identity: OSMO.identity },
    ];
    const rate = executedRate({ kind: "swap", success: true, amounts });
    assert.ok(rate);
    assert.equal(rate.fromTicker, "USDC.n");
    assert.equal(rate.toKey, "osmosis-1:uosmo");
    assert.ok(Math.abs(rate.rate - 28.86) < 1e-9);
    assert.equal(executedRate({ kind: "swap", success: false, amounts }), null);
    assert.equal(executedRate({ kind: "send", success: true, amounts }), null);
    assert.equal(executedRate({ kind: "swap", success: true, amounts: [amounts[0]!] }), null);
    assert.equal(executedRate({ kind: "swap", success: true, amounts: [amounts[0]!, { ...amounts[1]!, identity: { ...OSMO.identity, decimals: null } }] }), null);
  });

  test("split shares, spread and the receive view", () => {
    const route = {
      pools: [{ id: "1464", tokenOutDenom: "uosmo", spread: 0.01, takerFee: 0.1 }],
      splits: [
        { inAmount: "6965000", outAmount: "196270174", pools: [{ id: "1464", tokenOutDenom: "uosmo", spread: 0.01 }] },
        {
          inAmount: "2985000",
          outAmount: "84027072",
          pools: [
            { id: "3497", tokenOutDenom: "ibc/D189", spread: 0 },
            { id: "678", tokenOutDenom: "uosmo", spread: 0.2 },
          ],
        },
      ],
    };
    const views = splitViews(route, "9950000", "280297246");
    assert.deepEqual(
      views.map((view) => view.share),
      [70, 30],
    );
    assert.ok(Math.abs((routeSpread(route, "9950000", "280297246") ?? 0) - (0.01 * 0.7 + 0.2 * 0.3)) < 1e-9);
    assert.equal(routeSpread({ pools: [{ id: "1", tokenOutDenom: "uosmo" }] }, "1", "1"), null);
    assert.deepEqual(splitViews({ pools: [{ id: "1", tokenOutDenom: "uosmo", spread: 0.2 }] }, "5", "7")[0]?.share, 100);
    assert.deepEqual(receiveView({ path: "pool-deliver", amountOut: "348136", minOut: "344654" }), {
      amount: "344654",
      exact: true,
      kept: "3482",
    });
    assert.deepEqual(receiveView({ path: "contract", amountOut: "98213", minOut: "97230" }), { amount: "98213", exact: false, kept: null });
  });

  test("a quote matches the pair by its Osmosis denoms and delivery chain", () => {
    const delivery = { destChainId: "cosmoshub-4", channelId: "channel-0", port: "transfer", arrivalDenom: "uatom", kind: "unwind" as const, clientStatus: "active" as const };
    assert.equal(quoteMatchesPair({ venueInputDenom: "uosmo", venueOutputDenom: ATOM_OSMO.toLowerCase() }, OSMO, ATOM_ON_OSMO), true);
    assert.equal(quoteMatchesPair({ venueInputDenom: "uosmo", venueOutputDenom: USDC_N }, OSMO, ATOM_ON_OSMO), false);
    assert.equal(quoteMatchesPair({ venueInputDenom: "uosmo", venueOutputDenom: ATOM_OSMO, delivery }, OSMO, ATOM_HUB), true);
    assert.equal(quoteMatchesPair({ venueInputDenom: "uosmo", venueOutputDenom: ATOM_OSMO, delivery }, OSMO, ATOM_ON_OSMO), false);
    assert.equal(quoteMatchesPair({ venueInputDenom: "uosmo", venueOutputDenom: ATOM_OSMO }, OSMO, ATOM_HUB), false);
    assert.equal(quoteMatchesPair({ venueInputDenom: "uosmo", venueOutputDenom: "x" }, SAF, OSMO), false);
  });

  test("path copy names the chains and what happens on failure", () => {
    const hub = { ticker: "ATOM", chainName: "Cosmos Hub", chainId: "cosmoshub-4" };
    const osmo = { ticker: "OSMO", chainName: "Osmosis", chainId: "osmosis-1" };
    assert.match(pathCopy({ path: "pool", from: osmo, to: osmo }).body, /no fee is taken/);
    assert.match(pathCopy({ path: "contract", from: hub, to: osmo, inbound: { channelId: "channel-141" } }).body, /channel-141/);
    assert.match(pathCopy({ path: "pool-deliver", from: osmo, to: hub, minimumText: "1 ATOM" }).body, /stays in your Osmosis balance/);
    assert.match(pathCopy({ path: "move-first", from: hub, to: osmo }).title, /Two steps/);
  });
});

describe("the implied rate", () => {
  const hour = 3_600_000;
  test("pairs nearest samples within tolerance, never interpolates", () => {
    const from = [
      { t: 0, v: 2 },
      { t: hour, v: 4 },
      { t: 2 * hour, v: 3 },
      { t: 3 * hour, v: 0 },
    ];
    const to = [
      { t: 10 * 60_000, v: 1 },
      { t: hour + 5 * 60_000, v: 2 },
      { t: 5 * hour, v: 3 },
    ];
    assert.deepEqual(ratioSeries(from, to, sampleTolerance("hour")), [
      { t: 0, v: 2 },
      { t: hour, v: 2 },
    ]);
    assert.deepEqual(ratioSeries(from, [], hour), []);
  });

  test("compact rates and ages", () => {
    assert.equal(compactRatio(0.0196761), "0.01968");
    assert.equal(compactRatio(50.6485), "50.65");
    assert.equal(compactRatio(2800.53), "2,801");
    assert.equal(compactRatio(0), null);
    assert.equal(ageText(null, 0), null);
    assert.equal(ageText(10_000, 12_000), "just now");
    assert.equal(ageText(10_000, 40_000), "30s ago");
    assert.equal(ageText(0, 5 * 60_000), "5 min ago");
    assert.equal(ageText(0, 3 * 3_600_000), "3 h ago");
    assert.equal(ageText(20_000, 10_000), "just now");
  });

  test("change and range", () => {
    assert.ok(Math.abs((seriesChange([{ t: 0, v: 2 }, { t: 1, v: 2.5 }]) ?? 0) - 25) < 1e-9);
    assert.equal(seriesChange([{ t: 0, v: 2 }]), null);
    assert.deepEqual(seriesRange([{ t: 0, v: 2 }, { t: 1, v: 5 }, { t: 2, v: 1 }]), { low: 1, high: 5 });
    assert.equal(seriesRange([]), null);
  });
});

describe("after signing", () => {
  test("steps follow the stage", () => {
    assert.deepEqual(
      signSteps("awaiting-signature", "Osmosis", null).map((s) => s.state),
      ["current", "todo", "todo"],
    );
    assert.deepEqual(
      signSteps("confirming", "Osmosis", null).map((s) => s.state),
      ["done", "done", "current"],
    );
    assert.deepEqual(
      signSteps("success", "Osmosis", null).map((s) => s.state),
      ["done", "done", "done"],
    );
    assert.match(signSteps("submitted", "Osmosis", null)[2]?.description ?? "", /Not in a block yet/);
    assert.deepEqual(
      signSteps("failed", "Osmosis", "sign").map((s) => s.state),
      ["error", "todo", "todo"],
    );
    assert.deepEqual(
      signSteps("failed", "Osmosis", "confirm").map((s) => s.state),
      ["done", "done", "error"],
    );
    assert.equal(failedAt("user-rejected", null), "sign");
    assert.equal(failedAt("unknown", null), "broadcast");
    assert.equal(failedAt("out-of-gas", "ABC"), "confirm");
    assert.equal(failedAt("unknown", null, "awaiting-signature"), "sign");
    assert.equal(failedAt("unknown", null, "preparing"), "sign");
    assert.equal(failedAt("unknown", null, "broadcasting"), "broadcast");
    assert.equal(failedAt("out-of-gas", "ABC", "confirming"), "confirm");
  });

  test("tracking plans per path", () => {
    const quote: Pick<SwapQuotePrice, "delivery" | "inbound"> = {
      delivery: { destChainId: "cosmoshub-4", channelId: "channel-0", port: "transfer", arrivalDenom: "uatom", kind: "unwind", clientStatus: "active" },
      inbound: {
        sourceChainId: "cosmoshub-4",
        channelId: "channel-141",
        port: "transfer",
        venueChannelId: "channel-0",
        kind: "wrap",
        clientStatus: "active",
      },
    };
    const osmo = { chainId: "osmosis-1", denom: "uosmo" };
    const atom = { chainId: "cosmoshub-4", denom: "uatom" };
    assert.equal(trackingPlan({ path: "pool", from: osmo, to: osmo, quote: {} }), null);
    const deliver = trackingPlan({ path: "pool-deliver", from: osmo, to: atom, quote });
    assert.equal(deliver?.sourceChainId, "osmosis-1");
    assert.deepEqual(deliver?.hops.map((h) => [h.chainId, h.channelId, h.kind]), [["osmosis-1", "channel-0", "transfer"]]);
    const fromOsmosis = trackingPlan({ path: "contract", from: osmo, to: atom, quote });
    assert.deepEqual(fromOsmosis?.hops.map((h) => [h.channelId, h.kind]), [["", "swap"], ["channel-0", "forward"]]);
    const fromHub = trackingPlan({ path: "contract", from: atom, to: osmo, quote: { inbound: quote.inbound } });
    assert.equal(fromHub?.sourceChainId, "cosmoshub-4");
    assert.deepEqual(fromHub?.hops.map((h) => [h.chainId, h.channelId, h.kind]), [
      ["cosmoshub-4", "channel-141", "transfer"],
      ["osmosis-1", "", "swap"],
    ]);
    assert.equal(fromHub?.requiresIbcHooks, true);
    assert.equal(trackingPlan({ path: "contract", from: atom, to: osmo, quote: {} }), null);
  });
});
