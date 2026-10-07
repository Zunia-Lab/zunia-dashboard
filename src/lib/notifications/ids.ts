/**
 * Notice ids and links, in one place for every producer.
 *
 * The id is the contract between three producers that never talk to each
 * other: the in-page feed (derived from the activity, staking and governance
 * reads), the push poller on the server (derived from LCD tx searches), and a
 * second open tab. Each builds the id for the same event independently, so the
 * recipe must be identical everywhere — it is the read-state key, the
 * "already announced" key and the OS notification tag at once. A drift here is
 * a duplicate notification, so nothing else may format these strings.
 *
 * Ids follow the extension's scheme (zunia-extension `lib/notices.ts` @
 * 1453e7a: `rewards:<cycle>`, `unbonding:<chain>:<val>:<time>`,
 * `transfer:<hash>`, `gov:<chain>:<id>`), with two normalisations the extension
 * did not need because it had a single producer: tx hashes are upper-cased (an
 * LCD answers upper case, other APIs lower) and unbonding completion times are
 * epoch milliseconds (one source says `…:56.123456789Z`, another
 * `…:56.123Z`; both are the same instant).
 */

function upperHash(hash: string): string {
  return hash.trim().toUpperCase();
}

export const noticeId = {
  rewards: (cycle: number): string => `rewards:${cycle}`,
  unbonding: (chainId: string, validator: string, completesAt: number): string =>
    `unbonding:${chainId}:${validator}:${completesAt}`,
  /** Incoming transfers and IBC arrivals share the tx namespace. */
  transfer: (hash: string): string => `transfer:${upperHash(hash)}`,
  swap: (hash: string): string => `swap:${upperHash(hash)}`,
  /** An open vote the account has not cast. */
  governance: (chainId: string, proposalId: string): string => `gov:${chainId}:${proposalId}`,
  /**
   * The same vote inside its last 24 hours. A separate id on purpose: reading
   * the "vote open" row a week earlier must not swallow the last call.
   */
  governanceEnding: (chainId: string, proposalId: string): string =>
    `gov:${chainId}:${proposalId}:24h`,
  validatorJailed: (chainId: string, validator: string, since: number): string =>
    `validator:${chainId}:${validator}:jailed:${since}`,
  validatorInactive: (chainId: string, validator: string, since: number): string =>
    `validator:${chainId}:${validator}:inactive:${since}`,
  /** Keyed on the new rate in basis points, so a second raise is a new notice. */
  validatorCommission: (chainId: string, validator: string, rate: number): string =>
    `validator:${chainId}:${validator}:commission:${Math.round(rate * 10_000)}`,
  test: (at: number): string => `system:test:${at}`,
};

const q = encodeURIComponent;

/**
 * Where a notice takes the user.
 *
 * Each link uses the form its page reads: the transaction page takes
 * `?chainId=` (the activity list, the live rail and `/api/activity/[hash]`
 * all use it), a proposal lives at `/governance/<chainId>/<id>` (ids are per
 * chain; the old `/governance/<id>?chain=` form still redirects there, for
 * notifications already delivered), and validator pages take `?chain=`.
 */
export const noticeHref = {
  tx: (chainId: string, hash: string): string => `/activity/${q(upperHash(hash))}?chainId=${q(chainId)}`,
  proposal: (chainId: string, proposalId: string): string => `/governance/${q(chainId)}/${q(proposalId)}`,
  validator: (chainId: string, validator: string): string =>
    `/validators/${q(validator)}?chain=${q(chainId)}`,
  staking: (): string => "/staking",
  notifications: (): string => "/notifications",
};

const CHAIN_TIME = /^(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2})(?:\.(\d+))?(Z|[+-]\d{2}:\d{2})$/;

/**
 * A chain timestamp in epoch ms, or null.
 *
 * Cosmos LCDs print nanoseconds (`2026-10-12T11:58:17.002622909Z`). Engines
 * differ on how many fraction digits `Date.parse` accepts, and an id built
 * from a time must not depend on the engine, so the fraction is cut to
 * milliseconds (truncated, never rounded) before parsing.
 */
export function parseChainTime(value: string | number | null | undefined): number | null {
  if (typeof value === "number") return Number.isFinite(value) ? Math.floor(value) : null;
  if (typeof value !== "string") return null;
  const match = CHAIN_TIME.exec(value.trim());
  if (match) {
    const fraction = (match[2] ?? "").slice(0, 3).padEnd(3, "0");
    const ms = Date.parse(`${match[1]}.${fraction}${match[3]}`);
    return Number.isFinite(ms) ? ms : null;
  }
  const ms = Date.parse(value);
  return Number.isFinite(ms) ? ms : null;
}
