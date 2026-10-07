/**
 * The service worker, tested as shipped: `public/sw.js` is loaded into a VM
 * context with a fake `self`, and its real handlers run against stubs of the
 * registration, the window clients and Cache Storage.
 *
 * The URL rule exists twice (the worker cannot import modules), so one case
 * table runs against `safeNoticeUrl` (TypeScript) and `safeUrl` (the worker):
 * if they disagree on any case, this fails. Privacy mode's amount mask is
 * twinned the same way (`maskAmounts` and the worker's `maskText`).
 */

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import vm from "node:vm";

import { buildPushPayload, parsePushPayload } from "@/lib/notifications/payload";
import { maskAmounts } from "@/lib/notifications/text";
import { NOTICE_FALLBACK_URL, safeNoticeUrl } from "@/lib/notifications/url";

const ORIGIN = "https://wallet.zunialab.com";
const SOURCE = readFileSync(join(process.cwd(), "public", "sw.js"), "utf8");

const URL_CASES: Array<[unknown, string]> = [
  ["/activity/ABC?chain=osmosis-1", "/activity/ABC?chain=osmosis-1"],
  ["/governance/1049?chain=osmosis-1#vote", "/governance/1049?chain=osmosis-1#vote"],
  ["https://wallet.zunialab.com/staking", "/staking"],
  ["/staking/../settings", "/settings"],
  ["  /overview  ", "/overview"],
  ["https://evil.example/phish", NOTICE_FALLBACK_URL],
  ["http://wallet.zunialab.com/staking", NOTICE_FALLBACK_URL],
  ["//evil.example/x", NOTICE_FALLBACK_URL],
  ["/\\evil.example/x", NOTICE_FALLBACK_URL],
  ["\\\\evil.example", NOTICE_FALLBACK_URL],
  ["javascript:alert(1)", NOTICE_FALLBACK_URL],
  ["data:text/html,hi", NOTICE_FALLBACK_URL],
  ["activity/ABC", NOTICE_FALLBACK_URL],
  ["/api/push/subscribe", NOTICE_FALLBACK_URL],
  ["/api", NOTICE_FALLBACK_URL],
  ["https://user:pw@wallet.zunialab.com/x", NOTICE_FALLBACK_URL],
  ["/x\u0000y", NOTICE_FALLBACK_URL],
  ["/x\ny", NOTICE_FALLBACK_URL],
  [`/${"a".repeat(600)}`, NOTICE_FALLBACK_URL],
  ["", NOTICE_FALLBACK_URL],
  [42, NOTICE_FALLBACK_URL],
  [null, NOTICE_FALLBACK_URL],
];

interface FakeClient {
  url: string;
  focused: boolean;
  visibilityState: string;
  messages: unknown[];
  focusCalls: number;
  navigated: string[];
  focus(): Promise<FakeClient>;
  postMessage(message: unknown, ports?: MessagePort[]): void;
  navigate?(url: string): Promise<FakeClient>;
}

function fakeClient(url: string, options: { ack?: boolean; focused?: boolean; canNavigate?: boolean } = {}): FakeClient {
  const client: FakeClient = {
    url,
    focused: options.focused ?? false,
    visibilityState: "visible",
    messages: [],
    focusCalls: 0,
    navigated: [],
    async focus() {
      client.focusCalls += 1;
      return client;
    },
    postMessage(message: unknown, ports?: MessagePort[]) {
      client.messages.push(message);
      if (options.ack && ports?.[0]) ports[0].postMessage({ ok: true });
    },
  };
  if (options.canNavigate !== false) {
    client.navigate = async (target: string) => {
      client.navigated.push(target);
      return client;
    };
  }
  return client;
}

interface Harness {
  context: vm.Context;
  listeners: Map<string, (event: unknown) => void>;
  shown: Array<{ title: string; options: Record<string, unknown> }>;
  opened: string[];
  fetches: Array<{ url: string; init?: RequestInit }>;
  cache: Map<string, string>;
  clients: FakeClient[];
  dispatch(type: string, event: Record<string, unknown>): Promise<void>;
}

