/**
 * LCD payload readers. Public nodes disagree on encodings (decimal strings,
 * numbers, base64 `Dec` bytes, Duration strings or objects) and use 1970 /
 * year-1 timestamps for "never"; every reader must turn the odd case into
 * `null`, not into a confident wrong number.
 */

import assert from "node:assert/strict";
import { test } from "node:test";

import {
  depositProgress,
  parseAnnualProvisions,
  parseBlockHeader,
  parseDirectoryChain,
  parseEpochSeconds,
  parseGovSections,
  parseGovV1Params,
  parseInflation,
  parseMintParams,
  parseNodeStatus,
  parseOsmosisMintParams,
  parsePool,
  parseSlashingParams,
  parseStakingParams,
  parseSupplyAmount,
} from "../params";
import { coins, intString, parseDec, parseDurationSeconds, parseIntSafe, parseTime, ratio, safeWebsite, sumAmounts } from "../parse";

test("Dec parsing: strings, numbers, base64 bytes", () => {
  assert.equal(parseDec("0.334000000000000000"), 0.334);
  assert.equal(parseDec("1"), 1);
  assert.equal(parseDec(0.5), 0.5);
  // gogoproto bytes Dec as some gateways emit it: ASCII of 0.334 × 10^18.
  assert.equal(parseDec("MzM0MDAwMDAwMDAwMDAwMDAw"), 0.334);
  assert.equal(parseDec("abc"), null);
  assert.equal(parseDec(""), null);
  assert.equal(parseDec(Number.NaN), null);
});

test("amounts are truncated to whole base units, never rounded up", () => {
  assert.equal(intString("503521.100598716310000000"), "503521");
  assert.equal(intString("0007"), "7");
  assert.equal(intString("0.9"), "0");
  assert.equal(intString("-5"), null);
  assert.equal(intString("1e5"), null);
  assert.equal(sumAmounts(["1", "2", null, "x", "999999999999999999999999"]), "1000000000000000000000002");
  assert.deepEqual(coins([{ denom: "uatom", amount: "10.9" }, { denom: "", amount: "1" }, { amount: "2" }]), [
    { denom: "uatom", amount: "10" },
  ]);
  assert.equal(ratio("1", "4"), 0.25);
  assert.equal(ratio("1", "0"), null);
  assert.equal(ratio(null, "4"), null);
});

test("durations, integers, times", () => {
  assert.equal(parseDurationSeconds("1209600s"), 1_209_600);
  assert.equal(parseDurationSeconds("0.5s"), 0.5);
  assert.equal(parseDurationSeconds({ seconds: "60", nanos: 500_000_000 }), 60.5);
  assert.equal(parseDurationSeconds("two weeks"), null);
  assert.equal(parseIntSafe("10000"), 10_000);
  assert.equal(parseIntSafe("99999999999999999999"), null);
  assert.equal(parseTime("2026-10-06T23:09:15.323Z"), "2026-10-06T23:09:15.323Z");
  assert.equal(parseTime("1970-01-01T00:00:00Z"), null);
  assert.equal(parseTime("0001-01-01T00:00:00Z"), null);
  assert.equal(safeWebsite("ynukalabs.com"), "https://ynukalabs.com/");
  assert.equal(safeWebsite("ftp://x"), null);
});

test("staking, pool, supply, slashing (Safrochain payloads)", () => {
  assert.deepEqual(
    parseStakingParams({
      params: { unbonding_time: "1209600s", max_validators: 100, bond_denom: "usaf", min_commission_rate: "0.050000000000000000" },
    }),
    { bondDenom: "usaf", unbondingSeconds: 1_209_600, maxValidators: 100, minCommission: 0.05 },
  );
  assert.deepEqual(parsePool({ pool: { not_bonded_tokens: "12610485530777", bonded_tokens: "658043304304364" } }), {
    bonded: "658043304304364",
    notBonded: "12610485530777",
  });
  assert.equal(parsePool({ pool: {} }), null);
  assert.equal(parseSupplyAmount({ amount: { denom: "usaf", amount: "1037800901289961" } }), "1037800901289961");
  assert.deepEqual(
    parseSlashingParams({
      params: {
        signed_blocks_window: "10000",
        min_signed_per_window: "0.500000000000000000",
        downtime_jail_duration: "600s",
        slash_fraction_double_sign: "0.050000000000000000",
        slash_fraction_downtime: "0.000100000000000000",
      },
    }),
    {
      signedBlocksWindow: 10_000,
      minSignedPerWindow: 0.5,
      downtimeJailSeconds: 600,
      slashFractionDowntime: 0.0001,
      slashFractionDoubleSign: 0.05,
    },
  );
});

