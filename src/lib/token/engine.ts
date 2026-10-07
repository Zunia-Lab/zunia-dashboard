/**
 * Token identity: the one place a bank denom becomes a name.
 *
 * Ported from zunia-extension lib/token-identity.ts @ 1453e7a. The rules are
 * unchanged; three things moved because this runs in a server process, not in
 * a wallet:
 *
 * - the facts cache (proven traces the table does not list) lives in process
 *   memory on `globalThis`, shared by every visitor, instead of
 *   `browser.storage.local`. The LCD reads behind it are cached by
 *   `lib/token/trace-resolver.ts` through `lib/server/cache.ts`;
 * - the trace resolver is injected (`identifyHeld(…, { resolver })`) instead
 *   of reaching into the engine's `denomResolver()`, so this module stays pure
 *   and `node:test` can drive it with a stub;
 * - there are no user-added chains server side, so nothing here can be renamed
 *   or proven by a chain a visitor typed in.
 *
 * Two facts drive the design (unchanged from the extension):
 *
 * 1. An `ibc/HASH` denom names a path, not a token. The same `uusdc` base is
 *    Noble USDC over Osmosis channel-750 and Axelar USDC over channel-208, so
 *    the issuer comes from the trace, never from "the first catalog chain that
 *    lists the base denom". The generated table and a verified channel walk
 *    are the only two sources, and both prove the trace hashes to the denom.
 * 2. The ticker names the origin and never the location. `USDC.n` is Noble's
 *    USDC on Noble, Osmosis and Injective alike; where it sits is a separate
 *    field (`heldOnChainId`).
 *
 * Display only. Nothing here may feed a signed message: message denoms come
 * from the bank or from the table's hash-verified `originDenom`, never from a
 * ticker and never from the catalog's lowercased erc20 spellings.
 */

import { sha256 } from "@noble/hashes/sha2.js";
import { bytesToHex, utf8ToBytes } from "@noble/hashes/utils.js";

import {
  catalogIconFor,
  catalogRows,
  currenciesOf,
  findCatalogEntry,
  findCurrencyOn,
  onCatalogInstalled,
  type CatalogCurrency,
  type CatalogEntry,
} from "./catalog";
import { IBC_CHANNEL_ROWS } from "./ibc-channels.generated";
import {
  CATALOG_LOGOS,
  TOKEN_CHAINS,
  TOKEN_GROUPS,
  TOKEN_LOGO_PREFIXES,
  TOKEN_LOGOS,
  TOKEN_ROWS,
  type TokenRowTuple,
} from "./registry.generated";
import { shortDenom, tokenKindLabel } from "./text";
import type { TokenKind, TokenProvenance } from "./types";

export type { TokenKind, TokenProvenance };
export { shortDenom, tokenKindLabel };

/* -------------------------------------------------------------------------- *
 * Public types
 * -------------------------------------------------------------------------- */

/** Bridge that carried a token into Cosmos, as its ticker tag. */
export type TokenBridge =
  | "axl"
  | "grv"
  | "wh"
  | "peggy"
  | "eureka"
  | "pica"
  | "rt"
  | "carbon"
  | "int3"
  | "thor";

/** Network a bridge carried a token from, when it is not Ethereum. */
export type SourceNetwork = "polygon" | "avax" | "arb" | "op" | "base" | "sol" | "bsc" | "tron";

/**
 * Where a token text is shown, see {@link tokenText}.
 * - `pill`: the second line of a token pill, `on Osmosis`.
 * - `row`: a list row's subtitle, `Noble USDC · on Osmosis`.
 * - `sentence`: inline prose, `USDC.n (Noble USDC) on Osmosis`.
 * - `a11y`: the accessible name, `USDC from Noble, on Osmosis`.
 */
export type TokenTextVariant = "pill" | "row" | "sentence" | "a11y";

/**
 * What a token is and where it is: the extension's full identity record. The
 * API hands browsers the trimmed `TokenIdentity` from `./types`
 * (`toTokenIdentity` in `./identity`). Display only: nothing here is signed.
 */
export interface HeldTokenIdentity {
  /** `${heldOnChainId}:${denom}`, the location key. */
  readonly key: string;
  /** Where the balance lives, or where a destination is delivered. */
  readonly heldOnChainId: string;
  /** The holding chain's display name ("Osmosis"), or its id when unknown. */
  readonly heldOnChainName: string;
  /** The exact bank denom, never case-folded. */
  readonly denom: string;
  readonly kind: TokenKind;
  /** The issuer chain, or `null` when it cannot be proven. */
  readonly originChainId: string | null;
  readonly originChainName: string | null;
  /**
   * The exact denom on the origin chain: from a hash-verified trace or the
   * table's source denom, never from the catalog's case-folded spelling.
   */
  readonly originDenom: string | null;
  /** IBC trace path on the holding chain (`transfer/channel-750`), `""` when none. */
  readonly path: string;
  /** Chain reached after each hop of `path`, same order; `null` where unknown. */
  readonly hopChainIds: readonly (string | null)[];
  readonly bridge: TokenBridge | null;
  readonly sourceNetwork: SourceNetwork | null;
  /** The asset without its issuer decorations: `USDC` for USDC.n and USDC.axl. */
  readonly family: string;
  /** `USDC.inj`, `ATOM`, `allUSDC`; `IBC·498A` when the origin is unknown. */
  readonly ticker: string;
  /** `Injective USDC`, `Alloyed USDC`, `Unknown token`. */
  readonly name: string;
  /** Display exponent; 0 when unknown, in which case amounts are base units. */
  readonly decimals: number;
  readonly decimalsKnown: boolean;
  /** A token logo. Never a chain logo for a token that is not that chain's coin. */
  readonly logoUrl: string | null;
  readonly coinGeckoId: string | null;
  /** Osmosis variant group (the alloy's denom), shared by every USDC variant. */
  readonly variantGroup: string | null;
  /** An Osmosis alloy (transmuter share), shown as `all` + family. */
  readonly alloyed: boolean;
  /** This asset's denom on osmosis-1: the held denom there, else the canonical voucher. */
  readonly osmosisDenom: string | null;
  /** Other names users have seen: SQS (`USDC.noble`), registry (`USDC.n`), legacy (`axlUSDC`). */
  readonly aliases: readonly string[];
  readonly provenance: TokenProvenance;
  /**
   * Origin and name both come from the registry, the table or a verified
   * channel walk. The only reason a seal or a "verified" line may be shown,
   * and the only way a voucher may take its origin's price.
   */
  readonly proven: boolean;
  /**
   * Something names the token: a chain's own coin, a currency its catalog row
   * lists, a table row, or a known bridge contract. False for a voucher
   * nothing traces, and for a denom nobody lists wherever it sits, which
   * anyone can mint (`factory/<self>/USDC.n`).
   */
  readonly listed: boolean;
  /** Held on a testnet; never an issuer, shown with a pill. */
  readonly testnet: boolean;
}

/** What {@link tickerFor} needs to name an asset. */
export interface TickerInput {
  readonly family: string;
  readonly originChainId: string | null;
  readonly bridge?: TokenBridge | null;
  readonly sourceNetwork?: SourceNetwork | null;
  readonly alloyed?: boolean;
}

/** One decoded row of the generated table. */
export interface TokenTableRow {
  readonly heldOnChainId: string;
  /** Bank denom on the holding chain (`ibc/` hashes uppercase). */
  readonly denom: string;
  /**
   * The issuer as the source lists it. On a multi-hop Osmosis row that is the
   * chain one hop back, which may only have relayed the token; identities
   * then name the further issuer when the table holds the relay's row.
   */
  readonly originChainId: string;
  /** The issuer's exact, hash-verified denom (see the extension's notes). */
  readonly originDenom: string;
  /** Trace path on the holding chain, `""` for a local denom. */
  readonly path: string;
  /** The trace's base denom (`wei` for Picasso ETH); equals originDenom for one hop. */
  readonly baseDenom: string;
  /** First hop's channel on the holding chain (`channel-122`); `null` for a light-client hop. */
  readonly channelId: string | null;
  /** Chain at the other end of `channelId`; `null` when there is no channel hop. */
  readonly counterpartyChainId: string | null;
  /** The same channel's id on that chain (`channel-8`). */
  readonly counterpartyChannelId: string | null;
  readonly family: string;
  readonly bridge: TokenBridge | null;
  readonly sourceNetwork: SourceNetwork | null;
  readonly alloyed: boolean;
  /** Osmosis lists the row as verified (every hub-chain row counts as verified). */
  readonly verified: boolean;
  /** Not flagged unstable or disabled by Osmosis. */
  readonly stable: boolean;
  readonly decimals: number;
  readonly logoUrl: string | null;
  readonly coinGeckoId: string | null;
  readonly variantGroup: string | null;
  readonly aliases: readonly string[];
}

/** One trace a resolver found. Results are re-checked here anyway. */
export interface ResolvedTrace {
  readonly baseDenom: string;
  readonly path: string;
  readonly originChainId: string | null;
  readonly hopChainIds?: readonly (string | null)[];
}

