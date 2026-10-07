/**
 * POST   /api/push/subscribe — register or refresh this browser's push
 *        subscription with the accounts it watches and the user's prefs.
 * DELETE /api/push/subscribe — forget it.
 *
 * The dashboard server owns push end to end (spec §8): the subscription is
 * stored here, the in-process watcher reads it. There is no upstream to proxy
 * to, so there is no "stored: false, but 200" path any more — a request is
 * either stored (200 `{ok: true}`), refused for its content (400/413/415), not
 * from this site (403), over the rate limit (429), or push is off / full
 * (503). Never 502: Cloudflare replaces 502 bodies with its own page.
 *
 * Nothing here proves the browser owns the addresses: chain data is public,
 * and the worst a stranger can do is have their own browser told about
 * someone else's public transfers. The limits (32 accounts, 16 KB, rate,
 * 10,000 subscriptions) bound what that costs the server. An ADR-36 proof is
 * the upgrade path if that ever matters.
 *
 * Creating a subscription has its own small daily budget per client, apart
 * from the general rate (which refreshes and prefs changes share): fake
 * subscriptions are cheap to mint, and one client minting thousands would
 * fill the store and lock real users out with `push_full`.
 */

import { findServerChain } from "@/lib/server/chains";
import { readVapidConfig, PUSH_DISABLED_REASON } from "@/lib/server/push/config";
import { isSameOrigin, jsonError, readJsonBody } from "@/lib/server/push/guard";
import { loadPushStore } from "@/lib/server/push/store";
import { parseEndpointRequest, parseSubscribeRequest, PushInputError } from "@/lib/server/push/validate";
import { rateLimit } from "@/lib/server/rate-limit";
import { privateJson } from "@/lib/server/respond";

export const runtime = "nodejs";

const MAX_BODY_BYTES = 16 * 1024;
/** New subscriptions per client per day (a browser keeps one; a few profiles or devices behind one IP fit). */
const NEW_PER_DAY = 20;

function inputError(error: unknown): Response {
  if (error instanceof PushInputError) return jsonError(400, error.code, error.message);
  return jsonError(400, "bad_request", "Invalid request");
}

async function guarded(
  req: Request,
  scope: string,
  needsPush: boolean,
): Promise<{ ok: true; body: unknown } | { ok: false; response: Response }> {
  // Forgetting a subscription only removes data, so it works with push off.
  if (needsPush && !readVapidConfig()) {
    return { ok: false, response: jsonError(503, "push_disabled", PUSH_DISABLED_REASON) };
  }
  if (!isSameOrigin(req)) {
    return { ok: false, response: jsonError(403, "forbidden_origin", "Requests must come from this site") };
  }
  const limited = rateLimit(req, { scope, capacity: 10, refillPerSecond: 10 / 60 });
  if (limited) return { ok: false, response: limited };
  const body = await readJsonBody(req, MAX_BODY_BYTES);
  return body.ok ? { ok: true, body: body.value } : { ok: false, response: body.response };
}

export async function POST(req: Request): Promise<Response> {
  const gate = await guarded(req, "push-subscribe", true);
  if (!gate.ok) return gate.response;
  let request;
  try {
    request = parseSubscribeRequest(gate.body, findServerChain);
  } catch (error) {
    return inputError(error);
  }
  let store;
  try {
    store = await loadPushStore();
  } catch {
    return jsonError(503, "push_store_unavailable", "Push is temporarily unavailable. Try again shortly.");
  }
  if (!store.get(request.subscription.endpoint)) {
    const limited = rateLimit(req, { scope: "push-subscribe-new", capacity: NEW_PER_DAY, refillPerSecond: NEW_PER_DAY / 86_400 });
    if (limited) return limited;
  }
  const result = store.upsert(request, Date.now());
  if (!result.ok) {
    return jsonError(503, "push_full", "Push is at capacity on this server. Try again later.");
  }
  return privateJson({
    ok: true,
    created: result.created,
    accounts: result.record.accounts.length,
    updatedAt: Date.now(),
  });
}

export async function DELETE(req: Request): Promise<Response> {
  const gate = await guarded(req, "push-unsubscribe", false);
  if (!gate.ok) return gate.response;
  let endpoint: string;
  try {
    endpoint = parseEndpointRequest(gate.body);
  } catch (error) {
    return inputError(error);
  }
  let store;
  try {
    store = await loadPushStore();
  } catch {
    return jsonError(503, "push_store_unavailable", "Push is temporarily unavailable. Try again shortly.");
  }
  const removed = store.remove(endpoint);
  return privateJson({ ok: true, removed, updatedAt: Date.now() });
}
