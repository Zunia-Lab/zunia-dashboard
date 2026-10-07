/**
 * One Web Push delivery: RFC 8291 (aes128gcm) encryption and an RFC 8292
 * VAPID JWT, via the `web-push` library.
 *
 * The outcome is a value, never a throw, because the caller decides what each
 * one means for the subscription:
 * - `gone` (404/410): the browser dropped the subscription — delete it;
 * - `failed` + `retryable` (429, 5xx, network): try again on a later pass;
 * - `failed` otherwise (400/403/413): this message or these credentials will
 *   not work; counted, and a subscription that keeps failing is eventually
 *   given up on (a rotated VAPID key would otherwise fail forever).
 *
 * Logs name the push service host and status only. The endpoint is a
 * capability URL — anyone holding it can address that browser — so it is
 * never logged.
 */

import "server-only";
import { sendNotification, WebPushError } from "web-push";
import { encodePushPayload, type PushPayload } from "@/lib/notifications/payload";
import { readVapidConfig } from "@/lib/server/push/config";

export type SendOutcome =
  | { status: "sent" }
  | { status: "gone" }
  | { status: "failed"; code: number | null; retryable: boolean };

export interface SendOptions {
  /** `high` wakes a sleeping phone now; `normal` lets the OS batch it. */
  readonly urgency?: "normal" | "high";
  /** Seconds the push service keeps it for an offline device (default 1 h). */
  readonly ttlSeconds?: number;
}

export interface PushTarget {
  readonly endpoint: string;
  readonly keys: { readonly p256dh: string; readonly auth: string };
}

export type PushSender = (target: PushTarget, payload: PushPayload, options?: SendOptions) => Promise<SendOutcome>;

const SEND_TIMEOUT_MS = 10_000;

function hostOf(endpoint: string): string {
  try {
    return new URL(endpoint).host;
  } catch {
    return "unknown-host";
  }
}

export const sendPush: PushSender = async (target, payload, options = {}) => {
  const vapid = readVapidConfig();
  if (!vapid) return { status: "failed", code: null, retryable: false };
  const request = sendNotification(
    { endpoint: target.endpoint, keys: { p256dh: target.keys.p256dh, auth: target.keys.auth } },
    encodePushPayload(payload),
    {
      vapidDetails: vapid,
      TTL: options.ttlSeconds ?? 3_600,
      urgency: options.urgency ?? "normal",
      contentEncoding: "aes128gcm",
      // Socket idle timeout; the race below bounds the whole exchange.
      timeout: SEND_TIMEOUT_MS,
    },
  );
  let timer: ReturnType<typeof setTimeout> | undefined;
  const deadline = new Promise<"timeout">((resolve) => {
    timer = setTimeout(() => resolve("timeout"), SEND_TIMEOUT_MS + 2_000);
  });
  try {
    const result = await Promise.race([request, deadline]);
    if (result === "timeout") {
      request.catch(() => undefined);
      console.warn(`[push] ${hostOf(target.endpoint)} timed out`);
      return { status: "failed", code: null, retryable: true };
    }
    return { status: "sent" };
  } catch (error) {
    if (error instanceof WebPushError) {
      const code = error.statusCode;
      if (code === 404 || code === 410) return { status: "gone" };
      console.warn(`[push] ${hostOf(target.endpoint)} answered HTTP ${code}`);
      return { status: "failed", code, retryable: code === 429 || code >= 500 };
    }
    console.warn(`[push] ${hostOf(target.endpoint)} unreachable`);
    return { status: "failed", code: null, retryable: true };
  } finally {
    clearTimeout(timer);
  }
};
