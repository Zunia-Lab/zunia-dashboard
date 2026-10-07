/**
 * The one rule for where a notification may send the user.
 *
 * A notification's URL travels through places an attacker can touch — a push
 * payload, a stored feed, a postMessage — and clicking it acts with the
 * dashboard's authority (the user trusts a Zunia notification). So a target is
 * accepted only when it stays on this origin, on an app page: never another
 * host, never `javascript:`, never an API route, never something the URL
 * parser could read two ways (backslashes, control characters,
 * protocol-relative `//host`). Anything else opens the notification centre.
 *
 * `public/sw.js` carries a plain-JS twin of this function (`safeUrl`): the
 * service worker is served as a static file and cannot import modules. The
 * test in `__tests__/sw.test.ts` runs one case table against both, so the two
 * cannot drift apart silently.
 */

export const NOTICE_FALLBACK_URL = "/notifications";

const MAX_URL_LENGTH = 512;
// Control characters and backslashes: WHATWG URL parsing turns `\` into `/`
// on http(s), which is how `/\evil.example` becomes `//evil.example`.
const UNSAFE_CHARS = /[\u0000-\u001f\u007f\\]/;

/** A same-origin app path (`/x?y#z`) for `raw`, or the notification centre. */
export function safeNoticeUrl(raw: unknown, origin: string): string {
  if (typeof raw !== "string") return NOTICE_FALLBACK_URL;
  const value = raw.trim();
  if (!value || value.length > MAX_URL_LENGTH || UNSAFE_CHARS.test(value)) return NOTICE_FALLBACK_URL;
  // Relative paths must be rooted ("/…"); a bare "foo" or "//host" is refused
  // rather than resolved, because resolving is exactly where confusion hides.
  const rooted = value.startsWith("/") && !value.startsWith("//");
  const absolute = /^https?:\/\//i.test(value);
  if (!rooted && !absolute) return NOTICE_FALLBACK_URL;

  let base: URL;
  let url: URL;
  try {
    base = new URL(origin);
    url = new URL(value, base);
  } catch {
    return NOTICE_FALLBACK_URL;
  }
  if (url.origin !== base.origin) return NOTICE_FALLBACK_URL;
  if (url.username || url.password) return NOTICE_FALLBACK_URL;
  const path = url.pathname;
  if (path === "/api" || path.startsWith("/api/")) return NOTICE_FALLBACK_URL;
  return `${path}${url.search}${url.hash}`;
}
