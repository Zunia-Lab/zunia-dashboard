/*
 * Zunia dashboard service worker: shows Web Push notifications and routes
 * their clicks. Nothing else.
 *
 * - No `fetch` handler, on purpose: the dashboard is a live view of chain
 *   data, and a cached response is a wrong balance. Pages and API reads always
 *   go to the network.
 * - The push payload is complete (`{v:1, id, kind, title, body, url, chainId,
 *   tag, at}`, built by src/lib/notifications/payload.ts), so this worker
 *   needs no app code and no network to show it. `tag` is the notice id: a
 *   push and an in-page alert for the same event replace each other instead
 *   of stacking.
 * - A notification's URL is trusted only after `safeUrl`: same origin, an app
 *   path, nothing the URL parser could read two ways. `safeUrl` is the twin
 *   of `safeNoticeUrl` in src/lib/notifications/url.ts; the test in
 *   src/lib/notifications/__tests__/sw.test.ts runs one case table against
 *   both, and loads this file to test the handlers themselves.
 * - After a push, open tabs get `{type: "zunia:refresh"}` so they re-read
 *   balances and activity; a click focuses an existing tab and asks it to
 *   navigate (`{type: "zunia:navigate", url}`, answered on a MessageChannel),
 *   falling back to `navigate()` and then to a new window.
 * - When the browser rotates the subscription (`pushsubscriptionchange`), the
 *   worker subscribes again with the same server key and re-registers it with
 *   the accounts and prefs the page stored in Cache Storage (the only storage
 *   both a page and a worker can read).
 * - Privacy mode ("Hide amounts") applies here too: the page records it in
 *   Cache Storage (`/__zunia/privacy`, written by syncPushPrivacy in
 *   src/lib/data/push.ts), and with it on, the amounts in a transfer, IBC,
 *   swap or unbonding push are shown as dots. `maskText` is the twin of
 *   `maskAmounts` in src/lib/notifications/text.ts; sw.test.ts runs one case
 *   table against both. Unknown or unreadable means off, as in the page.
 *
 * Top-level helpers are function declarations so the test harness can call
 * them; tunables are `var` so it can shorten them.
 */

"use strict";

var ACK_TIMEOUT_MS = 1500;

const FALLBACK_URL = "/notifications";
const ICON = "/icons/icon-192.png";
const BADGE = "/icons/badge-96.png";
const REGISTRATION_CACHE = "zunia-push-v1";
const REGISTRATION_KEY = "/__zunia/push-registration";
const PRIVACY_KEY = "/__zunia/privacy";
const LIMITS = { url: 512, title: 120, body: 240, id: 200 };
const KINDS = ["transfer", "ibc", "swap", "rewards", "unbonding", "governance", "validator", "system"];
const UNSAFE_CHARS = /[\u0000-\u001f\u007f\\]/;
const AMOUNT_MASK = "\u2022\u2022\u2022\u2022";
/*
 * maskAmounts' number rule ("12.5", "1,234.56", not the "1" of osmo1… or a
 * proposal's "#1049"), written without a lookbehind: this file is parsed as is
 * by every browser that runs the worker, and a lookbehind literal is a
 * SyntaxError before Safari 16.4. The character before the number is captured
 * and put back instead.
 */
