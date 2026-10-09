/**
 * Insights the reader has opened or cleared, kept on this device per account.
 *
 * An insight is a standing fact ("7.2 TIA of rewards on Celestia"), so the
 * rules find it again on every read; without a memory of what was already
 * acted on, the same cards would sit at the top of the Overview for as long
 * as the fact holds. Opening one (its action button) or clearing it hides it.
 *
 * Hidden is not forgotten. An insight comes back:
 * - when it becomes more urgent than it was when it was hidden (a vote
 *   entering its last 48 hours, a validator going from a commission warning
 *   to jailed, a grant that can now move funds): the severity is part of the
 *   record, and a higher one shows again;
 * - after {@link INSIGHT_REST_MS} if it still holds (rewards claimed and
 *   grown back, an idle balance still idle a week later), except votes: a
 *   proposal has its own id and ends on its own, so a cleared vote stays
 *   cleared until its last call.
 *
 * Pure: the hook in `./index.ts` holds the record in localStorage under
 * {@link INSIGHT_DISMISSALS_KEY}, which "Clear local data" removes with the
 * rest of the dashboard's keys.
 */

import { SEVERITY_RANK, type Insight, type InsightSeverity } from "./rules";

export const INSIGHT_DISMISSALS_KEY = "zunia.dashboard.insights.dismissed";

const DAY = 24 * 60 * 60 * 1000;
/** How long an opened or cleared insight stays hidden while it still holds. */
export const INSIGHT_REST_MS = 7 * DAY;
/** Records older than this are dropped: past the rest, and past any proposal's voting period. */
const KEEP_MS = 30 * DAY;
const MAX_PER_ACCOUNT = 300;
const MAX_ACCOUNTS = 8;
const MAX_ID_LENGTH = 300;

const SEVERITIES = new Set<InsightSeverity>(["critical", "warning", "opportunity", "info"]);

export interface Dismissal {
  /** When it was hidden (epoch ms). */
  at: number;
  /** Its severity then: a more severe one shows again. */
  severity: InsightSeverity;
}

/** Account address → insight id → when and at what severity it was hidden. */
export type DismissalBook = Readonly<Record<string, Readonly<Record<string, Dismissal>>>>;

export const EMPTY_BOOK: DismissalBook = Object.freeze({});

function isDismissal(value: unknown): value is Dismissal {
  if (!value || typeof value !== "object") return false;
  const entry = value as Partial<Dismissal>;
  return typeof entry.at === "number" && Number.isFinite(entry.at) && typeof entry.severity === "string" && SEVERITIES.has(entry.severity as InsightSeverity);
}

/** Whatever localStorage held, as a book; malformed entries are dropped, never trusted. */
export function readBook(raw: unknown): DismissalBook {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return EMPTY_BOOK;
  const book: Record<string, Record<string, Dismissal>> = {};
  for (const [account, entries] of Object.entries(raw as Record<string, unknown>)) {
    if (!account || account.length > MAX_ID_LENGTH || !entries || typeof entries !== "object" || Array.isArray(entries)) continue;
    const kept: Record<string, Dismissal> = {};
    for (const [id, entry] of Object.entries(entries as Record<string, unknown>)) {
      if (id.length === 0 || id.length > MAX_ID_LENGTH || !isDismissal(entry)) continue;
      kept[id] = { at: entry.at, severity: entry.severity };
    }
    if (Object.keys(kept).length > 0) book[account] = kept;
  }
  return book;
}

/** A vote's id names its proposal, which ends on its own: no rest period. */
const restsForever = (id: string) => id.startsWith("vote:");

/** Whether `insight` stays hidden under `entry` at `now`. */
export function isDismissed(insight: Pick<Insight, "id" | "severity">, entry: Dismissal | undefined, now: number): boolean {
  if (!entry) return false;
  // More severe than when it was hidden: it is news again.
  if (SEVERITY_RANK[insight.severity] < SEVERITY_RANK[entry.severity]) return false;
  if (restsForever(insight.id)) return true;
  return now - entry.at < INSIGHT_REST_MS;
}

/** The list cut in two: what to show, and what the reader hid. Order is kept. */
export function splitDismissed<T extends Pick<Insight, "id" | "severity">>(
  items: readonly T[],
  entries: Readonly<Record<string, Dismissal>> | undefined,
  now: number,
): { visible: T[]; hidden: T[] } {
  const visible: T[] = [];
  const hidden: T[] = [];
  for (const item of items) (isDismissed(item, entries?.[item.id], now) ? hidden : visible).push(item);
  return { visible, hidden };
}

/** Drops records nothing can still hide, then the oldest past the cap. */
function prune(entries: Record<string, Dismissal>, now: number): Record<string, Dismissal> {
  const kept = Object.entries(entries)
    .filter(([, entry]) => now - entry.at < KEEP_MS && entry.at <= now + DAY)
    .sort((a, b) => b[1].at - a[1].at)
    .slice(0, MAX_PER_ACCOUNT);
  return Object.fromEntries(kept);
}

/** Hides `insights` for `account`, recording each one's severity now. */
export function dismissInsights(
  book: DismissalBook,
  account: string,
  insights: readonly Pick<Insight, "id" | "severity">[],
  now: number,
): DismissalBook {
  if (!account || insights.length === 0) return book;
  const entries: Record<string, Dismissal> = { ...(book[account] ?? {}) };
  for (const insight of insights) entries[insight.id] = { at: now, severity: insight.severity };
  const next: Record<string, Readonly<Record<string, Dismissal>>> = { ...book, [account]: prune(entries, now) };
  // Accounts used least recently go first once the device has seen many.
  const accounts = Object.keys(next);
  if (accounts.length > MAX_ACCOUNTS) {
    const latest = (id: string) => Math.max(0, ...Object.values(next[id]).map((entry) => entry.at));
    for (const old of accounts.filter((id) => id !== account).sort((a, b) => latest(a) - latest(b)).slice(0, accounts.length - MAX_ACCOUNTS)) {
      delete next[old];
    }
  }
  return next;
}

/** Shows everything `account` hid again. */
export function restoreInsights(book: DismissalBook, account: string): DismissalBook {
  if (!account || !(account in book)) return book;
  const next = { ...book };
  delete next[account];
  return next;
}

/** How many records still hide something for `account` (Settings' count, without running the rules). */
export function activeDismissals(book: DismissalBook, account: string | null | undefined, now: number): number {
  if (!account) return 0;
  return Object.entries(book[account] ?? {}).filter(([id, entry]) => restsForever(id) || now - entry.at < INSIGHT_REST_MS).length;
}
