/**
 * POST /api/push/test {endpoint} — send this subscription a real push now.
 *
 * Proof that the whole path works (keys, push service, service worker,
 * permission) before the user relies on it. Only for a subscription this
 * server already stores, so it cannot be used to push to arbitrary endpoints;
 * same-origin, small body, and a tight rate limit so it cannot be used to
 * spam a device either.
 */

import { testNotice, buildPushPayload } from "@/lib/notifications/payload";
import { PUSH_DISABLED_REASON, readVapidConfig } from "@/lib/server/push/config";
import { isSameOrigin, jsonError, readJsonBody } from "@/lib/server/push/guard";
import { sendPush } from "@/lib/server/push/send";
import { loadPushStore } from "@/lib/server/push/store";
import { parseEndpointRequest, PushInputError } from "@/lib/server/push/validate";
import { rateLimit } from "@/lib/server/rate-limit";
import { privateJson } from "@/lib/server/respond";

export const runtime = "nodejs";

export async function POST(req: Request): Promise<Response> {
  if (!readVapidConfig()) return jsonError(503, "push_disabled", PUSH_DISABLED_REASON);
  if (!isSameOrigin(req)) return jsonError(403, "forbidden_origin", "Requests must come from this site");
  const limited = rateLimit(req, { scope: "push-test", capacity: 3, refillPerSecond: 1 / 20 });
  if (limited) return limited;
  const body = await readJsonBody(req, 4 * 1024);
  if (!body.ok) return body.response;

  let endpoint: string;
  try {
    endpoint = parseEndpointRequest(body.value);
  } catch (error) {
    return error instanceof PushInputError
      ? jsonError(400, error.code, error.message)
      : jsonError(400, "bad_request", "Invalid request");
  }

  let store;
  try {
    store = await loadPushStore();
  } catch {
    return jsonError(503, "push_store_unavailable", "Push is temporarily unavailable. Try again shortly.");
  }
  const record = store.get(endpoint);
  if (!record) {
    return jsonError(404, "not_subscribed", "This device is not subscribed. Turn push on again.");
  }

  const now = Date.now();
  const outcome = await sendPush(record, buildPushPayload(testNotice(now)), { urgency: "high", ttlSeconds: 600 });
  if (outcome.status === "gone") {
    store.remove(endpoint);
    return jsonError(404, "subscription_expired", "The browser ended this subscription. Turn push on again.");
  }
  if (outcome.status === "failed") {
    return jsonError(
      503,
      "push_failed",
      outcome.retryable
        ? "The push service did not accept the message. Try again in a minute."
        : "The push service refused the message for this device. Turn push off and on again.",
    );
  }
  record.lastPushAt = now;
  store.touch();
  return privateJson({ ok: true, sent: true, updatedAt: now });
}