const AMOUNT_NUMBER = /(^|[^\w.,#-])\d[\d,]*(?:\.\d+)?(?!\w)/g;
/** Kinds whose text carries the user's amounts (a vote's number or a commission rate is not money). */
const AMOUNT_KINDS = ["transfer", "ibc", "swap", "unbonding"];

/** A same-origin app path for `raw`, or the notification centre. Twin of safeNoticeUrl. */
function safeUrl(raw, origin) {
  if (typeof raw !== "string") return FALLBACK_URL;
  const value = raw.trim();
  if (!value || value.length > LIMITS.url || UNSAFE_CHARS.test(value)) return FALLBACK_URL;
  const rooted = value.startsWith("/") && !value.startsWith("//");
  const absolute = /^https?:\/\//i.test(value);
  if (!rooted && !absolute) return FALLBACK_URL;
  let base;
  let url;
  try {
    base = new URL(origin);
    url = new URL(value, base);
  } catch {
    return FALLBACK_URL;
  }
  if (url.origin !== base.origin) return FALLBACK_URL;
  if (url.username || url.password) return FALLBACK_URL;
  const path = url.pathname;
  if (path === "/api" || path.startsWith("/api/")) return FALLBACK_URL;
  return path + url.search + url.hash;
}

function textOf(value, max) {
  return typeof value === "string" && value.length <= max ? value : null;
}

function rootedPath(value) {
  return typeof value === "string" && value.startsWith("/") && !value.startsWith("//") && value.length <= LIMITS.url
    ? value
    : FALLBACK_URL;
}

/** A v1 payload, validated; null for anything else. Twin of parsePushPayload. */
function parsePayload(raw) {
  if (!raw || typeof raw !== "object") return null;
  if (raw.v !== 1) return null;
  const id = textOf(raw.id, LIMITS.id);
  const title = textOf(raw.title, LIMITS.title);
  if (!id || !title) return null;
  return {
    v: 1,
    id: id,
    kind: KINDS.indexOf(raw.kind) >= 0 ? raw.kind : "system",
    title: title,
    body: textOf(raw.body, LIMITS.body) || "",
    url: rootedPath(textOf(raw.url, LIMITS.url)),
    chainId: textOf(raw.chainId, 64),
    tag: textOf(raw.tag, LIMITS.id) || id,
    at: typeof raw.at === "number" && Number.isFinite(raw.at) ? raw.at : 0,
  };
}

/** Privacy mode: free-standing amounts in an amount-bearing text become dots. Twin of maskAmounts. */
function maskText(text, kind) {
  return AMOUNT_KINDS.indexOf(kind) >= 0 ? text.replace(AMOUNT_NUMBER, "$1" + AMOUNT_MASK) : text;
}

/** Privacy mode as the page last recorded it; false when unknown or unreadable. */
async function amountsHidden() {
  try {
    const cache = await caches.open(REGISTRATION_CACHE);
    const response = await cache.match(PRIVACY_KEY);
    const value = response ? await response.json() : null;
    return Boolean(value && value.hideAmounts === true);
  } catch {
    return false;
  }
}

function readPayload(data) {
  if (!data) return null;
  try {
    return parsePayload(data.json());
  } catch {
    return null;
  }
}

/** What to show for a payload (a generic line when it could not be read: a push must always show something). */
function display(payload, origin) {
  if (!payload) {
    return {
      title: "Zunia",
      options: {
        body: "You have a new notification.",
        icon: ICON,
        badge: BADGE,
        tag: "zunia:generic",
        renotify: false,
        data: { url: FALLBACK_URL, id: null },
      },
    };
  }
  const options = {
    body: payload.body,
    icon: ICON,
    badge: BADGE,
    tag: payload.tag,
    renotify: false,
    data: { url: safeUrl(payload.url, origin), id: payload.id },
  };
  if (payload.at > 0) options.timestamp = payload.at;
  return { title: payload.title, options: options };
}

async function windowClients() {
  const list = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
  return list.filter(function (client) {
    try {
      return new URL(client.url).origin === self.location.origin;
    } catch {
      return false;
    }
  });
}

async function broadcast(message) {
  for (const client of await windowClients()) {
    try {
      client.postMessage(message);
    } catch {
      /* a closing tab */
    }
  }
}

/** Posts `message` with a reply port; true when the page answers `{ok: true}` in time. */
function askClient(client, message) {
  return new Promise(function (resolve) {
    let channel;
    try {
      channel = new MessageChannel();
    } catch {
      resolve(false);
      return;
    }
    const timer = setTimeout(function () {
      channel.port1.close();
      resolve(false);
    }, ACK_TIMEOUT_MS);
    channel.port1.onmessage = function (event) {
      clearTimeout(timer);
      channel.port1.close();
      resolve(Boolean(event.data && event.data.ok));
    };
    try {
      client.postMessage(message, [channel.port2]);
    } catch {
      clearTimeout(timer);
      channel.port1.close();
      resolve(false);
    }
  });
}

function pickClient(list) {
  return (
    list.find(function (client) {
      return client.focused;
    }) ||
    list.find(function (client) {
      return client.visibilityState === "visible";
    }) ||
    list[0] ||
    null
  );
}

async function openWindow(url) {
  return self.clients.openWindow ? self.clients.openWindow(url) : null;
}

/** Focus a tab of the dashboard and take it to `url`, or open one. */
async function openTarget(url) {
  const client = pickClient(await windowClients());
  // No tab: open one right away, while the click still counts as a user gesture.
  if (!client) return openWindow(url);
  let target = client;
  try {
    target = (await client.focus()) || client;
  } catch {
    /* focus refused; still try to navigate it */
  }
  if (await askClient(target, { type: "zunia:navigate", url: url })) return target;
  if (typeof target.navigate === "function") {
    try {
      return await target.navigate(url);
    } catch {
      /* uncontrolled tab: navigate() rejects */
    }
  }
  return openWindow(url);
}

function base64UrlToBytes(value) {
  const padded = value.replace(/-/g, "+").replace(/_/g, "/") + "===".slice((value.length + 3) % 4);
  const raw = atob(padded);
  const bytes = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i += 1) bytes[i] = raw.charCodeAt(i);
  return bytes;
}

async function readRegistration() {
  try {
    const cache = await caches.open(REGISTRATION_CACHE);
    const response = await cache.match(REGISTRATION_KEY);
    return response ? await response.json() : null;
  } catch {
    return null;
  }
}

async function writeRegistration(value) {
  try {
    const cache = await caches.open(REGISTRATION_CACHE);
    await cache.put(
      REGISTRATION_KEY,
      new Response(JSON.stringify(value), { headers: { "content-type": "application/json" } }),
    );
  } catch {
    /* storage refused; the page re-registers on its next visit */
  }
}

async function serverKey(oldSubscription) {
  const key = oldSubscription && oldSubscription.options && oldSubscription.options.applicationServerKey;
  if (key) return key;
  try {
    const response = await fetch("/api/push/config", { credentials: "same-origin" });
    const config = response.ok ? await response.json() : null;
    return config && config.enabled && typeof config.publicKey === "string" ? base64UrlToBytes(config.publicKey) : null;
  } catch {
    return null;
  }
}

/** Subscribe again after the browser rotated the subscription, and tell the server. */
async function resubscribe(oldSubscription, newSubscription) {
  const saved = await readRegistration();
  if (!saved || !Array.isArray(saved.accounts) || saved.accounts.length === 0) return false;
  let subscription = newSubscription;
  if (!subscription) {
    const key = await serverKey(oldSubscription);
    if (!key) return false;
    subscription = await self.registration.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: key });
  }
  const response = await fetch("/api/push/subscribe", {
    method: "POST",
    credentials: "same-origin",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      subscription: subscription.toJSON(),
      accounts: saved.accounts,
      prefs: saved.prefs,
      locale: saved.locale,
      timeZone: saved.timeZone,
      replaces: (oldSubscription && oldSubscription.endpoint) || saved.endpoint || null,
    }),
  });
  if (!response.ok) return false;
  await writeRegistration(Object.assign({}, saved, { endpoint: subscription.endpoint, savedAt: Date.now() }));
  await broadcast({ type: "zunia:push-changed" });
  return true;
}

self.addEventListener("install", function () {
  self.skipWaiting();
});

self.addEventListener("activate", function (event) {
  event.waitUntil(self.clients.claim());
});

self.addEventListener("push", function (event) {
  const payload = readPayload(event.data);
  event.waitUntil(
    amountsHidden().then(function (hide) {
      const visible =
        hide && payload
          ? Object.assign({}, payload, { title: maskText(payload.title, payload.kind), body: maskText(payload.body, payload.kind) })
          : payload;
      const shown = display(visible, self.location.origin);
      // Independent: open tabs refresh even when the notification cannot be
      // shown (permission revoked since subscribing), and the reverse.
      return Promise.allSettled([
        self.registration.showNotification(shown.title, shown.options),
        broadcast({ type: "zunia:refresh", id: shown.options.data.id }),
      ]);
    }),
  );
});

self.addEventListener("notificationclick", function (event) {
  event.notification.close();
  const data = event.notification.data || {};
  event.waitUntil(openTarget(safeUrl(data.url, self.location.origin)).catch(function () {}));
});

self.addEventListener("pushsubscriptionchange", function (event) {
  event.waitUntil(
    resubscribe(event.oldSubscription || null, event.newSubscription || null).catch(function () {
      return false;
    }),
  );
});
