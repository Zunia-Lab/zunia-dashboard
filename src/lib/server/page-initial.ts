/**
 * First answers for the public pages (Markets, Validators, Governance, a
 * chain's page): the page reads, on the server, the answer its client hook is
 * about to ask its API route for, and hands it down as the hook's `initial`
 * (`@/lib/useApi`). The first HTML then carries real prices, monikers,
 * proposal titles and the links to their pages (search engines, link
 * previews, slow networks) instead of skeletons, and the browser starts from
 * that answer instead of reading the route again.
 *
 * Three rules every reader here keeps:
 *
 * - **The route's answer, exactly.** The same server functions and caches the
 *   route reads through, assembled into the body the route sends (validators
 *   and governance repeat the route's assembly: keep the two in step), then
 *   copied through JSON as `Response.json` would send it, so the browser holds
 *   the same value whichever way it arrived. Whatever the route would answer
 *   with an error status (a 503 when nothing could be read) is not handed
 *   down: the page renders as it did before, and the browser's own read shows
 *   the reason with its Retry.
 * - **The URL the first render asks for.** Built with the hook's own `apiUrl`
 *   call from the values the browser's first render holds: USD, the followed
 *   chains of a first visit, no wallet. A stored currency, scope or a wallet
 *   is another URL, and the hook reads that one as it always did.
 * - **Bounded.** These pages render per request and do not stream (no loading
 *   boundary above them, so a missing chain or proposal stays a real 404), so
 *   the wait is time to first byte. A warm cache answers at once (the boot
 *   warm-up in `instrumentation.ts` fills it for the default chains); past
 *   `PAGE_READ_BUDGET_MS` the page renders without the answer, and the read
 *   carries on and warms the cache the browser's request then hits.
 */

import "server-only";

import { apiUrl } from "@/lib/api-url";
import { validatorApr } from "@/lib/chain/apr";
import type { PartError, ProposalRow, ProposalsResponse, ValidatorsResponse } from "@/lib/chain/types";
import { readEconomics } from "@/lib/server/chain/economics";
import { INHERITED_BUDGET, readChainProposals, sortProposals, type LookupBudget } from "@/lib/server/chain/governance";
import { within } from "@/lib/server/chain/lcd";
import { oldest, unknownChainErrors } from "@/lib/server/chain/request";
import { readChainDetail, statsUnavailable } from "@/lib/server/chain/stats";
import { readValidatorSet } from "@/lib/server/chain/validator-set";
import type { ServerChainEntry } from "@/lib/server/chains";
import { mapLimit } from "@/lib/server/http";
import { getMarkets } from "@/lib/server/prices/markets";
import { parseChainId, parseChainList } from "@/lib/server/validate";
import { attachValidatorLogos } from "@/lib/server/validator-logos";
import type { FiatCurrency } from "@/lib/token/types";
import type { ApiInitial } from "@/lib/useApi";

/**
 * How long a page waits for its first answer. Warm, the read is a cache hit
 * and costs nothing; this only bounds a cold one (just after a restart, or a
 * chain nobody opened lately), which renders the page as before, a skeleton
 * the browser fills, after at most this much more time to first byte.
 */
export const PAGE_READ_BUDGET_MS = 1_200;

/**
 * The currency of every first render: `PrefsProvider`'s default, since the
 * stored choice is read from localStorage only once the page has hydrated.
 */
const FIRST_CURRENCY: FiatCurrency = "usd";

/**
 * `read()` within the budget, as the hook's `initial` for `url`; null when it
 * failed or ran late. Never throws: a page renders whatever its read does.
 */
async function firstAnswer(url: string, read: () => Promise<unknown>): Promise<ApiInitial | null> {
  // Called from a microtask, so a throw before the read's first await (an
  // unknown chain id) is a rejection like any other.
  const answer = Promise.resolve()
    .then(read)
    .catch(() => null);
  const body = await within<unknown>(answer, PAGE_READ_BUDGET_MS, () => null);
  if (body === null || body === undefined) return null;
  try {
    // As the route sends it: no undefined keys, NaN as null, and no object
    // shared with the process-wide cache.
    return { url, data: JSON.parse(JSON.stringify(body)) as unknown, at: Date.now() };
  } catch {
    return null;
  }
}

/* ------------------------------------------------------------------ markets */