function loadWorker(clients: FakeClient[] = [], options: { showFails?: boolean } = {}): Harness {
  const listeners = new Map<string, (event: unknown) => void>();
  const shown: Harness["shown"] = [];
  const opened: string[] = [];
  const fetches: Harness["fetches"] = [];
  const cache = new Map<string, string>();
  const self = {
    location: { origin: ORIGIN },
    addEventListener: (type: string, listener: (event: unknown) => void) => listeners.set(type, listener),
    skipWaiting: async () => undefined,
    registration: {
      showNotification: async (title: string, details: Record<string, unknown>) => {
        if (options.showFails) throw new TypeError("No notification permission has been granted for this origin.");
        shown.push({ title, options: details });
      },
      pushManager: {
        subscribe: async () => ({
          endpoint: "https://fcm.googleapis.com/fcm/send/new",
          toJSON: () => ({ endpoint: "https://fcm.googleapis.com/fcm/send/new", keys: { p256dh: "k", auth: "a" } }),
        }),
      },
    },
    clients: {
      claim: async () => undefined,
      matchAll: async () => clients,
      openWindow: async (url: string) => {
        opened.push(url);
        return null;
      },
    },
  };
  const caches = {
    open: async () => ({
      match: async (key: string) => (cache.has(key) ? new Response(cache.get(key)) : undefined),
      put: async (key: string, response: Response) => {
        cache.set(key, await response.text());
      },
    }),
  };
  const fetchStub = async (url: string, init?: RequestInit) => {
    fetches.push({ url, init });
    if (url === "/api/push/config") {
      return Response.json({ enabled: true, publicKey: "BNcRdreALRFXTkOOUHK1EtK2wtaz5Ry4YfYCA_0QTpQtUbVlUls0VJXg7A8u-Ts1XbjhazAkj7I99e8QcYP7DkM" });
    }
    return Response.json({ ok: true });
  };
  const context = vm.createContext({
    self,
    caches,
    fetch: fetchStub,
    URL,
    Response,
    MessageChannel,
    setTimeout,
    clearTimeout,
    atob,
    console,
    Date,
  });
  vm.runInContext(SOURCE, context, { filename: "public/sw.js" });
  context.ACK_TIMEOUT_MS = 50;
  return {
    context,
    listeners,
    shown,
    opened,
    fetches,
    cache,
    clients,
    async dispatch(type, event) {
      const pending: Promise<unknown>[] = [];
      listeners.get(type)?.({ ...event, waitUntil: (promise: Promise<unknown>) => pending.push(promise) });
      await Promise.all(pending);
    },
  };
}

test("one URL rule: the TypeScript helper and the worker agree on every case", () => {
  const worker = loadWorker();
  for (const [raw, expected] of URL_CASES) {
    assert.equal(safeNoticeUrl(raw, ORIGIN), expected, `ts ${String(raw).slice(0, 40)}`);
    assert.equal(worker.context.safeUrl(raw, ORIGIN), expected, `sw ${String(raw).slice(0, 40)}`);
  }
});

test("payload parsing agrees between the app and the worker", () => {
  const worker = loadWorker();
  const inputs: unknown[] = [
    buildPushPayload({
      id: "transfer:AB",
      kind: "ibc",
      title: "Arrived from Cosmos Hub",
      body: "2 ATOM landed on Osmosis.",
      chainId: "osmosis-1",
      url: "/activity/AB?chain=osmosis-1",
      at: 1_700_000_000_000,
      severity: "success",
    }),
    { v: 1, id: "x", title: "t", kind: "nope", url: "//evil.example", tag: 3 },
    { v: 2, id: "x", title: "t" },
    { v: 1, id: "x" },
    "text",
    null,
  ];
  for (const input of inputs) {
    assert.deepEqual(
      JSON.parse(JSON.stringify(worker.context.parsePayload(input))),
      JSON.parse(JSON.stringify(parsePushPayload(input))),
      JSON.stringify(input),
    );
  }
});

test("push: shows the payload with its tag, badge and safe URL, then tells open tabs to refresh", async () => {
  const tab = fakeClient(`${ORIGIN}/overview`);
  const other = fakeClient("https://elsewhere.example/");
  const worker = loadWorker([tab, other]);
  const payload = buildPushPayload({
    id: "transfer:7B5E",
    kind: "transfer",
    title: "Received 0.5 OSMO on Osmosis",
    body: "From osmo1zva9…g8mm",
    chainId: "osmosis-1",
    url: "/activity/7B5E?chain=osmosis-1",
    at: 1_791_323_550_000,
    severity: "success",
  });
  await worker.dispatch("push", { data: { json: () => payload } });
  assert.equal(worker.shown.length, 1);
  assert.equal(worker.shown[0].title, "Received 0.5 OSMO on Osmosis");
  assert.deepEqual(JSON.parse(JSON.stringify(worker.shown[0].options)), {
    body: "From osmo1zva9…g8mm",
    icon: "/icons/icon-192.png",
    badge: "/icons/badge-96.png",
    tag: "transfer:7B5E",
    renotify: false,
    data: { url: "/activity/7B5E?chain=osmosis-1", id: "transfer:7B5E" },
    timestamp: 1_791_323_550_000,
  });
  // Objects made inside the VM have its prototypes: compare as JSON.
  assert.deepEqual(JSON.parse(JSON.stringify(tab.messages)), [{ type: "zunia:refresh", id: "transfer:7B5E" }]);
  assert.deepEqual(other.messages, [], "never messages another origin's window");
});

