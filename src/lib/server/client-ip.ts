/**
 * Who is asking: the per-client key the rate limiter buckets requests by.
 *
 * The key must be something a client cannot choose, or every limit in the app
 * is one header away from void (rotate a header, get a fresh full bucket on
 * every request). On this deployment the only such value is the TCP peer
 * address that nginx reports:
 *
 * - The dashboard's vhost (zunia-infra deploy/nginx/app.zunialab.com.conf;
 *   wallet.zunialab.com only redirects there) sends
 *   `proxy_set_header X-Real-IP $remote_addr`, which *replaces* any copy the
 *   client sent, and the app listens on 127.0.0.1 only, so nothing reaches it
 *   without passing through nginx. Next never rewrites `x-real-ip`.
 * - `cf-connecting-ip` is trustworthy only when that peer is Cloudflare. The
 *   origin also answers requests sent to it directly (its address is public),
 *   and the vhost neither sets nor strips the header, so a direct request can
 *   carry any value it likes. Cloudflare overwrites the header at the edge, so
 *   from a Cloudflare peer it is the real visitor.
 * - `x-forwarded-for` is never read: nginx *appends* to whatever the client
 *   sent (`$proxy_add_x_forwarded_for`), so its first hop is the client's
 *   choice.
 *
 * IPv6 visitors are keyed by their /64: one host is routinely given a whole
 * /64, and keying on the full address would let it rotate through 2^64
 * buckets. A request with no usable peer (local development without nginx)
 * shares one "anonymous" bucket — where the limiter is off anyway.
 *
 * No `server-only` import, so the rules are unit tested on their own
 * (`__tests__/client-ip.test.ts`); nothing here is secret.
 */

import { BlockList, isIP } from "node:net";

/**
 * Cloudflare's published edge ranges (https://www.cloudflare.com/ips/, checked
 * as current on 2026-10-07). A peer outside them is keyed as itself, so a stale
 * list fails safe: a new Cloudflare range would only make its visitors share
 * that edge's bucket until this list is updated.
 */
export const CLOUDFLARE_RANGES: readonly string[] = [
  "173.245.48.0/20",
  "103.21.244.0/22",
  "103.22.200.0/22",
  "103.31.4.0/22",
  "141.101.64.0/18",
  "108.162.192.0/18",
  "190.93.240.0/20",
  "188.114.96.0/20",
  "197.234.240.0/22",
  "198.41.128.0/17",
  "162.158.0.0/15",
  "104.16.0.0/13",
  "104.24.0.0/14",
  "172.64.0.0/13",
  "131.0.72.0/22",
  "2400:cb00::/32",
  "2606:4700::/32",
  "2803:f800::/32",
  "2405:b500::/32",
  "2405:8100::/32",
  "2a06:98c0::/29",
  "2c0f:f248::/32",
];

const CLOUDFLARE = new BlockList();
for (const range of CLOUDFLARE_RANGES) {
  const [network = "", bits = ""] = range.split("/");
  CLOUDFLARE.addSubnet(network, Number(bits), isIP(network) === 6 ? "ipv6" : "ipv4");
}

/** An IP address from a header value, or `null`. IPv4-mapped IPv6 is unwrapped. */
export function ipOf(value: string | null): string | null {
  const ip = (value ?? "").trim().replace(/^::ffff:(?=\d+\.\d+\.\d+\.\d+$)/i, "");
  return isIP(ip) ? ip : null;
}

/** IPv4 as is; IPv6 by its /64 network, written out canonically. */
export function bucketOf(ip: string): string {
  if (isIP(ip) === 4) return ip;
  try {
    // The URL parser canonicalises (lower case, `::` compression, no dotted quad).
    const canonical = new URL(`http://[${ip}]`).hostname.slice(1, -1);
    const [head = "", tail = ""] = canonical.split("::");
    const left = head ? head.split(":") : [];
    const right = tail ? tail.split(":") : [];
    const groups = [...left, ...Array<string>(Math.max(0, 8 - left.length - right.length)).fill("0"), ...right];
    return `${groups.slice(0, 4).join(":")}::/64`;
  } catch {
    return ip.slice(0, 64);
  }
}

/** Whether `ip` is a Cloudflare edge address. */
export function isCloudflare(ip: string): boolean {
  return CLOUDFLARE.check(ip, isIP(ip) === 6 ? "ipv6" : "ipv4");
}

/** The rate-limit bucket key for `req` (see the module comment for the rules). */
export function clientKey(req: Request): string {
  const peer = ipOf(req.headers.get("x-real-ip"));
  if (!peer) return "anonymous";
  const visitor = isCloudflare(peer) ? ipOf(req.headers.get("cf-connecting-ip")) : null;
  return bucketOf(visitor ?? peer);
}
