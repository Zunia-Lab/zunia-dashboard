/**
 * Decentralisation score: four transparent checks, unknown never scores,
 * ties go to the smaller validator.
 */

import assert from "node:assert/strict";
import { test } from "node:test";

import type { ValidatorLite } from "@/lib/chain/types";
import { cutoffRisk, decentralisationScore, rankByScore } from "../score";

function v(over: Partial<ValidatorLite>): ValidatorLite {
  return {
    operatorAddress: "x",
    moniker: "x",
    status: "bonded",
    jailed: false,
    tombstoned: false,
    commissionRate: 0.05,
    commissionMaxRate: 0.2,
    commissionReachable30d: 0.2,
    uptime: 1,
    rank: 1,
    votingPower: 0.01,
    inNakamotoSet: false,
    apr: 0.1,
    ...over,
  };
}

test("each check is one point", () => {
  assert.equal(decentralisationScore(v({})).score, 4);
  assert.equal(decentralisationScore(v({ inNakamotoSet: true })).score, 3);
  assert.equal(decentralisationScore(v({ commissionRate: 0.1 })).score, 4);
  assert.equal(decentralisationScore(v({ commissionRate: 0.11 })).score, 3);
  assert.equal(decentralisationScore(v({ uptime: 0.985 })).score, 3);
  assert.equal(decentralisationScore(v({ jailed: true })).score, 3);
  assert.equal(decentralisationScore(v({ tombstoned: true })).score, 3);
});

test("missing data scores nothing and says so", () => {
  const scored = decentralisationScore(v({ uptime: null }));
  assert.equal(scored.score, 3);
  assert.equal(scored.checks.find((check) => check.id === "uptime")?.pass, null);
});

test("ranking: score first, then the smaller validator, then the name", () => {
  const list = [
    v({ moniker: "Whale", inNakamotoSet: true, votingPower: 0.2 }),
    v({ moniker: "Mid", votingPower: 0.02 }),
    v({ moniker: "Tiny", votingPower: 0.001 }),
    v({ moniker: "Pricey", commissionRate: 0.5, votingPower: 0.0001 }),
    v({ moniker: "Blind", votingPower: null }),
  ];
  assert.deepEqual(
    rankByScore(list, (item) => item).map((item) => item.moniker),
    ["Tiny", "Mid", "Blind", "Pricey", "Whale"],
  );
});

test("in a full set the bottom tenth comes last within its score", () => {
  const set = { activeSetFull: true, active: 100 };
  const list = [
    v({ moniker: "Edge", rank: 95, votingPower: 0.0001 }),
    v({ moniker: "Safe", rank: 60, votingPower: 0.002 }),
    v({ moniker: "Low", rank: 30, votingPower: 0.01, commissionRate: 0.5 }),
  ];
  assert.equal(cutoffRisk({ rank: 91 }, set), true);
  assert.equal(cutoffRisk({ rank: 90 }, set), false);
  assert.equal(cutoffRisk({ rank: 99 }, { activeSetFull: false, active: 100 }), false);
  assert.deepEqual(
    rankByScore(list, (item) => item, { atRisk: (item) => cutoffRisk(item, set) }).map((item) => item.moniker),
    ["Safe", "Edge", "Low"],
  );
});
