/**
 * The activity API as the browser sees it: the response shapes, the URL
 * builders and the shape guards `useApi` parses with.
 *
 * Client-safe and pure. Pages import types from here (or `@/lib/activity/types`),
 * hooks build URLs with `activityUrl` / `txUrl`, and the route handlers share
 * the limits below so the client never builds a request the server refuses.
 */

import type { ActivityKind, ActivityPage, TxDetail } from "@/lib/activity/types";

export type {
  ActivityAmount,
  ActivityCoverage,
  ActivityError,
  ActivityFee,
  ActivityIbc,
  ActivityItem,
  ActivityKind,
  ActivityPage,
  FlowDirection,
  TxDetail,
  TxEventCount,
  TxMessageDetail,
  TxMovement,
  TxPacket,
  TxPacketStage,
} from "@/lib/activity/types";
export { ACTIVITY_KINDS, isActivityKind } from "@/lib/activity/types";

/** Accounts (chain + address pairs) one `/api/activity` request may read. */
export const ACTIVITY_MAX_ACCOUNTS = 24;
export const ACTIVITY_DEFAULT_LIMIT = 50;
export const ACTIVITY_MAX_LIMIT = 100;

export interface ActivityQuery {
  accounts: ReadonlyArray<{ chainId: string; address: string }>;
  limit?: number;
  kinds?: readonly ActivityKind[];
  /** From a previous page's `nextCursor`. */
  cursor?: string | null;
  /**
   * ISO time: rows strictly older. Only used without a cursor; the cursor of
   * the answer carries it on. Tx search cannot seek by time, so the read
   * walks down from the tip: continue with `nextCursor`.
   */
  before?: string | null;
}

/** `/api/activity?accounts=chain:addr,…&limit=&kinds=&cursor=`. Account order is kept: the cursor is bound to it. */
export function activityUrl(query: ActivityQuery): string {
  const params = new URLSearchParams();
  params.set("accounts", query.accounts.map((account) => `${account.chainId}:${account.address}`).join(","));
  if (query.limit !== undefined) params.set("limit", String(query.limit));
  if (query.kinds && query.kinds.length > 0) params.set("kinds", [...query.kinds].sort().join(","));
  if (query.cursor) params.set("cursor", query.cursor);
  else if (query.before) params.set("before", query.before);
  return `/api/activity?${params.toString()}`;
}

/** `/api/activity/{hash}?chainId=&address=` — with `address`, the answer carries that account's row and is private. */
export function txUrl(chainId: string, hash: string, address?: string | null): string {
  const params = new URLSearchParams({ chainId });
  if (address) params.set("address", address);
  return `/api/activity/${encodeURIComponent(hash)}?${params.toString()}`;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** Shape guard for `useApi(…, { parse })`: null when the body is not an activity page. */
export function parseActivityPage(raw: unknown): ActivityPage | null {
  if (!isRecord(raw)) return null;
  if (!Array.isArray(raw.items) || !Array.isArray(raw.coverage) || typeof raw.updatedAt !== "number") return null;
  if (raw.nextCursor !== null && typeof raw.nextCursor !== "string") return null;
  if (raw.nextBefore !== null && typeof raw.nextBefore !== "string") return null;
  const items = raw.items.filter(
    (item) =>
      isRecord(item) &&
      typeof item.chainId === "string" &&
      typeof item.address === "string" &&
      typeof item.hash === "string" &&
      typeof item.time === "string" &&
      typeof item.kind === "string" &&
      typeof item.summary === "string" &&
      typeof item.success === "boolean" &&
      Array.isArray(item.amounts),
  );
  return { ...(raw as unknown as ActivityPage), items: items as unknown as ActivityPage["items"] };
}

/** Shape guard for a transaction detail body. */
export function parseTxDetailBody(raw: unknown): TxDetail | null {
  if (!isRecord(raw)) return null;
  if (typeof raw.hash !== "string" || typeof raw.chainId !== "string" || !Array.isArray(raw.messages)) return null;
  return raw as unknown as TxDetail;
}
