/**
 * The Web Push payload: what the server encrypts and the service worker shows.
 *
 * Versioned (`v: 1`) and complete — title, body and a same-origin URL ready to
 * display — because the service worker runs with no app code and no network
 * guarantee: a wake-up ping it has to "go and look up" (the old backend design,
 * `{event, chainId, txHash}`) shows "New wallet update" at best. `tag` is the
 * notice id, so the push and an in-page alert for the same event collapse into
 * one notification.
 *
 * Push services cap payloads near 4 KB after encryption; `encodePushPayload`
 * keeps the JSON under `PUSH_LIMITS.bytes`, shortening the body if it must.
 */

import { noticeHref, noticeId } from "@/lib/notifications/ids";
import { clip } from "@/lib/notifications/text";
import { NOTICE_KINDS, type Notice, type NoticeKind } from "@/lib/notifications/types";
import { NOTICE_FALLBACK_URL } from "@/lib/notifications/url";

export interface PushPayload {
  readonly v: 1;
  readonly id: string;
  readonly kind: NoticeKind;
  readonly title: string;
  readonly body: string;
  /** Same-origin path; the service worker validates it again before opening. */
  readonly url: string;
  readonly chainId: string | null;
  readonly tag: string;
  /** Epoch ms of the event, for the notification's timestamp. */
  readonly at: number;
}

export const PUSH_LIMITS = { title: 120, body: 240, id: 200, url: 512, bytes: 3_000 } as const;

function rootedPath(url: string | undefined): string {
  return url && url.startsWith("/") && !url.startsWith("//") && url.length <= PUSH_LIMITS.url
    ? url
    : NOTICE_FALLBACK_URL;
}

export function buildPushPayload(notice: Notice): PushPayload {
  const id = notice.id.slice(0, PUSH_LIMITS.id);
  return {
    v: 1,
    id,
    kind: notice.kind,
    title: clip(notice.title, PUSH_LIMITS.title) || "Zunia",
    body: clip(notice.body, PUSH_LIMITS.body),
    url: rootedPath(notice.url),
    chainId: notice.chainId ?? null,
    tag: id,
    at: notice.at,
  };
}

/** JSON for the wire, under the size budget. */
export function encodePushPayload(payload: PushPayload): string {
  let json = JSON.stringify(payload);
  let body = payload.body;
  const bytes = (text: string) => new TextEncoder().encode(text).length;
  while (bytes(json) > PUSH_LIMITS.bytes && body.length > 0) {
    body = clip(body, Math.max(0, Math.floor(body.length * 0.7)));
    if (body.length < 8) body = "";
    json = JSON.stringify({ ...payload, body });
  }
  return json;
}

function text(value: unknown, max: number): string | null {
  return typeof value === "string" && value.length <= max ? value : null;
}

/**
 * A received payload, validated; null when it is not a v1 payload. The
 * service worker's `readPayload` follows the same rules.
 */
export function parsePushPayload(raw: unknown): PushPayload | null {
  if (!raw || typeof raw !== "object") return null;
  const row = raw as Record<string, unknown>;
  if (row.v !== 1) return null;
  const id = text(row.id, PUSH_LIMITS.id);
  const title = text(row.title, PUSH_LIMITS.title);
  const body = text(row.body, PUSH_LIMITS.body) ?? "";
  if (!id || !title) return null;
  const kind = NOTICE_KINDS.includes(row.kind as NoticeKind) ? (row.kind as NoticeKind) : "system";
  return {
    v: 1,
    id,
    kind,
    title,
    body,
    url: rootedPath(text(row.url, PUSH_LIMITS.url) ?? undefined),
    chainId: text(row.chainId, 64),
    tag: text(row.tag, PUSH_LIMITS.id) ?? id,
    at: typeof row.at === "number" && Number.isFinite(row.at) ? row.at : 0,
  };
}

/** The notice `POST /api/push/test` sends: proof the whole path works. */
export function testNotice(now: number): Notice {
  return {
    id: noticeId.test(now),
    kind: "system",
    title: "Zunia notifications are on",
    body: "This device will be told about incoming transfers and the alerts you chose.",
    url: noticeHref.notifications(),
    at: now,
    severity: "success",
  };
}
