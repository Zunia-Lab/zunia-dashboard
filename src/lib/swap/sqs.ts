/**
 * Reading the Osmosis router's (SQS) answers.
 *
 * `/router/quote` and `/router/custom-direct-quote` answer in one shape
 * (verified against sqs.osmosis.zone on 2026-10-07):
 *
 * ```json
 * {"amount_in":{"denom":"uosmo","amount":"10000000"},"amount_out":"351505",
 *  "route":[{"pools":[{"id":1464,"type":2,"spread_factor":"0.0001",
 *            "token_out_denom":"ibc/498A…","taker_fee":"0.008","liquidity_cap":"10699"}],
 *            "in_amount":"10000000","out_amount":"351505"}],
 *  "effective_fee":"0.008","price_impact":"-0.000159389905375342",
 *  "in_base_out_quote_spot_price":"0.035439620491950298"}
 * ```
 *
 * The parser is ported from `@zunialab/interchain` swap.ts `parseRouterQuote`
 * (sdk 0.1.0), which the package does not export: same rules, so a quote the
 * dashboard prices reads exactly as the extension's does. `price_impact` is
 * negative when the trade moves the price against the user; the figures for
 * display flip it so a cost reads positive, and a rare favourable quote still
 * reads favourable (never an absolute value).
 *
 * `/tokens/metadata` is a map keyed by Osmosis denom whose rows carry
 * `symbol`, `name`, `decimals`, `preview` and `coingeckoId`, and nothing about
 * where a token comes from. It is a freshness filter and a decimals witness,
 * never a name: what a token *is* comes from token identity.
 *
 * Pure: the server module src/lib/server/swap/sqs.ts does the reading.
 */

import { isRecord } from "@/lib/swap/types";

/** Why a router answer could not be used. */
export class SqsAnswerError extends Error {
  /** `no-route`: the router priced nothing for this pair at this size. `malformed`: an answer this cannot read. */
  readonly code: "no-route" | "malformed";
  constructor(code: "no-route" | "malformed", message: string) {
    super(message);
    this.name = "SqsAnswerError";
    this.code = code;
  }
}

/** One pool leg of a split, with the router's fee data. */
export interface SqsPoolLeg {
  /** Decimal string (SQS sends a JSON number; normalised). */
  readonly poolId: string;
  readonly tokenOutDenom: string;
  /** LP fee as a decimal fraction string (`"0.002"` = 0.2%); `null` when not reported. */
  readonly spreadFactor: string | null;
  /** Osmosis taker fee as a decimal fraction string; `null` when not reported. */
  readonly takerFee: string | null;
  /** Raw poolmanager pool-type discriminant; kept numeric so a new type is not a parse failure. */
  readonly poolType: number | null;
}

/** One split of an order. */
export interface SqsSplit {
  readonly pools: readonly SqsPoolLeg[];
  readonly inAmount: string;
  readonly outAmount: string;
}

/** A router quote, normalised. */
export interface SqsQuote {
  readonly inDenom: string;
  readonly inAmount: string;
  readonly outAmount: string;
  readonly splits: readonly SqsSplit[];
  /**
   * `effective_fee`: Osmosis's taker fee over the order, as a decimal fraction
   * (`"0.008"` = 0.8%), each split weighted by its share and multi-pool routes
   * compounded. It does NOT include the pools' spread factors (the LP fee,
   * per leg as `spreadFactor`): on 2026-10-07 OSMO→ATOM through pool 1
   * (spread 0.2%, taker 0.8%) answered `0.008`. `null` when absent.
   */
  readonly effectiveFee: string | null;
  /** As the router reports it: negative when the trade moves the price against the user. */
  readonly priceImpact: string | null;
  /**
   * `in_base_out_quote_spot_price`: output **base units** per input base unit
   * (INJ, 18 decimals, to USDC, 6, reads `0.000000000008133` for $8.13). Use
   * {@link spotPriceInDisplayUnits} before showing it.
   */
  readonly spotPrice: string | null;
}

function asNonEmptyString(value: unknown): string | null {
  return typeof value === "string" && value.length > 0 ? value : null;
}

