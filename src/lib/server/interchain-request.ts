/**
 * Guards for the `/api/interchain/*`, `/api/ibc/*` and `/api/nft/*` handlers,
 * answered in those routes' own wire shape.
 *
 * These handlers drive the most expensive work in the app — channel walks of
 * up to a thousand rows, client-state and module probes, denom traces — from
 * this server's IP, against public chain endpoints that throttle by IP. They
 * share the guards every other fan-out route has:
 *
 * - **Same origin** (`sameOriginProblem`): a page on another site cannot drive
 *   them from a visitor's browser.
 * - **Bounded JSON** (`readBoundedJson`): POST bodies must be
 *   `application/json` (which no cross-site form can send without a preflight
 *   these routes never answer) and are capped while they stream in.
 * - **Rate limit** (`rateLimit`): one client cannot spend everyone's upstream
 *   budget.
 *
 * The shared guards answer `{ error, message }`; the browser's reader for
 * these routes (`readFailure` in lib/interchain/wire.ts) only understands
 * `{ ok: false, code, message }` and would show anything else as "malformed
 * response". So every refusal is re-shaped here, keeping the guard's status
 * and headers (a 429's `Retry-After`).
 */

import "server-only";

import { rateLimit, type RateLimitOptions } from "@/lib/server/rate-limit";
import { readBoundedJson } from "@/lib/server/swap/request";
import { ParamError } from "@/lib/server/validate";
import { sameOriginProblem } from "@/lib/tx/server/request";

/** A guard's refusal, re-shaped into the interchain wire's failure body. */
export function refused(problem: Response, message: string): Response {
  return Response.json(
    { ok: false, code: "bad-request", message },
    { status: problem.status, headers: problem.headers },
  );
}

/** A 403 for a request another site's page sent, or `null`. */
export function foreignOrigin(req: Request): Response | null {
  const foreign = sameOriginProblem(req);
  return foreign ? refused(foreign, "This endpoint only answers the dashboard itself.") : null;
}

/** A 429 once this client's bucket for `options.scope` is empty, or `null`. */
export function overLimit(
  req: Request,
  options: RateLimitOptions,
  message = "Too many requests. Wait a moment and try again.",
): Response | null {
  const limited = rateLimit(req, options);
  return limited ? refused(limited, message) : null;
}

/**
 * The request's JSON object body, at most `maxBytes`; a 400 in the wire shape
 * when it is not `application/json`, too large, not JSON, or not an object
 * (`null`, an array). Reading `body.field` off whatever `req.json()` returned
 * used to throw a TypeError on a `null` body, which escaped as a bare 500.
 */
export async function boundedBody(req: Request, maxBytes: number): Promise<Record<string, unknown> | Response> {
  try {
    return await readBoundedJson(req, maxBytes);
  } catch (error) {
    if (error instanceof ParamError) {
      return Response.json({ ok: false, code: "bad-request", message: `${error.message}.` }, { status: 400 });
    }
    throw error;
  }
}
