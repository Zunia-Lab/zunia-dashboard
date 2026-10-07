/**
 * The Insights page's reading aids: counts and the headline follow the
 * rules' own groups, per-network rows say "nothing here" instead of dropping
 * a chain, concentration matches the HHI the rules quote, and the security
 * review groups grants by who holds them, flags fund-moving permissions and
 * keeps "nothing found" apart from "could not check".
 */

import assert from "node:assert/strict";
import { test } from "node:test";

import type { AuthzGrantRow, FeeGrantRow } from "@/lib/chain/types";
import type { Insight } from "@/lib/insights/rules";
import type { TokenIdentity } from "@/lib/token/types";
import type { PortfolioAsset, PortfolioChain } from "@/lib/token/wire";

import {
  EXPIRY_SOON_MS,
  assetSlices,
  chainSlices,
  chainValues,
  coinText,
  concentrationOf,
  countBySeverity,
  expiryOf,
  grantPermission,
  groupAuthz,
  groupFeeGrants,
  hhiLevel,
  insightsByChain,
  kindBreakdown,
  securityCoverage,
  severityCountText,
  splitByGroup,
  summaryText,
  nextSteps,
  stepLabel,
  untilText,
} from "../model";

const NOW = Date.parse("2026-10-07T12:00:00Z");
const DAY = 86_400_000;

function insight(kind: Insight["kind"], severity: Insight["severity"], chainId?: string, id = `${kind}:${chainId ?? "x"}:${severity}`): Insight {
  return { id, kind, severity, title: id, body: "", ...(chainId ? { chainId } : {}) };
}

test("severity counts and groups follow the rules' own grouping", () => {
  const items = [
    insight("security", "critical", "osmosis-1"),
    insight("vote", "warning", "cosmoshub-4"),
    insight("claim", "opportunity", "celestia"),
    insight("idle-stake", "opportunity", "akashnet-2"),
    insight("validator-risk", "warning", "celestia"),
    insight("unpriced", "info"),
  ];
  assert.deepEqual(countBySeverity(items), { critical: 1, warning: 2, opportunity: 2, info: 1 });
  const groups = splitByGroup(items);
  // A critical item is always "do now", whatever its kind.
  assert.deepEqual(
    groups["do-now"].map((item) => item.kind),
    ["security", "vote", "claim"],
  );
  assert.deepEqual(
    groups.opportunities.map((item) => item.kind),
    ["idle-stake"],
  );
  assert.deepEqual(
    groups.risks.map((item) => item.kind),
    ["validator-risk", "unpriced"],
  );
});

test("kind breakdown counts largest first and folds the tail", () => {
  const items = [insight("vote", "warning"), insight("validator-risk", "warning"), insight("validator-risk", "warning"), insight("chain-risk", "warning")];
  assert.equal(kindBreakdown(items), "2 validators · 1 vote · 1 chain status");
  assert.equal(kindBreakdown(items, 2), "2 validators · 1 vote · 1 more");
  // The tail counts insights, not kinds, so the parts add up to the total.
  const longer = [...items, insight("security", "warning"), insight("security", "warning"), insight("unpriced", "warning")];
  assert.equal(kindBreakdown(longer, 2), "2 validators · 2 security findings · 3 more");
  assert.equal(kindBreakdown([]), "");
});

test("until text uses the unit a person would", () => {
  assert.equal(untilText(NOW + 5 * 3_600_000, NOW), "today");
  assert.equal(untilText(NOW + DAY, NOW), "in 1 day");
  assert.equal(untilText(NOW + 59 * DAY, NOW), "in 59 days");
  assert.equal(untilText(NOW + 352 * DAY, NOW), "in 11 months");
  assert.equal(untilText(NOW + 800 * DAY, NOW), "in 2 years");
  assert.equal(untilText(NOW - DAY, NOW), "expired");
});

