/**
 * The activity list's paging cursor.
 *
 * A time (`before=<ISO>`) cannot page a public tx search exactly: the search
 * filters by height, not time, and pages by offset, which drifts when new
 * transactions land and differs between the nodes behind one load balancer.
 * The cursor instead carries, per account, the height bound the next read
 * starts below (`tx.height<=N`), so every "load more" is a fresh first page
 * of a fixed range — no offsets, no gaps, no repeats.
 *
 * It also carries what the coverage verdict needs across pages: the oldest
 * transaction seen and how many the account signed (compared with the
 * account's sequence to tell "the node's window holds the whole history"
 * from "older history was pruned"); whether the account is finished (both
 * searches reached the end on an earlier page, so it is not read again); and
 * the `before` bound of a time-paged request, so continuing with the cursor
 * keeps excluding what that request excluded.
 *
 * Opaque to clients, bound to the exact account list by `key`. Not signed:
 * a forged cursor can only change what its own sender sees. Pure.
 */

export interface AccountCursor {
  /** Inclusive height bound for the next read; null starts at the chain's tip. */
  upper: number | null;
  /** Oldest transaction consumed so far (epoch ms); null when none. */
  oldest: number | null;
  /** That oldest transaction was signed by the account (rather than received). */
  oldestSigned: boolean;
  /** Transactions the account signed among those consumed so far. */
  signedSeen: number;
  /** Nothing is left to read for the account: later pages skip it. */
  done?: boolean;
  /**
   * The bound moved past rows while one of the account's searches could not
   * be read, so older pages may miss some of its transactions (coverage says
   * so until the list is read again from the top).
   */
  gapped?: boolean;
}

export interface ActivityCursor {
  /** `accountsKey` of the account list the cursor pages through. */
  key: string;
  accounts: AccountCursor[];
  /** `before` (epoch ms) of the request that started the paging, if any. */
  before?: number | null;
}

export const EMPTY_ACCOUNT_CURSOR: AccountCursor = { upper: null, oldest: null, oldestSigned: false, signedSeen: 0 };

const MAX_CURSOR_LENGTH = 4_096;
const FLAG_DONE = 1;
const FLAG_GAPPED = 2;
const MAX_SAFE = Number.MAX_SAFE_INTEGER;

/** FNV-1a (32-bit) of the account list, so a cursor cannot be replayed against other accounts. */
export function accountsKey(accounts: ReadonlyArray<{ chainId: string; address: string }>): string {
  let hash = 0x811c9dc5;
  const input = accounts.map((account) => `${account.chainId}:${account.address}`).join("|");
  for (let i = 0; i < input.length; i++) {
    hash ^= input.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash.toString(16).padStart(8, "0");
}

function toBase64Url(value: string): string {
  return btoa(value).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function fromBase64Url(value: string): string | null {
  if (!/^[A-Za-z0-9_-]*$/.test(value)) return null;
  const padded = value.replace(/-/g, "+").replace(/_/g, "/") + "===".slice((value.length + 3) % 4);
  try {
    return atob(padded);
  } catch {
    return null;
  }
}

export function encodeCursor(cursor: ActivityCursor): string {
  const accounts = cursor.accounts.map((account) => [
    account.upper,
    account.oldest,
    account.oldestSigned ? 1 : 0,
    account.signedSeen,
    (account.done ? FLAG_DONE : 0) | (account.gapped ? FLAG_GAPPED : 0),
  ]);
  const before = cursor.before ?? null;
  return `v1.${toBase64Url(JSON.stringify(before === null ? { k: cursor.key, a: accounts } : { k: cursor.key, a: accounts, b: before }))}`;
}

function nullableInteger(value: unknown, min: number): number | null | undefined {
  if (value === null) return null;
  return typeof value === "number" && Number.isInteger(value) && value >= min && value <= MAX_SAFE ? value : undefined;
}

/** The cursor, or null when it is malformed or was made for a different number of accounts. */
export function decodeCursor(raw: string, accountCount: number): ActivityCursor | null {
  if (raw.length > MAX_CURSOR_LENGTH || !raw.startsWith("v1.")) return null;
  const json = fromBase64Url(raw.slice(3));
  if (json === null) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(json);
  } catch {
    return null;
  }
  if (typeof parsed !== "object" || parsed === null) return null;
  const record = parsed as { k?: unknown; a?: unknown; b?: unknown };
  if (typeof record.k !== "string" || !/^[0-9a-f]{8}$/.test(record.k)) return null;
  if (!Array.isArray(record.a) || record.a.length !== accountCount) return null;
  const before = record.b === undefined ? null : nullableInteger(record.b, 0);
  if (before === undefined) return null;
  const accounts: AccountCursor[] = [];
  for (const entry of record.a) {
    // Four fields before the flags existed; five since.
    if (!Array.isArray(entry) || (entry.length !== 4 && entry.length !== 5)) return null;
    const upper = nullableInteger(entry[0], 0);
    const oldest = nullableInteger(entry[1], 0);
    const signedSeen = nullableInteger(entry[3], 0);
    if (upper === undefined || oldest === undefined || signedSeen === undefined || signedSeen === null) return null;
    if (entry[2] !== 0 && entry[2] !== 1) return null;
    const flags = entry.length === 5 ? entry[4] : 0;
    if (typeof flags !== "number" || !Number.isInteger(flags) || flags < 0 || flags > (FLAG_DONE | FLAG_GAPPED)) return null;
    accounts.push({
      upper,
      oldest,
      oldestSigned: entry[2] === 1,
      signedSeen,
      ...(flags & FLAG_DONE ? { done: true } : {}),
      ...(flags & FLAG_GAPPED ? { gapped: true } : {}),
    });
  }
  return { key: record.k, accounts, ...(before !== null ? { before } : {}) };
}