/**
 * A lookup that failed for a reason that says nothing about the voucher (a
 * timeout, a 5xx): remembered for minutes, not for the half hour a real miss
 * is, so one bad minute of a public LCD does not leave tokens unnamed.
 */
export interface TransientMiss {
  readonly transient: true;
}

/**
 * Point lookups of `ibc/` vouchers. Must answer at most `maxLookups` of the
 * denoms and leave the rest out; a denom left out is a miss unless marked
 * transient.
 */
export interface DenomTraceResolver {
  identifyDenoms(
    chainId: string,
    denoms: readonly string[],
    options?: { signal?: AbortSignal; maxLookups?: number },
  ): Promise<ReadonlyMap<string, ResolvedTrace | TransientMiss>>;
}

export interface IdentifyHeldOptions {
  readonly resolver: DenomTraceResolver;
  readonly signal?: AbortSignal;
}

/* -------------------------------------------------------------------------- *
 * The ticker rule
 * -------------------------------------------------------------------------- */

/** The venue chain the table's Osmosis rows describe. */
const OSMOSIS = "osmosis-1";

/** Families with several issuers of equal standing: always tagged, never bare. */
const MULTI_ISSUER: ReadonlySet<string> = new Set(["USDC", "USDT", "DAI", "ETH", "WBTC", "BTC"]);

/**
 * Issuer tags the ecosystem already uses (chain-registry #7918, Keplr, Skip).
 * Any other issuer falls back to its bech32 prefix, as Osmosis does.
 */
const ISSUER_TAG: ReadonlyMap<string, string> = new Map([
  ["noble-1", "n"],
  ["injective-1", "inj"],
  ["kava_2222-10", "kava"],
  ["osmosis-1", "osmo"],
]);

/** Ticker suffixes that decorate a family rather than name it (`USDC.e.matic.axl`). */
const DECORATIONS: ReadonlySet<string> = new Set([
  "n", "inj", "axl", "grv", "wh", "peggy", "pica", "eureka", "kava", "osmo", "noble", "atom",
  "eth", "sol", "avax", "matic", "polygon", "arb", "op", "base", "bsc", "tron", "rt", "int3",
  "carbon", "terra", "e", "gravity", "wormhole", "axelar", "cosmos",
]);

/** Keplr-style network prefixes on Axelar tickers (`PolygonUSDC.axl`). */
const NETWORK_PREFIX: ReadonlyMap<string, SourceNetwork> = new Map([
  ["Polygon", "polygon"],
  ["Avalanche", "avax"],
  ["Arbitrum", "arb"],
  ["Optimism", "op"],
  ["Base", "base"],
  ["Binance", "bsc"],
]);

/** Every bridge tag; a catalog symbol may already carry one (`LINK.axl`). */
const BRIDGES: ReadonlySet<TokenBridge> = new Set<TokenBridge>([
  "axl", "grv", "wh", "peggy", "eureka", "pica", "rt", "carbon", "int3", "thor",
]);
const NETWORKS: ReadonlySet<SourceNetwork> = new Set<SourceNetwork>([
  "polygon", "avax", "arb", "op", "base", "sol", "bsc", "tron",
]);
const isBridge = (value: string): value is TokenBridge => BRIDGES.has(value as TokenBridge);
const isNetwork = (value: string): value is SourceNetwork => NETWORKS.has(value as SourceNetwork);

/**
 * THORChain pool assets are `chain-asset[-contract]` (`eth-usdc-0xa0b8…`). The
 * first part is the network the asset lives on.
 */
const THOR_POOL = /^(eth|avax|base|bsc|tron|gaia|btc|bch|doge|ltc|xrp|sol)-/;
const THOR_NETWORK: ReadonlyMap<string, SourceNetwork> = new Map([
  ["avax", "avax"],
  ["base", "base"],
  ["bsc", "bsc"],
  ["tron", "tron"],
  ["sol", "sol"],
]);

export const NETWORK_NAME: Readonly<Record<SourceNetwork, string>> = {
  polygon: "Polygon",
  avax: "Avalanche",
  arb: "Arbitrum",
  op: "Optimism",
  base: "Base",
  sol: "Solana",
  bsc: "BNB Chain",
  tron: "Tron",
};

/**
 * Ethereum contracts behind the Peggy (`peggy0x…`) and Gravity (`gravity0x…`)
 * denoms the catalog does not list, such as Injective's legacy Peggy USDC.
 * The denom embeds the contract, so the asset is known without a registry row.
 */
const ETHEREUM_TOKENS: ReadonlyMap<string, readonly [string, number]> = new Map([
  ["0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48", ["USDC", 6]],
  ["0xdac17f958d2ee523a2206206994597c13d831ec7", ["USDT", 6]],
  ["0xc02aaa39b223fe8d0a0e5c4f27ead9083c756cc2", ["ETH", 18]],
  ["0x2260fac5e5542a773aa44fbcfedf7c193bc2c599", ["WBTC", 8]],
  ["0x6b175474e89094c44da98b954eedeac495271d0f", ["DAI", 18]],
]);

/**
 * The asset a symbol names, without issuer decorations: `axlUSDC`,
 * `PolygonUSDC.axl`, `solana.USDC.wh`, `USDC.e.matic.axl` and `USDC.n` are all
 * `USDC`. Wrapped ETH goes to its root (`WETH` → `ETH`; WETH stays an alias),
 * and Tether's `USDt` is `USDT`.
 */
export function familyOf(symbol: string): string {
  let text = symbol.trim();
  text = text.replace(/^axl(?=[A-Z])/, "");
  text = text.replace(/^(Polygon|Avalanche|Arbitrum|Optimism|Base|Binance)(?=[A-Z])/, "");
  text = text.replace(/^(solana|avalanche|polygon|arbitrum|optimism|base|ethereum|binance|bsc)\.(?=[A-Za-z])/, "");
  const parts = text.split(".");
  while (parts.length > 1 && DECORATIONS.has((parts[parts.length - 1] ?? "").toLowerCase())) parts.pop();
  text = parts.join(".");
  if (/^usdt$/i.test(text)) return "USDT";
  if (/^usdc$/i.test(text)) return "USDC";
  if (/^w?eth$/i.test(text)) return "ETH";
  if (/^wbtc$/i.test(text)) return "WBTC";
  return text || symbol;
}

/* -------------------------------------------------------------------------- *
 * Derived state, dropped whenever the catalog or the facts change
 * -------------------------------------------------------------------------- */

let homeIssuers: Map<string, string> | null = null;
let table: TableIndex | null = null;
let canonicalHops: Set<string> | null = null;
let knownNames: ReadonlySet<string> | null = null;
let guards = new Map<string, Map<string, string>>();
const memo = new Map<string, HeldTokenIdentity>();
let memoGeneration = -1;
const MEMO_MAX = 4_000;

onCatalogInstalled(() => {
  homeIssuers = null;
  table = null;
  knownNames = null;
  guards = new Map();
  memo.clear();
});

/**
 * The one mainnet chain whose staking coin is `family`. Chains that pay gas in
 * someone else's coin (an `ibc/` or `l2/` native) do not count, and when two
 * registry chains share a native ticker neither is home.
 */