/**
 * A uint as a decimal string. SQS reports pool ids as JSON numbers, the LCD as
 * strings; a number is accepted only when it is a safe integer, so an id past
 * 2^53 fails loudly instead of being silently rounded.
 */
function asUintString(value: unknown): string | null {
  if (typeof value === "string") return /^[0-9]+$/.test(value) ? value : null;
  if (typeof value === "number") return Number.isSafeInteger(value) && value >= 0 ? String(value) : null;
  return null;
}

/** A decimal fraction such as `"0.008000000000000000"` or `"-0.00006"`. */
function asDecimalString(value: unknown): string | null {
  if (typeof value === "number") return Number.isFinite(value) ? String(value) : null;
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return /^-?[0-9]*\.?[0-9]+$/.test(trimmed) ? trimmed : null;
}

function parsePoolLeg(value: unknown): SqsPoolLeg | null {
  if (!isRecord(value)) return null;
  const poolId = asUintString(value.id) ?? asUintString(value.pool_id);
  const tokenOutDenom = asNonEmptyString(value.token_out_denom);
  if (poolId === null || tokenOutDenom === null) return null;
  return {
    poolId,
    tokenOutDenom,
    spreadFactor: asDecimalString(value.spread_factor),
    takerFee: asDecimalString(value.taker_fee),
    poolType: typeof value.type === "number" && Number.isFinite(value.type) ? value.type : null,
  };
}

/**
 * Parse a `/router/quote` or `/router/custom-direct-quote` body.
 *
 * @throws {@link SqsAnswerError} `malformed` when the amounts or the route
 *   array are missing; `no-route` when the router answered with no usable
 *   route, which is how it reports "priceable pair, but not at this size".
 */
export function parseSqsQuote(body: unknown): SqsQuote {
  if (!isRecord(body)) throw new SqsAnswerError("malformed", "router quote is not an object");
  const amountIn = isRecord(body.amount_in) ? body.amount_in : null;
  const inDenom = amountIn ? asNonEmptyString(amountIn.denom) : null;
  const inAmount = amountIn ? asUintString(amountIn.amount) : null;
  const outAmount = asUintString(body.amount_out);
  if (inDenom === null || inAmount === null || outAmount === null) {
    throw new SqsAnswerError("malformed", "router quote is missing amount_in or amount_out");
  }
  if (!Array.isArray(body.route)) throw new SqsAnswerError("malformed", "router quote has no route array");

  const splits: SqsSplit[] = [];
  for (const entry of body.route) {
    if (!isRecord(entry) || !Array.isArray(entry.pools)) continue;
    const legs: SqsPoolLeg[] = [];
    let broken = false;
    for (const pool of entry.pools) {
      const leg = parsePoolLeg(pool);
      // A leg that cannot be read makes the whole split unusable: a route with
      // a hole in it would misreport which pools the funds pass through.
      if (leg === null) {
        broken = true;
        break;
      }
      legs.push(leg);
    }
    if (broken || legs.length === 0) continue;
    splits.push({
      pools: legs,
      inAmount: asUintString(entry.in_amount) ?? inAmount,
      outAmount: asUintString(entry.out_amount) ?? outAmount,
    });
  }
  if (splits.length === 0) throw new SqsAnswerError("no-route", `the router returned no usable route for ${inDenom}`);

  return {
    inDenom,
    inAmount,
    outAmount,
    splits,
    effectiveFee: asDecimalString(body.effective_fee),
    priceImpact: asDecimalString(body.price_impact),
    spotPrice: asDecimalString(body.in_base_out_quote_spot_price),
  };
}

/** A fraction string as a percentage number, or `null` when absent or not finite. */
export function fractionToPercent(fraction: string | null): number | null {
  if (fraction === null) return null;
  const value = Number(fraction);
  return Number.isFinite(value) ? value * 100 : null;
}

/**
 * The router's price impact as a cost, in percent: positive when the trade
 * moves the price against the user. `null` when the router did not report
 * one, never a confident 0.
 */
export function priceImpactPercent(quote: Pick<SqsQuote, "priceImpact">): number | null {
  const percent = fractionToPercent(quote.priceImpact);
  if (percent === null) return null;
  const flipped = -percent;
  // `-0` would print as "-0%".
  return Object.is(flipped, -0) ? 0 : flipped;
}

