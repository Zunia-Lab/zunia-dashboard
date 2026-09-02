/**
 * Server-only reads against public Cosmos REST (LCD) endpoints and the price
 * feed. Runs in the route handler rather than the browser so the visitor's IP
 * is never exposed to a long tail of third-party chain endpoints, and so one
 * slow chain cannot block the page.
 */

import "server-only";
import { bech32 } from "bech32";
import { CHAINS, findChain, type ChainEntry } from "@/lib/chains";

const REQUEST_TIMEOUT_MS = 6_000;
const PRICE_ENDPOINT = "https://api.coingecko.com/api/v3/simple/price";

export interface ChainHolding {
  chainId: string;
  chainName: string;
  symbol: string;
  iconUrl?: string;
  address: string;
  decimals: number;
  /** Base units. */
  available: string;
  staked: string;
  rewards: string;
  /** Whole-coin total across the three buckets. */
  amount: number;
  price: number | null;
  change24h: number | null;
  value: number | null;
  error?: string;
}

export interface PortfolioSnapshot {
  total: number;
  staked: number;
  claimable: number;
  change24h: number | null;
  pricedChains: number;
  unpricedChains: number;
  holdings: ChainHolding[];
  /** Chains that were skipped because the address cannot be re-derived. */
  skipped: string[];
}

/**
 * Re-encodes a bech32 address under another chain's prefix.
 *
 * Cosmos accounts on the same BIP44 coin type share the same 20-byte address,
 * so a `cosmos1…` address is the same account as `osmo1…`. Chains on a
 * different coin type (Ethermint's 60) derive from a different key, so those
 * are refused rather than guessed.
 */
export function reencodeAddress(
  address: string,
  target: ChainEntry,
  source: ChainEntry,
): string | null {
  if (target.coinType !== source.coinType) return null;
  try {
    const decoded = bech32.decode(address);
    return bech32.encode(target.bech32Prefix, decoded.words);
  } catch {
    return null;
  }
}

async function getJson(url: string): Promise<unknown> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    const res = await fetch(url, {
      signal: controller.signal,
      headers: { accept: "application/json" },
      cache: "no-store",
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return await res.json();
  } finally {
    clearTimeout(timer);
  }
}

function sumDenom(
  rows: Array<{ denom?: string; amount?: string }> | undefined,
  denom: string,
): string {
  if (!rows) return "0";
  let total = BigInt(0);
  for (const row of rows) {
    if (row.denom !== denom || !row.amount) continue;
    // Reward amounts arrive as decimal strings; truncate to base units.
    total += BigInt(row.amount.split(".")[0] || "0");
  }
  return total.toString();
}

function toWholeCoins(base: string, decimals: number): number {
  if (!base || base === "0") return 0;
  const digits = base.padStart(decimals + 1, "0");
  const whole = digits.slice(0, digits.length - decimals);
  const fraction = decimals > 0 ? digits.slice(digits.length - decimals) : "";
  return Number(`${whole}.${fraction || "0"}`);
}

async function readChain(
  chain: ChainEntry,
  address: string,
): Promise<Omit<ChainHolding, "price" | "change24h" | "value">> {
  const base = {
    chainId: chain.chainId,
    chainName: chain.chainName,
    symbol: chain.coinDenom,
    iconUrl: chain.iconUrl,
    address,
    decimals: chain.coinDecimals,
    available: "0",
    staked: "0",
    rewards: "0",
    amount: 0,
  };

  const rest = chain.rest?.replace(/\/$/, "");
  if (!rest) return { ...base, error: "No REST endpoint in the registry" };

  const denom = chain.coinMinimalDenom;
  const [bank, staking, rewards] = await Promise.allSettled([
    getJson(`${rest}/cosmos/bank/v1beta1/balances/${address}`),
    getJson(`${rest}/cosmos/staking/v1beta1/delegations/${address}`),
    getJson(`${rest}/cosmos/distribution/v1beta1/delegators/${address}/rewards`),
  ]);

  if (bank.status === "rejected") {
    return { ...base, error: "Endpoint unreachable" };
  }

  const available = sumDenom(
    (bank.value as { balances?: Array<{ denom?: string; amount?: string }> })
      .balances,
    denom,
  );
  const stakedRows =
    staking.status === "fulfilled"
      ? (
          staking.value as {
            delegation_responses?: Array<{
              balance?: { denom?: string; amount?: string };
            }>;
          }
        ).delegation_responses?.map((d) => d.balance ?? {})
      : undefined;
  const rewardRows =
    rewards.status === "fulfilled"
      ? (rewards.value as { total?: Array<{ denom?: string; amount?: string }> })
          .total
      : undefined;

  const staked = sumDenom(stakedRows, denom);
  const claimable = sumDenom(rewardRows, denom);

  return {
    ...base,
    available,
    staked,
    rewards: claimable,
    amount:
      toWholeCoins(available, chain.coinDecimals) +
      toWholeCoins(staked, chain.coinDecimals) +
      toWholeCoins(claimable, chain.coinDecimals),
  };
}

