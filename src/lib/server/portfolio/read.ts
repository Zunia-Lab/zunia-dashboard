/**
 * What one account holds on one chain, read from the chain's public LCD.
 *
 * Four reads per chain, the bank one paginated (≤ 10 pages of 200 — a wallet
 * that has received a thousand airdropped denoms is still read whole up to
 * 2,000; past the cap the answer carries an issue saying only part was
 * counted, never a silently short list), the others in parallel with it:
 *
 * - bank balances: required. If it fails the chain is "error" — a chain row
 *   without its liquid balances would be a confident wrong number;
 * - delegations, rewards, unbonding: best effort. A failure is reported as an
 *   issue (scope "delegations" etc.) and the rest of the chain still counts.
 *   HTTP 404/501 means the chain has no such module (a consumer chain, a PoA
 *   chain), which is "nothing staked", not an error.
 *
 * Cached per (chain, address) for 30 s, so the Overview cards, the chain rail
 * and a refetch inside the same half minute cost one read; `fetchJson` caps
 * concurrent requests per host so a 32-chain portfolio cannot open a burst of
 * sockets against one public node.
 */

import "server-only";

import { cached, invalidate } from "@/lib/server/cache";
import { restOf } from "@/lib/server/chains";
import { describeUpstreamError, fetchJson, UpstreamError } from "@/lib/server/http";
import type { UpstreamIssue } from "@/lib/token/wire";
import type { ChainHoldings } from "./aggregate";
import {
  parseBalancesPage,
  parseDelegationsPage,
  parseRewards,
  parseUnbondingPage,
  type Coin,
  type Page,
} from "./parse";

const TTL_MS = 30_000;
const TIMEOUT_MS = 7_000;
const BANK_PAGES = 10;
const STAKING_PAGES = 5;
const PAGE_LIMIT = 200;

function cacheKey(chainId: string, address: string): string {
  return `portfolio:chain:${chainId}:${address}`;
}

/** Drops the cached read, so the next portfolio read sees a just-broadcast transaction. */
export function invalidatePortfolioRead(chainId: string, address: string): void {
  invalidate(cacheKey(chainId, address));
}

function absent(error: unknown): boolean {
  return error instanceof UpstreamError && error.kind === "http" && (error.status === 404 || error.status === 501);
}

interface Paged<T> {
  rows: T[];
  /** The chain had more pages than the cap: `rows` is the first part only. */
  truncated: boolean;
}

async function paginate<T>(
  url: (key: string | null) => string,
  parse: (body: unknown) => Page<T> | null,
  maxPages: number,
): Promise<Paged<T>> {
  const rows: T[] = [];
  let key: string | null = null;
  for (let page = 0; page < maxPages; page += 1) {
    const body = await fetchJson(url(key), { timeoutMs: TIMEOUT_MS, retries: 1 });
    const parsed = parse(body);
    if (!parsed) throw new Error("Unreadable answer");
    rows.push(...parsed.rows);
    if (!parsed.nextKey) return { rows, truncated: false };
    key = parsed.nextKey;
  }
  return { rows, truncated: true };
}

function sumByDenom(coins: readonly Coin[]): Coin[] {
  const sums = new Map<string, bigint>();
  for (const coin of coins) sums.set(coin.denom, (sums.get(coin.denom) ?? BigInt(0)) + BigInt(coin.amount));
  return [...sums].map(([denom, amount]) => ({ denom, amount: amount.toString() }));
}

/**
 * The account's holdings on `chainId`. Rejects only when the bank read fails
 * (or the chain has no REST endpoint); every other failure is an issue.
 * `bondDenom` is the catalog's staking denom, used when a delegation row does
 * not name one (unbonding entries never do).
 */
export function readChainHoldings(chainId: string, address: string, bondDenom: string): Promise<ChainHoldings> {
  return cached(cacheKey(chainId, address), { ttlMs: TTL_MS, staleMs: TTL_MS, errorTtlMs: 10_000 }, async () => {
    const rest = restOf(chainId);
    if (!rest) throw new Error("No public endpoint for this chain in the catalog");
    const account = encodeURIComponent(address);
    const page = (path: string) => (key: string | null) =>
      `${rest}${path}?pagination.limit=${PAGE_LIMIT}${key ? `&pagination.key=${encodeURIComponent(key)}` : ""}`;

    const [bank, delegations, rewards, unbonding] = await Promise.allSettled([
      paginate(page(`/cosmos/bank/v1beta1/balances/${account}`), parseBalancesPage, BANK_PAGES),
      paginate(page(`/cosmos/staking/v1beta1/delegations/${account}`), parseDelegationsPage, STAKING_PAGES),
      fetchJson(`${rest}/cosmos/distribution/v1beta1/delegators/${account}/rewards`, {
        timeoutMs: TIMEOUT_MS,
        retries: 1,
      }).then((body): Paged<Coin> => {
        const parsed = parseRewards(body);
        if (!parsed) throw new Error("Unreadable answer");
        return { rows: parsed, truncated: false };
      }),
      paginate(
        page(`/cosmos/staking/v1beta1/delegators/${account}/unbonding_delegations`),
        parseUnbondingPage,
        STAKING_PAGES,
      ),
    ]);

    if (bank.status === "rejected") throw bank.reason;

    const issues: UpstreamIssue[] = [];
    const settle = <T>(result: PromiseSettledResult<Paged<T>>, scope: string, cap: number): T[] => {
      if (result.status === "fulfilled") {
        // Partial data beats none, but it must say it is partial.
        if (result.value.truncated) {
          issues.push({ scope, message: `More than ${cap.toLocaleString("en-US")} entries; only the first ${cap.toLocaleString("en-US")} are counted` });
        }
        return result.value.rows;
      }
      if (!absent(result.reason)) {
        const reason = result.reason instanceof Error && result.reason.message === "Unreadable answer"
          ? "Unreadable answer"
          : describeUpstreamError(result.reason);
        issues.push({ scope, message: reason });
      }
      return [];
    };

    const liquid = settle(bank, "bank", BANK_PAGES * PAGE_LIMIT);
    const delegated = settle(delegations, "delegations", STAKING_PAGES * PAGE_LIMIT);
    const staked = sumByDenom(delegated.map((row) => ({ denom: row.denom, amount: row.amount })));
    const stakingDenom = delegated[0]?.denom ?? bondDenom;
    const unbondingEntries = settle(unbonding, "unbonding", STAKING_PAGES * PAGE_LIMIT);
    return {
      liquid,
      staked,
      rewards: sumByDenom(settle(rewards, "rewards", 0)),
      unbonding: sumByDenom(unbondingEntries.map((entry) => ({ denom: stakingDenom, amount: entry.amount }))),
      issues,
    };
  });
}
