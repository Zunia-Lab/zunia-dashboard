/**
 * The response headers declared in next.config.ts.
 *
 * Two of these rules fail silently when they regress, which is why they are
 * pinned here rather than left to a curl someone remembers to run:
 *
 * - Config headers override a route handler's header of the same name (Next
 *   only copies a handler's header when the response does not have it yet). A
 *   `Cache-Control` on every `/api` path would wipe every `publicJson` policy
 *   and nobody would notice until Cloudflare stopped caching market data.
 * - The address rule is the safety net that keeps one visitor's balances out
 *   of a shared cache even when a route forgets `privateJson`.
 */

import assert from "node:assert/strict";
import { test } from "node:test";

import nextConfig from "../../../next.config";

type Rule = {
  source: string;
  has?: Array<{ type: string; key: string; value?: string }>;
  headers: Array<{ key: string; value: string }>;
};

async function rules(): Promise<Rule[]> {
  assert.ok(nextConfig.headers, "next.config.ts declares headers()");
  return (await nextConfig.headers()) as Rule[];
}

function header(rule: Rule | undefined, key: string): string | undefined {
  return rule?.headers.find((entry) => entry.key.toLowerCase() === key.toLowerCase())?.value;
}

test("every response carries the baseline security headers", async () => {
  const all = (await rules()).find((rule) => rule.source === "/:path*" && !rule.has);
  assert.ok(all, "a site-wide rule");
  assert.equal(header(all, "X-Frame-Options"), "DENY");
  assert.equal(header(all, "X-Content-Type-Options"), "nosniff");
  assert.equal(header(all, "Referrer-Policy"), "strict-origin-when-cross-origin");
  assert.equal(header(all, "Cross-Origin-Opener-Policy"), "same-origin");

  const permissions = header(all, "Permissions-Policy") ?? "";
  // The recipient field's QR scanner needs the camera; nothing else is granted.
  assert.match(permissions, /camera=\(self\)/);
  for (const feature of ["microphone", "geolocation", "payment", "usb", "hid", "serial", "bluetooth"]) {
    assert.match(permissions, new RegExp(`${feature}=\\(\\)`), feature);
  }

  // Enforced today: nobody may frame a signing screen.
  const enforced = header(all, "Content-Security-Policy") ?? "";
  assert.match(enforced, /frame-ancestors 'none'/);
  assert.match(enforced, /object-src 'none'/);

  const reportOnly = header(all, "Content-Security-Policy-Report-Only") ?? "";
  for (const directive of [
    "default-src 'self'",
    "frame-ancestors 'none'",
    "object-src 'none'",
    "base-uri 'none'",
    "form-action 'self'",
  ]) {
    assert.ok(reportOnly.includes(directive), directive);
  }
  // Zunia Connect: pairing over https and the relay socket over wss.
  assert.match(reportOnly, /connect-src 'self'[^;]* https:\/\/api\.zunialab\.com[^;]* wss:\/\/api\.zunialab\.com/);
  if (process.env.NODE_ENV !== "development") {
    assert.doesNotMatch(reportOnly, /unsafe-eval/, "eval is a development-only allowance");
  }
  assert.equal(nextConfig.poweredByHeader, false);
});

test("no rule sets Cache-Control on every API path", async () => {
  for (const rule of await rules()) {
    if (rule.has?.length) continue;
    const coversApi = rule.source === "/:path*" || rule.source.startsWith("/api/:path");
    assert.equal(
      coversApi && header(rule, "Cache-Control") !== undefined,
      false,
      `${rule.source} would override every publicJson cache policy`,
    );
  }
});

test("any API request that carries an address is private, whatever the route says", async () => {
  const all = await rules();
  for (const key of ["address", "accounts", "voter"]) {
    const rule = all.find(
      (candidate) =>
        candidate.source === "/api/:path*" &&
        candidate.has?.length === 1 &&
        candidate.has[0]!.type === "query" &&
        candidate.has[0]!.key === key &&
        candidate.has[0]!.value === undefined,
    );
    assert.ok(rule, `a rule for ?${key}=`);
    assert.equal(header(rule, "Cache-Control"), "private, no-store", key);
  }
  const api = all.find((rule) => rule.source === "/api/:path*" && !rule.has);
  assert.equal(header(api, "X-Robots-Tag"), "noindex");
  assert.equal(header(api, "Cross-Origin-Resource-Policy"), "same-origin");
});

test("the service worker is never served stale and keeps its own policy", async () => {
  const all = await rules();
  const index = all.findIndex((rule) => rule.source === "/sw.js");
  assert.ok(index > 0, "a /sw.js rule after the site-wide one (later rules win)");
  const sw = all[index];
  assert.equal(header(sw, "Cache-Control"), "no-cache, max-age=0, must-revalidate");
  assert.equal(header(sw, "Content-Security-Policy"), "default-src 'self'");
  assert.equal(header(sw, "Service-Worker-Allowed"), "/");
});
