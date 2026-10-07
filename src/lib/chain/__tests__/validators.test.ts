/**
 * Validator set analytics. Shares must be of the whole bonded set, the
 * Nakamoto set must be the smallest one strictly above 1/3, commission
 * headroom must follow the staking module's one-change-per-24h rule, and an
 * unjoinable signing info must read as "unknown", never "100 % uptime".
 */

import assert from "node:assert/strict";
import { test } from "node:test";

import {
  bondStatus,
  buildValidatorRows,
  median,
  nakamotoCoefficient,
  parseSigningInfo,
  parseValidator,
  reachableCommission,
  signingIndex,
  sortByTokens,
  summariseValidators,
  topShare,
  uptimeOf,
  votingShares,
  type RawValidator,
} from "../validators";

const NOW = Date.parse("2026-10-07T00:00:00Z");

/** A real Safrochain validator (YnukaLabs) as the LCD returns it. */
const YNUKA = {
  operator_address: "addr_safrovaloper1q4c4p0n66crlkgagr76mjtnmt4d8pdlq8knm5z",
  consensus_pubkey: { "@type": "/cosmos.crypto.ed25519.PubKey", key: "uEMMh+NBGJIW9cwyr+PycuBqw/cb9CxN3TYPvQYEtLY=" },
  jailed: false,
  status: "BOND_STATUS_BONDED",
  tokens: "23522663029877",
  delegator_shares: "23522663029877.000000000000000000",
  description: {
    moniker: "YnukaLabs",
    identity: "3FB682C7BC8A0006",
    website: "https://www.ynukalabs.com",
    security_contact: "olivierbanyene@icloud.com",
    details: "Operated by Ynuka Labs (Goma Hub) in DR Congo.",
  },
  unbonding_height: "0",
  unbonding_time: "1970-01-01T00:00:00Z",
  commission: {
    commission_rates: { rate: "0.100000000000000000", max_rate: "0.200000000000000000", max_change_rate: "0.010000000000000000" },
    update_time: "2026-07-20T05:10:28.197278571Z",
  },
  min_self_delegation: "1",
};

/** Its signing info, keyed by the consensus address derived from the key above. */
const YNUKA_SIGNING = {
  address: "addr_safrovalcons1uwnp77lnywt32rrk6ktyq5qajx4frgjlp686hd",
  start_height: "794060",
  index_offset: "2454438",
  jailed_until: "1970-01-01T00:00:00Z",
  tombstoned: false,
  missed_blocks_counter: "1",
};

function raw(operator: string, tokens: string, extra: Partial<RawValidator> = {}): RawValidator {
  return {
    operatorAddress: operator,
    consensusPubkey: null,
    consensusHex: null,
    jailed: false,
    status: "bonded",
    tokens,
    delegatorShares: tokens,
    moniker: operator,
    identity: null,
    website: null,
    details: null,
    securityContact: null,
    unbondingTime: null,
    commission: { rate: 0.05, maxRate: 0.2, maxChangeRate: 0.01, updatedAt: null },
    minSelfDelegation: "1",
    ...extra,
  };
}

test("bond status accepts the enum names and numbers", () => {
  assert.equal(bondStatus("BOND_STATUS_BONDED"), "bonded");
  assert.equal(bondStatus(3), "bonded");
  assert.equal(bondStatus("BOND_STATUS_UNBONDING"), "unbonding");
  assert.equal(bondStatus("BOND_STATUS_UNBONDED"), "unbonded");
  assert.equal(bondStatus("BOND_STATUS_UNSPECIFIED"), null);
});

