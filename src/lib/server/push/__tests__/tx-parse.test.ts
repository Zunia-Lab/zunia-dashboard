/**
 * "What did this address receive?" against real Osmosis responses: a plain
 * fee transfer inside someone else's swap, and two relayer-delivered IBC
 * packets (a foreign token arriving as a voucher, a native token coming home).
 * Plus the cases that must stay silent: own transactions and failed ones.
 *
 * The fixture is read with fs, not imported: `pnpm test` runs with
 * `--conditions=import`, under which tsx's JSON handling breaks on Node 26.
 */

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";

import { composeIncoming, coinWords, formatBaseUnits, shortDenom } from "@/lib/server/push/compose";
import { flatEvents, parseCoinList, readIncoming } from "@/lib/server/push/tx-parse";

const FIXTURES = JSON.parse(
  readFileSync(join(process.cwd(), "src/lib/server/push/__tests__/fixtures/osmosis-txs.json"), "utf8"),
) as Record<string, Record<string, unknown>>;

const TREASURY = "osmo1gv86dp8wmnmmatdckgr5xkevnpmy4662stl5rm";
const SWAPPER = "osmo1zva9t8r8dkugkeytzjjd8fg345sh37ngrwg8mm";
const VOUCHER_RECEIVER = "osmo1nhj6ggsrtsn4cwjffyecgd82j8sf7y3c7z5pxv";
const HOME_RECEIVER = "osmo1k2udl7s6zcyh2qun6077zxwh2vfw7f795clggv";

test("a fee paid to the treasury inside another account's swap is an incoming transfer", () => {
  const incoming = readIncoming(FIXTURES.feeToTreasury, TREASURY);
  assert.ok(incoming);
  assert.equal(incoming.hash, "7B5E447B64067CF2E5E31D4921927156C3F9B9B913E06895239E0795D72B57F3");
  assert.equal(incoming.height, 72036807);
  assert.equal(incoming.at, Date.parse("2026-10-06T21:52:30Z"));
  assert.deepEqual(incoming.coins, [{ denom: "uosmo", amount: "500000" }]);
  assert.deepEqual(incoming.senders, [SWAPPER]);
  assert.equal(incoming.ibc, null);
  assert.equal(incoming.refund, false);
});

test("the signer's own transaction is never reported as incoming", () => {
  assert.equal(readIncoming(FIXTURES.feeToTreasury, SWAPPER), null);
});

test("a relayed IBC delivery is an arrival: credited voucher, packet channel and source sender", () => {
  const incoming = readIncoming(FIXTURES.ibcVoucherArrival, VOUCHER_RECEIVER);
  assert.ok(incoming);
  assert.deepEqual(incoming.coins, [
    { denom: "ibc/7D72341AF4AB0B2975BF933A425B81DAC2C940E50E7549207E2B3C6B14A9DAB2", amount: "950000" },
  ]);
  assert.deepEqual(incoming.ibc, {
    port: "transfer",
    channel: "channel-0",
    sender: "cosmos1nhj6ggsrtsn4cwjffyecgd82j8sf7y3cke83s7",
  });
});

test("a token returning home is credited in its native denom", () => {
  const incoming = readIncoming(FIXTURES.ibcReturnHome, HOME_RECEIVER);
  assert.ok(incoming);
  assert.deepEqual(incoming.coins, [
    { denom: "factory/osmo1q77cw0mmlluxu0wr29fcdd0tdnh78gzhkvhe4n6ulal9qvrtu43qtd0nh8/t7s", amount: "500000000" },
  ]);
  assert.equal(incoming.ibc?.channel, "channel-0");
});

test("failed transactions and unrelated addresses are silent", () => {
  assert.equal(readIncoming({ ...FIXTURES.feeToTreasury, code: 5 }, TREASURY), null);
  assert.equal(readIncoming(FIXTURES.feeToTreasury, "osmo1nobody"), null);
  assert.equal(readIncoming(null, TREASURY), null);
  assert.equal(readIncoming({ txhash: "nope" }, TREASURY), null);
});

test("base64 attributes from older nodes are decoded", () => {
  const b64 = (text: string) => Buffer.from(text).toString("base64");
  const tx = {
    txhash: "A".repeat(64),
    height: "10",
    code: 0,
    timestamp: "2026-10-07T00:00:00Z",
    events: [
      {
        type: "transfer",
        attributes: [
          { key: b64("recipient"), value: b64(TREASURY) },
          { key: b64("sender"), value: b64(SWAPPER) },
          { key: b64("amount"), value: b64("7uosmo,3uion") },
        ],
      },
    ],
  };
  assert.deepEqual(readIncoming(tx, TREASURY)?.coins, [
    { denom: "uosmo", amount: "7" },
    { denom: "uion", amount: "3" },
  ]);
  assert.equal(flatEvents(tx)[0].attributes[0][0], "recipient");
});