test("the headline leads with what to do now, then gains, then risks", () => {
  const one = [insight("claim", "opportunity")];
  assert.deepEqual(summaryText({ "do-now": one, opportunities: [], risks: [] }, "on 5 networks"), {
    title: "1 thing to do now",
    sub: "The only insight on 5 networks.",
  });
  assert.equal(
    summaryText({ "do-now": [1, 2, 3], opportunities: [1], risks: [1, 2] }, "on 5 networks").sub,
    "Plus 1 opportunity and 2 risks to review, on 5 networks.",
  );
  assert.equal(summaryText({ "do-now": [], opportunities: [1, 2], risks: [1] }, "on Osmosis").title, "2 opportunities to consider");
  assert.equal(summaryText({ "do-now": [], opportunities: [], risks: [1] }, "on Osmosis").title, "1 risk to review");
  // Nothing found is only said plainly when every read answered.
  assert.equal(summaryText({ "do-now": [], opportunities: [], risks: [] }, "on Osmosis").title, "Nothing needs you right now");
  assert.equal(summaryText({ "do-now": [], opportunities: [], risks: [] }, "on Osmosis", true).title, "Nothing found in what loaded");
  // Nothing read at all is said as such, never as "nothing found".
  assert.equal(summaryText({ "do-now": [], opportunities: [], risks: [] }, "on Osmosis", true, true).title, "Nothing could be measured");
  assert.equal(summaryText({ "do-now": [1], opportunities: [], risks: [] }, "on Osmosis", true, true).title, "1 thing to do now");
});

test("next steps take the actions of what to do now, else of the opportunities", () => {
  const act = (item: Insight, label: string): Insight => ({ ...item, action: { label, href: "/x" } });
  const claim = act(insight("claim", "opportunity", "celestia"), "Claim rewards");
  const vote = act(insight("vote", "warning", "cosmoshub-4", "vote:cosmoshub-4:1058"), "Vote");
  const idle = act(insight("idle-stake", "opportunity", "akashnet-2"), "Stake");
  const bare = insight("unbonding", "info", "osmosis-1");
  assert.deepEqual(
    nextSteps({ "do-now": [vote, bare, claim], opportunities: [idle], risks: [] }).map((item) => item.kind),
    ["vote", "claim"],
  );
  assert.deepEqual(
    nextSteps({ "do-now": [], opportunities: [idle], risks: [] }).map((item) => item.kind),
    ["idle-stake"],
  );
  assert.equal(stepLabel(vote, "Cosmos Hub"), "Vote · Cosmos Hub #1058");
  assert.equal(stepLabel(claim, "Celestia"), "Claim rewards · Celestia");
  assert.equal(stepLabel(claim, null), "Claim rewards");
  // Two validators on one chain share their action ("Review validator") but
  // lead to different pages: the title tells them apart.
  const jailed = (operator: string, moniker: string): Insight => ({
    ...act(insight("validator-risk", "critical", "cosmoshub-4", `validator-risk:cosmoshub-4:${operator}`), "Review validator"),
    title: `${moniker} is jailed`,
  });
  const strangelove = jailed("cosmosvaloper130mdu9a0etmeuw52qfxk73pn0ga6gawkxsrlwf", "strangelove");
  const multiplex = jailed("cosmosvaloper1a4qlael79p76my9pml6thwhnnzsxyy4ajrvd9s", "Multiplex");
  assert.equal(stepLabel(strangelove, "Cosmos Hub"), "strangelove is jailed · Cosmos Hub");
  assert.equal(stepLabel(multiplex, null), "Multiplex is jailed");
  assert.notEqual(stepLabel(strangelove, "Cosmos Hub"), stepLabel(multiplex, "Cosmos Hub"));
});

test("per-network rows keep empty chains and sort the most severe first", () => {
  const tally = insightsByChain(
    [
      insight("claim", "opportunity", "celestia"),
      insight("validator-risk", "warning", "cosmoshub-4"),
      insight("vote", "info", "cosmoshub-4"),
      insight("security", "critical", "osmosis-1"),
      insight("concentration", "info"),
      insight("chain-risk", "warning", "stride-1"),
    ],
    ["safrochain-1", "cosmoshub-4", "osmosis-1", "celestia"],
  );
  assert.deepEqual(
    tally.rows.map((row) => [row.chainId, row.worst, row.total]),
    [
      ["osmosis-1", "critical", 1],
      ["cosmoshub-4", "warning", 2],
      // Out of scope, still counted rather than dropped.
      ["stride-1", "warning", 1],
      ["celestia", "opportunity", 1],
      ["safrochain-1", null, 0],
    ],
  );
  assert.equal(tally.acrossChains, 1);
});

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
    chainName: chainId,
    ...extra,
  };
}

