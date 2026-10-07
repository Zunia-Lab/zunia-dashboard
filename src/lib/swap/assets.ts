/**
 * The swap page's two lists: what the wallet can sell, and what it can buy
 * and where that will be delivered.
 *
 * Ported from zunia-extension lib/swap-assets.ts @ 1453e7a. The rows, the
 * exponent rule, the four sources of the buy list, the gating and the order
 * are the extension's; the inputs are the dashboard's: held balances arrive
 * with their identities from the balances API, the Osmosis side and the route
 * table from `/api/swap/assets` (identities computed on the server, where the
 * token tables live), and every chain's own coin from the slim client
 * catalog.
 *
 * Every row is one exact bank denom on one chain, named by its identity. The
 * ticker says what the token is and never where it is; the row's chain is
 * where the coin is held (sell) or delivered (buy). Signing reads `chainId`
 * and `denom` and nothing else here; a delivery row's denom is the token
 * table's hash-verified origin denom in its exact case, never a catalog
 * string (Injective's USDC hashes to `ibc/794C…` only in its exact case).
 *
 * Pure: no network, no storage. Runs in the browser.
 */

import { SWAP_VENUE_CHAIN_ID } from "@/config/interchain";
import { CHAINS, type ChainEntry } from "@/lib/chains";
import { toBaseUnits } from "@/lib/interchain/amounts";
import type { SwapAsset } from "@/lib/swap/wire";
import { gateOptions, osmosisDenomFor, type Executable, type XcsRouteTable } from "@/lib/swap/xcs";
import type { TokenIdentity } from "@/lib/token/types";
import type { PortfolioAsset } from "@/lib/token/wire";

const VENUE = SWAP_VENUE_CHAIN_ID;
const POSITIVE_AMOUNT = /^0*[1-9]\d*$/;

/** One balance the wallet holds, as the balances API names it. */
export interface HeldToken {
  readonly chainId: string;
  /** Exact bank denom. */
  readonly denom: string;
  /** Base units held. */
  readonly amount: string;
  readonly identity: TokenIdentity;
  /**
   * The balance reader's exponent from the chain's own bank metadata. Used
   * only for a token identity does not know, and only when SQS does not
   * disagree.
   */
  readonly reportedDecimals?: number;
}

/**
 * The sell side's input from `/api/portfolio` (`usePortfolio().data.assets`):
 * one row per asset, its **liquid** balance only. Staked, unbonding and
 * reward amounts are listed in the portfolio but cannot be sold by a swap
 * until they are back in the bank balance, so they never count here. Rows
 * with nothing liquid are left out (`sellOptions` would drop them anyway).
 */
export function heldFromPortfolio(assets: readonly Pick<PortfolioAsset, "chainId" | "identity" | "amounts">[]): HeldToken[] {
  const out: HeldToken[] = [];
  for (const asset of assets) {
    const amount = asset.amounts.liquid;
    if (!POSITIVE_AMOUNT.test(amount)) continue;
    out.push({ chainId: asset.chainId, denom: asset.identity.denom, amount, identity: asset.identity });
  }
  return out;
}

/** One row of either list: a denom on a chain, with what it is and whether it can be picked. */
export interface AssetOption {
  /** `${chainId}:${denom}`: the row key and the picker-memory id. */
  readonly key: string;
  /** Held on (sell) or delivered on (buy). Signed as is. */
  readonly chainId: string;
  readonly chainName: string;
  /** The exact bank denom on `chainId`. Signed as is. */
  readonly denom: string;
  /**
   * What the token is, carrying this row's exponent: `identity.decimals`
   * always equals {@link decimals}, so a helper that formats or converts from
   * the identity agrees with the row (a row whose two exponents differed would
   * show one scale and convert with another).
   */
  readonly identity: TokenIdentity;
  /** The ticker (`USDC.inj`). Display only. */
  readonly ticker: string;
  /** Display exponent; `null` when nothing proves one, or SQS disagrees: amounts then by Max only. */
  readonly decimals: number | null;
  /** Base units held; `"0"` for a row the wallet does not hold. */
  readonly amount: string;
  readonly held: boolean;
  /** The row's denom on Osmosis: its own on Osmosis, else the identity's canonical voucher. */
  readonly osmosisDenom: string | null;
  /** USD per whole token on Osmosis (router price); `null` when not priced. */
  readonly price: number | null;
  /** USD of Osmosis pool liquidity for the asset; `null` when not reported. */
  readonly liquidity: number | null;
  /** The token's logo; a chain logo only for that chain's own coin. */
  readonly iconUrl?: string;
  /** Show the seal: the identity is proven, not merely on a registry chain. */
  readonly verified: boolean;
  /** The route table's answer for the current From. Always `unknown` on the sell list. */
  readonly executable: Executable;
  /** Why the row cannot be picked, in the words the picker shows; `null` when it can. */
  readonly disabledReason: string | null;
  /** Shown by a search only, with its reason: every row that cannot be picked. */
  readonly searchOnly: boolean;
  /** On a catalog test network. The To list shows only the From's network. */
  readonly testnet: boolean;
}