test("parseValidator reads a live payload and drops what it cannot trust", () => {
  const v = parseValidator(YNUKA);
  assert.ok(v);
  assert.equal(v.moniker, "YnukaLabs");
  assert.equal(v.commission.rate, 0.1);
  assert.equal(v.commission.maxRate, 0.2);
  assert.equal(v.commission.maxChangeRate, 0.01);
  assert.equal(v.website, "https://www.ynukalabs.com/");
  assert.equal(v.unbondingTime, null, "the 1970 sentinel means never");
  assert.equal(v.delegatorShares, "23522663029877");
  assert.equal(parseValidator({ ...YNUKA, description: { ...YNUKA.description, website: "javascript:alert(1)" } })?.website, null);
  assert.equal(parseValidator({ ...YNUKA, tokens: "abc" }), null);
  assert.equal(parseValidator({ ...YNUKA, status: "nope" }), null);
  assert.equal(parseValidator(null), null);
});

test("sortByTokens compares exactly (string order would put 9 above 10)", () => {
  const sorted = sortByTokens([raw("a", "9"), raw("b", "10"), raw("c", "100000000000000000000000001"), raw("d", "100000000000000000000000000")]);
  assert.deepEqual(sorted.map((v) => v.operatorAddress), ["c", "d", "b", "a"]);
});

test("voting shares sum to one over the whole set", () => {
  const { shares, total } = votingShares(["600", "300", "100"]);
  assert.deepEqual(shares, [0.6, 0.3, 0.1]);
  assert.equal(total, BigInt(1000));
  assert.deepEqual(votingShares([]).shares, []);
});

test("Nakamoto coefficient: smallest set strictly above one third", () => {
  // Hub on 2026-10-07: Coinbase 19.62 %, Upbit 7.29 %, Kiln 6.47 % → 33.37 % > 1/3.
  assert.equal(nakamotoCoefficient([0.1962, 0.0729, 0.0647, 0.0468, 0.0412]), 3);
  // Exactly one third is not enough to halt the chain.
  assert.equal(nakamotoCoefficient([1 / 3, 1 / 3, 1 / 3]), 2);
  assert.equal(nakamotoCoefficient([0.5, 0.5]), 1);
  assert.equal(nakamotoCoefficient([]), null);
});

test("top-N share and median", () => {
  assert.equal(topShare([0.4, 0.3, 0.2, 0.1], 2), 0.7);
  assert.equal(topShare([], 10), null);
  assert.equal(median([0.05, 0.1, 0.07]), 0.07);
  assert.equal(median([0.05, 0.1]), 0.07500000000000001);
  assert.equal(median([]), null);
});

test("reachable commission: one change per 24 h, by max_change_rate, capped at max_rate", () => {
  const base = { rate: 0.05, maxRate: 0.2, maxChangeRate: 0.01, updatedAt: null };
  // 30 slots in [now, now + 30 d).
  assert.equal(reachableCommission(base, 30, NOW), 0.2);
  assert.equal(reachableCommission({ ...base, maxRate: 0.5 }, 30, NOW), 0.35);
  assert.equal(reachableCommission({ ...base, maxRate: 0.5 }, 1, NOW), 0.06);
  // Changed an hour ago: the first raise waits until 23 h from now; still one slot in 1 day.
  const recent = { ...base, maxRate: 0.5, updatedAt: new Date(NOW - 3_600_000).toISOString() };
  assert.equal(reachableCommission(recent, 1, NOW), 0.06);
  // Changed an hour ago and asked about the next 12 h: no slot yet.
  assert.equal(reachableCommission(recent, 0.5, NOW), 0.05);
  // Nothing can change: at the cap, or a zero change rate.
  assert.equal(reachableCommission({ ...base, rate: 0.2 }, 90, NOW), 0.2);
  assert.equal(reachableCommission({ ...base, maxChangeRate: 0 }, 90, NOW), 0.05);
  // Coinbase on the Hub: 20 % with max 100 % and max change 100 % → 100 % tomorrow.
  assert.equal(reachableCommission({ rate: 0.2, maxRate: 1, maxChangeRate: 1, updatedAt: null }, 30, NOW), 1);
});