function asset(chainId: string, denom: string, ticker: string, value: number | null, extra: Partial<TokenIdentity> = {}): PortfolioAsset {
  return {
    identity: identity(chainId, denom, ticker, extra),
    chainId,
    amounts: { liquid: "1000000", staked: "0", rewards: "0", unbonding: "0" },
    total: 1,
    price: value === null ? null : { price: value, change24h: null, source: "numia", at: NOW },
    value,
    change24hAbs: null,
  } as PortfolioAsset;
}

function chain(chainId: string, value: number | null, status: PortfolioChain["status"] = "ok"): PortfolioChain {
  return {
    chainId,
    chainName: chainId.toUpperCase(),
    iconUrl: null,
    address: "a",
    status,
    value,
    liquid: value,
    staked: 0,
    rewards: 0,
    unbonding: 0,
    change24hAbs: null,
    assetCount: 1,
    nativeSymbol: "X",
  };
}

test("concentration: HHI, its inverse and the band", () => {
  const even = concentrationOf([
    { id: "a", label: "A", value: 25 },
    { id: "b", label: "B", value: 25 },
    { id: "c", label: "C", value: 25 },
    { id: "d", label: "D", value: 25 },
  ]);
  assert.equal(even.hhi, 0.25);
  assert.equal(even.effective, 4);
  assert.equal(even.level, "moderate");

  const skewed = concentrationOf([
    { id: "small", label: "S", value: 10 },
    { id: "big", label: "B", value: 90 },
    { id: "zero", label: "Z", value: 0 },
  ]);
  assert.equal(skewed.top?.id, "big");
  assert.equal(skewed.topShare, 0.9);
  assert.ok(Math.abs((skewed.hhi ?? 0) - 0.82) < 1e-9);
  assert.equal(skewed.level, "concentrated");
  assert.equal(skewed.slices.length, 2, "zero slices are left out");

  const none = concentrationOf([{ id: "x", label: "X", value: 0 }]);
  assert.equal(none.hhi, null);
  assert.equal(none.level, null);

  assert.equal(hhiLevel(0.1), "diversified");
  assert.equal(hhiLevel(0.15), "moderate");
  assert.equal(hhiLevel(0.2501), "concentrated");
  assert.equal(hhiLevel(null), null);
});

test("asset slices merge a proven voucher with its origin and tell look-alikes apart", () => {
  const slices = assetSlices({
    assets: [
      asset("cosmoshub-4", "uatom", "ATOM", 60),
      // ATOM on Osmosis, proven: same key as the Hub's.
      asset("osmosis-1", "ibc/27394FB", "ATOM", 20, { key: "cosmoshub-4:uatom", originChainId: "cosmoshub-4", originChainName: "Cosmos Hub" }),
      // Two different USDCs with the same ticker.
      asset("noble-1", "uusdc", "USDC", 10, { chainName: "Noble" }),
      asset("osmosis-1", "factory/x/usdc", "USDC", 5, { proven: false, chainName: "Osmosis" }),
      asset("akashnet-2", "uakt", "AKT", null),
    ],
  });
  const byId = new Map(slices.map((slice) => [slice.id, slice]));
  assert.equal(byId.get("cosmoshub-4:uatom")?.value, 80);
  assert.equal(byId.get("noble-1:uusdc")?.label, "USDC · Noble");
  assert.equal(byId.get("osmosis-1:factory/x/usdc")?.label, "USDC · Osmosis");
  assert.equal(byId.has("akashnet-2:uakt"), false, "unpriced assets are not valued");
});

test("severity counts read as words, plural where English has one", () => {
  assert.equal(severityCountText("critical", 2), "2 critical");
  assert.equal(severityCountText("warning", 1), "1 warning");
  assert.equal(severityCountText("warning", 3), "3 warnings");
  assert.equal(severityCountText("opportunity", 1), "1 opportunity");
  assert.equal(severityCountText("opportunity", 2), "2 opportunities");
  assert.equal(severityCountText("info", 4), "4 info");
});