test("push: an unreadable payload still shows a notification (browsers require one)", async () => {
  const worker = loadWorker();
  await worker.dispatch("push", {
    data: {
      json: () => {
        throw new SyntaxError("bad");
      },
    },
  });
  await worker.dispatch("push", { data: null });
  assert.equal(worker.shown.length, 2);
  assert.equal(worker.shown[0].title, "Zunia");
  assert.deepEqual(JSON.parse(JSON.stringify(worker.shown[0].options.data)), { url: "/notifications", id: null });
});

test("push: open tabs still refresh when the notification cannot be shown", async () => {
  const tab = fakeClient(`${ORIGIN}/overview`);
  const worker = loadWorker([tab], { showFails: true });
  await worker.dispatch("push", { data: { json: () => ({ v: 1, id: "a", title: "t" }) } });
  assert.deepEqual(worker.shown, []);
  assert.deepEqual(JSON.parse(JSON.stringify(tab.messages)), [{ type: "zunia:refresh", id: "a" }]);
});

test("click: focuses the open tab and asks it to navigate", async () => {
  const tab = fakeClient(`${ORIGIN}/overview`, { ack: true, focused: true });
  const worker = loadWorker([tab]);
  let closed = false;
  await worker.dispatch("notificationclick", {
    notification: { data: { url: "/governance/1049?chain=osmosis-1" }, close: () => (closed = true) },
  });
  assert.equal(closed, true);
  assert.equal(tab.focusCalls, 1);
  assert.deepEqual(JSON.parse(JSON.stringify(tab.messages)), [{ type: "zunia:navigate", url: "/governance/1049?chain=osmosis-1" }]);
  assert.deepEqual(tab.navigated, []);
  assert.deepEqual(worker.opened, []);
});

test("click: a tab that does not answer is navigated; no tab opens a window", async () => {
  const silent = fakeClient(`${ORIGIN}/overview`);
  const first = loadWorker([silent]);
  await first.dispatch("notificationclick", { notification: { data: { url: "/staking" }, close() {} } });
  assert.deepEqual(silent.navigated, ["/staking"]);

  const uncontrolled = fakeClient(`${ORIGIN}/overview`, { canNavigate: false });
  const second = loadWorker([uncontrolled]);
  await second.dispatch("notificationclick", { notification: { data: { url: "/staking" }, close() {} } });
  assert.deepEqual(second.opened, ["/staking"]);

  const none = loadWorker([]);
  await none.dispatch("notificationclick", { notification: { data: { url: "https://evil.example/" }, close() {} } });
  assert.deepEqual(none.opened, ["/notifications"], "a foreign URL in the data opens the notification centre");
});

test("subscription change: subscribes again and re-registers the stored accounts", async () => {
  const tab = fakeClient(`${ORIGIN}/overview`);
  const worker = loadWorker([tab]);
  const accounts = [{ chainId: "osmosis-1", address: "osmo1gv86dp8wmnmmatdckgr5xkevnpmy4662stl5rm" }];
  worker.cache.set(
    "/__zunia/push-registration",
    JSON.stringify({ endpoint: "https://fcm.googleapis.com/fcm/send/old", accounts, prefs: { transfers: true }, locale: "en", timeZone: "UTC" }),
  );
  await worker.dispatch("pushsubscriptionchange", { oldSubscription: null, newSubscription: null });

  const post = worker.fetches.find((call) => call.url === "/api/push/subscribe");
  assert.ok(post, "posted to the subscribe route");
  assert.equal(post.init?.method, "POST");
  const sent = JSON.parse(String(post.init?.body));
  assert.deepEqual(sent.accounts, accounts);
  assert.equal(sent.subscription.endpoint, "https://fcm.googleapis.com/fcm/send/new");
  assert.equal(sent.replaces, "https://fcm.googleapis.com/fcm/send/old");
  assert.equal(JSON.parse(worker.cache.get("/__zunia/push-registration") ?? "{}").endpoint, "https://fcm.googleapis.com/fcm/send/new");
  assert.deepEqual(JSON.parse(JSON.stringify(tab.messages)), [{ type: "zunia:push-changed" }]);
});

test("subscription change without stored accounts does nothing", async () => {
  const worker = loadWorker();
  await worker.dispatch("pushsubscriptionchange", {});
  assert.deepEqual(worker.fetches, []);
});

