/**
 * The insight rules: each fires on its measured condition and only then,
 * says the numbers it measured, respects privacy mode, and the assembled
 * list comes out in the same order every time. Fixtures follow live answers
 * read on 2026-10-07 (Celestia, Cosmos Hub, Safrochain, Osmosis).
 */

import assert from "node:assert/strict";
import { test } from "node:test";

import type {
  ChainStats,
  ChainStatsResponse,
  ProposalRow,
  ProposalsResponse,
  SecurityReviewResponse,
  StakingChain,
  StakingDelegation,
  ValidatorLite,
} from "@/lib/chain/types";
import type { TokenIdentity } from "@/lib/token/types";
import type { PortfolioAsset, PortfolioChain, PortfolioResponse } from "@/lib/token/wire";
import type { FeeChain } from "@/lib/tx/fees";

import {
  CHAIN_NOTICES,
  chainRiskInsights,
  claimMessages,
  concentrationInsights,
  deriveInsights,
  estimateFee,
  herfindahl,
  idleStakeInsights,
  insightContext,
  insightGroup,
  moneyText,
  restakeThreshold,
  rewardInsights,
  securityInsights,
  tokenText,
  unbondingInsights,
  unpricedInsights,
  validatorRiskInsights,
  voteInsights,
  type InsightInputs,
} from "../rules";

const NOW = Date.parse("2026-10-07T12:00:00Z");
const HOUR = 3_600_000;
const DAY = 24 * HOUR;

/* ------------------------------------------------------------------ fixtures */

const FEE_CHAINS: Record<string, FeeChain> = {
  celestia: { chainId: "celestia", chainName: "Celestia", feeMinimalDenom: "utia", feeDenom: "TIA", feeDecimals: 6, gasPriceStep: { low: 0.01, average: 0.02, high: 0.1 } },
  "cosmoshub-4": { chainId: "cosmoshub-4", chainName: "Cosmos Hub", feeMinimalDenom: "uatom", feeDenom: "ATOM", feeDecimals: 6, gasPriceStep: { low: 0.005, average: 0.025, high: 0.03 } },
  "safrochain-1": { chainId: "safrochain-1", chainName: "Safrochain", feeMinimalDenom: "usaf", feeDenom: "SAF", feeDecimals: 6, gasPriceStep: { low: 0.05, average: 0.075, high: 0.1 } },
  "osmosis-1": { chainId: "osmosis-1", chainName: "Osmosis", feeMinimalDenom: "uosmo", feeDenom: "OSMO", feeDecimals: 6, gasPriceStep: { low: 0.03, average: 0.1, high: 0.16 } },
};

function validator(overrides: Partial<ValidatorLite> = {}): ValidatorLite {
  return {
    operatorAddress: "celestiavaloper1qubelabs",
    moniker: "Qubelabs",
    status: "bonded",
    jailed: false,
    tombstoned: false,
    commissionRate: 0.05,
    commissionMaxRate: 0.05,
    commissionReachable30d: 0.05,
    uptime: 1,
    rank: 5,
    votingPower: 0.04,
    inNakamotoSet: false,
    apr: 0.05,
    ...overrides,
  };
}

function delegation(amount: string, rewards: string, denom: string, v: Partial<ValidatorLite> = {}): StakingDelegation {
  return { validator: validator(v), amount, rewards: rewards === "0" ? [] : [{ denom, amount: rewards }] };
}

function stakingChain(overrides: Partial<StakingChain> & Pick<StakingChain, "chainId" | "denom" | "symbol">): StakingChain {
  return {
    address: `${overrides.chainId}-address`,
    decimals: 6,
    delegations: [],
    unbonding: [],
    redelegations: [],
    withdrawAddress: null,
    totals: { staked: "0", rewards: "0", unbonding: "0" },
    rewardsOther: [],
    nextUnbonding: null,
    apr: { chain: null, weighted: null },
    status: "ok",
    ...overrides,
  };
}

function identity(chainId: string, denom: string, ticker: string, extra: Partial<TokenIdentity> = {}): TokenIdentity {
  return {
    key: `${chainId}:${denom}`,
    chainId,
    denom,
    kind: "native",
    ticker,
    name: ticker,
    decimals: 6,
    provenance: "native",
    proven: true,
    originChainId: chainId,
    originDenom: denom,
    ...extra,
  };
}

function asset(
  chainId: string,
  denom: string,
  ticker: string,
  amounts: Partial<PortfolioAsset["amounts"]>,
  price: number | null,
  extra: Partial<TokenIdentity> = {},
): PortfolioAsset {
  const full = { liquid: "0", staked: "0", rewards: "0", unbonding: "0", ...amounts };
  const total = Object.values(full).reduce((sum, v) => sum + Number(v), 0) / 1e6;
  return {
    identity: identity(chainId, denom, ticker, extra),
    chainId,
    amounts: full,
    total,
    price: price === null ? null : { price, change24h: 1, source: "numia", at: NOW },
    value: price === null ? null : total * price,
    change24hAbs: null,
    ...(price === null ? { unpriced: "no-market" as const } : {}),
  };
}