function homeIssuerOf(family: string): string | undefined {
  if (!homeIssuers) {
    const byFamily = new Map<string, CatalogEntry[]>();
    for (const entry of catalogRows()) {
      if (entry.network !== "mainnet" || /^(ibc|l2)\//.test(entry.coinMinimalDenom)) continue;
      const key = familyOf(entry.coinDenom);
      byFamily.set(key, [...(byFamily.get(key) ?? []), entry]);
    }
    homeIssuers = new Map();
    for (const [key, entries] of byFamily) {
      const listed = entries.length > 1 ? entries.filter((entry) => entry.inCosmosRegistry) : entries;
      if (listed.length === 1 && listed[0]) homeIssuers.set(key, listed[0].chainId);
    }
  }
  return homeIssuers.get(family);
}

/** A testnet is never an issuer and never renames anyone. */
function isNeverIssuer(chainId: string): boolean {
  return findCatalogEntry(chainId)?.network === "testnet";
}

function issuerTag(chainId: string): string {
  return ISSUER_TAG.get(chainId) ?? (prefixOfChain(chainId) || chainId);
}

/**
 * The ticker for an asset, from its origin and never its location:
 * 1. an Osmosis alloy is `all` + family (`allUSDC`), so a bare USDC never shows;
 * 2. a bridged asset takes the bridge tag, plus the source network for a
 *    multi-issuer family when it is not Ethereum (`USDC.axl.polygon`);
 * 3. a multi-issuer family minted on a chain takes the issuer tag (`USDC.n`);
 * 4. any other family is bare on its home issuer (`ATOM` on the Hub) and
 *    tagged elsewhere (`ATOM.thor`);
 * 5. a testnet origin is never tagged.
 * Same-chain duplicates are separated afterwards by the collision guard.
 */
export function tickerFor(input: TickerInput): string {
  const family = input.family;
  if (input.alloyed) return `all${family}`;
  if (input.originChainId && isNeverIssuer(input.originChainId)) return family;
  if (input.bridge) {
    const network = input.sourceNetwork && MULTI_ISSUER.has(family) ? `.${input.sourceNetwork}` : "";
    return `${family}.${input.bridge}${network}`;
  }
  if (!input.originChainId) return family;
  if (MULTI_ISSUER.has(family)) return `${family}.${issuerTag(input.originChainId)}`;
  const home = homeIssuerOf(family);
  return !home || home === input.originChainId ? family : `${family}.${issuerTag(input.originChainId)}`;
}

/**
 * Family, bridge and network of a catalog currency issued on its own chain.
 * `denom` is the held spelling; the catalog's may differ in case for erc20.
 * A hash-verified table row about the same asset wins over the symbol, so the
 * issuer and every chain holding a voucher read the same ticker.
 */
function catalogTraits(
  entry: CatalogEntry,
  currency: CatalogCurrency,
  denom: string = currency.coinMinimalDenom,
): { family: string; bridge: TokenBridge | null; sourceNetwork: SourceNetwork | null; alloyed: boolean } {
  const row = tableRow(entry.chainId, denom);
  if (row && row.originChainId === entry.chainId && !row.path) {
    return { family: row.family, bridge: row.bridge, sourceNetwork: row.sourceNetwork, alloyed: row.alloyed };
  }
  const issued = issuerRowOf(entry.chainId, denom) ?? issuerRowOf(entry.chainId, denom, true);
  if (issued) {
    return { family: issued.family, bridge: issued.bridge, sourceNetwork: issued.sourceNetwork, alloyed: false };
  }
  const symbol = currency.coinDenom;
  const prefix = /^(Polygon|Avalanche|Arbitrum|Optimism|Base|Binance)(?=[A-Z])/.exec(symbol)?.[1];
  let sourceNetwork: SourceNetwork | null = prefix ? (NETWORK_PREFIX.get(prefix) ?? null) : null;
  let bridge: TokenBridge | null = null;
  if (/^peggy0x/i.test(denom)) bridge = "peggy";
  else if (/^gravity0x/i.test(denom)) bridge = "grv";
  else if (entry.chainId === "thorchain-1" && THOR_POOL.test(denom)) {
    bridge = "thor";
    sourceNetwork = THOR_NETWORK.get(denom.split("-")[0] ?? "") ?? null;
  } else if (entry.chainId === "axelar-dojo-1" && denom !== entry.coinMinimalDenom) bridge = "axl";
  // Every token-factory denom on the Wormhole Gateway is the token bridge's.
  else if (entry.chainId === "wormchain" && denom.startsWith("factory/")) bridge = "wh";
  else {
    const tags = symbol.split(".").slice(1).map((tag) => tag.toLowerCase());
    bridge = [...tags].reverse().find(isBridge) ?? null;
  }
  return { family: familyOf(symbol), bridge, sourceNetwork, alloyed: false };
}

/** The ticker of a catalog currency on its own chain, under {@link tickerFor}. */
export function catalogTicker(entry: CatalogEntry, currency: CatalogCurrency): string {
  if (isNeverIssuer(entry.chainId)) return currency.coinDenom;
  const denom = currency.coinMinimalDenom;
  if (/^(ibc|l2)\//.test(denom)) {
    // Gas paid in someone else's coin: a voucher (moo-1's INIT) or what the
    // OPinit bridge minted on an Initia L2 (`l2/…`). The listing chain did
    // not issue it, so the ticker never carries that chain's tag.
    const proven = isIbcDenom(denom) ? identityOf(entry.chainId, denom) : undefined;
    if (proven && proven.provenance !== "unknown") return proven.ticker;
    const family = familyOf(currency.coinDenom);
    const home = homeIssuerOf(family);
    return home ? tickerFor({ family, originChainId: home }) : currency.coinDenom;
  }
  const traits = catalogTraits(entry, currency);
  return tickerFor({ ...traits, originChainId: entry.chainId });
}

/** The chain's staking ticker under the identity rule: `ATOM` on the Hub, `USDC.n` on Noble. */
export function chainTicker(chainId: string): string | null {
  const entry = findCatalogEntry(chainId);
  if (!entry) return null;
  return tickerOfCurrency(entry, entry.coinDenom, entry.coinMinimalDenom);
}

/** The fee ticker, with the same rule as {@link chainTicker}. */
export function feeTicker(chainId: string): string | null {
  const entry = findCatalogEntry(chainId);
  if (!entry) return null;
  if (!entry.feeDenom || entry.feeDenom === entry.coinDenom) return chainTicker(chainId);
  return tickerOfCurrency(entry, entry.feeDenom, entry.feeMinimalDenom);
}

function tickerOfCurrency(entry: CatalogEntry, symbol: string, minimalDenom?: string): string {
  const currency =
    (minimalDenom ? findCurrencyOn(entry.chainId, minimalDenom)?.currency : undefined) ??
    currenciesOf(entry).find((candidate) => candidate.coinDenom === symbol) ?? {
      coinDenom: symbol,
      coinMinimalDenom: minimalDenom ?? entry.coinMinimalDenom,
      coinDecimals: entry.coinDecimals,
    };
  return catalogTicker(entry, currency);
}

/**
 * The issuer a ticker describes. An `l2/…` denom is what Initia's OPinit
 * bridge minted for a deposit from L1: the L2 holds and mints it but did not
 * issue the asset.
 */
function tickerOriginOf(draft: Draft): string | null {
  if (draft.originDenom?.startsWith("l2/")) return homeIssuerOf(draft.family) ?? null;
  return draft.originChainId;
}

/**
 * The table row that proves `denom` is issued on `chainId`: a voucher whose
 * first hop lands on its issuer, so unwinding it delivers exactly this denom
 * there. `folded` matches erc20 and peggy spellings without case, for traits
 * only: a folded match is never a denom.
 */
function issuerRowOf(chainId: string, denom: string, folded = false): TokenTableRow | undefined {
  const index = tableIndex();
  if (!folded) return index.issuerRows.get(`${chainId}:${denomKey(denom)}`);
  const exact = index.issuerSpellings.get(`${chainId}:${foldDenom(denom)}`);
  return exact === undefined ? undefined : index.issuerRows.get(`${chainId}:${denomKey(exact)}`);
}

/* -------------------------------------------------------------------------- *
 * IBC arithmetic
 * -------------------------------------------------------------------------- */

/**
 * `ibc/` + uppercase sha256 of `path/baseDenom`, synchronously. The denom a
 * voucher has on the chain whose trace `path` is (ibc-go's DenomTrace.Hash).
 */
export function ibcDenomFor(path: string, baseDenom: string): string {
  const trimmed = path.replace(/^\/+|\/+$/g, "");
  const full = trimmed ? `${trimmed}/${baseDenom}` : baseDenom;
  return `ibc/${bytesToHex(sha256(utf8ToBytes(full))).toUpperCase()}`;
}

export const isIbcDenom = (denom: string): boolean => denom.startsWith("ibc/");

/** Table and cache key: `ibc/` hashes uppercase, every other denom exact. */
export function denomKey(denom: string): string {
  return isIbcDenom(denom) ? `ibc/${denom.slice(4).toUpperCase()}` : denom;
}

/** True when `path/baseDenom` hashes to `denom`. A trace that does not is rejected. */
export function traceMatches(denom: string, path: string, baseDenom: string): boolean {
  if (!isIbcDenom(denom) || !baseDenom) return false;
  return ibcDenomFor(path, baseDenom) === denomKey(denom);
}

function firstChannelOf(path: string): string | null {
  return /^[^/]+\/(channel-\d+)(?:\/|$)/.exec(path)?.[1] ?? null;
}

/* -------------------------------------------------------------------------- *
 * The generated table
 * -------------------------------------------------------------------------- */

interface TableIndex {
  readonly rows: readonly TokenTableRow[];
  readonly byKey: ReadonlyMap<string, TokenTableRow>;
  readonly byChain: ReadonlyMap<string, readonly TokenTableRow[]>;
  /** `${originChainId}:${originDenom}` → the canonical Osmosis voucher. */
  readonly osmosisByOrigin: ReadonlyMap<string, TokenTableRow>;
  /** `${originChainId}:${originDenom}` → the best voucher row whose first hop lands on its issuer. */
  readonly issuerRows: ReadonlyMap<string, TokenTableRow>;
  /** Issuer chain → the denoms `issuerRows` proves there. */
  readonly issuerDenoms: ReadonlyMap<string, readonly string[]>;
  /** `${originChainId}:${erc20 or peggy denom, lowercased}` → its one proven spelling. */
  readonly issuerSpellings: ReadonlyMap<string, string>;
  /** `${chainId}:${channelId}` → the chain at the other end, from first hops. */
  readonly channels: ReadonlyMap<string, string>;
  readonly chains: ReadonlyMap<string, readonly [string, string]>;
  /** Chain id → (denom, erc20 and peggy lowercased) → logo URL. */
  readonly catalogLogos: ReadonlyMap<string, ReadonlyMap<string, string>>;
}

function expandLogo(value: string | undefined): string | null {
  if (!value) return null;
  const prefix = /^\d/.test(value) ? TOKEN_LOGO_PREFIXES[Number(value[0])] : undefined;
  return prefix ? `${prefix}${value.slice(1)}` : value;
}

/** `122/52` → `transfer/channel-122/transfer/channel-52`; a full path stays as is. */
function expandPath(value: string): string {
  if (!/^\d+(\/\d+)*$/.test(value)) return value;
  return value
    .split("/")
    .map((channel) => `transfer/channel-${channel}`)
    .join("/");
}

function decodeRow(tuple: TokenRowTuple): TokenTableRow {
  const chainAt = (index: number) => TOKEN_CHAINS[index]?.[0] ?? "";
  const heldOnChainId = chainAt(tuple[0]);
  const denom = tuple[1];
  const originChainId = chainAt(tuple[2]);
  const originDenom = tuple[3] || denom;
  const path = expandPath(tuple[4]);
  const channelId = firstChannelOf(path);
  const flags = tuple[11];
  const alloyed = (flags & 1) !== 0;
  const aliases = tuple[16] ? tuple[16].split("|") : [];
  return {
    heldOnChainId,
    denom,
    originChainId,
    originDenom,
    path,
    baseDenom: tuple[5] || originDenom,
    channelId,
    // -1 means "the origin" only behind a channel: a light-client hop (the
    // Hub's Eureka `transfer/08-wasm-1369`) leads off Cosmos, to no chain id.
    counterpartyChainId: tuple[6] >= 0 ? chainAt(tuple[6]) : channelId ? originChainId : null,
    counterpartyChannelId: tuple[7] >= 0 ? `channel-${tuple[7]}` : null,
    family: familyOf(tuple[8]),
    bridge: isBridge(tuple[9]) ? tuple[9] : null,
    sourceNetwork: isNetwork(tuple[10]) ? tuple[10] : null,
    alloyed,
    verified: (flags & 2) !== 0,
    stable: (flags & 4) !== 0,
    decimals: tuple[12],
    logoUrl: tuple[13] >= 0 ? expandLogo(TOKEN_LOGOS[tuple[13]]) : null,
    coinGeckoId: tuple[14] || null,
    variantGroup: tuple[15] >= 0 ? (TOKEN_GROUPS[tuple[15]] ?? null) : alloyed ? denom : null,
    aliases,
  };
}

/** Lower is better when several Osmosis vouchers carry one origin asset. */
function osmosisRank(row: TokenTableRow): number {
  const hops = row.path.split("/").length / 2;
  return (row.verified ? 0 : 4) + (row.stable ? 0 : 2) + (hops > 1 ? 1 : 0);
}

function tableIndex(): TableIndex {
  if (table) return table;
  const rows = TOKEN_ROWS.map(decodeRow);
  const byKey = new Map<string, TokenTableRow>();
  const byChain = new Map<string, TokenTableRow[]>();
  const osmosisByOrigin = new Map<string, TokenTableRow>();
  const issuerRows = new Map<string, TokenTableRow>();
  const channels = new Map<string, string>();
  for (const row of rows) {
    byKey.set(`${row.heldOnChainId}:${denomKey(row.denom)}`, row);
    const list = byChain.get(row.heldOnChainId);
    if (list) list.push(row);
    else byChain.set(row.heldOnChainId, [row]);
    if (row.channelId && row.counterpartyChainId) {
      const key = `${row.heldOnChainId}:${row.channelId}`;
      if (!channels.has(key)) channels.set(key, row.counterpartyChainId);
    }
    if (row.heldOnChainId === OSMOSIS && row.path) {
      const key = `${row.originChainId}:${row.originDenom}`;
      const best = osmosisByOrigin.get(key);
      if (!best || osmosisRank(row) < osmosisRank(best)) osmosisByOrigin.set(key, row);
    }
    if (row.channelId && row.counterpartyChainId === row.originChainId && row.originChainId !== row.heldOnChainId) {
      // Osmosis rows first: its listing carries the verified flags and logos.
      const key = `${row.originChainId}:${denomKey(row.originDenom)}`;
      const best = issuerRows.get(key);
      const rank = (candidate: TokenTableRow) => (candidate.heldOnChainId === OSMOSIS ? 0 : 8) + osmosisRank(candidate);
      if (!best || rank(row) < rank(best)) issuerRows.set(key, row);
    }
  }
  const issuerDenoms = new Map<string, string[]>();
  const issuerSpellings = new Map<string, string>();
  for (const row of issuerRows.values()) {
    issuerDenoms.set(row.originChainId, [...(issuerDenoms.get(row.originChainId) ?? []), row.originDenom]);
    const folded = foldDenom(row.originDenom);
    if (folded !== row.originDenom) issuerSpellings.set(`${row.originChainId}:${folded}`, row.originDenom);
  }
  const chains = new Map<string, readonly [string, string]>(
    TOKEN_CHAINS.map(([id, name, prefix]) => [id, [name, prefix] as const]),
  );
  const catalogLogos = new Map<string, Map<string, string>>();
  for (const [chainId, dir, entries] of CATALOG_LOGOS) {
    const logos = new Map<string, string>();
    for (const entry of entries) {
      const denom = entry[0];
      const url =
        entry.length === 2
          ? expandLogo(TOKEN_LOGOS[entry[1]])
          : `${TOKEN_LOGO_PREFIXES[1]}${dir}/${denom.replace(/:/g, "/")}.png`;
      if (url) logos.set(foldDenom(denom), url);
    }
    catalogLogos.set(chainId, logos);
  }
  table = {
    rows,
    byKey,
    byChain,
    osmosisByOrigin,
    issuerRows,
    issuerDenoms,
    issuerSpellings,
    channels,
    chains,
    catalogLogos,
  };
  return table;
}

function tableRow(chainId: string, denom: string): TokenTableRow | undefined {
  return tableIndex().byKey.get(`${chainId}:${denomKey(denom)}`);
}

const foldDenom = (denom: string): string => (/^(erc20:|peggy)/i.test(denom) ? denom.toLowerCase() : denom);

function catalogLogo(chainId: string, denom: string): string | null {
  return tableIndex().catalogLogos.get(chainId)?.get(foldDenom(denom)) ?? null;
}

/** Rows of the generated table, all of them or those held on one chain. */
export function tokenTableRows(heldOnChainId?: string): readonly TokenTableRow[] {
  const index = tableIndex();
  return heldOnChainId ? (index.byChain.get(heldOnChainId) ?? []) : index.rows;
}

/**
 * The chain at the other end of `channelId` on `chainId`, from the table's
 * first hops and the channel walks this process has proven; `null` when unknown.
 */
export function channelCounterpartyOf(chainId: string, channelId: string): string | null {
  const known = tableIndex().channels.get(`${chainId}:${channelId}`);
  if (known) return known;
  for (const [key, fact] of factStore().facts) {
    if (!key.startsWith(`${chainId}:`) || firstChannelOf(fact.p) !== channelId) continue;
    const next = fact.h?.[0];
    if (next) return next;
  }
  return null;
}

/**
 * The asset's denom on osmosis-1: the origin denom when Osmosis is the issuer,
 * else the canonical voucher the table lists (verified and stable first). Exact
 * match only: the catalog's lowercase erc20 spelling finds nothing.
 */
export function osmosisDenomOf(originChainId: string, originDenom: string): string | null {
  if (!originChainId || !originDenom) return null;
  if (originChainId === OSMOSIS) return originDenom;
  return tableIndex().osmosisByOrigin.get(`${originChainId}:${originDenom}`)?.denom ?? null;
}

/* -------------------------------------------------------------------------- *
 * Chains
 * -------------------------------------------------------------------------- */

/** A chain the catalog or the token table names (the table also names issuers the catalog lacks, such as stargaze-1). */
export function isKnownChain(chainId: string): boolean {
  return findCatalogEntry(chainId) !== undefined || tableIndex().chains.has(chainId);
}

function chainNameOf(chainId: string): string {
  return findCatalogEntry(chainId)?.chainName ?? tableIndex().chains.get(chainId)?.[0] ?? chainId;
}

function prefixOfChain(chainId: string): string {
  return findCatalogEntry(chainId)?.bech32Prefix ?? tableIndex().chains.get(chainId)?.[1] ?? "";
}

let canonicalEnds: Map<string, string> | null = null;

/**
 * The chain at the far end of `channelId` on `chainId` when the registry names
 * that channel canonical, else `null`. The trace resolver walks such a hop
 * without a network read: the registry is the trust anchor a walk is proven
 * against anyway, so asking a light client to confirm it would add a request
 * and no evidence.
 */
export function canonicalCounterpartyOf(chainId: string, channelId: string): string | null {
  if (!canonicalEnds) {
    canonicalEnds = new Map();
    for (const [source, channel, dest] of IBC_CHANNEL_ROWS) canonicalEnds.set(`${source}|${channel}`, dest);
  }
  return canonicalEnds.get(`${chainId}|${channelId}`) ?? null;
}

/* -------------------------------------------------------------------------- *
 * The facts store: proven traces the table does not list
 * -------------------------------------------------------------------------- */

/** One proven trace. Facts, never labels, so a rule change needs no wipe. */
interface TraceFact {
  /** Origin chain id. */
  readonly o: string;
  /** Base denom on the origin. */
  readonly b: string;
  /** Trace path on the holding chain. */
  readonly p: string;
  /** Chain after each hop. */
  readonly h?: readonly (string | null)[];
  /** When it was learned, for trimming. */
  readonly at: number;
}

interface FactStore {
  facts: Map<string, TraceFact>;
  /** Denom key → epoch ms until which it is not asked about again. */
  misses: Map<string, number>;
  generation: number;
}

/** Process-wide; one visitor's walk names the token for every other visitor. */
const FACTS_MAX = 5_000;
const MISSES_MAX = 5_000;
/** A voucher that could not be traced is not asked about again for this long. */
const MISS_TTL_MS = 30 * 60_000;
/** A lookup that failed for reasons unrelated to the voucher is retried sooner. */
const TRANSIENT_MISS_TTL_MS = 2 * 60_000;
/**
 * Point lookups per call. The resolver stops there and returns the rest
 * unanswered, so only this many are asked, and only those can be a miss; the
 * others wait for the next balance read.
 */
export const MAX_LOOKUPS = 32;

const STORE_KEY = "__zuniaTokenIdentityFacts";

/** On `globalThis`, so Next's dev HMR does not forget what was proven. */
function factStore(): FactStore {
  const g = globalThis as unknown as Record<string, FactStore | undefined>;
  let store = g[STORE_KEY];
  if (!store) {
    store = { facts: new Map(), misses: new Map(), generation: 0 };
    g[STORE_KEY] = store;
  }
  return store;
}

const factKey = (chainId: string, denom: string): string => `${chainId}:${denomKey(denom)}`;

/** Forgets every learned trace and miss (tests; never needed in the app). */
export function resetIdentityFacts(): void {
  const store = factStore();
  store.facts.clear();
  store.misses.clear();
  store.generation += 1;
}

function trimMap<V>(map: Map<string, V>, max: number): void {
  // Map iteration is insertion order: the oldest learned go first.
  for (const key of map.keys()) {
    if (map.size <= max) break;
    map.delete(key);
  }
}

function isTransient(answer: ResolvedTrace | TransientMiss | undefined): answer is TransientMiss {
  return answer !== undefined && "transient" in answer && answer.transient === true;
}

/**
 * Identify a chain's held denoms, once per balance read. Denoms the table or
 * the catalog already name cost nothing; each remaining `ibc/` voucher gets one
 * point lookup (never a full trace sweep) whose trace must hash to the denom,
 * at most {@link MAX_LOOKUPS} per call. A voucher that was asked about and
 * could not be traced is not looked up again for {@link MISS_TTL_MS}.
 * Rejects only when `signal` aborts.
 */
export async function identifyHeld(
  chainId: string,
  denoms: readonly string[],
  options: IdentifyHeldOptions,
): Promise<ReadonlyMap<string, HeldTokenIdentity>> {
  const store = factStore();
  const now = Date.now();
  const wanted = [
    ...new Set(
      denoms.filter((denom) => {
        if (!isIbcDenom(denom) || identityOf(chainId, denom).provenance !== "unknown") return false;
        const until = store.misses.get(factKey(chainId, denom));
        return until === undefined || now >= until;
      }),
    ),
  ].slice(0, MAX_LOOKUPS);
  if (wanted.length > 0) {
    let found: ReadonlyMap<string, ResolvedTrace | TransientMiss> = new Map();
    let failedWhole = false;
    try {
      found = await options.resolver.identifyDenoms(chainId, wanted, {
        ...(options.signal ? { signal: options.signal } : {}),
        maxLookups: MAX_LOOKUPS,
      });
    } catch (error) {
      if (options.signal?.aborted) throw error;
      // The resolver itself failed (not one voucher): nothing was learned
      // about any of them, so ask again soon rather than in half an hour.
      failedWhole = true;
    }
    // A cancelled read proves nothing missing, even if the resolver returned.
    if (options.signal?.aborted) {
      throw new Error(`${chainId}: token identification cancelled`);
    }
    let learned = 0;
    for (const denom of wanted) {
      const hit = found.get(denom);
      if (failedWhole || isTransient(hit)) {
        store.misses.set(factKey(chainId, denom), now + TRANSIENT_MISS_TTL_MS);
        continue;
      }
      if (!hit?.originChainId || !traceMatches(denom, hit.path, hit.baseDenom)) {
        store.misses.set(factKey(chainId, denom), now + MISS_TTL_MS);
        continue;
      }
      store.facts.set(factKey(chainId, denom), {
        o: hit.originChainId,
        b: hit.baseDenom,
        p: hit.path,
        ...(hit.hopChainIds ? { h: [...hit.hopChainIds] } : {}),
        at: now,
      });
      learned += 1;
    }
    trimMap(store.misses, MISSES_MAX);
    if (learned > 0) {
      trimMap(store.facts, FACTS_MAX);
      store.generation += 1;
    }
  }
  return new Map(denoms.map((denom) => [denom, identityOf(chainId, denom)]));
}

/* -------------------------------------------------------------------------- *
 * Resolution
 * -------------------------------------------------------------------------- */

/** An identity before the ticker, the name and the guard are applied. */
interface Draft {
  readonly heldOnChainId: string;
  readonly denom: string;
  readonly kind: TokenKind;
  readonly originChainId: string | null;
  readonly originDenom: string | null;
  readonly path: string;
  readonly hopChainIds: readonly (string | null)[];
  /** The registry symbol, or a readable stand-in when `named` is false. */
  readonly symbol: string;
  readonly family: string;
  readonly bridge: TokenBridge | null;
  readonly sourceNetwork: SourceNetwork | null;
  readonly alloyed: boolean;
  readonly decimals: number | null;
  readonly logoUrl: string | null;
  readonly coinGeckoId: string | null;
  readonly variantGroup: string | null;
  readonly aliases: readonly string[];
  readonly provenance: TokenProvenance;
  /** The symbol comes from the catalog, the table or a known contract. */
  readonly named: boolean;
  /** Rank in the collision guard: lower keeps the bare ticker. */
  readonly rank: number;
  /** For a channel walk: every hop crossed a registry-canonical channel. */
  readonly walkCanonical?: boolean;
}

function kindOf(chainId: string, denom: string): TokenKind {
  if (isIbcDenom(denom)) return "ibc";
  if (denom.startsWith("factory/")) return "factory";
  if (/^erc20[:/]/i.test(denom)) return "erc20";
  if (/^peggy0x/i.test(denom)) return "peggy";
  if (/^cw20:/i.test(denom)) return "cw20";
  const entry = findCatalogEntry(chainId);
  if (entry && (denom === entry.coinMinimalDenom || denom === entry.feeMinimalDenom)) return "native";
  return "other";
}

function unknownDraft(chainId: string, denom: string): Draft {
  return {
    heldOnChainId: chainId,
    denom,
    kind: kindOf(chainId, denom),
    originChainId: null,
    originDenom: null,
    path: "",
    hopChainIds: [],
    symbol: "",
    family: "",
    bridge: null,
    sourceNetwork: null,
    alloyed: false,
    decimals: null,
    logoUrl: null,
    coinGeckoId: null,
    variantGroup: null,
    aliases: [],
    provenance: "unknown",
    named: false,
    rank: 9,
  };
}

/**
 * Decimals turn an amount into a value, so when the catalog and the table
 * disagree about one asset (Osmosis lists allSHIB at 12, the catalog at 18)
 * neither is trusted: the amount stays in base units and is never valued.
 */
function agreedDecimals(first: number | null, second: number | null | undefined): number | null {
  if (first === null || second === null || second === undefined) return first;
  return first === second ? first : null;
}

function hopsOf(row: TokenTableRow): (string | null)[] {
  if (!row.path) return [];
  const count = row.path.split("/").length / 2;
  return [row.counterpartyChainId, ...Array.from({ length: count - 1 }, () => null)];
}

/**
 * The row of the voucher a relay holds, when `row` reached its listed origin
 * through that relay rather than from the issuer (Osmosis lists LBTC as the
 * Hub's; the Hub's own row walks it on to Lombard). Adopted only when its
 * trace is exactly the rest of `row`'s, so both hashes prove one journey.
 */
function relayedRowOf(row: TokenTableRow): TokenTableRow | undefined {
  if (!row.path || row.originChainId === row.heldOnChainId) return undefined;
  const inner = tableRow(row.originChainId, row.originDenom);
  if (!inner?.channelId || inner.originChainId === inner.heldOnChainId) return undefined;
  const rest = row.path.split("/").slice(2).join("/");
  return inner.path === rest && inner.baseDenom === row.baseDenom ? inner : undefined;
}

function draftFromRow(row: TokenTableRow): Draft {
  // The identity names the issuer; the row keeps the hop delivery unwinds to.
  const relayed = relayedRowOf(row);
  const originChainId = relayed?.originChainId ?? row.originChainId;
  const originDenom = relayed?.originDenom ?? row.originDenom;
  return {
    heldOnChainId: row.heldOnChainId,
    denom: row.denom,
    kind: kindOf(row.heldOnChainId, row.denom),
    originChainId,
    originDenom,
    path: row.path,
    hopChainIds: relayed ? [row.counterpartyChainId, ...hopsOf(relayed)] : hopsOf(row),
    symbol: row.family,
    family: row.family,
    bridge: row.bridge,
    sourceNetwork: row.sourceNetwork,
    alloyed: row.alloyed,
    decimals: agreedDecimals(
      agreedDecimals(row.decimals, relayed?.decimals),
      findCurrencyOn(originChainId, originDenom)?.currency.coinDecimals,
    ),
    logoUrl: row.logoUrl,
    coinGeckoId: row.coinGeckoId,
    variantGroup: row.variantGroup,
    aliases: row.aliases,
    provenance: row.path ? "table" : "native",
    named: true,
    rank: row.verified && row.stable ? 1 : row.verified ? 2 : 3,
  };
}

function draftFromCatalog(
  chainId: string,
  denom: string,
  entry: CatalogEntry,
  currency: CatalogCurrency,
): Draft {
  // The same asset as the table knows it: a row held here, else the voucher
  // row that proves this exact denom on its issuer (what Osmosis trades).
  const row = tableRow(chainId, denom) ?? issuerRowOf(chainId, denom);
  const traits = catalogTraits(entry, currency, denom);
  const native = denom === entry.coinMinimalDenom || denom === entry.feeMinimalDenom;
  return {
    heldOnChainId: chainId,
    denom,
    kind: kindOf(chainId, denom),
    originChainId: chainId,
    originDenom: denom,
    path: "",
    hopChainIds: [],
    symbol: currency.coinDenom,
    family: traits.family,
    bridge: traits.bridge,
    sourceNetwork: traits.sourceNetwork,
    alloyed: traits.alloyed,
    decimals: agreedDecimals(currency.coinDecimals, row?.decimals),
    // A chain's own staking or fee coin wears the chain's mark when nothing
    // names a coin logo: there the chain logo is the token logo.
    logoUrl:
      (row?.heldOnChainId === chainId ? row.logoUrl : null) ??
      catalogLogo(chainId, denom) ??
      row?.logoUrl ??
      (native ? (catalogIconFor(entry) ?? null) : null),
    coinGeckoId: currency.coinGeckoId ?? row?.coinGeckoId ?? (native ? (entry.coinGeckoId ?? null) : null),
    variantGroup: row?.variantGroup ?? null,
    aliases: row?.aliases ?? [],
    provenance: native ? "native" : "catalog",
    named: true,
    rank: 0,
  };
}

/** The issuer's side of {@link issuerRowOf}: the voucher's trace minus its first hop. */
function issuerTrace(row: TokenTableRow): { path: string; base: string } {
  const path = row.path.split("/").slice(2).join("/");
  // A light-client hop (`transfer/08-wasm-1369/0x…`) stays inside the base on
  // the voucher's row; split it back out so the path reads as one.
  const hop = path ? null : /^([^/]+\/\d{2}-[a-z][a-z0-9]*-\d+)\/(.+)$/.exec(row.baseDenom);
  return hop ? { path: hop[1] ?? "", base: hop[2] ?? "" } : { path, base: row.baseDenom };
}

/**
 * A denom on its issuer that the catalog does not list but a table voucher
 * proves (Axelar's `polygon-uusdt`, Picasso's ETH voucher, the Hub's Eureka
 * ETH). Named exactly as that voucher. `undefined` when an `ibc/` denom's
 * derived trace does not hash back to it.
 */
function draftFromIssuerRow(chainId: string, denom: string, row: TokenTableRow): Draft | undefined {
  let path = "";
  if (isIbcDenom(denom)) {
    const trace = issuerTrace(row);
    if (!traceMatches(denom, trace.path, trace.base)) return undefined;
    path = trace.path;
  }
  return {
    heldOnChainId: chainId,
    denom,
    kind: kindOf(chainId, denom),
    originChainId: chainId,
    originDenom: denom,
    path,
    hopChainIds: path ? Array.from({ length: path.split("/").length / 2 }, () => null) : [],
    symbol: row.family,
    family: row.family,
    bridge: row.bridge,
    sourceNetwork: row.sourceNetwork,
    alloyed: row.alloyed,
    decimals: agreedDecimals(row.decimals, findCurrencyOn(chainId, denom)?.currency.coinDecimals),
    logoUrl: row.logoUrl,
    coinGeckoId: row.coinGeckoId,
    variantGroup: row.variantGroup,
    aliases: row.aliases,
    provenance: "table",
    named: true,
    rank: row.verified && row.stable ? 1 : row.verified ? 2 : 3,
  };
}

/**
 * The Ethereum bridges whose module mints `<prefix>0x<contract>` denoms, and
 * the one mainnet chain each runs on. Anywhere else (a testnet's Sepolia
 * contracts, a chain without the module) the same string proves nothing.
 */
const CONTRACT_BRIDGES: ReadonlyMap<string, readonly [string, TokenBridge]> = new Map([
  ["peggy", ["injective-1", "peggy"]],
  ["gravity", ["gravity-bridge-3", "grv"]],
]);

/**
 * A local denom no registry lists. It was minted on the chain that holds it
 * (only `ibc/` denoms travel), so the origin is known; the name is not, unless
 * the denom embeds a known Ethereum contract on the chain whose bridge mints
 * such denoms (`peggy0xA0b8…` on Injective is USDC).
 */
function draftFromLocal(chainId: string, denom: string): Draft {
  const base = unknownDraft(chainId, denom);
  if (!findCatalogEntry(chainId)) return base;
  const bridged = /^(peggy|gravity)(0x[0-9a-fA-F]{40})$/.exec(denom);
  const minter = bridged ? CONTRACT_BRIDGES.get(bridged[1] ?? "") : undefined;
  const known =
    bridged && minter?.[0] === chainId ? ETHEREUM_TOKENS.get((bridged[2] ?? "").toLowerCase()) : undefined;
  if (minter && known) {
    return {
      ...base,
      originChainId: chainId,
      originDenom: denom,
      symbol: known[0],
      family: known[0],
      bridge: minter[1],
      decimals: known[1],
      provenance: "native",
      named: true,
      rank: 0,
    };
  }
  const symbol = denom.startsWith("factory/") ? (denom.split("/").pop() ?? "") : "";
  return { ...base, originChainId: chainId, originDenom: denom, symbol, provenance: "native", rank: 5 };
}

/** Whether the registry names `channelId` on `chainId` as the canonical channel to `counterparty`. */
function isCanonicalHop(chainId: string, channelId: string, counterparty: string): boolean {
  canonicalHops ??= new Set(IBC_CHANNEL_ROWS.map(([source, channel, dest]) => `${source}|${channel}|${dest}`));
  return canonicalHops.has(`${chainId}|${channelId}|${counterparty}`);
}

/**
 * Whether a walked trace crossed only registry-canonical transfer channels,
 * hop by hop from the holding chain back to the origin. A hop whose far chain
 * the walk could not name fails the check.
 */
function walkedCanonically(holdingChainId: string, fact: TraceFact): boolean {
  const segments = fact.p.split("/");
  if (segments.length === 0 || segments.length % 2 !== 0) return false;
  let chain = holdingChainId;
  for (let hop = 0; hop < segments.length / 2; hop++) {
    const port = segments[hop * 2];
    const channel = segments[hop * 2 + 1];
    const next = fact.h?.[hop];
    if (port !== "transfer" || !channel || !next || !isCanonicalHop(chain, channel, next)) return false;
    chain = next;
  }
  return true;
}

/**
 * A voucher named from a proven channel walk: the asset is its origin's denom.
 * When the origin's base is unnamed, the holding chain's own catalog listing
 * of this exact voucher may name it; the walk still supplies the origin.
 */
function draftFromFact(chainId: string, denom: string, fact: TraceFact): Draft {
  const inner = localDraftOf(fact.o, fact.b);
  const canonical = tableIndex().osmosisByOrigin.get(`${fact.o}:${fact.b}`);
  const listed = inner.named ? undefined : findCurrencyOn(chainId, denom)?.currency;
  const unnamedSymbol = fact.b.startsWith("factory/") ? (fact.b.split("/").pop() ?? "") : "";
  return {
    ...inner,
    heldOnChainId: chainId,
    denom,
    kind: "ibc",
    originChainId: fact.o,
    originDenom: fact.b,
    path: fact.p,
    hopChainIds: fact.h ?? [],
    symbol: inner.named ? inner.symbol : (listed?.coinDenom ?? unnamedSymbol),
    family: inner.named ? inner.family : listed ? familyOf(listed.coinDenom) : inner.family,
    decimals: inner.named ? inner.decimals : (listed?.coinDecimals ?? null),
    named: inner.named || listed !== undefined,
    aliases: [...inner.aliases, ...(canonical?.aliases ?? [])],
    coinGeckoId: inner.coinGeckoId ?? listed?.coinGeckoId ?? canonical?.coinGeckoId ?? null,
    variantGroup: inner.variantGroup ?? canonical?.variantGroup ?? null,
    provenance: "channel-walk",
    // An unnamed walk never outranks a named token in the collision guard.
    rank: inner.named || listed !== undefined ? 4 : 6,
    walkCanonical: walkedCanonically(chainId, fact),
  };
}

/**
 * A denom as its own chain sees it: the catalog, a table row held there, the
 * voucher row that proves it on its issuer, else an unlisted local denom.
 * An erc20 or peggy spelling that differs only in case from the one the table
 * proves is a different bank denom, so it stays unknown instead of borrowing
 * USDC.inj through the catalog's case-folding.
 */
function localDraftOf(chainId: string, denom: string): Draft {
  const exact = tableIndex().issuerSpellings.get(`${chainId}:${foldDenom(denom)}`);
  if (exact !== undefined && exact !== denom) return unknownDraft(chainId, denom);
  const hit = findCurrencyOn(chainId, denom) ?? cw20Listing(chainId, denom);
  if (hit) return draftFromCatalog(chainId, denom, hit.entry, hit.currency);
  const row = tableRow(chainId, denom);
  if (row) return draftFromRow(row);
  const issued = issuerRowOf(chainId, denom);
  const fromIssuer = issued ? draftFromIssuerRow(chainId, denom, issued) : undefined;
  if (fromIssuer) return fromIssuer;
  return draftFromLocal(chainId, denom);
}

/**
 * The catalog row of a `cw20:<contract>` denom (how IBC spells a CW20) when
 * the catalog lists the contract bare: one token under two spellings.
 */
function cw20Listing(
  chainId: string,
  denom: string,
): { entry: CatalogEntry; currency: CatalogCurrency } | undefined {
  return denom.startsWith("cw20:") ? findCurrencyOn(chainId, denom.slice("cw20:".length)) : undefined;
}

/**
 * A packet denom (`transfer/channel-0/uatom`, or Eureka's
 * `transfer/08-wasm-1369/0x…`): the sender's trace, not a bank denom here.
 */
const PACKET_PATH = /^[^/]+\/(?:channel-\d+|\d{2}-[a-z][a-z0-9]*-\d+)\//;

/**
 * The resolution order: for a voucher, a table row held here, the voucher row
 * that proves it on its issuer, then the facts store; for a local denom, see
 * {@link localDraftOf}. A packet path is not a bank denom and stays unknown.
 */
function draftOf(chainId: string, denom: string): Draft {
  if (!chainId || !denom) return unknownDraft(chainId, denom);
  if (isIbcDenom(denom)) {
    const row = tableRow(chainId, denom);
    if (row) return draftFromRow(row);
    const issued = issuerRowOf(chainId, denom);
    const fromIssuer = issued ? draftFromIssuerRow(chainId, denom, issued) : undefined;
    if (fromIssuer) return fromIssuer;
    const fact = factStore().facts.get(factKey(chainId, denom));
    if (fact) return draftFromFact(chainId, denom, fact);
    return unknownDraft(chainId, denom);
  }
  if (PACKET_PATH.test(denom)) return unknownDraft(chainId, denom);
  return localDraftOf(chainId, denom);
}

/* -------------------------------------------------------------------------- *
 * Tickers, the collision guard and the final identity
 * -------------------------------------------------------------------------- */

function unknownTicker(denom: string): string {
  return isIbcDenom(denom) ? `IBC·${denom.slice(4, 8).toUpperCase()}` : shortDenom(denom);
}

/**
 * Four characters that tell two denoms apart: the start of an `ibc/` hash,
 * else the start of the denom's own sha256 (a factory subdenom is free text
 * its creator picked, so it cannot be the tag).
 */
export function hashTag(denom: string): string {
  const hex = isIbcDenom(denom) ? denom.slice(4) : bytesToHex(sha256(utf8ToBytes(denom)));
  return hex.slice(0, 4).toUpperCase() || "0000";
}

/**
 * Every name the registries give an asset, uppercased: catalog symbols, table
 * families and aliases, and the multi-issuer families. Bundled data only.
 */
function knownNameSet(): ReadonlySet<string> {
  if (knownNames) return knownNames;
  const names = new Set<string>(["IBC", ...MULTI_ISSUER]);
  const add = (symbol: string) => {
    if (!symbol) return;
    names.add(symbol.toUpperCase());
    names.add(familyOf(symbol).toUpperCase());
  };
  for (const row of tableIndex().rows) {
    add(row.family);
    row.aliases.forEach(add);
  }
  for (const entry of catalogRows()) {
    add(entry.coinDenom);
    for (const currency of currenciesOf(entry)) add(currency.coinDenom);
  }
  knownNames = names;
  return names;
}

/** True when free text claims a name the registries give a real asset. */
export function claimsKnownName(symbol: string): boolean {
  const known = knownNameSet();
  const words = [symbol, familyOf(symbol), symbol.split(".")[0] ?? "", symbol.replace(/^all(?=[A-Z])/, "")];
  return words.some((word) => word.length > 0 && known.has(word.toUpperCase()));
}

/**
 * The ticker of a token no registry names, from its own free text (a factory
 * subdenom). Anyone can mint `factory/osmo1…/USDC.n` and airdrop it, so when
 * that text claims a name the registries give a real asset, it carries a hash
 * of its denom (`USDC.n·3F2A`). `·` cannot occur in a denom, so the mark
 * cannot be forged.
 */
function unnamedTicker(draft: Draft): string {
  const symbol = draft.symbol;
  if (!symbol) return unknownTicker(draft.denom);
  return claimsKnownName(symbol) ? `${symbol}·${hashTag(draft.denom)}` : symbol;
}

/** A coin a testnet issued itself: shown under the symbol it was listed with. */
function ownSymbolOnly(draft: Draft): boolean {
  return draft.originChainId === null || isNeverIssuer(draft.originChainId);
}

function baseTicker(draft: Draft): string {
  if (draft.provenance === "unknown") return unknownTicker(draft.denom);
  if (!draft.named) return unnamedTicker(draft);
  if (ownSymbolOnly(draft)) return draft.symbol;
  return tickerFor({
    family: draft.family,
    originChainId: tickerOriginOf(draft),
    bridge: draft.bridge,
    sourceNetwork: draft.sourceNetwork,
    alloyed: draft.alloyed,
  });
}

/**
 * Tickers on one holding chain after the collision guard. Everything the
 * table, the catalog and the facts name there takes part. When several share
 * a ticker, the best ranked keeps it; the others take their issuer tag when
 * that separates them, else a 4-character hash of their denom (`ATOM·1A2B`).
 * An unnamed token only ever gets the hash.
 */
function guardFor(chainId: string): Map<string, string> {
  const cached = guards.get(chainId);
  if (cached) return cached;
  const drafts = new Map<string, Draft>();
  for (const row of tableIndex().byChain.get(chainId) ?? []) drafts.set(denomKey(row.denom), draftOf(chainId, row.denom));
  const entry = findCatalogEntry(chainId);
  if (entry) {
    for (const currency of currenciesOf(entry)) {
      if (isIbcDenom(currency.coinMinimalDenom)) continue;
      const key = denomKey(currency.coinMinimalDenom);
      if (!drafts.has(key)) drafts.set(key, draftOf(chainId, currency.coinMinimalDenom));
    }
  }
  for (const denom of tableIndex().issuerDenoms.get(chainId) ?? []) {
    const key = denomKey(denom);
    if (drafts.has(key) || cw20Listing(chainId, denom)) continue;
    drafts.set(key, draftOf(chainId, denom));
  }
  for (const [key, fact] of factStore().facts) {
    if (!key.startsWith(`${chainId}:`)) continue;
    const denom = key.slice(chainId.length + 1);
    if (!drafts.has(denom)) drafts.set(denom, draftFromFact(chainId, denom, fact));
  }
  const groups = new Map<string, Draft[]>();
  for (const draft of drafts.values()) {
    if (draft.provenance === "unknown") continue;
    const ticker = baseTicker(draft);
    groups.set(ticker, [...(groups.get(ticker) ?? []), draft]);
  }
  const taken = new Set(groups.keys());
  const out = new Map<string, string>();
  for (const [ticker, members] of [...groups.entries()].sort((a, b) => (a[0] < b[0] ? -1 : 1))) {
    if (members.length < 2) continue;
    members.sort((a, b) => a.rank - b.rank || (denomKey(a.denom) < denomKey(b.denom) ? -1 : 1));
    const keeper = members[0];
    for (const draft of members.slice(1)) {
      let next = ticker;
      const tag = draft.named && draft.originChainId ? issuerTag(draft.originChainId) : "";
      if (tag && draft.originChainId !== keeper?.originChainId && !ticker.endsWith(`.${tag}`)) {
        const candidate = `${ticker}.${tag}`;
        if (!taken.has(candidate)) next = candidate;
      }
      if (next === ticker) {
        next = `${ticker}·${hashTag(draft.denom)}`;
        for (let extra = 1; taken.has(next); extra += 1) next = `${next}${extra}`;
      }
      taken.add(next);
      out.set(denomKey(draft.denom), next);
    }
  }
  guards.set(chainId, out);
  return out;
}

function legacyAliases(draft: Draft): string[] {
  if (draft.provenance === "unknown" || draft.alloyed) return [];
  const out: string[] = [];
  if (draft.family === "ETH") out.push("WETH");
  if (draft.bridge === "axl") out.push(`axl${draft.family}`, ...(draft.family === "ETH" ? ["axlWETH"] : []));
  if (draft.family === "USDC" && draft.originChainId === "noble-1") out.push("USDCnb", "USDC.noble");
  if (draft.family === "USDC" && draft.bridge === "wh") out.push("USDCet");
  if (draft.family === "USDT" && draft.originChainId === "kava_2222-10") out.push("USDTkv");
  return out;
}

function nameOf(draft: Draft, originName: string | null, heldName: string): string {
  if (draft.provenance === "unknown") return "Unknown token";
  // The origin is known but nothing names the token: never echo its own free
  // text as a name ("Neutron USDC.n" for anyone's factory/…/USDC.n).
  if (!draft.named) return `Unlisted ${originName ?? heldName} token`;
  if (draft.alloyed) return `Alloyed ${draft.family}`;
  if (ownSymbolOnly(draft)) return `${originName ?? heldName} ${draft.symbol}`.trim();
  const network = draft.sourceNetwork ? ` from ${NETWORK_NAME[draft.sourceNetwork]}` : "";
  return `${originName ?? heldName} ${draft.family}${network}`;
}

function finalize(draft: Draft): HeldTokenIdentity {
  const testnet = isNeverIssuer(draft.heldOnChainId);
  const heldName = chainNameOf(draft.heldOnChainId);
  const originName = draft.originChainId ? chainNameOf(draft.originChainId) : null;
  const guarded = draft.provenance === "unknown" ? undefined : guardFor(draft.heldOnChainId).get(denomKey(draft.denom));
  const ticker = guarded ?? baseTicker(draft);
  // No channel joins a testnet to a mainnet issuer: such a walk is forged.
  const crossesNetworks = testnet && draft.originChainId !== null && !isNeverIssuer(draft.originChainId);
  const aliasSet = new Set<string>();
  for (const alias of [...draft.aliases, ...legacyAliases(draft)]) {
    // The family is already a keyword; an alias must add a name users saw.
    if (alias && alias !== ticker && alias !== draft.family) aliasSet.add(alias);
  }
  return {
    key: `${draft.heldOnChainId}:${draft.denom}`,
    heldOnChainId: draft.heldOnChainId,
    heldOnChainName: heldName,
    denom: draft.denom,
    kind: draft.kind,
    originChainId: draft.originChainId,
    originChainName: originName,
    originDenom: draft.originDenom,
    path: draft.path,
    hopChainIds: draft.hopChainIds,
    bridge: draft.bridge,
    sourceNetwork: draft.sourceNetwork,
    family: draft.family || ticker,
    ticker,
    name: nameOf(draft, originName, heldName),
    decimals: draft.decimals ?? 0,
    decimalsKnown: draft.decimals !== null,
    logoUrl: draft.logoUrl,
    coinGeckoId: draft.coinGeckoId,
    variantGroup: draft.variantGroup,
    alloyed: draft.alloyed,
    osmosisDenom:
      draft.heldOnChainId === OSMOSIS
        ? draft.denom
        : draft.originChainId && draft.originDenom
          ? osmosisDenomOf(draft.originChainId, draft.originDenom)
          : null,
    aliases: [...aliasSet],
    provenance: draft.provenance,
    proven:
      draft.provenance !== "unknown" &&
      draft.named &&
      !crossesNetworks &&
      (draft.provenance !== "channel-walk" || draft.walkCanonical === true),
    listed: draft.named,
    testnet,
  };
}

/** Drop derived state when the facts change. */
function syncMemo(): void {
  const generation = factStore().generation;
  if (memoGeneration === generation) return;
  memo.clear();
  guards = new Map();
  memoGeneration = generation;
}

/**
 * The identity of `denom` held on `chainId`. Synchronous and never throws: a
 * denom nothing proves comes back with provenance `unknown`, ticker
 * `IBC·498A`, no origin and unknown decimals, never a guessed issuer.
 */
export function identityOf(chainId: string, denom: string): HeldTokenIdentity {
  try {
    syncMemo();
    const key = `${chainId}:${denom}`;
    const cached = memo.get(key);
    if (cached) return cached;
    const identity = finalize(draftOf(chainId, denom));
    if (memo.size >= MEMO_MAX) memo.clear();
    memo.set(key, identity);
    return identity;
  } catch (error) {
    // The catalog not being installed is a wiring bug, not an unknown token.
    if (error instanceof Error && error.message.startsWith("Token catalog not installed")) throw error;
    return {
      key: `${chainId}:${denom}`,
      heldOnChainId: chainId,
      heldOnChainName: chainId,
      denom,
      kind: "other",
      originChainId: null,
      originChainName: null,
      originDenom: null,
      path: "",
      hopChainIds: [],
      bridge: null,
      sourceNetwork: null,
      family: unknownTicker(denom),
      ticker: unknownTicker(denom),
      name: "Unknown token",
      decimals: 0,
      decimalsKnown: false,
      logoUrl: null,
      coinGeckoId: null,
      variantGroup: null,
      alloyed: false,
      osmosisDenom: null,
      aliases: [],
      provenance: "unknown",
      proven: false,
      listed: false,
      testnet: false,
    };
  }
}

/* -------------------------------------------------------------------------- *
 * Text
 * -------------------------------------------------------------------------- */

/**
 * A token minted on the chain that holds it that nothing lists: anyone's
 * `factory/<self>/USDC.n`. Never called native.
 */
export function isUnlistedLocal(
  identity: Pick<HeldTokenIdentity, "provenance" | "listed" | "originChainId" | "heldOnChainId">,
): boolean {
  return (
    identity.provenance !== "unknown" && !identity.listed && identity.originChainId === identity.heldOnChainId
  );
}

/** The words an unlisted local token gets where a listed one reads "Native". */
export const UNLISTED_TOKEN = "Unlisted token";

/**
 * The words for one identity, so no screen builds token text itself.
 * - `pill`: `on Osmosis`.
 * - `row`: `Native on Injective`, `Noble USDC · on Osmosis`,
 *   `Alloyed USDC · Osmosis only`, `Unlisted token · on Osmosis`, or
 *   `Unknown origin · on Osmosis · ibc/498A…6BA6E4`.
 * - `sentence`: `USDC.n (Noble USDC) on Osmosis`, `ATOM on Cosmos Hub`.
 * - `a11y`: `USDC from Noble, on Osmosis`, `ATOM, native on Cosmos Hub`.
 */
export function tokenText(identity: HeldTokenIdentity, variant: TokenTextVariant): string {
  const held = identity.heldOnChainName;
  const unknown = identity.provenance === "unknown";
  const home = !unknown && identity.originChainId === identity.heldOnChainId;
  const unlisted = isUnlistedLocal(identity);
  switch (variant) {
    case "pill":
      return `on ${held}`;
    case "row":
      if (unknown) return `Unknown origin · on ${held} · ${shortDenom(identity.denom)}`;
      if (unlisted) return `${UNLISTED_TOKEN} · on ${held}`;
      // An alloy exists only where it was minted; a voucher of one elsewhere
      // reads like any other voucher ("Alloyed USDC · on Neutron").
      if (identity.alloyed && home) return `${identity.name} · ${held} only`;
      return home ? `Native on ${held}` : `${identity.name} · on ${held}`;
    case "sentence":
      if (unknown) return `unknown token ${shortDenom(identity.denom)} on ${held}`;
      if (unlisted) return `${identity.ticker} (unlisted token) on ${held}`;
      return home ? `${identity.ticker} on ${held}` : `${identity.ticker} (${identity.name}) on ${held}`;
    case "a11y":
      if (unknown) return `Unknown token ${shortDenom(identity.denom)}, on ${held}`;
      if (unlisted) return `${identity.ticker}, unlisted token, on ${held}`;
      // A walked voucher nothing names: its name says so ("Unlisted Neutron token").
      if (identity.alloyed || !identity.listed) return `${identity.name}, on ${held}`;
      return home
        ? `${identity.ticker}, native on ${held}`
        : `${identity.family} from ${identity.originChainName ?? "an unknown chain"}, on ${held}`;
  }
}

/** Everything a search should match: ticker, family, aliases, names, chains, denoms. */
export function tokenKeywords(identity: HeldTokenIdentity): string[] {
  const words = [
    identity.ticker,
    identity.family,
    ...identity.aliases,
    identity.name,
    identity.originChainName ?? "",
    identity.originChainId ?? "",
    identity.heldOnChainName,
    identity.heldOnChainId,
    identity.denom,
    identity.originDenom ?? "",
    identity.sourceNetwork ? NETWORK_NAME[identity.sourceNetwork] : "",
  ];
  return [...new Set(words.filter((word) => word.length > 0))];
}