/* ------------------------------------------------------------ privacy mode */

const MASK_CASES: Array<[string, string]> = [
  ["Received 1,250.5 OSMO on Osmosis", "transfer"],
  ["Received 0.5 OSMO and 3 more on Osmosis", "transfer"],
  ["From osmo1zva9…g8mm", "transfer"],
  ["950000 base units of ibc/7D72…DAB2 landed on Osmosis from cosmos1qx8t…ccyk.", "ibc"],
  ["2 ATOM came back to you on cosmoshub-4: the transfer did not complete.", "ibc"],
  ["12.5 ATOM is liquid again on Cosmos Hub.", "unbonding"],
  ["Swapped 10 OSMO for 1.2 ATOM", "swap"],
  ["(1.5 ATOM) and 2,000 TIA", "swap"],
  ["0.000012 TIA", "transfer"],
  ["1 2 3", "transfer"],
  ["1.5.3 v2 x-4 #7", "transfer"],
  ["#1049 Upgrade to v25 · Osmosis. You haven't voted yet.", "governance"],
  ["Vote ends in 5 h", "governance"],
  ["From 5% to 10% on Osmosis.", "validator"],
  ["Waiting on Cosmos Hub and 2 more networks.", "rewards"],
];

test("privacy: the worker's mask agrees with maskAmounts on every case", () => {
  const worker = loadWorker();
  for (const [text, kind] of MASK_CASES) {
    assert.equal(worker.context.maskText(text, kind), maskAmounts(text, kind), `${kind}: ${text}`);
  }
});

test("privacy: with hide amounts recorded, a push shows dots for amounts only", async () => {
  const worker = loadWorker();
  worker.cache.set("/__zunia/privacy", JSON.stringify({ hideAmounts: true }));
  const transfer = buildPushPayload({
    id: "transfer:7B5E",
    kind: "transfer",
    title: "Received 0.5 OSMO on Osmosis",
    body: "From osmo1zva9…g8mm",
    chainId: "osmosis-1",
    url: "/activity/7B5E?chainId=osmosis-1",
    at: 1,
    severity: "success",
  });
  const unbonding = buildPushPayload({
    id: "unbonding:cosmoshub-4:v:1",
    kind: "unbonding",
    title: "Unbonding complete",
    body: "12.5 ATOM is liquid again on Cosmos Hub.",
    chainId: "cosmoshub-4",
    url: "/staking",
    at: 1,
    severity: "success",
  });
  const vote = buildPushPayload({
    id: "gov:osmosis-1:1049:24h",
    kind: "governance",
    title: "Vote ends in 5 h",
    body: "#1049 Upgrade · Osmosis.",
    chainId: "osmosis-1",
    url: "/governance/osmosis-1/1049",
    at: 1,
    severity: "warning",
  });
  await worker.dispatch("push", { data: { json: () => transfer } });
  await worker.dispatch("push", { data: { json: () => unbonding } });
  await worker.dispatch("push", { data: { json: () => vote } });
  await worker.dispatch("push", { data: null });
  assert.equal(worker.shown[0].title, "Received •••• OSMO on Osmosis");
  assert.equal(worker.shown[0].options.body, "From osmo1zva9…g8mm", "an address keeps its digits");
  assert.equal(worker.shown[1].options.body, "•••• ATOM is liquid again on Cosmos Hub.");
  assert.equal(worker.shown[2].title, "Vote ends in 5 h", "a vote carries no amount");
  assert.equal(worker.shown[2].options.body, "#1049 Upgrade · Osmosis.");
  assert.equal(worker.shown[3].title, "Zunia", "an unreadable push still shows the generic line");
});

test("privacy: off, missing, unreadable or unavailable storage leaves the push as composed", async () => {
  const push = { v: 1, id: "transfer:A", kind: "transfer", title: "Received 0.5 OSMO on Osmosis" };
  for (const stored of [JSON.stringify({ hideAmounts: false }), JSON.stringify({ hideAmounts: "yes" }), null, "not json"]) {
    const worker = loadWorker();
    if (stored !== null) worker.cache.set("/__zunia/privacy", stored);
    await worker.dispatch("push", { data: { json: () => push } });
    assert.equal(worker.shown[0].title, "Received 0.5 OSMO on Osmosis", String(stored));
  }
  const broken = loadWorker();
  broken.context.caches = {
    open: async () => {
      throw new Error("SecurityError");
    },
  };
  await broken.dispatch("push", { data: { json: () => push } });
  assert.equal(broken.shown[0].title, "Received 0.5 OSMO on Osmosis", "Cache Storage refused");
});