function portfolioChain(chainId: string, chainName: string, value: number | null, assetCount = 1): PortfolioChain {
  return {
    chainId,
    chainName,
    iconUrl: null,
    address: `${chainId}-address`,
    status: "ok",
    value,
    liquid: value,
    staked: 0,
    rewards: 0,
    unbonding: 0,
    change24hAbs: null,
    assetCount,
    nativeSymbol: chainName.slice(0, 3).toUpperCase(),
  };
}

function portfolio(assets: PortfolioAsset[], chains: PortfolioChain[]): PortfolioResponse {
  const priced = assets.filter((a) => a.value !== null);
  const pricedValue = priced.reduce((sum, a) => sum + (a.value as number), 0);
  return {
    currency: "usd",
    updatedAt: NOW,
    totals: {
      value: pricedValue,
      liquid: pricedValue,
      staked: 0,
      rewards: 0,
      unbonding: 0,
      change24hAbs: null,
      change24hPct: null,
      change7dAbs: null,
      change7dPct: null,
      pricedValue,
      unpricedAssetCount: assets.length - priced.length,
      assetCount: assets.length,
      chainCount: chains.length,
    },
    chains,
    assets,
  };
}

function stats(chainId: string, chainName: string, overrides: Partial<ChainStats> = {}): ChainStats {
  return {
    chainId,
    chainName,
    network: "mainnet",
    iconUrl: null,
    nativeSymbol: "TIA",
    nativeDenom: "utia",
    nativeDecimals: 6,
    price: null,
    apr: { naive: 0.055, actual: 0.055, source: "lcd", blockTimeFactor: 1, excludesFees: true },
    inflation: { param: 0.0232, actual: 0.0228 },
    realYield: 0.0322,
    bondedRatio: 0.405,
    goalBonded: null,
    bondedTokens: "1000000000000000",
    notBondedTokens: null,
    totalSupply: null,
    communityTax: 0.02,
    unbondingDays: 14,
    maxValidators: 100,
    minCommission: 0.05,
    activeValidators: 95,
    nakamoto: 6,
    top10Share: 0.4,
    medianCommission: 0.05,
    blockTimeSec: 6,
    paramsBlockTimeSec: 6,
    blockTimeWindow: 100,
    latestHeight: 100,
    latestBlockTime: new Date(NOW - 5_000).toISOString(),
    halted: false,
    slashing: null,
    gov: null,
    ...overrides,
  };
}

function statsResponse(chains: ChainStats[]): ChainStatsResponse {
  return { updatedAt: NOW, currency: "usd", chains };
}

function proposal(overrides: Partial<ProposalRow>): ProposalRow {
  return {
    chainId: "cosmoshub-4",
    id: "1058",
    api: "v1",
    title: "Move the recovered ATOM",
    summary: "",
    type: "Text",
    messageTypes: [],
    status: "voting",
    submitTime: null,
    depositEndTime: null,
    votingStartTime: null,
    votingEndTime: new Date(NOW + 30 * HOUR).toISOString(),
    totalDeposit: [],
    minDeposit: null,
    expedited: false,
    tally: null,
    tallyKind: "live",
    turnout: 0.1268,
    quorum: 0.334,
    threshold: 0.5,
    vetoThreshold: 0.334,
    passingIfEndedNow: false,
    myVote: null,
    myVoteStatus: "not-voted",
    myVotingPower: "277900000",
    inheritedVote: [{ validator: "cosmosvaloper1everstake", moniker: "Everstake", option: null, weight: 1 }],
    ...overrides,
  };
}

function proposals(rows: ProposalRow[]): ProposalsResponse {
  return { updatedAt: NOW, proposals: rows, chains: [] };
}

function inputs(overrides: Partial<InsightInputs> = {}): InsightInputs {
  return {
    now: NOW,
    currency: "usd",
    hideAmounts: false,
    portfolio: null,
    staking: null,
    chainStats: null,
    proposals: null,
    security: null,
    feeChains: FEE_CHAINS,
    ...overrides,
  };
}

const TIA_PRICE = 0.4860881640002772;

/** Celestia as read for the rich test wallet: 41,020 TIA staked, 2,005 TIA of rewards, 49,099 TIA liquid. */
const CELESTIA_STAKING = stakingChain({
  chainId: "celestia",
  denom: "utia",
  symbol: "TIA",
  delegations: [
    delegation("41020000000", "2005135050", "utia", {
      operatorAddress: "celestiavaloper1qubelabs",
      moniker: "Qubelabs",
      commissionRate: 0.2,
      commissionMaxRate: 1,
      commissionReachable30d: 0.6,
      inNakamotoSet: true,
    }),
  ],
  totals: { staked: "41020000000", rewards: "2005135050", unbonding: "0" },
  apr: { chain: 0.055105066592275126, weighted: 0.044084053273820104 },
});

