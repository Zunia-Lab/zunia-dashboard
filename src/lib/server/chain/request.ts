/**
 * Request parsing shared by the chain analytics routes.
 *
 * `accounts=` (and `voter=`) carry `chainId:address` pairs. Every chain id
 * must be in the catalog (that is where upstream hosts come from) and every
 * address must decode as bech32 under that chain's prefix, so a request can
 * never steer a read to an unexpected path. Unknown chain ids are reported
 * back rather than failing the whole request (a followed chain can leave the
 * catalog); a malformed pair or address is a client bug and answers 400.
 */

import "server-only";
import { findServerChain, SERVER_CHAINS, type ServerChainEntry } from "@/lib/server/chains";
import { upstreamFailure } from "@/lib/server/respond";
import { bech32 } from "bech32";
import { decodeBech32, ParamError, parseAddress, parseEnum } from "@/lib/server/validate";
import { splitAccounts } from "@/lib/chain/accounts";
import type { PartError } from "@/lib/chain/types";
import type { FiatCurrency } from "@/lib/token/types";

export interface ResolvedAccount {
  chain: ServerChainEntry;
  address: string;
}

/**
 * A validator operator address on `chain`.
 *
 * Usually `<prefix>valoper1…`, but not always: Crypto.org's operators are
 * `crocncl1…` on the `cro` account prefix, which `parseValoper` in
 * `@/lib/server/validate` refuses. Accepted: any bech32 address whose prefix
 * extends the chain's account prefix (and is not the account prefix itself),
 * 20 or 32 bytes. The chain's LCD then says whether such a validator exists.
 */
export function parseOperatorAddress(raw: string | null | undefined, chain: Pick<ServerChainEntry, "bech32Prefix">): string {
  const value = (raw ?? "").trim();
  const decoded = value.length <= 128 ? decodeBech32(value) : null;
  if (
    !decoded ||
    decoded.prefix === chain.bech32Prefix ||
    !decoded.prefix.startsWith(chain.bech32Prefix) ||
    !/^[a-z0-9_]+$/.test(decoded.prefix)
  ) {
    throw new ParamError("validator_invalid", `validator must be an operator address of this chain (${chain.bech32Prefix}valoper1…)`);
  }
  const bytes = bech32.fromWords(decoded.words).length;
  if (bytes !== 20 && bytes !== 32) throw new ParamError("validator_invalid", "validator has an unexpected length");
  return value;
}

/**
 * The chain an operator address belongs to when no chain id was given: the
 * one mainnet whose `<prefix>valoper` matches exactly, else the one whose
 * account prefix the operator prefix extends (Crypto.org's `crocncl`).
 */
export function inferOperatorChain(address: string): ServerChainEntry {
  const decoded = decodeBech32(address.trim());
  if (!decoded) throw new ParamError("validator_invalid", "validator must be an operator address (…valoper1…)");
  const prefix = decoded.prefix;
  const pickOne = (matches: ServerChainEntry[]) => {
    const mainnets = matches.filter((chain) => chain.network === "mainnet");
    return mainnets.length === 1 ? mainnets[0] : matches.length === 1 ? matches[0] : undefined;
  };
  const exact = SERVER_CHAINS.filter((chain) => `${chain.bech32Prefix}valoper` === prefix);
  const loose = exact.length
    ? []
    : SERVER_CHAINS.filter((chain) => prefix !== chain.bech32Prefix && prefix.startsWith(chain.bech32Prefix));
  const candidates = exact.length ? exact : loose;
  if (candidates.length === 0) {
    throw new ParamError("validator_invalid", "validator must be an operator address of a known chain (…valoper1…)");
  }
  const chosen = pickOne(candidates);
  if (!chosen) throw new ParamError("chainId_required", "chainId is required for this address prefix");
  return chosen;
}

/**
 * The chain and operator a validator URL names, or `null` when it can name
 * none: the synchronous half of the validator page's lookup
 * (`(app)/validators/[address]/lookup.ts`), as a function so a malformed
 * address is refused by exactly the page's rule, before any read.
 *
 * `rawAddress` is the route param as Next hands it to the page (decoded once);
 * it is decoded once more, like the page does, and trimmed. `chainParam` is
 * the page's `?chain=` (or `?chainId=`) value; without one the chain is
 * inferred from the operator prefix.
 */
export function locateOperator(
  rawAddress: string,
  chainParam: string | null,
): { chain: ServerChainEntry; operator: string } | null {
  let address: string;
  try {
    address = decodeURIComponent(rawAddress).trim();
  } catch {
    return null;
  }
  if (!address || address.length > 128) return null;
  try {
    const chain = chainParam ? findServerChain(chainParam) : inferOperatorChain(address);
    if (!chain) return null;
    return { chain, operator: parseOperatorAddress(address, chain) };
  } catch {
    return null;
  }
}

const CURRENCIES = ["usd", "eur", "gbp"] as const;

/** `currency=usd|eur|gbp` (case-insensitive), default usd. */
export function parseCurrency(raw: string | null | undefined): FiatCurrency {
  return parseEnum(raw?.toLowerCase(), CURRENCIES, "usd", "currency");
}

/** Validated `chainId:address` pairs; throws ParamError on bad input. */
export function parseAccountsParam(
  raw: string | null,
  { max, name = "accounts", required = true }: { max: number; name?: string; required?: boolean },
): { accounts: ResolvedAccount[]; unknown: string[] } {
  const split = splitAccounts(raw, max);
  if (!split.ok) {
    throw new ParamError(split.code.replace("accounts", name), `${name}: ${split.message}`);
  }
  if (required && split.accounts.length === 0) {
    throw new ParamError(`${name}_required`, `${name} is required (chainId:address,…)`);
  }
  const accounts: ResolvedAccount[] = [];
  const unknown: string[] = [];
  for (const { chainId, address } of split.accounts) {
    const chain = findServerChain(chainId);
    if (!chain) {
      unknown.push(chainId.slice(0, 64));
      continue;
    }
    accounts.push({ chain, address: parseAddress(address, chain, name) });
  }
  return { accounts, unknown };
}

/** Errors for requested chain ids that are not in the catalog. */
export function unknownChainErrors(unknown: readonly string[]): PartError[] {
  return unknown.map((chainId) => ({ chainId, scope: "request", message: "Unknown chain" }));
}

/** 503 for "every requested chain failed" (never 502: Cloudflare replaces 502 bodies). */
export function allFailed(message: string): Response {
  return upstreamFailure(message, 503);
}

/**
 * Request-wide budget of the single-chain routes. A cold read of a slow node
 * can take longer (each upstream call has its own 6–10 s timeout, and some
 * run one after another); past this the route answers instead of holding the
 * socket until nginx gives up, and the reads keep landing in the cache.
 */
export const SINGLE_CHAIN_BUDGET_MS = 15_000;

/** 503 + Retry-After for "still loading": the next request is served from the cache. */
export function stillLoading(message: string): Response {
  return Response.json(
    { error: "upstream_timeout", message },
    { status: 503, headers: { "cache-control": "no-store", "retry-after": "5" } },
  );
}

/** Smallest positive timestamp, or `fallback`. */
export function oldest(times: ReadonlyArray<number | null | undefined>, fallback = Date.now()): number {
  let min = Number.POSITIVE_INFINITY;
  for (const at of times) {
    if (typeof at === "number" && at > 0 && at < min) min = at;
  }
  return Number.isFinite(min) ? min : fallback;
}
