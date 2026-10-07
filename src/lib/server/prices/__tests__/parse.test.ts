/**
 * Reading the market-data sources: unknown is null, never zero; rows that do
 * not read are dropped, never guessed.
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  barCloses,
  candleClose,
  finite,
  osmosisDenomKey,
  parseCoinstoreKlines,
  parseGeckoChart,
  parseGeckoFx,
  parseGeckoMarkets,
  parseGeckoSimple,
  parseNumiaChart,
  parseNumiaTokens,
  quoteFromBars,
  type Bar,
} from "../parse";

const HOUR = 3_600_000;

describe("Numia", () => {
  it("reads token rows, keeping unknowns as null", () => {
    const rows = parseNumiaTokens([
      {
        symbol: "OSMO",
        denom: "uosmo",
        name: "Osmosis",
        exponent: 6,
        coingecko_id: "osmosis",
        price: 0.0354,
        price_24h_change: -2.75,
        price_7d_change: -3.4,
        volume_24h: 124910.1,
        liquidity: 2205221.3,
        coingecko_mcap: 28008378.1,
      },
      // A listing with no price: still a row, price null (never 0).
      { symbol: "SAF", denom: "ibc/dbaa4846f611a7603efc0ab6c6d3b6b5ba1376c3f8dd0f2c64d8b5c66fb6e1a8", price: null, liquidity: 0 },
      { symbol: "", denom: "uxyz", price: 1 },
      { denom: "unosymbol", price: 1 },
      "not a row",
      { symbol: "ZERO", denom: "uzero", price: 0, exponent: 99 },
    ]);
    assert.equal(rows.length, 3);
    assert.deepEqual(rows[0], {
      symbol: "OSMO",
      denom: "uosmo",
      name: "Osmosis",
      exponent: 6,
      coinGeckoId: "osmosis",
      price: 0.0354,
      change24h: -2.75,
      change7d: -3.4,
      volume24h: 124910.1,
      liquidity: 2205221.3,
      marketCap: 28008378.1,
    });
    assert.equal(rows[1]?.price, null);
    assert.equal(rows[1]?.denom, "ibc/DBAA4846F611A7603EFC0AB6C6D3B6B5BA1376C3F8DD0F2C64D8B5C66FB6E1A8");
    assert.equal(rows[1]?.change24h, null);
    assert.equal(rows[2]?.price, null, "a zero price is not a price");
    assert.equal(rows[2]?.exponent, null, "an impossible exponent is unknown");
    assert.deepEqual(parseNumiaTokens({ error: "nope" }), []);
  });

  it("stamps each close at the end of its candle, oldest first, without duplicates", () => {
    const now = 1791331200_000 + 16 * 60_000; // 00:16, inside the 00:00 candle
    const points = parseNumiaChart(
      [
        { time: 1791327600, close: 0.0354 },
        { time: 1791324000, close: 0.0353, open: 1 },
        { time: 1791324000, close: 0.0353 },
        { time: 1791320400, close: "bad" },
        { time: -5, close: 1 },
        // The candle still forming: its close is the price at the read time.
        { time: 1791331200, close: 0.0355 },
        // A candle from the future (clock skew) is not a price.
        { time: 1791334800, close: 9 },
      ],
      HOUR,
      now,
    );
    assert.deepEqual(points, [
      { t: 1791324000_000 + HOUR, v: 0.0353 },
      { t: 1791327600_000 + HOUR, v: 0.0354 },
      { t: now, v: 0.0355 },
    ]);
  });

  it("never puts a daily close on the morning it opened", () => {
    // Daily candles keyed by their 00:00 UTC start: the close of Oct 5's
    // candle is the price at Oct 6 00:00, so a grid point at Oct 5 00:00
    // must not see it.
    const day = 24 * HOUR;
    const oct5 = Date.UTC(2026, 9, 5);
    const points = parseNumiaChart(
      [
        { time: oct5 / 1000 - 86_400, close: 1 },
        { time: oct5 / 1000, close: 2 },
      ],
      day,
      oct5 + 2 * day,
    );
    assert.deepEqual(points, [
      { t: oct5, v: 1 },
      { t: oct5 + day, v: 2 },
    ]);
    assert.equal(candleClose(oct5, day, 3, oct5 + 3 * HOUR)?.t, oct5 + 3 * HOUR, "the forming candle closes now");
    assert.equal(candleClose(oct5, day, 3, oct5), null, "a candle that has not started is no price");
  });

  it("normalises ibc hashes for matching only", () => {
    assert.equal(osmosisDenomKey("ibc/27394fb0"), "ibc/27394FB0");
    assert.equal(osmosisDenomKey("factory/osmo1abc/alloyed/allUSDC"), "factory/osmo1abc/alloyed/allUSDC");
  });
});

describe("Coinstore", () => {
  it("reads candles oldest first and skips the unreadable", () => {
    const bars = parseCoinstoreKlines({
      code: 0,
      data: {
        item: [
          { startTime: 7200, open: "0.0003", close: "0.00028", amount: "100.5" },
          { startTime: 3600, open: "0.00031", close: "0.0003", amount: "50" },
          { startTime: 10800, open: "x", close: "0.0003" },
        ],
      },
    });
    assert.deepEqual(bars, [
      { t: 3600_000, open: 0.00031, close: 0.0003, quoteVolume: 50 },
      { t: 7200_000, open: 0.0003, close: 0.00028, quoteVolume: 100.5 },
    ]);
    assert.deepEqual(parseCoinstoreKlines({ data: {} }), []);
  });

  it("turns candles into closes at each candle's end, scaled from USDT", () => {
    const bars: Bar[] = [
      { t: 0, open: 1, close: 2, quoteVolume: 0 },
      { t: HOUR, open: 2, close: 4, quoteVolume: 0 },
    ];
    assert.deepEqual(barCloses(bars, HOUR, HOUR + 60_000, 0.5), [
      { t: HOUR, v: 1 },
      { t: HOUR + 60_000, v: 2 },
    ]);
  });

  it("quotes the last close against the first open inside each window", () => {
    // 8 days of hourly candles, price stepping from 1.00 up by 0.01 per hour.
    const bars: Bar[] = Array.from({ length: 8 * 24 }, (_, i) => ({
      t: i * HOUR,
      open: 1 + i * 0.01,
      close: 1 + (i + 1) * 0.01,
      quoteVolume: 10,
    }));
    const quote = quoteFromBars(bars);
    assert.ok(quote);
    const last = bars[bars.length - 1] as Bar;
    const open24 = bars[bars.length - 24] as Bar;
    const open7d = bars[bars.length - 7 * 24] as Bar;
    assert.equal(quote.price, last.close);
    assert.ok(Math.abs((quote.change24h ?? 0) - ((last.close - open24.open) / open24.open) * 100) < 1e-9);
    assert.ok(Math.abs((quote.change7d ?? 0) - ((last.close - open7d.open) / open7d.open) * 100) < 1e-9);
    assert.equal(quote.volume24h, 24 * 10);
  });

  it("has no 7-day change when the candles do not reach back a week", () => {
    const bars: Bar[] = Array.from({ length: 30 }, (_, i) => ({ t: i * HOUR, open: 1, close: 1.1, quoteVolume: 1 }));
    const quote = quoteFromBars(bars);
    assert.ok(quote);
    assert.equal(quote.change7d, null);
    assert.notEqual(quote.change24h, null);
    assert.equal(quoteFromBars([]), null);
  });

  it("measures 24 h by time, not by candle count, when hours are missing", () => {
    // Only 3 candles in the last day; the 24 h open is the first of them.
    const bars: Bar[] = [
      { t: 0, open: 5, close: 5, quoteVolume: 1 },
      { t: 30 * HOUR, open: 2, close: 2.2, quoteVolume: 1 },
      { t: 40 * HOUR, open: 2.2, close: 2.4, quoteVolume: 1 },
      { t: 50 * HOUR, open: 2.4, close: 3, quoteVolume: 1 },
    ];
    const quote = quoteFromBars(bars);
    assert.ok(quote);
    assert.ok(Math.abs((quote.change24h ?? 0) - 50) < 1e-9, String(quote.change24h));
    assert.equal(quote.volume24h, 3);
  });
});

describe("CoinGecko", () => {
  it("reads simple prices and drops ids without a USD price", () => {
    const quotes = parseGeckoSimple({
      cosmos: { usd: 1.79, usd_24h_change: -1.35 },
      osmosis: { usd: 0.0354 },
      broken: { usd: "n/a" },
    });
    assert.deepEqual([...quotes.entries()], [
      ["cosmos", { usd: 1.79, change24h: -1.35 }],
      ["osmosis", { usd: 0.0354, change24h: null }],
    ]);
  });

  it("derives USD→EUR/GBP from Tether, refusing implausible rates", () => {
    const fx = parseGeckoFx({ tether: { usd: 0.999954, eur: 0.888259, gbp: 0.753482 } });
    assert.ok(fx);
    assert.ok(Math.abs(fx.eur - 0.888259 / 0.999954) < 1e-12);
    assert.ok(Math.abs(fx.gbp - 0.753482 / 0.999954) < 1e-12);
    assert.equal(parseGeckoFx({ tether: { usd: 1, eur: 88, gbp: 0.75 } }), null);
    assert.equal(parseGeckoFx({}), null);
  });

  it("reads supply and all-time figures, unknown as null", () => {
    const markets = parseGeckoMarkets([
      {
        id: "cosmos",
        market_cap: 953959359,
        circulating_supply: 534612105.25,
        total_supply: 534636408.58,
        total_volume: 41526273,
        ath: 43.84,
        ath_change_percentage: -95.93,
        ath_date: "2021-09-19T16:00:00.000Z",
      },
      { id: "thin", market_cap: 0, circulating_supply: null, ath: "x", ath_date: "never" },
      { market_cap: 1 },
    ]);
    assert.equal(markets.size, 2);
    assert.deepEqual(markets.get("cosmos"), {
      marketCap: 953959359,
      circulatingSupply: 534612105.25,
      totalSupply: 534636408.58,
      volume24h: 41526273,
      ath: 43.84,
      athChangePct: -95.93,
      athAt: Date.UTC(2021, 8, 19, 16),
    });
    assert.deepEqual(markets.get("thin"), {
      marketCap: null,
      circulatingSupply: null,
      totalSupply: null,
      volume24h: null,
      ath: null,
      athChangePct: null,
      athAt: null,
    });
    assert.equal(parseGeckoMarkets({ error: "rate limited" }).size, 0);
  });

  it("reads market charts oldest first", () => {
    assert.deepEqual(parseGeckoChart({ prices: [[2000, 1.5], [1000, 1.4], [3000, null], "x"] }), [
      { t: 1000, v: 1.4 },
      { t: 2000, v: 1.5 },
    ]);
    assert.deepEqual(parseGeckoChart({}), []);
  });

  it("treats numeric strings as numbers and everything else as unknown", () => {
    assert.equal(finite("1.5"), 1.5);
    assert.equal(finite(""), null);
    assert.equal(finite("abc"), null);
    assert.equal(finite(Number.NaN), null);
    assert.equal(finite(null), null);
  });
});