const CELESTIA_ASSET = asset(
  "celestia",
  "utia",
  "TIA",
  { liquid: "49099918286", staked: "41020000000", rewards: "2005135050" },
  TIA_PRICE,
);

/* ------------------------------------------------------------------ helpers */

test("fee estimates use the catalog's average gas price and the fallback gas limits", () => {
  // One claim: 800k gas × 0.02 utia.
  assert.equal(estimateFee(FEE_CHAINS.celestia, claimMessages(1)), BigInt(16_000));
  // Claim + delegate in one tx: 900k + 800k/4 = 1.1M gas.
  assert.equal(
    estimateFee(FEE_CHAINS.celestia, [...claimMessages(1), { typeUrl: "/cosmos.staking.v1beta1.MsgDelegate" }]),
    BigInt(22_000),
  );
  // No gas price published: no fee is guessed.
  assert.equal(estimateFee({ chainId: "x", feeMinimalDenom: "ux", feeDecimals: 6 }, claimMessages(1)), null);
  assert.equal(estimateFee(undefined, claimMessages(1)), null);
});

test("restake threshold is √(2·F·P) and refuses nonsense", () => {
  const fee = 22_000;
  const stake = 41_020_000_000;
  assert.ok(Math.abs((restakeThreshold(fee, stake) as number) - Math.sqrt(2 * fee * stake)) < 1e-6);
  assert.equal(restakeThreshold(fee, 0), null);
  assert.equal(restakeThreshold(-1, stake), null);
  assert.equal(restakeThreshold(Number.NaN, stake), null);
});

test("herfindahl", () => {
  assert.equal(herfindahl([1]), 1);
  assert.equal(herfindahl([0.5, 0.5]), 0.5);
  assert.equal(herfindahl([]), null);
  assert.equal(herfindahl([0, Number.NaN]), null);
});

test("money text: a holding prints cents at most, compact from 10k, masked in privacy mode", () => {
  assert.equal(moneyText(974.6712, "usd", false), "$974.67");
  assert.equal(moneyText(0.286, "usd", false), "$0.29");
  // Dust is "<$0.01", never a price's eight decimals ("$0.00000185").
  assert.equal(moneyText(0.00000185, "usd", false), "<$0.01");
  assert.equal(moneyText(0.0205, "usd", false), "$0.02");
  assert.equal(moneyText(23_912, "usd", false), "$23.9k");
  assert.equal(moneyText(974.67, "usd", true), "••••");
});

test("token text picks precision by size and masks in privacy mode", () => {
  assert.equal(tokenText("2005135050", 6, "TIA", false), "2,005.13 TIA");
  assert.equal(tokenText("49099918286", 6, "TIA", false), "49.09k TIA");
  assert.equal(tokenText("48246", 6, "ATOM", false), "0.048246 ATOM");
  assert.equal(tokenText("12340", null, "X", false), "12,340 base units");
  assert.equal(tokenText("2005135050", 6, "TIA", true), "•••• TIA");
});

/* ------------------------------------------------------------------ rewards */

test("large rewards past the restake point are a compounding card", () => {
  const ctx = insightContext(
    inputs({
      staking: { updatedAt: NOW, chains: [CELESTIA_STAKING] },
      portfolio: portfolio([CELESTIA_ASSET], [portfolioChain("celestia", "Celestia", CELESTIA_ASSET.value)]),
    }),
  );
  const [card, ...rest] = rewardInsights(ctx);
  assert.equal(rest.length, 0);
  assert.equal(card?.kind, "compounding");
  assert.equal(card?.severity, "opportunity");
  assert.equal(card?.chainId, "celestia");
  assert.equal(card?.metric?.label, "Claimable");
  assert.equal(card?.metric?.value, "$974.67");
  assert.match(card?.body ?? "", /2,005\.13 TIA/);
  // √(2 × 22,000 × 41,020,000,000) utia ≈ 42.48 TIA.
  assert.match(card?.body ?? "", /about 42\.48 TIA/);
  assert.equal(card?.action?.href, "/staking?action=claim&chain=celestia");
});