test("a merged transfer event (older nodes' logs) credits each amount to its own recipient", () => {
  // SDK ≤ 0.45 `logs` fold a multi-send into one event: (recipient, sender, amount) × n.
  const tx = {
    txhash: "B".repeat(64),
    height: "11",
    code: 0,
    timestamp: "2026-10-07T00:00:00Z",
    logs: [
      {
        events: [
          {
            type: "transfer",
            attributes: [
              { key: "recipient", value: SWAPPER },
              { key: "sender", value: HOME_RECEIVER },
              { key: "amount", value: "900000000uosmo" },
              { key: "recipient", value: TREASURY },
              { key: "sender", value: HOME_RECEIVER },
              { key: "amount", value: "5uosmo" },
            ],
          },
        ],
      },
    ],
  };
  const incoming = readIncoming(tx, TREASURY);
  assert.deepEqual(incoming?.coins, [{ denom: "uosmo", amount: "5" }], "not the 900 OSMO paid to someone else");
  assert.deepEqual(incoming?.senders, [HOME_RECEIVER]);
  assert.deepEqual(readIncoming(tx, SWAPPER)?.coins, [{ denom: "uosmo", amount: "900000000" }]);
});

test("coin lists parse strictly", () => {
  assert.deepEqual(parseCoinList("1uosmo,22ibc/27394FB092D2ECCD56123C74F36E4C1F926001CEADA9CA97EA622B25F41E5EB2"), [
    { amount: "1", denom: "uosmo" },
    { amount: "22", denom: "ibc/27394FB092D2ECCD56123C74F36E4C1F926001CEADA9CA97EA622B25F41E5EB2" },
  ]);
  assert.deepEqual(parseCoinList("abc, 12, 5u"), []);
});

test("amounts: base units to decimals without float math", () => {
  assert.equal(formatBaseUnits("500000", 6), "0.5");
  assert.equal(formatBaseUnits("12500000", 6), "12.5");
  assert.equal(formatBaseUnits("1234567890000", 6), "1,234,567.89");
  assert.equal(formatBaseUnits("1", 18), "0.000000000000000001", "a dust amount is never printed as 0");
  assert.equal(formatBaseUnits("1000000000000000000", 18), "1");
  assert.equal(formatBaseUnits("12", 0), "12");
  assert.equal(shortDenom("ibc/7D72341AF4AB0B2975BF933A425B81DAC2C940E50E7549207E2B3C6B14A9DAB2"), "ibc/7D72…DAB2");
});

test("named coins read as amounts; unnamed IBC vouchers stay in base units; spam names never appear", () => {
  assert.deepEqual(coinWords({ amount: "500000", denom: "uosmo", ticker: "OSMO", decimals: 6 }), {
    text: "0.5 OSMO",
    named: true,
  });
  assert.equal(
    coinWords({ amount: "950000", denom: "ibc/7D72341AF4AB0B2975BF933A425B81DAC2C940E50E7549207E2B3C6B14A9DAB2", ticker: null, decimals: null })?.text,
    "950000 base units of ibc/7D72…DAB2",
  );
  assert.equal(coinWords({ amount: "1", denom: "factory/osmo1x/www.claim-reward.example", ticker: null, decimals: null }), null);
});

test("composition: transfer, IBC arrival, refund, and spam that is not pushed", () => {
  const now = Date.parse("2026-10-07T00:00:00Z");
  const base = { chainId: "osmosis-1", chainName: "Osmosis", hash: "AB".repeat(32), at: now - 60_000, refund: false };
  const transfer = composeIncoming(
    { ...base, coins: [{ amount: "500000", denom: "uosmo", ticker: "OSMO", decimals: 6 }], senders: [SWAPPER], ibc: null },
    now,
  );
  assert.equal(transfer?.title, "Received 0.5 OSMO on Osmosis");
  assert.equal(transfer?.body, "From osmo1zva9…g8mm");
  assert.equal(transfer?.id, `transfer:${"AB".repeat(32)}`);
  assert.equal(transfer?.url, `/activity/${"AB".repeat(32)}?chainId=osmosis-1`);
  assert.equal(transfer?.data?.amount, "0.5 OSMO");

  const arrival = composeIncoming(
    {
      ...base,
      coins: [{ amount: "2000000", denom: "ibc/27394FB092D2ECCD56123C74F36E4C1F926001CEADA9CA97EA622B25F41E5EB2", ticker: "ATOM", decimals: 6 }],
      senders: ["osmo1escrow"],
      ibc: { sourceChainName: "Cosmos Hub", sender: "cosmos1nhj6ggsrtsn4cwjffyecgd82j8sf7y3cke83s7" },
    },
    now,
  );
  assert.equal(arrival?.kind, "ibc");
  assert.equal(arrival?.title, "Arrived from Cosmos Hub");
  assert.equal(arrival?.body, "2 ATOM landed on Osmosis from cosmos1nhj6…83s7.");

  const unlistedArrival = composeIncoming(
    { ...base, coins: [{ amount: "5", denom: "factory/osmo1x/t7s", ticker: null, decimals: null }], senders: [], ibc: { sourceChainName: null, sender: null } },
    now,
  );
  assert.equal(unlistedArrival?.title, "IBC transfer arrived on Osmosis");
  assert.equal(unlistedArrival?.body, "An unlisted token landed on Osmosis.");

  const refund = composeIncoming(
    { ...base, refund: true, coins: [{ amount: "1000000", denom: "uosmo", ticker: "OSMO", decimals: 6 }], senders: [], ibc: null },
    now,
  );
  assert.equal(refund?.title, "IBC transfer refunded");
  assert.equal(refund?.severity, "warning");

  const spam = composeIncoming(
    { ...base, coins: [{ amount: "1", denom: "factory/osmo1x/www.claim-reward.example", ticker: null, decimals: null }], senders: [SWAPPER], ibc: null },
    now,
  );
  assert.equal(spam, null, "a plain transfer of only unnameable tokens is not pushed");
});