test("mint readers: standard, custom without blocks_per_year, Osmosis", () => {
  assert.deepEqual(parseMintParams({ params: { mint_denom: "usaf", goal_bonded: "0.55", blocks_per_year: "6311520" } }), {
    mintDenom: "usaf",
    blocksPerYear: 6_311_520,
    goalBonded: 0.55,
  });
  // Juno's mint publishes blocks_per_year only.
  assert.equal(parseMintParams({ params: { mint_denom: "ujuno", blocks_per_year: "10096186" } })?.goalBonded, null);
  assert.equal(parseMintParams({ params: { blocks_per_year: "0" } })?.blocksPerYear, null);
  assert.equal(parseAnnualProvisions({ annual_provisions: "75117306271476.908581467655538052" }), 75_117_306_271_476.91);
  assert.deepEqual(
    parseOsmosisMintParams({
      params: { epoch_identifier: "day", distribution_proportions: { staking: "0.080000000000000000" } },
    }),
    { epochIdentifier: "day", stakingProportion: 0.08 },
  );
  const epochs = { epochs: [{ identifier: "day", duration: "86400s" }, { identifier: "week", duration: "604800s" }] };
  assert.equal(parseEpochSeconds(epochs, "week"), 604_800);
  assert.equal(parseEpochSeconds({}, "day"), 86_400);
  assert.equal(parseEpochSeconds({}, "hour"), null);
});

test("inflation: the standard route, and Celestia's inflation_rate (live 2026-10-07)", () => {
  assert.equal(parseInflation({ inflation: "0.072380523784049260" }), 0.07238052378404926);
  assert.equal(parseInflation({ inflation_rate: "0.023242056300000000" }), 0.0232420563);
  assert.equal(parseInflation({ code: 12, message: "Not Implemented" }), null);
});

test("latest block from node status or block header", () => {
  assert.deepEqual(parseNodeStatus({ height: "3248727", timestamp: "2026-10-06T23:23:35.939980592Z" }), {
    height: 3_248_727,
    time: "2026-10-06T23:23:35.939980592Z",
  });
  assert.equal(parseNodeStatus({ height: "0", timestamp: "2026-10-06T23:23:35Z" }), null);
  assert.deepEqual(parseBlockHeader({ block: { header: { height: "14709398", time: "2026-10-06T15:12:18.960176910Z" } } }), {
    height: 14_709_398,
    time: "2026-10-06T15:12:18.960176910Z",
  });
  assert.deepEqual(parseBlockHeader({ sdk_block: { header: { height: "5", time: "2026-10-06T15:12:18Z" } } }), {
    height: 5,
    time: "2026-10-06T15:12:18Z",
  });
});

test("gov params: v1 unified, and per-section reads ignoring zero-filled sections", () => {
  const unified = parseGovV1Params({
    voting_params: null,
    tally_params: { quorum: "0.334" },
    params: {
      min_deposit: [{ denom: "usaf", amount: "5000000000" }],
      max_deposit_period: "172800s",
      voting_period: "604800s",
      quorum: "0.334000000000000000",
      threshold: "0.500000000000000000",
      veto_threshold: "0.334000000000000000",
      expedited_voting_period: "86400s",
      expedited_threshold: "0.667000000000000000",
    },
  });
  assert.deepEqual(unified, {
    quorum: 0.334,
    threshold: 0.5,
    vetoThreshold: 0.334,
    expeditedThreshold: 0.667,
    votingPeriodDays: 7,
    expeditedVotingPeriodDays: 1,
    depositPeriodDays: 2,
    minDeposit: [{ denom: "usaf", amount: "5000000000" }],
    api: "v1",
  });
  assert.equal(parseGovV1Params({ tally_params: { quorum: "0.4" }, params: null }), null);

  const sections = parseGovSections(
    { voting_params: { voting_period: "0s" }, deposit_params: { min_deposit: [] }, tally_params: { quorum: "0.400000000000000000", threshold: "0.500000000000000000", veto_threshold: "0.334000000000000000" } },
    { voting_params: { voting_period: "604800s" }, tally_params: { quorum: "0.000000000000000000" } },
    { deposit_params: { min_deposit: [{ denom: "uatom", amount: "500000000" }], max_deposit_period: "1209600s" } },
    "v1beta1",
  );
  assert.equal(sections?.quorum, 0.4);
  assert.equal(sections?.votingPeriodDays, 7);
  assert.equal(sections?.depositPeriodDays, 14);
  assert.deepEqual(sections?.minDeposit, [{ denom: "uatom", amount: "500000000" }]);
  assert.equal(sections?.api, "v1beta1");
});

test("cosmos.directory economics: zero means not published", () => {
  assert.deepEqual(
    parseDirectoryChain({
      chain: { params: { estimated_apr: 0.1027, calculated_apr: 0.1853, base_inflation: 0.0724, blocks_per_year: 6311520, actual_blocks_per_year: 11386699.7 } },
    }),
    { naive: 0.1027, actual: 0.1853, inflation: 0.0724, blocksPerYear: 6_311_520, actualBlocksPerYear: 11_386_699.7 },
  );
  // Kava: x/mint issues nothing, so cosmos.directory says 0 — not an APR.
  const kava = parseDirectoryChain({ chain: { params: { estimated_apr: 0, calculated_apr: 0 } } });
  assert.equal(kava?.naive, null);
  assert.equal(kava?.actual, null);
  assert.equal(parseDirectoryChain({}), null);
});

test("deposit progress against the minimum", () => {
  const min = [{ denom: "uatom", amount: "500000000" }];
  assert.equal(depositProgress([{ denom: "uatom", amount: "250000000" }], min), 0.5);
  assert.equal(depositProgress([{ denom: "uatom", amount: "900000000" }], min), 1);
  assert.equal(depositProgress([], min), 0);
  assert.equal(depositProgress([], null), null);
});