test("uptime uses the part of the window the validator has been in", () => {
  assert.deepEqual(uptimeOf({ missedBlocks: 100, indexOffset: 2_454_438 }, 10_000), {
    uptime: 0.99,
    missed: 100,
    window: 10_000,
  });
  // A newcomer 2,000 blocks in: 20 missed is 1 %, not 0.2 %.
  assert.deepEqual(uptimeOf({ missedBlocks: 20, indexOffset: 2_000 }, 10_000), {
    uptime: 0.99,
    missed: 20,
    window: 2_000,
  });
  assert.equal(uptimeOf(null, 10_000).uptime, null);
  assert.equal(uptimeOf({ missedBlocks: null, indexOffset: 5 }, 10_000).uptime, null);
  assert.equal(uptimeOf({ missedBlocks: 3, indexOffset: 5 }, null).uptime, null);
});

test("buildValidatorRows ranks, accumulates, marks the Nakamoto set and joins signing info", () => {
  const ynuka = parseValidator(YNUKA);
  const info = parseSigningInfo(YNUKA_SIGNING);
  assert.ok(ynuka && info);
  const infos = signingIndex([info]);
  const rows = buildValidatorRows(
    [
      raw("small", "100"),
      { ...ynuka, tokens: "500" },
      raw("mid", "400"),
      raw("jailed", "900", { status: "unbonding", jailed: true }),
    ],
    infos,
    { accountPrefix: "addr_safro", window: 10_000, chainApr: 0.18, now: NOW },
  );
  assert.deepEqual(
    rows.map((row) => [row.operatorAddress.slice(0, 18), row.rank, row.votingPower, row.inNakamotoSet]),
    [
      ["addr_safrovaloper1", 1, 0.5, true],
      ["mid", 2, 0.4, false],
      ["small", 3, 0.1, false],
      ["jailed", null, 0, false],
    ],
  );
  const top = rows[0]!;
  assert.equal(top.cumulative, 0.5);
  assert.equal(rows[1]!.cumulative, 0.9);
  assert.equal(rows[3]!.cumulative, null);
  // Signing info joined through the derived consensus address.
  assert.equal(top.consensusAddress, YNUKA_SIGNING.address);
  assert.equal(top.accountAddress, "addr_safro1q4c4p0n66crlkgagr76mjtnmt4d8pdlq3gcr9j");
  assert.equal(top.uptime, 0.9999);
  assert.equal(top.missedBlocks, 1);
  assert.equal(top.tombstoned, false);
  // No key to derive from: unknown, not perfect.
  assert.equal(rows[1]!.uptime, null);
  assert.equal(rows[1]!.tombstoned, null);
  // APR: chain × (1 − commission); a jailed validator pays nothing.
  assert.ok(Math.abs((top.apr ?? 0) - 0.18 * 0.9) < 1e-12);
  assert.equal(rows[3]!.apr, 0);
  assert.equal(top.commission.reachable30d, 0.2);
});

test("without signing infos, uptime and tombstone stay unknown", () => {
  const ynuka = parseValidator(YNUKA)!;
  const [row] = buildValidatorRows([ynuka], null, { accountPrefix: "addr_safro", window: 10_000, chainApr: null, now: NOW });
  assert.equal(row!.uptime, null);
  assert.equal(row!.tombstoned, null);
  assert.equal(row!.apr, null);
});

test("summary: active set, cutoff when full, concentration figures", () => {
  const rows = buildValidatorRows(
    [raw("a", "500"), raw("b", "300", { commission: { rate: 0.1, maxRate: 0.2, maxChangeRate: 0.01, updatedAt: null } }), raw("c", "200")],
    null,
    { accountPrefix: "x", window: 100, chainApr: 0.1, now: NOW },
  );
  const full = summariseValidators(rows, { maxValidators: 3, aprActual: 0.1, signedBlocksWindow: 100 });
  assert.equal(full.active, 3);
  assert.equal(full.activeSetFull, true);
  assert.equal(full.cutoffTokens, "200");
  assert.equal(full.nakamoto, 1);
  assert.equal(full.top10Share, 1);
  assert.equal(full.medianCommission, 0.05);
  assert.equal(full.bondedTokens, "1000");
  const open = summariseValidators(rows, { maxValidators: 100, aprActual: null, signedBlocksWindow: null });
  assert.equal(open.activeSetFull, false);
  assert.equal(open.cutoffTokens, null);
});