test("chain values give each chain's priced value and share, unknown when it failed", () => {
  const values = chainValues({
    chains: [chain("a", 75), chain("b", null), chain("c", 5, "error"), chain("d", 25)],
    totals: { pricedValue: 100 } as never,
  });
  assert.deepEqual(values.get("a"), { value: 75, share: 0.75, assets: 1, failed: false });
  assert.deepEqual(values.get("b"), { value: null, share: null, assets: 1, failed: false });
  assert.deepEqual(values.get("c"), { value: null, share: null, assets: 1, failed: true }, "a failed read is not valued");
  assert.equal(values.get("d")?.share, 0.25);
  assert.equal(chainValues(null).size, 0);
  // Nothing priced at all: values stay, shares are unknown rather than divided by zero.
  assert.equal(chainValues({ chains: [chain("a", 0)], totals: { pricedValue: 0 } as never }).get("a")?.share, null);
});

test("chain slices skip chains that failed or hold nothing priced", () => {
  const slices = chainSlices({ chains: [chain("a", 10), chain("b", null), chain("c", 5, "error"), chain("d", 0)] });
  assert.deepEqual(
    slices.map((slice) => slice.id),
    ["a"],
  );
});

function grant(extra: Partial<AuthzGrantRow>): AuthzGrantRow {
  return {
    chainId: "osmosis-1",
    granter: "osmo1granter",
    grantee: "osmo1bot",
    authorization: "GenericAuthorization",
    authorizationTypeUrl: "/cosmos.authz.v1beta1.GenericAuthorization",
    expiration: "2027-07-22T23:00:00Z",
    ...extra,
  };
}

test("grant permissions say what the grantee can do and whether funds can leave", () => {
  assert.deepEqual(grantPermission(grant({ msgTypeUrl: "/cosmos.gov.v1beta1.MsgVote" })), {
    label: "Vote",
    typeUrl: "/cosmos.gov.v1beta1.MsgVote",
    movesFunds: false,
  });
  assert.equal(grantPermission(grant({ msgTypeUrl: "/cosmos.bank.v1beta1.MsgSend" })).movesFunds, true);
  assert.equal(grantPermission(grant({ authorization: "SendAuthorization" })).label, "Send tokens");
  assert.equal(grantPermission(grant({ authorization: "SendAuthorization" })).movesFunds, true);
  assert.equal(grantPermission(grant({ authorization: "StakeAuthorization", stakeAction: "delegate" })).label, "Delegate");
  assert.equal(grantPermission(grant({ msgTypeUrl: "/osmosis.poolmanager.v1beta1.MsgSwapExactAmountIn" })).label, "MsgSwapExactAmountIn");
});

test("expiry: never beats a date, the earliest date wins, soon and past are flagged", () => {
  assert.deepEqual(expiryOf([null, "2027-01-01T00:00:00Z"], NOW), { kind: "never" });
  const soon = expiryOf([new Date(NOW + 10 * DAY).toISOString(), new Date(NOW + 400 * DAY).toISOString()], NOW);
  assert.equal(soon.kind, "at");
  if (soon.kind === "at") {
    assert.equal(soon.at, NOW + 10 * DAY);
    assert.equal(soon.soon, true);
    assert.equal(soon.past, false);
  }
  const later = expiryOf([new Date(NOW + EXPIRY_SOON_MS + DAY).toISOString()], NOW);
  assert.equal(later.kind === "at" && later.soon, false);
  const past = expiryOf([new Date(NOW - DAY).toISOString()], NOW);
  assert.equal(past.kind === "at" && past.past, true);
  assert.deepEqual(expiryOf(["not a date"], NOW), { kind: "unknown" });
});