/** What the buy list depends on besides the wallet. */
export interface BuyOptionsInput {
  /** The row being sold: picks the network shown and gates every row. */
  readonly from?: AssetOption | null;
  /** `/api/swap/assets` rows. Empty while loading or when the router is unreachable. */
  readonly swapAssets?: readonly SwapAsset[];
  /** `/api/swap/assets` `routeTable`. `null` while loading or unreadable, which gates no route. */
  readonly routeTable?: XcsRouteTable | null;
  /** The catalog; the shipped one unless a test passes its own. */
  readonly chains?: readonly ChainEntry[];
}

interface RowInput {
  readonly chainId: string;
  readonly denom: string;
  readonly identity: TokenIdentity;
  readonly amount: string;
  readonly held: boolean;
  readonly reportedDecimals?: number;
}

interface Listed {
  readonly decimals: ReadonlyMap<string, number>;
  readonly byDenom: ReadonlyMap<string, SwapAsset>;
}

function listedOf(swapAssets: readonly SwapAsset[]): Listed {
  const decimals = new Map<string, number>();
  const byDenom = new Map<string, SwapAsset>();
  for (const asset of swapAssets) {
    decimals.set(asset.osmosisDenom, asset.listedDecimals);
    if (!byDenom.has(asset.osmosisDenom)) byDenom.set(asset.osmosisDenom, asset);
  }
  return { decimals, byDenom };
}

function chainOf(chainId: string, chains: readonly ChainEntry[]): ChainEntry | undefined {
  return chains.find((chain) => chain.chainId === chainId);
}

/**
 * The exponent a typed amount is converted with, or `null` when nothing proves
 * one. The identity's comes first. Only for a token whose identity is unknown
 * may the balance reader's figure stand in. Either way SQS's figure for the
 * asset's Osmosis denom is a further witness, because IBC keeps one exponent
 * per asset: when it disagrees, a typed amount could be signed at the wrong
 * scale.
 */
export function exponentOf(
  identity: Pick<TokenIdentity, "decimals" | "provenance">,
  venueDenom: string | null,
  reported: number | undefined,
  listed: ReadonlyMap<string, number>,
): number | null {
  const own =
    identity.decimals !== null
      ? identity.decimals
      : identity.provenance === "unknown" && reported !== undefined
        ? reported
        : null;
  if (own === null) return null;
  const sqs = venueDenom ? listed.get(venueDenom) : undefined;
  return sqs === undefined || sqs === own ? own : null;
}

function withExponent(identity: TokenIdentity, decimals: number | null): TokenIdentity {
  return identity.decimals === decimals ? identity : { ...identity, decimals };
}

function toOption(input: RowInput, listed: Listed, chains: readonly ChainEntry[]): AssetOption {
  const chain = chainOf(input.chainId, chains);
  const venueDenom = osmosisDenomFor({ chainId: input.chainId, denom: input.denom, identity: input.identity });
  const sane =
    typeof input.reportedDecimals === "number" &&
    Number.isInteger(input.reportedDecimals) &&
    input.reportedDecimals >= 0 &&
    input.reportedDecimals <= 30
      ? input.reportedDecimals
      : undefined;
  const decimals = exponentOf(input.identity, venueDenom, sane, listed.decimals);
  const identity = withExponent(input.identity, decimals);
  const market = venueDenom ? listed.byDenom.get(venueDenom) : undefined;
  const ownCoin = identity.kind === "native" && identity.originChainId === input.chainId;
  const iconUrl = identity.logoUrl ?? (ownCoin ? chain?.iconUrl : undefined);
  return {
    key: `${input.chainId}:${input.denom}`,
    chainId: input.chainId,
    chainName: identity.chainName ?? chain?.chainName ?? input.chainId,
    denom: input.denom,
    identity,
    ticker: identity.ticker,
    decimals,
    amount: input.amount,
    held: input.held,
    osmosisDenom: venueDenom,
    price: market?.price ?? null,
    liquidity: market?.liquidity ?? null,
    ...(iconUrl ? { iconUrl } : {}),
    verified: identity.proven,
    executable: "unknown",
    disabledReason: null,
    searchOnly: false,
    testnet: chain?.network === "testnet",
  };
}

