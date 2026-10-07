/**
 * The push payload is the whole message: the service worker has no app code
 * and may have no network, so what is encrypted here is exactly what the user
 * sees. It must fit the push services' size cap and survive a round trip.
 */

import assert from "node:assert/strict";
import { test } from "node:test";

import {
  buildPushPayload,
  encodePushPayload,
  parsePushPayload,
  PUSH_LIMITS,
  testNotice,
} from "@/lib/notifications/payload";
import type { Notice } from "@/lib/notifications/types";

const NOTICE: Notice = {
  id: "transfer:7B5E447B64067CF2E5E31D4921927156C3F9B9B913E06895239E0795D72B57F3",
  kind: "transfer",
  title: "Received 0.5 OSMO on Osmosis",
  body: "From osmo1zva9…g8mm",
  chainId: "osmosis-1",
  url: "/activity/7B5E447B64067CF2E5E31D4921927156C3F9B9B913E06895239E0795D72B57F3?chainId=osmosis-1",
  at: 1_791_323_550_000,
  severity: "success",
  data: { amount: "0.5 OSMO" },
};

test("a notice becomes a v1 payload whose tag is the notice id", () => {
  const payload = buildPushPayload(NOTICE);
  assert.deepEqual(payload, {
    v: 1,
    id: NOTICE.id,
    kind: "transfer",
    title: NOTICE.title,
    body: NOTICE.body,
    url: NOTICE.url,
    chainId: "osmosis-1",
    tag: NOTICE.id,
    at: NOTICE.at,
  });
  assert.deepEqual(parsePushPayload(JSON.parse(encodePushPayload(payload))), payload);
});

test("only rooted same-site paths travel; anything else opens the notification centre", () => {
  for (const url of ["https://evil.example/x", "//evil.example/x", "javascript:alert(1)", "activity/x", undefined]) {
    assert.equal(buildPushPayload({ ...NOTICE, url }).url, "/notifications", String(url));
  }
});

test("long text is clipped and the encoded payload stays under the size budget", () => {
  const huge = buildPushPayload({ ...NOTICE, title: "T".repeat(500), body: "word ".repeat(2_000) });
  assert.ok(huge.title.length <= PUSH_LIMITS.title);
  assert.ok(huge.body.length <= PUSH_LIMITS.body);
  const wide = { ...huge, body: "😀".repeat(PUSH_LIMITS.body / 2) };
  const json = encodePushPayload(wide);
  assert.ok(new TextEncoder().encode(json).length <= PUSH_LIMITS.bytes);
  assert.ok(parsePushPayload(JSON.parse(json)));
});

test("payloads that are not v1 or lack a title are refused", () => {
  assert.equal(parsePushPayload(null), null);
  assert.equal(parsePushPayload("text"), null);
  assert.equal(parsePushPayload({ v: 2, id: "a", title: "t" }), null);
  assert.equal(parsePushPayload({ v: 1, id: "a" }), null);
  assert.equal(parsePushPayload({ v: 1, title: "t" }), null);
  const odd = parsePushPayload({ v: 1, id: "a", title: "t", kind: "lottery", url: "//x", tag: 5 });
  assert.equal(odd?.kind, "system");
  assert.equal(odd?.url, "/notifications");
  assert.equal(odd?.tag, "a");
});

test("the test notice says what it proves", () => {
  const notice = testNotice(42);
  assert.equal(notice.title, "Zunia notifications are on");
  assert.equal(notice.id, "system:test:42");
  assert.equal(buildPushPayload(notice).url, "/notifications");
});