/** `/api/markets` as `useMarkets` asks for it on a first render. */
export function marketsInitial(): Promise<ApiInitial | null> {
  return firstAnswer(apiUrl("/api/markets", { currency: FIRST_CURRENCY }), () => getMarkets(FIRST_CURRENCY));
}

/* ------------------------------------------------------------------ chain detail */

/** `/api/chains/<id>` as `useChainDetail` asks for it on a first render. */
export function chainDetailInitial(chainId: string): Promise<ApiInitial | null> {
  return firstAnswer(apiUrl(`/api/chains/${encodeURIComponent(chainId)}`, { currency: FIRST_CURRENCY }), async () => {
    const detail = await readChainDetail(parseChainId(chainId), FIRST_CURRENCY);
    // Nothing readable at all: the route answers 503 for this one.
    return statsUnavailable(detail.chain) && detail.validatorSet === null ? null : detail;
  });
}

/* ------------------------------------------------------------------ validators */

/** `/api/validators?chainId=` (the bonded set) as `useValidators` asks for it on a first render. */
export function validatorsInitial(chainId: string): Promise<ApiInitial | null> {
  return firstAnswer(apiUrl("/api/validators", { chainId, status: null }), async () => readValidators(parseChainId(chainId)));
}

/** The bonded set's body, assembled as `app/api/validators/route.ts` (`readOne`) assembles it. */
async function readValidators(chain: ServerChainEntry): Promise<ValidatorsResponse> {
  const status = "bonded";
  const [economics, set] = await Promise.all([readEconomics(chain), readValidatorSet(chain, { status, chainApr: null })]);
  const chainApr = economics.result.apr.actual;
  const withApr = set.rows.map((row) => ({
    ...row,
    apr: chainApr === null ? null : row.status === "bonded" && !row.jailed ? validatorApr(chainApr, row.commission.rate) : 0,
  }));
  const rows = await attachValidatorLogos(chain, withApr, { waitMs: 1_500, keybaseWaitMs: 0 });
  const errors: PartError[] = [...set.errors];
  return {
    updatedAt: oldest([set.asOf]),
    chainId: chain.chainId,
    chainName: chain.chainName,
    symbol: economics.symbol,
    decimals: economics.decimals,
    status,
    summary: {
      ...set.summary,
      aprActual: chainApr,
      ...(chainApr === null ? { aprNote: economics.result.apr.note ?? "APR unavailable" } : {}),
    },
    validators: rows,
    ...(set.truncated ? { truncated: true } : {}),
    ...(errors.length ? { errors } : {}),
  };
}

/* ------------------------------------------------------------------ governance */

/**
 * `/api/governance?chains=…&status=all` (public, no voter) as `useProposals`
 * asks for it on a first render: every proposal in voting plus the 20 most
 * recent per chain, for `chainIds` in the order the page lists them.
 */
export function proposalsInitial(chainIds: readonly string[]): Promise<ApiInitial | null> {
  const key = chainIds.filter(Boolean).slice(0, 40).join(",");
  if (!key) return Promise.resolve(null);
  return firstAnswer(apiUrl("/api/governance", { chains: key, status: "all", voter: null }), () => readProposals(key));
}

/** The public list's body, assembled as `app/api/governance/route.ts` assembles it. */
async function readProposals(chainsParam: string): Promise<ProposalsResponse | null> {
  const parsed = parseChainList(chainsParam, 40);
  const budget: LookupBudget = { remaining: INHERITED_BUDGET };
  // No per-chain deadline: the route's (12 s) never fires within this page's
  // budget, and an answer missing a slow chain is not the route's answer.
  const results = await mapLimit(parsed.chains, 12, (chain) => readChainProposals(chain, "all", null, budget));
  // Every chain failed: the route answers 503.
  if (parsed.chains.length > 0 && results.every((result) => !result.ok)) return null;
  const proposals: ProposalRow[] = sortProposals(results.flatMap((result) => result.rows));
  const errors: PartError[] = [...unknownChainErrors(parsed.unknown), ...results.flatMap((result) => result.errors)];
  return {
    updatedAt: oldest(results.map((result) => result.at)),
    proposals,
    chains: results.map((result) => ({
      chainId: result.chainId,
      status: result.ok ? "ok" : "error",
      api: result.api,
    })),
    ...(parsed.unknown.length ? { unknown: parsed.unknown } : {}),
    ...(errors.length ? { errors } : {}),
  };
}
