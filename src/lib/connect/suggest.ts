/**
 * Keplr `ChainInfo` for `experimentalSuggestChain`, built from the catalog.
 *
 * Keplr only signs on chains it knows; for one it does not (Safrochain is not
 * in Keplr's registry) the site has to suggest it, and the user approves the
 * endpoints, coin type and currencies in Keplr's own prompt. The Zunia
 * extension accepts the same shape. Everything here comes from the shipped
 * catalog — nothing from a request — so a suggestion can never point a wallet
 * at a host the catalog does not list.
 *
 * Pure: the server route (`/api/account/chain-info`) calls it with the full
 * catalog row (endpoints are server-side data), and the tests call it directly.
 */

export interface SuggestCurrency {
  coinDenom: string;
  coinMinimalDenom: string;
  coinDecimals: number;
  coinGeckoId?: string;
}

export interface SuggestFeeCurrency extends SuggestCurrency {
  gasPriceStep?: { low: number; average: number; high: number };
}

/** The Keplr ChainInfo fields this app sets. */
export interface SuggestChainInfo {
  chainId: string;
  chainName: string;
  rpc: string;
  rest: string;
  bip44: { coinType: number };
  bech32Config: {
    bech32PrefixAccAddr: string;
    bech32PrefixAccPub: string;
    bech32PrefixValAddr: string;
    bech32PrefixValPub: string;
    bech32PrefixConsAddr: string;
    bech32PrefixConsPub: string;
  };
  currencies: SuggestCurrency[];
  feeCurrencies: SuggestFeeCurrency[];
  stakeCurrency: SuggestCurrency;
  features: string[];
  chainSymbolImageUrl?: string;
}

/** The catalog fields used; the server's `ServerChainEntry` satisfies it. */
export interface SuggestSource {
  chainId: string;
  chainName: string;
  rpc?: string;
  rest?: string;
  bech32Prefix: string;
  coinType: number;
  coinDenom: string;
  coinMinimalDenom: string;
  coinDecimals: number;
  coinGeckoId?: string;
  feeDenom: string;
  feeMinimalDenom: string;
  feeDecimals: number;
  gasPriceStep?: { low: number; average: number; high: number };
  features?: string[];
  currencies?: Array<{ coinDenom: string; coinMinimalDenom: string; coinDecimals: number; coinGeckoId?: string }>;
  iconUrl?: string;
}

/**
 * Features passed through. Keplr validates the list against the features it
 * knows and refuses the whole suggestion over one it does not, so only flags
 * that change how a key signs or a message is built are forwarded.
 */
const FORWARDED_FEATURES = new Set([
  "cosmwasm",
  "eth-address-gen",
  "eth-key-sign",
  "eth-secp256k1-cosmos",
  "eth-secp256k1-initia",
  "ibc-transfer",
  "ibc-go",
]);

function currency(c: { coinDenom: string; coinMinimalDenom: string; coinDecimals: number; coinGeckoId?: string }): SuggestCurrency {
  return {
    coinDenom: c.coinDenom,
    coinMinimalDenom: c.coinMinimalDenom,
    coinDecimals: c.coinDecimals,
    ...(c.coinGeckoId ? { coinGeckoId: c.coinGeckoId } : {}),
  };
}

export class SuggestUnavailableError extends Error {
  constructor(chainName: string) {
    super(`${chainName} has no public RPC and REST endpoints in this build's catalog, so a wallet cannot be asked to add it.`);
    this.name = "SuggestUnavailableError";
  }
}

export function buildSuggestChainInfo(chain: SuggestSource): SuggestChainInfo {
  const rpc = chain.rpc?.replace(/\/+$/, "");
  const rest = chain.rest?.replace(/\/+$/, "");
  if (!rpc || !rest || !/^https:\/\//.test(rpc) || !/^https:\/\//.test(rest)) {
    throw new SuggestUnavailableError(chain.chainName);
  }
  const prefix = chain.bech32Prefix;
  const stake = currency({
    coinDenom: chain.coinDenom,
    coinMinimalDenom: chain.coinMinimalDenom,
    coinDecimals: chain.coinDecimals,
    coinGeckoId: chain.coinGeckoId,
  });
  const fee: SuggestFeeCurrency = {
    ...currency({
      coinDenom: chain.feeDenom,
      coinMinimalDenom: chain.feeMinimalDenom,
      coinDecimals: chain.feeDecimals,
      ...(chain.feeMinimalDenom === chain.coinMinimalDenom && chain.coinGeckoId ? { coinGeckoId: chain.coinGeckoId } : {}),
    }),
    ...(chain.gasPriceStep ? { gasPriceStep: { ...chain.gasPriceStep } } : {}),
  };
  // The stake and fee currencies first, then the rest of the catalog's list,
  // de-duplicated by minimal denom and capped (a suggestion is a prompt the
  // user reads, not a token registry).
  const seen = new Set<string>();
  const currencies: SuggestCurrency[] = [];
  for (const c of [stake, currency(fee), ...(chain.currencies ?? []).map(currency)]) {
    if (seen.has(c.coinMinimalDenom) || currencies.length >= 24) continue;
    seen.add(c.coinMinimalDenom);
    currencies.push(c);
  }
  return {
    chainId: chain.chainId,
    chainName: chain.chainName,
    rpc,
    rest,
    bip44: { coinType: chain.coinType },
    bech32Config: {
      bech32PrefixAccAddr: prefix,
      bech32PrefixAccPub: `${prefix}pub`,
      bech32PrefixValAddr: `${prefix}valoper`,
      bech32PrefixValPub: `${prefix}valoperpub`,
      bech32PrefixConsAddr: `${prefix}valcons`,
      bech32PrefixConsPub: `${prefix}valconspub`,
    },
    currencies,
    feeCurrencies: [fee],
    stakeCurrency: stake,
    features: (chain.features ?? []).filter((f) => FORWARDED_FEATURES.has(f)),
    ...(chain.iconUrl && /^https:\/\//.test(chain.iconUrl) ? { chainSymbolImageUrl: chain.iconUrl } : {}),
  };
}