/**
 * Everything the wallet can sell: one row per non-zero balance, per chain and
 * exact bank denom, in the order given. Names come from identity, never from
 * a balance reader's labels.
 *
 * @param swapAssets - When given, SQS's decimals are checked against the
 *   identity's, so a disagreement makes the amount field Max-only.
 */
export function sellOptions(
  held: readonly HeldToken[],
  swapAssets: readonly SwapAsset[] = [],
  chains: readonly ChainEntry[] = CHAINS,
): AssetOption[] {
  const listed = listedOf(swapAssets);
  const out: AssetOption[] = [];
  const seen = new Set<string>();
  for (const token of held) {
    if (!token.denom || !POSITIVE_AMOUNT.test(token.amount)) continue;
    const key = `${token.chainId}:${token.denom}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(
      toOption(
        {
          chainId: token.chainId,
          denom: token.denom,
          identity: token.identity,
          amount: token.amount,
          held: true,
          ...(token.reportedDecimals !== undefined ? { reportedDecimals: token.reportedDecimals } : {}),
        },
        listed,
        chains,
      ),
    );
  }
  return out;
}

/**
 * A chain's own staking coin, named from the catalog: what the browser can
 * say about it without the server's token tables. Its Osmosis denom (when it
 * trades there) comes from the swap assets' home row, if there is one.
 */
export function chainCoinIdentity(chain: ChainEntry, home?: SwapAsset): TokenIdentity {
  if (home && home.chainId === chain.chainId && home.denom === chain.coinMinimalDenom) return home.identity;
  return {
    key: `${chain.chainId}:${chain.coinMinimalDenom}`,
    chainId: chain.chainId,
    denom: chain.coinMinimalDenom,
    kind: "native",
    ticker: chain.coinDenom,
    name: chain.chainName,
    decimals: chain.coinDecimals,
    ...(chain.iconUrl ? { logoUrl: chain.iconUrl } : {}),
    originChainId: chain.chainId,
    originDenom: chain.coinMinimalDenom,
    ...(chain.coinGeckoId ? { coinGeckoId: chain.coinGeckoId } : {}),
    ...(chain.chainId === VENUE ? { osmosisDenom: chain.coinMinimalDenom } : {}),
    provenance: "native",
    proven: true,
    testnet: chain.network === "testnet",
    chainName: chain.chainName,
    listed: true,
  };
}

function compareText(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

/** Alphabetical by ticker; for one ticker, the issuer's own row before vouchers of it. */
function byTicker(a: AssetOption, b: AssetOption): number {
  const ticker = compareText(a.ticker.toLowerCase(), b.ticker.toLowerCase());
  if (ticker !== 0) return ticker;
  const home = (option: AssetOption) => (option.identity.originChainId === option.chainId ? 0 : 1);
  return (
    home(a) - home(b) ||
    compareText(a.chainName.toLowerCase(), b.chainName.toLowerCase()) ||
    compareText(a.key, b.key)
  );
}

/**
 * Held rows first (in balance order), then rows the contract can reach, then
 * the rest that can still be picked, then the ones that cannot. A picker
 * lists the first three groups and shows the last only to a search.
 */
function ordered(options: readonly AssetOption[]): AssetOption[] {
  const position = new Map(options.map((option, index) => [option.key, index]));
  const group = (option: AssetOption): number =>
    option.disabledReason !== null ? 3 : option.held ? 0 : option.executable === "yes" ? 1 : 2;
  return [...options].sort((a, b) => {
    const step = group(a) - group(b);
    if (step !== 0) return step;
    if (a.held !== b.held) return a.held ? -1 : 1;
    if (a.held) return (position.get(a.key) ?? 0) - (position.get(b.key) ?? 0);
    return byTicker(a, b);
  });
}

/**
 * Everything the wallet can ask a swap to deliver, one row per
 * `${chainId}:${denom}`, from four sources:
 * 1. the held balances;
 * 2. the staking coin of every catalog chain on the From's network;
 * 3. the tokens Osmosis lists, delivered on Osmosis;
 * 4. each of those delivered home to its issuer.
 *
 * Only the From's network is shown. A token nothing identifies is offered
 * only when held. Each row is gated against the From with the route table
 * (./xcs.ts `gateOptions`): a row that cannot be picked carries its reason and
 * is search-only. Order: held, then reachable, then the rest.
 */
export function buyOptions(held: readonly HeldToken[], input: BuyOptionsInput = {}): AssetOption[] {
  const chains = input.chains ?? CHAINS;
  const swapAssets = input.swapAssets ?? [];
  const listed = listedOf(swapAssets);
  const from = input.from ?? null;
  const testnet = from?.testnet ?? false;
  const homeByKey = new Map(swapAssets.filter((asset) => asset.kind === "home").map((asset) => [asset.key, asset]));
  const rows = new Map<string, AssetOption>();
  const add = (option: AssetOption) => {
    if (rows.has(option.key) || option.testnet !== testnet) return;
    if (!option.held && option.identity.provenance === "unknown") return;
    rows.set(option.key, option);
  };
  const addRow = (row: RowInput) => {
    if (!rows.has(`${row.chainId}:${row.denom}`)) add(toOption(row, listed, chains));
  };

  for (const option of sellOptions(held, swapAssets, chains)) add(option);
  for (const chain of chains) {
    if ((chain.network === "testnet") !== testnet) continue;
    const home = homeByKey.get(`${chain.chainId}:${chain.coinMinimalDenom}`);
    addRow({
      chainId: chain.chainId,
      denom: chain.coinMinimalDenom,
      identity: chainCoinIdentity(chain, home),
      amount: "0",
      held: false,
    });
  }
  if (!testnet) {
    for (const asset of swapAssets) {
      if (!asset.tradable) continue;
      addRow({ chainId: asset.chainId, denom: asset.denom, identity: asset.identity, amount: "0", held: false });
    }
  }

  const gated = gateOptions(from, [...rows.values()], input.routeTable).map((option) => ({
    ...option,
    searchOnly: option.disabledReason !== null,
  }));
  return ordered(gated);
}

/**
 * The To on screen. A row the user picked stays picked, even once the From
 * or the route table turns it off: its reason is then shown and nothing is
 * quoted for it, rather than the destination changing under them. With no
 * pick, the first row that can be used.
 */
export function pickTo(destinations: readonly AssetOption[], toKey: string | null): AssetOption | undefined {
  return (
    (toKey ? destinations.find((asset) => asset.key === toKey) : undefined) ??
    destinations.find((asset) => asset.disabledReason === null)
  );
}

/**
 * The base units an amount field's text stands for, with the row's own
 * exponent. A row whose exponent is unknown takes only Max, whose text is the
 * raw balance in base units. `null` when the text is empty or does not
 * convert (too many decimals, not a number).
 */
export function amountUnitsOf(option: Pick<AssetOption, "decimals"> | undefined, text: string): bigint | null {
  if (!option || !text.trim()) return null;
  if (option.decimals === null) return /^\d+$/.test(text.trim()) ? BigInt(text.trim()) : null;
  const base = toBaseUnits(text, option.decimals);
  return base === null ? null : BigInt(base);
}

/**
 * What the quote should find on Osmosis for this pair: the From's denom there
 * and the To's. Sent as hints (`fromVenueDenom`, `toVenueDenom`); the server
 * proves each before it uses it.
 */
export function expectedVenueDenoms(
  from: Pick<AssetOption, "chainId" | "denom" | "identity">,
  to: Pick<AssetOption, "chainId" | "denom" | "identity">,
): { fromVenueDenom?: string; toVenueDenom?: string } {
  const input = osmosisDenomFor(from);
  const output = osmosisDenomFor(to);
  return {
    ...(input && from.chainId !== VENUE ? { fromVenueDenom: input } : {}),
    ...(output && to.chainId !== VENUE ? { toVenueDenom: output } : {}),
  };
}