test("a validator with unreadable commission is dropped, never shown at a made-up 0 %", () => {
  const rates = YNUKA.commission.commission_rates;
  const without = (patch: Partial<typeof rates>) =>
    parseValidator({ ...YNUKA, commission: { ...YNUKA.commission, commission_rates: { ...rates, ...patch } } });
  assert.equal(without({ rate: "" }), null);
  assert.equal(without({ max_rate: "n/a" }), null);
  assert.equal(without({ max_change_rate: "" }), null);
  assert.ok(without({}));
});

test("signing infos join by bytes under the chain's own consensus prefix (Crypto.org)", () => {
  // Crypto.org "Hostenga.com" as its LCD returned it on 2026-10-07.
  const hostenga = parseValidator({
    ...YNUKA,
    operator_address: "crocncl1qz7k6tlc37u02yw95pp2rx2dgw0uraxaxne0v8",
    consensus_pubkey: { "@type": "/cosmos.crypto.ed25519.PubKey", key: "GBwVwPARM2HauwBFKmk0b36/FWu03j85ssKrwmms9fs=" },
  });
  const info = parseSigningInfo({
    address: "crocnclcons1angd4k6prqg49g233fdn28v0vuaxs6v9y3jmv8",
    start_height: "3393972",
    index_offset: "28767681",
    jailed_until: "1970-01-01T00:00:00Z",
    tombstoned: false,
    missed_blocks_counter: "5",
  });
  assert.ok(hostenga && info);
  const index = signingIndex([info]);
  assert.equal(index.prefix, "crocnclcons");
  const [row] = buildValidatorRows([hostenga], index, { accountPrefix: "cro", window: 10_000, chainApr: 0.04, now: NOW });
  assert.equal(row!.consensusAddress, "crocnclcons1angd4k6prqg49g233fdn28v0vuaxs6v9y3jmv8");
  assert.equal(row!.accountAddress, "cro1qz7k6tlc37u02yw95pp2rx2dgw0uraxa976xwm");
  assert.equal(row!.uptime, 0.9995);
  assert.equal(row!.tombstoned, false);
  // Without any signing info read, the prefix still follows the operator's.
  const [alone] = buildValidatorRows([hostenga], null, { accountPrefix: "cro", window: 10_000, chainApr: 0.04, now: NOW });
  assert.equal(alone!.consensusAddress, "crocnclcons1angd4k6prqg49g233fdn28v0vuaxs6v9y3jmv8");
  assert.equal(alone!.uptime, null);
  // A signing info whose address is not bech32 cannot be joined.
  assert.equal(parseSigningInfo({ ...YNUKA_SIGNING, address: "nope" }), null);
});

test("inactive validators have no uptime: their counter was reset when jailed", () => {
  const ynuka = parseValidator(YNUKA)!;
  // Jailed for downtime: x/slashing zeroed its counter, which reads as 100 %.
  const info = parseSigningInfo({ ...YNUKA_SIGNING, missed_blocks_counter: "0", jailed_until: "2026-10-05T08:17:19Z" })!;
  const [row] = buildValidatorRows([{ ...ynuka, status: "unbonding", jailed: true }], signingIndex([info]), {
    accountPrefix: "addr_safro",
    window: 10_000,
    chainApr: 0.18,
    now: NOW,
  });
  assert.equal(row!.uptime, null);
  assert.equal(row!.missedBlocks, null);
  assert.equal(row!.signedWindow, null);
  // What the signing info does say still shows.
  assert.equal(row!.jailedUntil, "2026-10-05T08:17:19Z");
  assert.equal(row!.tombstoned, false);
  assert.equal(row!.apr, 0);
});