async function readPrices(
  chains: ChainEntry[],
  currency: string,
): Promise<Record<string, { price: number; change24h: number }>> {
  const ids = [
    ...new Set(chains.map((c) => c.coinGeckoId).filter(Boolean)),
  ] as string[];
  if (ids.length === 0) return {};

  const url =
    `${PRICE_ENDPOINT}?ids=${encodeURIComponent(ids.join(","))}` +
    `&vs_currencies=${currency}&include_24hr_change=true`;

  let body: Record<string, Record<string, number>>;
  try {
    body = (await getJson(url)) as Record<string, Record<string, number>>;
  } catch {
    // Rate limited or offline. Amounts still render; fiat stays blank.
    return {};
  }

  const out: Record<string, { price: number; change24h: number }> = {};
  for (const chain of chains) {
    const row = chain.coinGeckoId ? body[chain.coinGeckoId] : undefined;
    if (!row) continue;
    const price = row[currency];
    if (typeof price !== "number") continue;
    out[chain.chainId] = {
      price,
      change24h: row[`${currency}_24h_change`] ?? 0,
    };
  }
  return out;
}

/** Chains to read when the caller did not name any. */
export const DEFAULT_FOLLOWED = [
  "safrochain-1",
  "cosmoshub-4",
  "osmosis-1",
  "celestia",
  "neutron-1",
];

export async function readPortfolio(
  address: string,
  sourceChainId: string,
  followed: string[],
  currency = "usd",
): Promise<PortfolioSnapshot> {
  const source = findChain(sourceChainId);
  const wanted = followed
    .map((id) => findChain(id))
    .filter((c): c is ChainEntry => Boolean(c));

  if (wanted.length === 0) {
    return {
      total: 0,
      staked: 0,
      claimable: 0,
      change24h: null,
      pricedChains: 0,
      unpricedChains: 0,
      holdings: [],
      skipped: [],
    };
  }

  const targets: Array<{ chain: ChainEntry; address: string }> = [];
  const skipped: string[] = [];

  for (const chain of wanted) {
    if (chain.chainId === sourceChainId) {
      targets.push({ chain, address });
      continue;
    }
    const derived = source ? reencodeAddress(address, chain, source) : null;
    if (derived) targets.push({ chain, address: derived });
    else skipped.push(chain.chainId);
  }

  const [rows, prices] = await Promise.all([
    Promise.all(
      targets.map(({ chain, address: addr }) =>
        readChain(chain, addr).catch(() => ({
          chainId: chain.chainId,
          chainName: chain.chainName,
          symbol: chain.coinDenom,
          iconUrl: chain.iconUrl,
          address: addr,
          decimals: chain.coinDecimals,
          available: "0",
          staked: "0",
          rewards: "0",
          amount: 0,
          error: "Request failed",
        })),
      ),
    ),
    readPrices(
      targets.map((t) => t.chain),
      currency,
    ),
  ]);

  let total = 0;
  let staked = 0;
  let claimable = 0;
  let weightedChange = 0;
  let pricedChains = 0;
  let unpricedChains = 0;

  const holdings: ChainHolding[] = rows.map((row) => {
    const spot = prices[row.chainId];
    if (!spot) {
      if (row.amount > 0) unpricedChains += 1;
      return { ...row, price: null, change24h: null, value: null };
    }
    const value = row.amount * spot.price;
    total += value;
    staked += toWholeCoins(row.staked, row.decimals) * spot.price;
    claimable += toWholeCoins(row.rewards, row.decimals) * spot.price;
    weightedChange += value * spot.change24h;
    pricedChains += 1;
    return {
      ...row,
      price: spot.price,
      change24h: spot.change24h,
      value,
    };
  });

  holdings.sort((a, b) => (b.value ?? -1) - (a.value ?? -1));

  return {
    total,
    staked,
    claimable,
    change24h: total > 0 ? weightedChange / total : null,
    pricedChains,
    unpricedChains,
    holdings,
    skipped,
  };
}

export interface ValidatorRow {
  chainId: string;
  chainName: string;
  operatorAddress: string;
  moniker: string;
  identity: string;
  commission: number;
  votingPower: number;
  tokens: string;
  jailed: boolean;
}

/** Bonded validator set for one chain, strongest first. */
export async function readValidators(chainId: string): Promise<ValidatorRow[]> {
  const chain = findChain(chainId);
  const rest = chain?.rest?.replace(/\/$/, "");
  if (!chain || !rest) return [];

  const body = (await getJson(
    `${rest}/cosmos/staking/v1beta1/validators?status=BOND_STATUS_BONDED&pagination.limit=150`,
  )) as {
    validators?: Array<{
      operator_address?: string;
      jailed?: boolean;
      tokens?: string;
      description?: { moniker?: string; identity?: string };
      commission?: { commission_rates?: { rate?: string } };
    }>;
  };

  const rows = body.validators ?? [];
  const total = rows.reduce((sum, v) => sum + BigInt(v.tokens || "0"), 0n);

  return rows
    .map((v) => ({
      chainId: chain.chainId,
      chainName: chain.chainName,
      operatorAddress: v.operator_address ?? "",
      moniker: v.description?.moniker ?? v.operator_address ?? "Validator",
      identity: v.description?.identity ?? "",
      commission: Number(v.commission?.commission_rates?.rate ?? "0"),
      votingPower:
        total > 0n
          ? Number((BigInt(v.tokens || "0") * 10000n) / total) / 10000
          : 0,
      tokens: v.tokens ?? "0",
      jailed: Boolean(v.jailed),
    }))
    .sort((a, b) => Number(b.tokens) - Number(a.tokens));
}

/** Chain ids the dashboard can offer, mainnet first. */
export function knownChainIds(): string[] {
  return CHAINS.map((c) => c.chainId);
}
