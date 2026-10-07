/**
 * The rate limiter's client key must be something a client cannot choose.
 *
 * Headers are built the way the wallet vhost forwards them to the app
 * (zunia-infra deploy/nginx/wallet.zunialab.com.conf): every client header
 * passes through, `X-Real-IP` is replaced with nginx's `$remote_addr`, and
 * `X-Forwarded-For` is appended to. Cloudflare, when it is in the path,
 * overwrites `CF-Connecting-IP` with the visitor's address.
 */

import assert from "node:assert/strict";
import { test } from "node:test";

import { bucketOf, clientKey, ipOf, isCloudflare } from "../client-ip";

type Headers = Record<string, string>;

const CF_EDGE = "172.68.143.20"; // inside 172.64.0.0/13
const ATTACKER = "198.51.100.9";
const VISITOR = "203.0.113.7";

function viaNginx(peer: string, client: Headers = {}): Request {
  const headers: Headers = { ...client, "x-real-ip": peer };
  headers["x-forwarded-for"] = client["x-forwarded-for"] ? `${client["x-forwarded-for"]}, ${peer}` : peer;
  return new Request("https://wallet.zunialab.com/api/x", { headers });
}

function viaCloudflare(visitor: string, client: Headers = {}, edge = CF_EDGE): Request {
  return viaNginx(edge, {
    ...client,
    "cf-connecting-ip": visitor,
    "x-forwarded-for": client["x-forwarded-for"] ? `${client["x-forwarded-for"]}, ${visitor}` : visitor,
  });
}

const rotate = (i: number) => `10.${(i >> 16) & 255}.${(i >> 8) & 255}.${i & 255}`;

function bucketsFor(make: (i: number) => Request, n = 200): Set<string> {
  const keys = new Set<string>();
  for (let i = 0; i < n; i += 1) keys.add(clientKey(make(i)));
  return keys;
}

test("a visitor through Cloudflare is keyed by the address Cloudflare names", () => {
  assert.equal(clientKey(viaCloudflare(VISITOR)), VISITOR);
});

test("two visitors behind the same Cloudflare edge get two buckets", () => {
  assert.equal(new Set([clientKey(viaCloudflare(VISITOR)), clientKey(viaCloudflare(ATTACKER))]).size, 2);
});

test("a forged CF-Connecting-IP sent straight to the origin is ignored", () => {
  const keys = bucketsFor((i) => viaNginx(ATTACKER, { "cf-connecting-ip": rotate(i) }));
  assert.deepEqual([...keys], [ATTACKER]);
});

test("a forged X-Forwarded-For is never read, through Cloudflare or not", () => {
  assert.deepEqual([...bucketsFor((i) => viaNginx(ATTACKER, { "x-forwarded-for": rotate(i) }))], [ATTACKER]);
  // Through Cloudflare the forged copy is overwritten at the edge anyway.
  assert.deepEqual(
    [...bucketsFor((i) => viaCloudflare(ATTACKER, { "cf-connecting-ip": rotate(i), "x-forwarded-for": rotate(i) }))],
    [ATTACKER],
  );
});

test("one host rotating inside its IPv6 /64 stays in one bucket", () => {
  const keys = bucketsFor((i) =>
    viaCloudflare(`2a01:4f9:c012:abcd:${((i * 7919) & 0xffff).toString(16)}:${i.toString(16)}:1:2`),
  );
  assert.deepEqual([...keys], ["2a01:4f9:c012:abcd::/64"]);
  // Two different /64s are two clients.
  assert.equal(
    new Set([clientKey(viaCloudflare("2001:db8:1:2::1")), clientKey(viaCloudflare("2001:db8:1:3::1"))]).size,
    2,
  );
});

test("Cloudflare reaching the origin over IPv6 is still keyed by the visitor", () => {
  assert.equal(clientKey(viaNginx("2400:cb00:2049:1::a29f:1804", { "cf-connecting-ip": VISITOR })), VISITOR);
});

test("no peer address (local development without nginx) shares one anonymous bucket", () => {
  assert.equal(clientKey(new Request("http://127.0.0.1:3003/api/x", { headers: { "cf-connecting-ip": "1.2.3.4" } })), "anonymous");
  assert.equal(clientKey(new Request("http://127.0.0.1:3003/api/x", { headers: { "x-real-ip": "not an ip" } })), "anonymous");
});

test("address helpers", () => {
  assert.equal(ipOf(" ::ffff:203.0.113.7 "), VISITOR);
  assert.equal(ipOf("203.0.113.7, 10.0.0.1"), null);
  assert.equal(bucketOf("2001:DB8::1"), "2001:db8:0:0::/64");
  assert.equal(bucketOf(VISITOR), VISITOR);
  assert.equal(isCloudflare(CF_EDGE), true);
  assert.equal(isCloudflare(ATTACKER), false);
});