test("rewards above 3× the fee but below the restake point are a claim card", () => {
  const hub = stakingChain({
    chainId: "cosmoshub-4",
    denom: "uatom",
    symbol: "ATOM",
    delegations: [delegation("277900000", "1000000", "uatom", { moniker: "Everstake", operatorAddress: "cosmosvaloper1everstake" })],
    totals: { staked: "277900000", rewards: "1000000", unbonding: "0" },
    apr: { chain: 0.1958, weighted: 0.1801 },
  });
  const atom = asset("cosmoshub-4", "uatom", "ATOM", { liquid: "9995770", staked: "277900000", rewards: "1000000" }, 1.78);
  const ctx = insightContext(
    inputs({
      staking: { updatedAt: NOW, chains: [hub] },
      portfolio: portfolio([atom], [portfolioChain("cosmoshub-4", "Cosmos Hub", atom.value)]),
    }),
  );
  const cards = rewardInsights(ctx);
  assert.equal(cards.length, 1);
  assert.equal(cards[0]?.kind, "claim");
  assert.equal(cards[0]?.title, "1 ATOM of rewards on Cosmos Hub");
  // 800k gas × 0.025 uatom = 0.02 ATOM.
  assert.match(cards[0]?.body ?? "", /about 0\.02 ATOM \(est\.\)/);
});

test("rewards are skipped when dust, under 3× the fee, or paid in another fee denom", () => {
  const saf = stakingChain({
    chainId: "safrochain-1",
    denom: "usaf",
    symbol: "SAF",
    delegations: [delegation("3108137268", "2926278", "usaf")],
    totals: { staked: "3108137268", rewards: "2926278", unbonding: "0" },
    apr: { chain: 0.185, weighted: 0.1675 },
  });
  const safAsset = asset("safrochain-1", "usaf", "SAF", { liquid: "4050583", staked: "3108137268" }, 0.000201990102);
  const tiny = stakingChain({
    chainId: "cosmoshub-4",
    denom: "uatom",
    symbol: "ATOM",
    delegations: [delegation("277900000", "48246", "uatom")],
    totals: { staked: "277900000", rewards: "48246", unbonding: "0" },
  });
  const otherFee = stakingChain({
    chainId: "celestia",
    denom: "utia",
    symbol: "TIA",
    delegations: [delegation("41020000000", "2005135050", "utia")],
    totals: { staked: "41020000000", rewards: "2005135050", unbonding: "0" },
  });
  const ctx = insightContext(
    inputs({
      staking: { updatedAt: NOW, chains: [saf, tiny, otherFee] },
      portfolio: portfolio([safAsset, CELESTIA_ASSET], [portfolioChain("safrochain-1", "Safrochain", safAsset.value)]),
      feeChains: { ...FEE_CHAINS, celestia: { ...FEE_CHAINS.celestia, feeMinimalDenom: "uusdc" } as FeeChain },
    }),
  );
  assert.deepEqual(rewardInsights(ctx), []);
});

test("privacy mode masks every amount of a rewards card but keeps rates", () => {
  const ctx = insightContext(
    inputs({
      hideAmounts: true,
      staking: { updatedAt: NOW, chains: [CELESTIA_STAKING] },
      portfolio: portfolio([CELESTIA_ASSET], [portfolioChain("celestia", "Celestia", CELESTIA_ASSET.value)]),
    }),
  );
  const [card] = rewardInsights(ctx);
  assert.ok(card);
  assert.equal(card.metric?.value, "••••");
  assert.doesNotMatch(`${card.title} ${card.body}`, /2,005|974|41\.02k|42\.48/);
  assert.match(card.body, /••••/);
});

/* ------------------------------------------------------------------ idle */

test("idle native balance: yearly yield at your validators' APR, after a 10-fee reserve", () => {
  const ctx = insightContext(
    inputs({
      staking: { updatedAt: NOW, chains: [CELESTIA_STAKING] },
      portfolio: portfolio([CELESTIA_ASSET], [portfolioChain("celestia", "Celestia", CELESTIA_ASSET.value)]),
      chainStats: statsResponse([stats("celestia", "Celestia", { apr: { naive: 0.0551, actual: 0.0551, source: "lcd", blockTimeFactor: 1, excludesFees: true } })]),
    }),
  );
  const [card] = idleStakeInsights(ctx);
  assert.ok(card);
  assert.equal(card.kind, "idle-stake");
  // Reserve: 10 × (900k gas × 0.02) = 180,000 utia; idle = 49,099,738,286 utia.
  assert.equal(card.title, "49.09k TIA idle on Celestia");
  assert.match(card.body, /4\.4% APR/);
  assert.match(card.body, /2\.3% a year/);
  // 49,099.738286 × 0.044084… × 0.48608… ≈ $1,052.
  assert.equal(card.metric?.value, "$1,052.15");
  assert.equal(card.action?.href, "/staking?action=delegate&chain=celestia");
});