test("authz grants group by grantee, fund-moving parties first", () => {
  const groups = groupAuthz(
    [
      grant({ chainId: "cosmoshub-4", granter: "cosmos1me", grantee: "cosmos1voter", msgTypeUrl: "/cosmos.gov.v1.MsgVote" }),
      grant({ chainId: "cosmoshub-4", granter: "cosmos1me", grantee: "cosmos1voter", msgTypeUrl: "/cosmos.gov.v1beta1.MsgVote" }),
      grant({ msgTypeUrl: "/cosmos.distribution.v1beta1.MsgWithdrawDelegatorReward" }),
      grant({ msgTypeUrl: "/cosmos.bank.v1beta1.MsgSend", expiration: null, spendLimit: [{ denom: "uosmo", amount: "5000000" }] }),
    ],
    NOW,
    (chainId) => (chainId === "osmosis-1" ? { coinMinimalDenom: "uosmo", coinDenom: "OSMO", coinDecimals: 6 } : null),
  );
  assert.equal(groups.length, 2);
  const [bot, voter] = groups;
  assert.equal(bot?.grantee, "osmo1bot");
  assert.equal(bot?.movesFunds, true);
  assert.deepEqual(
    bot?.permissions.map((p) => p.label),
    ["Send tokens", "Claim rewards"],
  );
  assert.deepEqual(bot?.expiry, { kind: "never" });
  assert.deepEqual(bot?.limits, ["Up to 5 OSMO"]);
  // Two vote grants (v1 and v1beta1) read as one permission.
  assert.deepEqual(
    voter?.permissions.map((p) => p.label),
    ["Vote"],
  );
  assert.equal(voter?.grants.length, 2);
});

test("fee grants: unlimited allowances first, restricted messages named", () => {
  const rows: FeeGrantRow[] = [
    {
      chainId: "osmosis-1",
      granter: "osmo1me",
      grantee: "osmo1a",
      allowance: "BasicAllowance",
      allowanceTypeUrl: "/cosmos.feegrant.v1beta1.BasicAllowance",
      spendLimit: [{ denom: "uosmo", amount: "1000000" }],
      expiration: null,
    },
    {
      chainId: "osmosis-1",
      granter: "osmo1me",
      grantee: "osmo1b",
      allowance: "AllowedMsgAllowance",
      allowanceTypeUrl: "/cosmos.feegrant.v1beta1.AllowedMsgAllowance",
      allowedMessages: ["/cosmos.gov.v1beta1.MsgVote"],
      expiration: new Date(NOW + 5 * DAY).toISOString(),
    },
  ];
  const groups = groupFeeGrants(rows, NOW);
  assert.deepEqual(
    groups.map((group) => [group.grantee, group.limited]),
    [
      ["osmo1b", false],
      ["osmo1a", true],
    ],
  );
  assert.deepEqual(groups[0]?.allowedMessages, ["Vote"]);
  assert.deepEqual(groups[1]?.limits, ["Up to 1,000,000 uosmo"]);
});

test("coin text formats the chain's own coin and leaves other denoms in base units", () => {
  const hub = { coinMinimalDenom: "uatom", coinDenom: "ATOM", coinDecimals: 6 };
  assert.equal(coinText({ denom: "uatom", amount: "12500000" }, hub), "12.5 ATOM");
  assert.equal(coinText({ denom: "ibc/27394FB092D2ECCD56123C74F36E4C1F926001CEADA9CA97EA622B25F41E5EB2", amount: "7" }, hub), "7 ibc/27394FB0…1E5EB2");
});

test("coverage keeps clean, flagged, partial and failed chains apart", () => {
  const coverage = securityCoverage(
    {
      authzGrants: [grant({ chainId: "cosmoshub-4", grantee: "cosmos1x" }), grant({ chainId: "cosmoshub-4", grantee: "cosmos1x", msgTypeUrl: "/a" })],
      feeGrants: [],
      withdrawAddressDiffers: [{ chainId: "celestia", address: "c1", withdrawAddress: "c2" }],
      checked: [
        { chainId: "safrochain-1", address: "a", status: "ok" },
        { chainId: "cosmoshub-4", address: "b", status: "ok" },
        { chainId: "celestia", address: "c1", status: "ok" },
        { chainId: "osmosis-1", address: "d", status: "partial" },
        { chainId: "akashnet-2", address: "e", status: "error" },
      ],
    },
    ["injective-1"],
  );
  assert.deepEqual(coverage.clean, ["safrochain-1"]);
  assert.deepEqual(coverage.flagged, ["cosmoshub-4", "celestia"]);
  assert.deepEqual(coverage.partial, ["osmosis-1"]);
  assert.deepEqual(coverage.failed, ["akashnet-2"]);
  assert.deepEqual(coverage.notAsked, ["injective-1"]);
  // One party with two grants counts once, plus the withdraw address.
  assert.equal(coverage.findings, 2);
});
