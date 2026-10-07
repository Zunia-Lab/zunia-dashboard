/**
 * The push routes' doors: which endpoints the server will POST to, what a
 * subscription may contain, and which requests count as coming from this
 * site. Each rule here is a request-forgery or abuse path closed.
 */

import assert from "node:assert/strict";
import { test } from "node:test";

import { isSameOrigin, readJsonBody } from "@/lib/server/push/guard";
import {
  isAllowedPushEndpoint,
  parseEndpointRequest,
  parseSubscribeRequest,
  PushInputError,
  type ChainLookup,
} from "@/lib/server/push/validate";

const CATALOG: Record<string, { bech32Prefix: string }> = {
  "osmosis-1": { bech32Prefix: "osmo" },
  "cosmoshub-4": { bech32Prefix: "cosmos" },
  "safrochain-1": { bech32Prefix: "addr_safro" },
  "lava-mainnet-1": { bech32Prefix: "lava@" },
};
const lookup: ChainLookup = (chainId) => CATALOG[chainId];

// A real P-256 point (65 bytes, 0x04 prefix) and 16-byte auth secret, base64url.
const P256DH = "BNcRdreALRFXTkOOUHK1EtK2wtaz5Ry4YfYCA_0QTpQtUbVlUls0VJXg7A8u-Ts1XbjhazAkj7I99e8QcYP7DkM";
const AUTH = "tBHItJI5svbpez7KI4CCXg";
const ENDPOINT = "https://fcm.googleapis.com/fcm/send/abc:def";

function body(overrides: Record<string, unknown> = {}) {
  return {
    subscription: { endpoint: ENDPOINT, keys: { p256dh: P256DH, auth: AUTH } },
    accounts: [
      { chainId: "osmosis-1", address: "osmo1gv86dp8wmnmmatdckgr5xkevnpmy4662stl5rm" },
      { chainId: "safrochain-1", address: "addr_safro1gv86dp8wmnmmatdckgr5xkevnpmy4662qudn7e" },
    ],
    prefs: { transfers: true, governance: true, rewards: "weekly", quietHours: { start: 22, end: 7 } },
    locale: "fr-FR",
    timeZone: "Europe/Paris",
    ...overrides,
  };
}

function code(fn: () => unknown): string {
  try {
    fn();
  } catch (error) {
    assert.ok(error instanceof PushInputError, String(error));
    return error.code;
  }
  assert.fail("expected a PushInputError");
}

test("only https endpoints on the known push services", () => {
  for (const ok of [
    "https://fcm.googleapis.com/fcm/send/x",
    "https://updates.push.services.mozilla.com/wpush/v2/x",
    "https://web.push.apple.com/QF-x",
    "https://wns2-par02p.notify.windows.com/w/?token=x",
  ]) {
    assert.equal(isAllowedPushEndpoint(ok), true, ok);
  }
  for (const bad of [
    "http://fcm.googleapis.com/fcm/send/x",
    "https://fcm.googleapis.com.evil.example/x",
    "https://evil.example/fcm.googleapis.com",
    "https://notify.windows.com/x",
    "https://user:pass@fcm.googleapis.com/x",
    "https://fcm.googleapis.com:8443/x",
    "https://127.0.0.1/x",
    `https://fcm.googleapis.com/${"x".repeat(2_000)}`,
    42,
  ]) {
    assert.equal(isAllowedPushEndpoint(bad), false, String(bad).slice(0, 60));
  }
});

test("a full subscription parses; Safrochain's underscore prefix is a valid bech32 prefix", () => {
  const parsed = parseSubscribeRequest(body(), lookup);
  assert.equal(parsed.subscription.endpoint, ENDPOINT);
  assert.equal(parsed.accounts.length, 2);
  assert.equal(parsed.prefs.rewards, "weekly");
  assert.deepEqual(parsed.prefs.quietHours, { start: 22, end: 7 });
  assert.equal(parsed.locale, "fr-FR");
  assert.equal(parsed.timeZone, "Europe/Paris");
  assert.equal(parsed.replaces, null);
});

test("every catalog prefix shape is accepted: Lava's `lava@` too", () => {
  const lava = "lava@1qurswpc8qurswpc8qurswpc8qurswpc8ttsl8v";
  const request = parseSubscribeRequest(
    body({ accounts: [{ chainId: "lava-mainnet-1", address: lava }, { chainId: "osmosis-1", address: "osmo1gv86dp8wmnmmatdckgr5xkevnpmy4662stl5rm" }] }),
    lookup,
  );
  assert.deepEqual(
    request.accounts.map((account) => account.chainId),
    ["lava-mainnet-1", "osmosis-1"],
  );
  assert.equal(
    code(() => parseSubscribeRequest(body({ accounts: [{ chainId: "osmosis-1", address: lava }] }), lookup)),
    "address_prefix",
  );
});