test("idle balance needs a positive APR, a fee estimate and a meaningful value", () => {
  const base = {
    staking: { updatedAt: NOW, chains: [CELESTIA_STAKING] },
    portfolio: portfolio([CELESTIA_ASSET], [portfolioChain("celestia", "Celestia", CELESTIA_ASSET.value)]),
  };
  const zeroApr = statsResponse([stats("celestia", "Celestia", { apr: { naive: 0, actual: 0, source: "lcd", blockTimeFactor: 1, excludesFees: true } })]);
  assert.deepEqual(idleStakeInsights(insightContext(inputs({ ...base, chainStats: zeroApr }))), []);
  // No stats at all: APR unknown, nothing claimed.
  assert.deepEqual(idleStakeInsights(insightContext(inputs(base))), []);
  // No gas price: the reserve cannot be computed.
  const noGas = { celestia: { chainId: "celestia", feeMinimalDenom: "utia", feeDecimals: 6 } as FeeChain };
  assert.deepEqual(
    idleStakeInsights(insightContext(inputs({ ...base, chainStats: statsResponse([stats("celestia", "Celestia")]), feeChains: noGas }))),
    [],
  );
  // $5 idle: below the floor.
  const small = asset("celestia", "utia", "TIA", { liquid: "10000000" }, TIA_PRICE);
  assert.deepEqual(
    idleStakeInsights(
      insightContext(
        inputs({
          staking: base.staking,
          portfolio: portfolio([small], [portfolioChain("celestia", "Celestia", small.value)]),
          chainStats: statsResponse([stats("celestia", "Celestia")]),
        }),
      ),
    ),
    [],
  );
});

/* ------------------------------------------------------------------ votes */

