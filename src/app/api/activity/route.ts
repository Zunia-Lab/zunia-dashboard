/**
 * `GET /api/activity` — multi-chain transaction history for the accounts
 * the client names, decoded from public LCD tx search (lib/server/activity).
 *
 * Query:
 * - `accounts` (required): `chainId:address` pairs, comma-separated, at most
 *   24; every chain must be in the catalog and every address valid bech32
 *   under that chain's prefix (it is interpolated into the node's query).
 *   Each chain is asked for its own address: the client resolves them from
 *   the wallet, so a coin-type-60 chain is never read with a re-encoded one.
 * - `limit` 1–100 (default 50): rows wanted; a page can hold a few more when
 *   transactions share the boundary second, or fewer when the read budget ran
 *   out first (`nextCursor` then still says there is more).
 * - `kinds`: comma-separated activity kinds to keep.
 * - `cursor`: `nextCursor` of the previous page (same `accounts`, same order).
 * - `before`: ISO time, rows strictly older; ignored with `cursor` (which
 *   carries the `before` of the request that started the paging). Tx search
 *   cannot seek by time, so the read starts at the chain's tip and walks
 *   down: continue with `nextCursor` until rows older than `before` arrive.
 *
 * Answers `ActivityPage` (lib/activity/types): private (keyed by addresses),
 * partial when some chains failed (`errors`), 503 only when none could be
 * read. An entry that names a chain the catalog lacks or an address that is
 * not that chain's is left out and reported (`errors`, scope `input`), so one
 * stale followed chain does not blank the whole list; 400 when no entry is
 * usable. Rate limited per client, one token per account.
 */

import type { NextRequest } from "next/server";
import { accountsKey, decodeCursor, type ActivityCursor } from "@/lib/activity/cursor";
import { isActivityKind, type ActivityError, type ActivityKind } from "@/lib/activity/types";
import { ACTIVITY_DEFAULT_LIMIT, ACTIVITY_MAX_ACCOUNTS, ACTIVITY_MAX_LIMIT } from "@/lib/data/activity";
import { ActivityUnavailableError, readActivity, type ActivityAccount } from "@/lib/server/activity";
import { rateLimit } from "@/lib/server/rate-limit";
import { privateJson, upstreamFailure } from "@/lib/server/respond";
import { badRequest, ParamError, parseAddress, parseChainId, parseIntParam } from "@/lib/server/validate";

const MAX_ACCOUNTS_PARAM = 8_000;
/** No Cosmos chain in the catalog predates this; anything earlier is a typo. */
const EARLIEST_BEFORE = Date.UTC(2016, 0, 1);

/** The usable accounts, and what was wrong with the others (throws when none is usable). */
function parseAccounts(raw: string | null): { accounts: ActivityAccount[]; rejected: ActivityError[] } {
  const value = (raw ?? "").trim();
  if (!value) throw new ParamError("accounts_required", "accounts is required: chainId:address,…");
  if (value.length > MAX_ACCOUNTS_PARAM) throw new ParamError("accounts_too_long", "accounts is too long");
  const entries = Array.from(new Set(value.split(",").map((entry) => entry.trim()).filter(Boolean)));
  if (entries.length > ACTIVITY_MAX_ACCOUNTS) {
    throw new ParamError("accounts_too_many", `At most ${ACTIVITY_MAX_ACCOUNTS} accounts per request`);
  }
  const accounts: ActivityAccount[] = [];
  const rejected: ActivityError[] = [];
  let firstError: unknown = null;
  for (const entry of entries) {
    const split = entry.indexOf(":");
    try {
      if (split <= 0) throw new ParamError("account_invalid", "Each account is chainId:address");
      const chain = parseChainId(entry.slice(0, split), "chainId");
      accounts.push({ chainId: chain.chainId, address: parseAddress(entry.slice(split + 1), chain, "address") });
    } catch (error) {
      firstError ??= error;
      // The entry's chain id is echoed back only when it is shaped like one
      // (bounded, plain characters); a malformed entry is reported without it.
      const chainId = split > 0 ? entry.slice(0, split) : "";
      const known = chainId.length <= 64 && /^[A-Za-z0-9._-]+$/.test(chainId);
      rejected.push({
        ...(known ? { chainId } : {}),
        scope: "input",
        message: error instanceof ParamError ? error.message : "Invalid account",
      });
    }
  }
  if (accounts.length === 0) throw firstError ?? new ParamError("accounts_required", "accounts is required: chainId:address,…");
  return { accounts, rejected };
}

function parseKinds(raw: string | null): ActivityKind[] | null {
  if (!raw) return null;
  const kinds = Array.from(new Set(raw.split(",").map((kind) => kind.trim()).filter(Boolean)));
  for (const kind of kinds) {
    if (!isActivityKind(kind)) throw new ParamError("kinds_invalid", `Unknown activity kind ${kind.slice(0, 32)}`);
  }
  return kinds.length > 0 ? (kinds as ActivityKind[]) : null;
}

function parseBefore(raw: string | null): number | null {
  if (!raw) return null;
  const at = raw.length <= 40 ? Date.parse(raw) : Number.NaN;
  if (!Number.isFinite(at) || at < EARLIEST_BEFORE || at > Date.now() + 86_400_000) {
    throw new ParamError("before_invalid", "before must be an ISO date");
  }
  return at;
}

function parseCursor(raw: string | null, accounts: ActivityAccount[]): ActivityCursor | null {
  if (!raw) return null;
  const cursor = decodeCursor(raw, accounts.length);
  if (!cursor) throw new ParamError("cursor_invalid", "cursor is not valid");
  if (cursor.key !== accountsKey(accounts)) {
    throw new ParamError("cursor_mismatch", "cursor was made for a different account list");
  }
  return cursor;
}

export async function GET(req: NextRequest) {
  const params = req.nextUrl.searchParams;
  let input: Parameters<typeof readActivity>[0];
  let rejected: ActivityError[];
  try {
    const parsed = parseAccounts(params.get("accounts"));
    const accounts = parsed.accounts;
    rejected = parsed.rejected;
    input = {
      accounts,
      limit: parseIntParam(params.get("limit"), { min: 1, max: ACTIVITY_MAX_LIMIT, fallback: ACTIVITY_DEFAULT_LIMIT, name: "limit" }),
      kinds: parseKinds(params.get("kinds")),
      cursor: parseCursor(params.get("cursor"), accounts),
      before: parseBefore(params.get("before")),
    };
  } catch (error) {
    return badRequest(error);
  }

  // One token per account: a page fans out to two searches per account.
  // 96 tokens is four full 24-account pages in a burst, then one every 15 s.
  const limited = rateLimit(req, { scope: "activity", capacity: 96, refillPerSecond: 1.6, cost: input.accounts.length });
  if (limited) return limited;

  try {
    const page = await readActivity(input);
    const errors = [...rejected, ...(page.errors ?? [])];
    return privateJson(errors.length > 0 ? { ...page, errors } : page);
  } catch (error) {
    if (error instanceof ActivityUnavailableError) {
      return upstreamFailure(`No chain could be read: ${error.message}`, 503);
    }
    console.error("[api/activity] read failed", error instanceof Error ? error.name : "unknown");
    return upstreamFailure("Activity could not be read", 503);
  }
}