test("bad keys, chains, addresses and sizes are refused with a code", () => {
  assert.equal(code(() => parseSubscribeRequest(null, lookup)), "body_invalid");
  assert.equal(code(() => parseSubscribeRequest(body({ subscription: { endpoint: "https://evil.example/x", keys: {} } }), lookup)), "endpoint_invalid");
  assert.equal(code(() => parseSubscribeRequest(body({ subscription: { endpoint: ENDPOINT, keys: { p256dh: "AAAA", auth: AUTH } } }), lookup)), "keys_invalid");
  assert.equal(code(() => parseSubscribeRequest(body({ accounts: [] }), lookup)), "accounts_required");
  assert.equal(code(() => parseSubscribeRequest(body({ accounts: [{ chainId: "nope-1", address: "x" }] }), lookup)), "chain_unknown");
  assert.equal(
    code(() => parseSubscribeRequest(body({ accounts: [{ chainId: "osmosis-1", address: "cosmos1gv86dp8wmnmmatdckgr5xkevnpmy4662csvy4f" }] }), lookup)),
    "address_prefix",
  );
  assert.equal(
    code(() => parseSubscribeRequest(body({ accounts: [{ chainId: "osmosis-1", address: "osmo1gv86dp8wmnmmatdckgr5xkevnpmy4662stl5rX" }] }), lookup)),
    "address_invalid",
  );
  const many = Array.from({ length: 33 }, () => ({ chainId: "osmosis-1", address: "osmo1gv86dp8wmnmmatdckgr5xkevnpmy4662stl5rm" }));
  assert.equal(code(() => parseSubscribeRequest(body({ accounts: many }), lookup)), "accounts_too_many");
});

test("duplicates collapse; unknown locale and zone fall back; replaces must be another push endpoint", () => {
  const twice = { chainId: "osmosis-1", address: "osmo1gv86dp8wmnmmatdckgr5xkevnpmy4662stl5rm" };
  const parsed = parseSubscribeRequest(
    body({ accounts: [twice, twice], locale: "<script>", timeZone: "Mars/Olympus", replaces: "https://fcm.googleapis.com/fcm/send/old" }),
    lookup,
  );
  assert.equal(parsed.accounts.length, 1);
  assert.equal(parsed.locale, "en");
  assert.equal(parsed.timeZone, null);
  assert.equal(parsed.replaces, "https://fcm.googleapis.com/fcm/send/old");
  assert.equal(parseSubscribeRequest(body({ replaces: "https://evil.example/" }), lookup).replaces, null);
  assert.equal(parseEndpointRequest({ endpoint: ENDPOINT }), ENDPOINT);
  assert.equal(code(() => parseEndpointRequest({ endpoint: "https://evil.example/" })), "endpoint_invalid");
});

test("same-origin: Sec-Fetch-Site first, Origin vs Host as the fallback", () => {
  const req = (headers: Record<string, string>) => new Request("http://127.0.0.1:3003/api/push/subscribe", { method: "POST", headers });
  assert.equal(isSameOrigin(req({ "sec-fetch-site": "same-origin" })), true);
  assert.equal(isSameOrigin(req({ "sec-fetch-site": "cross-site", origin: "https://wallet.zunialab.com", host: "wallet.zunialab.com" })), false);
  assert.equal(isSameOrigin(req({ "sec-fetch-site": "same-site" })), false);
  assert.equal(isSameOrigin(req({ origin: "https://wallet.zunialab.com", host: "wallet.zunialab.com" })), true);
  assert.equal(isSameOrigin(req({ origin: "https://evil.example", host: "wallet.zunialab.com" })), false);
  assert.equal(isSameOrigin(req({ origin: "https://wallet.zunialab.com", "x-forwarded-host": "wallet.zunialab.com", host: "127.0.0.1:3012" })), true);
  assert.equal(isSameOrigin(req({})), false, "no Origin and no Sec-Fetch-Site: refused");
});

test("bodies: JSON only, capped while streaming, parse errors are 400", async () => {
  const post = (payload: BodyInit, type = "application/json") =>
    new Request("http://x/api", { method: "POST", headers: { "content-type": type }, body: payload });
  const ok = await readJsonBody(post(JSON.stringify({ a: 1 })), 100);
  assert.deepEqual(ok, { ok: true, value: { a: 1 } });

  const charset = await readJsonBody(post("{}", "application/json; charset=utf-8"), 100);
  assert.equal(charset.ok, true);

  const form = await readJsonBody(post("a=1", "application/x-www-form-urlencoded"), 100);
  assert.equal(form.ok ? 0 : form.response.status, 415);

  const big = await readJsonBody(post(JSON.stringify({ a: "x".repeat(500) })), 100);
  assert.equal(big.ok ? 0 : big.response.status, 413);

  const broken = await readJsonBody(post("{oops"), 100);
  assert.equal(broken.ok ? 0 : broken.response.status, 400);
  if (!broken.ok) assert.deepEqual(await broken.response.json(), { error: "invalid_json", message: "The body is not valid JSON" });
});
