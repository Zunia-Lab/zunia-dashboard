/**
 * The chain catalog as token identity reads it: every registry row, with the
 * currency lists the slim browser catalog drops.
 *
 * Ported from zunia-extension lib/chain-catalog.ts @ 1453e7a (lookups only).
 * The dashboard has no user-added chains on the server, so the extension's
 * custom-chain hooks are gone and every row here is bundled registry data:
 * nothing a visitor sends can add an issuer or rename a token.
 *
 * The rows are installed rather than imported. `catalog-data.ts` installs the
 * shipped JSON for the app; tests install the same file read with `fs`,
 * because `node --conditions=import --import tsx` (the repo's test command)
 * cannot import a `.json` module at all. Keeping this module free of the JSON
 * import is what lets the identity rules be tested.
 */

export type ChainNetwork = "mainnet" | "testnet";

/** One bank denom from a chain's `currencies` list. */
export interface CatalogCurrency {
  coinDenom: string;
  coinMinimalDenom: string;
  coinDecimals: number;
  coinGeckoId?: string;
}

/** The catalog row fields identity and pricing read. */
export interface CatalogEntry {
  chainId: string;
  chainName: string;
  bech32Prefix: string;
  coinType: number;
  network: ChainNetwork;
  coinDenom: string;
  coinMinimalDenom: string;
  coinDecimals: number;
  feeDenom: string;
  feeMinimalDenom: string;
  feeDecimals: number;
  currencies?: readonly CatalogCurrency[];
  coinGeckoId?: string;
  iconUrl?: string;
  inCosmosRegistry?: boolean;
}

interface CatalogState {
  rows: readonly CatalogEntry[];
  byId: ReadonlyMap<string, CatalogEntry>;
  /** Minimal denom (erc20/peggy case-folded) → every currency that uses it. */
  currencies: ReadonlyMap<string, readonly { entry: CatalogEntry; currency: CatalogCurrency }[]>;
}

let state: CatalogState | null = null;
const listeners = new Set<() => void>();

/** `erc20:0xA00C…` and `peggy0xA00C…` match the registry's lowercase spelling. */
const CASE_FOLD_DENOM = /^(?:erc20:|peggy)/i;

function denomIndexKey(denom: string): string {
  return CASE_FOLD_DENOM.test(denom) ? denom.toLowerCase() : denom;
}

/**
 * Installs the catalog rows. Called once by `catalog-data.ts` (the app) or by
 * a test; a later call replaces the rows, which only tests do.
 */
export function installCatalog(rows: readonly CatalogEntry[]): void {
  const byId = new Map<string, CatalogEntry>();
  const currencies = new Map<string, { entry: CatalogEntry; currency: CatalogCurrency }[]>();
  for (const entry of rows) {
    if (!byId.has(entry.chainId)) byId.set(entry.chainId, entry);
    for (const currency of currenciesOf(entry)) {
      const key = denomIndexKey(currency.coinMinimalDenom);
      const list = currencies.get(key);
      if (list) list.push({ entry, currency });
      else currencies.set(key, [{ entry, currency }]);
    }
  }
  state = { rows, byId, currencies };
  for (const listener of listeners) listener();
}

/** Lets derived indexes (the identity memo) drop themselves when rows change. */
export function onCatalogInstalled(listener: () => void): void {
  listeners.add(listener);
}

function current(): CatalogState {
  if (!state) {
    // A wiring mistake, not a data condition: server code must import
    // `@/lib/token/identity` (which installs the rows), tests must call
    // `installCatalog` first. Failing loudly beats naming nothing.
    throw new Error("Token catalog not installed: import @/lib/token/identity, or installCatalog() in tests");
  }
  return state;
}

/** Every registry row, mainnets and testnets. */
export function catalogRows(): readonly CatalogEntry[] {
  return current().rows;
}

export function findCatalogEntry(chainId: string): CatalogEntry | undefined {
  return current().byId.get(chainId);
}

export function catalogIconFor(entry: CatalogEntry): string | undefined {
  return entry.iconUrl;
}

export function denomsMatch(left: string, right: string): boolean {
  if (left === right) return true;
  if (CASE_FOLD_DENOM.test(left) && CASE_FOLD_DENOM.test(right)) {
    return left.toLowerCase() === right.toLowerCase();
  }
  return false;
}

/** Native row plus every extra currency. A row without `currencies` has just the native row. */
export function currenciesOf(entry: CatalogEntry): readonly CatalogCurrency[] {
  if (entry.currencies && entry.currencies.length > 0) return entry.currencies;
  return [
    {
      coinDenom: entry.coinDenom,
      coinMinimalDenom: entry.coinMinimalDenom,
      coinDecimals: entry.coinDecimals,
      ...(entry.coinGeckoId ? { coinGeckoId: entry.coinGeckoId } : {}),
    },
  ];
}

/**
 * The currency `denom` is on `chainId` itself, or `undefined`.
 *
 * Only `erc20:` and `peggy` denoms compare without case: the catalog spells
 * Injective's erc20 rows in lowercase while the bank uses mixed case. Every
 * other denom must match exactly. For naming only; never build a message
 * denom from the row it returns.
 */
export function findCurrencyOn(
  chainId: string,
  denom: string,
): { entry: CatalogEntry; currency: CatalogCurrency } | undefined {
  const entry = findCatalogEntry(chainId);
  if (!entry || !denom) return undefined;
  const currency = currenciesOf(entry).find((row) => denomsMatch(row.coinMinimalDenom, denom));
  if (currency) return { entry, currency };
  // A few registry rows list a staking or fee coin only in its own fields.
  if (denom === entry.coinMinimalDenom) {
    return {
      entry,
      currency: {
        coinDenom: entry.coinDenom,
        coinMinimalDenom: entry.coinMinimalDenom,
        coinDecimals: entry.coinDecimals,
        ...(entry.coinGeckoId ? { coinGeckoId: entry.coinGeckoId } : {}),
      },
    };
  }
  if (denom === entry.feeMinimalDenom) {
    return {
      entry,
      currency: {
        coinDenom: entry.feeDenom,
        coinMinimalDenom: entry.feeMinimalDenom,
        coinDecimals: entry.feeDecimals,
      },
    };
  }
  return undefined;
}

/**
 * Base units that Ethereum, Bitcoin and Solana assets unwind to. A catalog
 * chain that happens to call its own coin `wei` (Stratos) is not the issuer of
 * the Ethereum ETH that Picasso carries, so these never have a unique issuer.
 */
const FOREIGN_BASE_UNITS: ReadonlySet<string> = new Set([
  "wei",
  "gwei",
  "sat",
  "sats",
  "satoshi",
  "lamport",
  "lamports",
]);

/**
 * The one mainnet registry chain that issues `baseDenom`, or `undefined` when
 * none does or several do (`uusdc`: Noble, Axelar and others).
 *
 * The only safe base-denom lookup: it never picks between issuers, and
 * non-Cosmos base units (`wei`) never resolve to a Cosmos chain.
 */
export function uniqueIssuerOf(
  baseDenom: string,
): { entry: CatalogEntry; currency: CatalogCurrency } | undefined {
  const needle = baseDenom.trim();
  if (!needle || FOREIGN_BASE_UNITS.has(needle.toLowerCase())) return undefined;
  const issuers = (current().currencies.get(denomIndexKey(needle)) ?? []).filter(
    (match) => match.entry.network === "mainnet",
  );
  const chains = new Set(issuers.map((match) => match.entry.chainId));
  return chains.size === 1 ? issuers[0] : undefined;
}