test("votes: warning under 48 h, info later, nothing when voted, powerless or ended", () => {
  const rows = [
    proposal({ id: "1", votingEndTime: new Date(NOW + 30 * HOUR).toISOString() }),
    proposal({ id: "2", votingEndTime: new Date(NOW + 5 * DAY).toISOString() }),
    proposal({ id: "3", myVoteStatus: "voted", myVote: { option: "yes" } }),
    proposal({ id: "4", myVotingPower: "0" }),
    proposal({ id: "5", votingEndTime: new Date(NOW - HOUR).toISOString() }),
    proposal({ id: "6", status: "deposit" }),
  ];
  const cards = voteInsights(insightContext(inputs({ proposals: proposals(rows), chainNames: { "cosmoshub-4": "Cosmos Hub" } })));
  assert.deepEqual(
    cards.map((c) => [c.id, c.severity]),
    [
      ["vote:cosmoshub-4:1", "warning"],
      ["vote:cosmoshub-4:2", "info"],
    ],
  );
  assert.equal(cards[0]?.title, "Cosmos Hub #1 closes in 30 h");
  assert.match(cards[0]?.body ?? "", /Everstake hasn't voted either/);
  assert.match(cards[0]?.body ?? "", /Turnout 12\.7% of a 33\.4% quorum, failing as of now/);
  assert.equal(cards[0]?.metric?.value, "1 d 6 h");
  // The proposal page's own URL, chain in the path (no redirect).
  assert.equal(cards[0]?.action?.href, "/governance/cosmoshub-4/1");
});

test("votes: inherited votes are reported with the share of stake they cover", () => {
  const row = proposal({
    inheritedVote: [
      { validator: "v1", moniker: "Alpha", option: "yes", weight: 0.6 },
      { validator: "v2", moniker: "Beta", option: null, weight: 0.4 },
    ],
  });
  const [card] = voteInsights(insightContext(inputs({ proposals: proposals([row]) })));
  assert.match(card?.body ?? "", /Alpha voted Yes for 60% of your stake; Beta hasn't voted\./);
});

/* ------------------------------------------------------------------ unbonding */

test("unbonding within 7 days, one card per chain", () => {
  const hub = stakingChain({
    chainId: "cosmoshub-4",
    denom: "uatom",
    symbol: "ATOM",
    unbonding: [
      {
        validator: validator({ moniker: "Everstake" }),
        entries: [
          { balance: "5000000", initialBalance: "5000000", completionTime: new Date(NOW + 3 * DAY).toISOString(), creationHeight: 1 },
          { balance: "9000000", initialBalance: "9000000", completionTime: new Date(NOW + 10 * DAY).toISOString(), creationHeight: 2 },
        ],
      },
    ],
  });
  const atom = asset("cosmoshub-4", "uatom", "ATOM", { unbonding: "14000000" }, 1.78);
  const [card, ...rest] = unbondingInsights(
    insightContext(
      inputs({
        staking: { updatedAt: NOW, chains: [hub] },
        portfolio: portfolio([atom], [portfolioChain("cosmoshub-4", "Cosmos Hub", atom.value)]),
      }),
    ),
  );
  assert.equal(rest.length, 0);
  assert.equal(card?.title, "5 ATOM unlocks on Cosmos Hub in 3 d");
  assert.equal(card?.metric?.value, "$8.90");
  assert.equal(card?.severity, "info");
});

/* ------------------------------------------------------------------ validators */

test("validator risk: the most severe reason leads, every reason is listed", () => {
  const chain = stakingChain({
    chainId: "celestia",
    denom: "utia",
    symbol: "TIA",
    delegations: [
      delegation("41020000000", "0", "utia", {
        operatorAddress: "celestiavaloper1qubelabs",
        moniker: "Qubelabs",
        commissionRate: 0.2,
        commissionReachable30d: 0.6,
        inNakamotoSet: true,
      }),
      delegation("1000000", "0", "utia", { operatorAddress: "celestiavaloper1jailed", moniker: "Down", jailed: true }),
      delegation("1000000", "0", "utia", {
        operatorAddress: "celestiavaloper1rise",
        moniker: "Riser",
        commissionRate: 0.08,
        commissionReachable30d: 0.2,
      }),
      delegation("1000000", "0", "utia", { operatorAddress: "celestiavaloper1fine", moniker: "Fine" }),
    ],
  });
  const cards = validatorRiskInsights(
    insightContext(inputs({ staking: { updatedAt: NOW, chains: [chain] }, chainStats: statsResponse([stats("celestia", "Celestia")]) })),
  );
  const byName = new Map(cards.map((c) => [c.title.split(" ")[0], c]));
  assert.equal(cards.length, 3);
  assert.equal(byName.get("Qubelabs")?.severity, "warning");
  assert.equal(byName.get("Qubelabs")?.title, "Qubelabs charges 20% commission");
  assert.match(
    byName.get("Qubelabs")?.body ?? "",
    /charges 20% commission \(median on this chain 5%\) and can raise it to 60% within 30 days and is one of the 6 validators/,
  );
  assert.equal(byName.get("Down")?.severity, "critical");
  assert.equal(byName.get("Riser")?.severity, "info");
  assert.equal(byName.get("Riser")?.title, "Riser can raise its commission to 20%");
  assert.equal(byName.get("Fine"), undefined);
});

test("validator risk: a commission keeps its decimal (7.5%, not 8%)", () => {
  // Ledger by Bitwise on the Hub: 7.5 % now, 38 % reachable within 30 days.
  const chain = stakingChain({
    chainId: "cosmoshub-4",
    denom: "uatom",
    symbol: "ATOM",
    delegations: [
      delegation("5000000", "0", "uatom", {
        operatorAddress: "cosmosvaloper1ledger",
        moniker: "Ledger",
        commissionRate: 0.075,
        commissionReachable30d: 0.38,
      }),
    ],
  });
  const cards = validatorRiskInsights(
    insightContext(
      inputs({
        staking: { updatedAt: NOW, chains: [chain] },
        chainStats: statsResponse([stats("cosmoshub-4", "Cosmos Hub", { medianCommission: 0.05, minCommission: 0.05 })]),
      }),
    ),
  );
  assert.equal(cards.length, 1);
  assert.equal(cards[0]?.title, "Ledger can raise its commission to 38%");
  assert.match(cards[0]?.body ?? "", /can raise its commission from 7\.5% to 38% within 30 days \(median on this chain 5%\)/);
});

test("validator risk: a tombstoned validator is final: no unjail wording, no commission clause", () => {
  const chain = stakingChain({
    chainId: "osmosis-1",
    denom: "uosmo",
    symbol: "OSMO",
    delegations: [
      delegation("8360000", "0", "uosmo", {
        operatorAddress: "osmovaloper1tomb",
        moniker: "Tomb",
        status: "unbonded",
        jailed: true,
        tombstoned: true,
        uptime: 0.4,
        commissionRate: 0.05,
        commissionReachable30d: 0.6,
      }),
    ],
  });
  const cards = validatorRiskInsights(
    insightContext(inputs({ staking: { updatedAt: NOW, chains: [chain] }, chainStats: statsResponse([stats("osmosis-1", "Osmosis")]) })),
  );
  assert.equal(cards.length, 1);
  assert.equal(cards[0]?.severity, "critical");
  assert.equal(cards[0]?.title, "Tomb is tombstoned");
  assert.match(cards[0]?.body ?? "", /until you move it to another validator\.$/);
  assert.doesNotMatch(cards[0]?.body ?? "", /unjailed|commission|signed|more/);
});

test("validator risk: a commission at the chain's own floor is not flagged as high", () => {
  // Celestia: minimum commission 20 %, median 20 %.
  const chain = stakingChain({
    chainId: "celestia",
    denom: "utia",
    symbol: "TIA",
    delegations: [
      delegation("41020000000", "0", "utia", {
        operatorAddress: "celestiavaloper1qubelabs",
        moniker: "Qubelabs",
        commissionRate: 0.2,
        commissionReachable30d: 0.6,
      }),
      delegation("1000000", "0", "utia", { operatorAddress: "celestiavaloper1flat", moniker: "Flat", commissionRate: 0.2, commissionReachable30d: 0.2 }),
    ],
  });
  const cards = validatorRiskInsights(
    insightContext(
      inputs({
        staking: { updatedAt: NOW, chains: [chain] },
        chainStats: statsResponse([stats("celestia", "Celestia", { minCommission: 0.2, medianCommission: 0.2 })]),
      }),
    ),
  );
  assert.equal(cards.length, 1);
  assert.equal(cards[0]?.severity, "info");
  assert.equal(cards[0]?.title, "Qubelabs can raise its commission to 60%");
  assert.match(cards[0]?.body ?? "", /can raise its commission from 20% to 60% within 30 days \(median on this chain 20%\)/);
});

/* ------------------------------------------------------------------ concentration */

test("concentration: info above 60%, warning from 90%, effective number of assets", () => {
  const usdc = asset("osmosis-1", "ibc/usdc", "USDC.n", { liquid: "7500000000" }, 1, { key: "noble-1:uusdc", originChainId: "noble-1" });
  const pf = portfolio([CELESTIA_ASSET, usdc], [portfolioChain("celestia", "Celestia", CELESTIA_ASSET.value), portfolioChain("osmosis-1", "Osmosis", usdc.value)]);
  const [card] = concentrationInsights(insightContext(inputs({ portfolio: pf })));
  assert.ok(card);
  const share = (CELESTIA_ASSET.value as number) / pf.totals.pricedValue;
  assert.ok(share > 0.6 && share < 0.9);
  assert.equal(card.severity, "info");
  assert.match(card.title, /% of your value is TIA$/);
  assert.equal(card.metric?.label, "Effective assets");
  const hhi = share ** 2 + (1 - share) ** 2;
  assert.equal(card.metric?.value, (1 / hhi).toFixed(1));

  const solo = portfolio([CELESTIA_ASSET], [portfolioChain("celestia", "Celestia", CELESTIA_ASSET.value)]);
  assert.deepEqual(concentrationInsights(insightContext(inputs({ portfolio: solo }))), []);

  const dust = asset("osmosis-1", "uosmo", "OSMO", { liquid: "1000000" }, 0.03);
  const heavy = portfolio([CELESTIA_ASSET, dust], [portfolioChain("celestia", "Celestia", CELESTIA_ASSET.value), portfolioChain("osmosis-1", "Osmosis", dust.value)]);
  const [warning] = concentrationInsights(insightContext(inputs({ portfolio: heavy })));
  assert.equal(warning?.severity, "warning");
  assert.equal(warning?.title, ">99.9% of your value is TIA");

  const spread = portfolio(
    [asset("a", "ua", "A", { liquid: "1000000" }, 1), asset("b", "ub", "B", { liquid: "1000000" }, 1)],
    [portfolioChain("a", "A", 1), portfolioChain("b", "B", 1)],
  );
  assert.deepEqual(concentrationInsights(insightContext(inputs({ portfolio: spread }))), []);
});

/* ------------------------------------------------------------------ unpriced */

test("unpriced holdings are counted with their reasons", () => {
  const pf = portfolio(
    [CELESTIA_ASSET, asset("cosmoshub-4", "factory/x/a", "A", { liquid: "1" }, null), asset("cosmoshub-4", "factory/x/b", "B", { liquid: "1" }, null)],
    [portfolioChain("celestia", "Celestia", CELESTIA_ASSET.value)],
  );
  const [card] = unpricedInsights(insightContext(inputs({ portfolio: pf })));
  assert.equal(card?.title, "2 assets without a price");
  assert.match(card?.body ?? "", /2 with no market/);

  // By asset: the same unpriced token on two chains (a proven voucher) is one.
  const voucher = asset("osmosis-1", "ibc/aaa", "A", { liquid: "1" }, null, { key: "cosmoshub-4:factory/x/a", kind: "ibc", originChainId: "cosmoshub-4" });
  const twice = portfolio(
    [CELESTIA_ASSET, asset("cosmoshub-4", "factory/x/a", "A", { liquid: "1" }, null, { key: "cosmoshub-4:factory/x/a" }), voucher],
    [portfolioChain("celestia", "Celestia", CELESTIA_ASSET.value)],
  );
  const [once] = unpricedInsights(insightContext(inputs({ portfolio: twice })));
  assert.equal(once?.title, "1 asset without a price");
  assert.equal(once?.metric?.value, "1");
});

/* ------------------------------------------------------------------ security */

test("security: fund-moving grants are critical, vote/claim bots are info, withdraw address is a warning", () => {
  const review: SecurityReviewResponse = {
    updatedAt: NOW,
    authzGrants: [
      { chainId: "osmosis-1", granter: "me", grantee: "osmo1yp23pfwmrhyxv3yal3xfglgc5vex57a7ceqy5w", authorization: "GenericAuthorization", authorizationTypeUrl: "x", msgTypeUrl: "/cosmos.gov.v1beta1.MsgVote", expiration: "2027-07-22T12:00:00Z" },
      { chainId: "osmosis-1", granter: "me", grantee: "osmo1yp23pfwmrhyxv3yal3xfglgc5vex57a7ceqy5w", authorization: "GenericAuthorization", authorizationTypeUrl: "x", msgTypeUrl: "/cosmos.distribution.v1beta1.MsgWithdrawDelegatorReward", expiration: "2027-07-22T12:00:00Z" },
      { chainId: "cosmoshub-4", granter: "me", grantee: "cosmos1thief000000000000000000000000000000", authorization: "SendAuthorization", authorizationTypeUrl: "x", expiration: null },
    ],
    feeGrants: [],
    withdrawAddressDiffers: [{ chainId: "osmosis-1", address: "me", withdrawAddress: "osmo1yp23pfwmrhyxv3yal3xfglgc5vex57a7ceqy5w" }],
    checked: [],
  };
  const cards = securityInsights(insightContext(inputs({ security: review, chainNames: { "osmosis-1": "Osmosis", "cosmoshub-4": "Cosmos Hub" } })));
  const bot = cards.find((c) => c.id.startsWith("security:authz:osmosis-1"));
  const thief = cards.find((c) => c.id.startsWith("security:authz:cosmoshub-4"));
  const withdraw = cards.find((c) => c.id === "security:withdraw:osmosis-1");
  assert.equal(bot?.severity, "info");
  assert.match(bot?.body ?? "", /2 authz grants let it vote and claim rewards in your name\. Expires Jul 22, 2027\./);
  assert.equal(thief?.severity, "critical");
  assert.match(thief?.title ?? "", /can move funds from your Cosmos Hub account/);
  assert.match(thief?.body ?? "", /never expires/);
  assert.equal(withdraw?.severity, "warning");
});

/* ------------------------------------------------------------------ chain risk */

test("chain risk: halted chains you hold value on, and assets from chains in the notice list", () => {
  const stAtom = asset("cosmoshub-4", "ibc/statom", "stATOM", { liquid: "36667536" }, 3.55, {
    key: "stride-1:stuatom",
    originChainId: "stride-1",
    kind: "ibc",
  });
  const strd = asset("cosmoshub-4", "ibc/strd", "STRD", { liquid: "464063765" }, 0.0073, { key: "stride-1:ustrd", originChainId: "stride-1", kind: "ibc" });
  const pf = portfolio([CELESTIA_ASSET, stAtom, strd], [portfolioChain("celestia", "Celestia", CELESTIA_ASSET.value), portfolioChain("cosmoshub-4", "Cosmos Hub", 133)]);
  const halted = stats("celestia", "Celestia", { halted: true, latestBlockTime: new Date(NOW - 20 * 60_000).toISOString() });
  const cards = chainRiskInsights(insightContext(inputs({ portfolio: pf, chainStats: statsResponse([halted]) })));
  const halt = cards.find((c) => c.id === "chain-risk:halted:celestia");
  const stride = cards.find((c) => c.id === "chain-risk:notice:stride-1");
  assert.equal(halt?.severity, "warning");
  assert.match(halt?.body ?? "", /20 min ago/);
  assert.equal(stride?.title, "2 assets you hold depend on Stride");
  assert.match(stride?.body ?? "", /stATOM and STRD come from or sit on Stride, and a wind-down of Stride was proposed in 2026/);
  assert.ok(CHAIN_NOTICES["noble-1"]);
});

/* ------------------------------------------------------------------ assembly */

test("deriveInsights orders by severity, then kind, then value, and is deterministic", () => {
  const all = inputs({
    staking: { updatedAt: NOW, chains: [CELESTIA_STAKING] },
    portfolio: portfolio(
      [CELESTIA_ASSET, asset("cosmoshub-4", "factory/x/a", "A", { liquid: "1" }, null)],
      [portfolioChain("celestia", "Celestia", CELESTIA_ASSET.value)],
    ),
    chainStats: statsResponse([stats("celestia", "Celestia")]),
    proposals: proposals([proposal({})]),
    security: {
      updatedAt: NOW,
      authzGrants: [],
      feeGrants: [],
      withdrawAddressDiffers: [{ chainId: "celestia", address: "me", withdrawAddress: "celestia1other0000000000000000000000000000" }],
      checked: [],
    },
  });
  const first = deriveInsights(all);
  const second = deriveInsights(all);
  assert.deepEqual(first, second);
  assert.deepEqual(
    first.map((i) => `${i.severity}:${i.kind}`),
    [
      "warning:security",
      "warning:validator-risk",
      "warning:vote",
      "opportunity:compounding",
      "opportunity:idle-stake",
      "info:unpriced",
    ],
  );
  // The weight used for ordering never leaks into the contract.
  for (const item of first) assert.equal("weight" in item, false);
  assert.equal(insightGroup(first[0] as (typeof first)[number]), "risks");
  assert.equal(insightGroup({ kind: "claim", severity: "opportunity" }), "do-now");
  assert.equal(insightGroup({ kind: "idle-stake", severity: "opportunity" }), "opportunities");
  assert.equal(insightGroup({ kind: "security", severity: "critical" }), "do-now");
});

test("no inputs, no insights", () => {
  assert.deepEqual(deriveInsights(inputs()), []);
});