/**
 * The router's spot price as display units of the output per display unit of
 * the input (`10^(decimalsIn − decimalsOut)` times the base-unit figure), or
 * `null` when it is absent, not a positive finite number, or either side's
 * decimals are unknown: a base-unit ratio shown as a price is off by the
 * difference in exponents (12 orders of magnitude for INJ against USDC).
 */
export function spotPriceInDisplayUnits(
  spotPrice: string | null,
  decimalsIn: number | null,
  decimalsOut: number | null,
): number | null {
  if (spotPrice === null || decimalsIn === null || decimalsOut === null) return null;
  if (!Number.isInteger(decimalsIn) || !Number.isInteger(decimalsOut)) return null;
  const value = Number(spotPrice) * 10 ** (decimalsIn - decimalsOut);
  return Number.isFinite(value) && value > 0 ? value : null;
}

/** The split carrying the most input: the one worth drawing as "the" route. */
export function largestSplit(splits: readonly SqsSplit[]): SqsSplit | null {
  let best: SqsSplit | null = null;
  let bestAmount = BigInt(-1);
  for (const split of splits) {
    const value = /^[0-9]+$/.test(split.inAmount) ? BigInt(split.inAmount) : BigInt(0);
    if (value > bestAmount) {
      bestAmount = value;
      best = split;
    }
  }
  return best;
}

/* -------------------------------------------------------------------------- *
 * /tokens/metadata
 * -------------------------------------------------------------------------- */

/** One row SQS lists (`preview: false`), as it describes it. */
export interface OsmosisListing {
  /** Denom on Osmosis: `uosmo`, `ibc/…`, `factory/…`. */
  readonly denom: string;
  /** SQS's symbol (`USDC.noble`): an alias users have seen, never the ticker shown. */
  readonly symbol: string;
  readonly name: string;
  /** SQS's exponent, compared with the identity's; a mismatch makes the decimals unknown. */
  readonly decimals: number;
  readonly coinGeckoId: string | null;
}

const LISTED_DENOM = /^[a-zA-Z][a-zA-Z0-9/:._-]{2,127}$/;
const MAX_SYMBOL = 24;
const MAX_NAME = 48;
const MAX_COINGECKO_ID = 64;

/** One SQS row, or `null` when it does not parse. Ported from zunia-extension lib/osmosis-assets.ts `toListing`. */
function toListing(denom: unknown, raw: unknown): OsmosisListing | null {
  if (typeof denom !== "string" || !LISTED_DENOM.test(denom)) return null;
  if (!isRecord(raw)) return null;
  const symbol = typeof raw.symbol === "string" ? raw.symbol.trim() : "";
  const decimals = raw.decimals;
  if (!symbol || typeof decimals !== "number" || !Number.isInteger(decimals)) return null;
  if (decimals < 0 || decimals > 30) return null;
  const name = typeof raw.name === "string" && raw.name.trim() ? raw.name.trim() : symbol;
  const rawId = typeof raw.coinGeckoId === "string" ? raw.coinGeckoId : raw.coingeckoId;
  const coinGeckoId =
    typeof rawId === "string" && /^[a-z0-9][a-z0-9-]*$/.test(rawId.trim()) && rawId.trim().length <= MAX_COINGECKO_ID
      ? rawId.trim()
      : null;
  return { denom, symbol: symbol.slice(0, MAX_SYMBOL), name: name.slice(0, MAX_NAME), decimals, coinGeckoId };
}

/**
 * Parse the router's `/tokens/metadata` body: unlisted (`preview` not exactly
 * `false`) and unparseable rows are skipped. Sorted by symbol, then denom.
 * Ported from zunia-extension lib/osmosis-assets.ts `parseOsmosisTokenMetadata`.
 */
export function parseOsmosisTokenMetadata(body: unknown): OsmosisListing[] {
  if (!isRecord(body)) return [];
  const out: OsmosisListing[] = [];
  for (const [denom, raw] of Object.entries(body)) {
    if (!isRecord(raw) || raw.preview !== false) continue;
    const listing = toListing(denom, raw);
    if (listing) out.push(listing);
  }
  return out.sort((a, b) => a.symbol.localeCompare(b.symbol) || a.denom.localeCompare(b.denom));
}
