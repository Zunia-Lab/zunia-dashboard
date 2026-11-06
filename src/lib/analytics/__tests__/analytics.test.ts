import assert from "node:assert/strict";
import { test } from "node:test";

import {
  CONSENT_KEY,
  analyticsConfigured,
  analyticsHostOk,
  disableAnalytics,
  enableAnalytics,
  gaCookieNames,
  parseConsent,
  sendPageView,
  type AnalyticsEnv,
} from "../consent";
import { sanitizePageView, sanitizePath, scrubText } from "../sanitize";

const ADDRESS = "cosmos1qypqxpq9qcrsszg2pvxq6rs0zqg3yyc5lzv7xu";
const VALOPER = "cosmosvaloper1sjllsnramtg3ewxqwwrwjxfgc4n4ef9u2lcnj0";
const OSMO = "osmo1clpqr4nrk4khgkxj78fcwwh6dl3uw4ep88n0y4";
const HASH = "3A1F5C9D8E7B2A4C6D0E1F2A3B4C5D6E7F8091A2B3C4D5E6F708192A3B4C5D6E";
const LOWER_HASH = HASH.toLowerCase();
const EVM = "0x52908400098527886E0F7030069857D2E4169EE7";

test("sanitizer drops query and hash", () => {
  assert.equal(sanitizePath(`/send?to=${ADDRESS}&amount=12.5#memo`), "/send");
  assert.equal(sanitizePath("/markets?sort=tvl"), "/markets");
  assert.equal(sanitizePath("/"), "/");
});

test("sanitizer replaces bech32 addresses, valoper included, with :address", () => {
  assert.equal(scrubText(`Balance of ${ADDRESS}`), "Balance of :address");
  assert.equal(scrubText(VALOPER), ":address");
  assert.equal(scrubText(`${OSMO} and ${ADDRESS}`), ":address and :address");
  assert.equal(sanitizePath(`/some/${ADDRESS}`), "/some/:address");
});

test("sanitizer replaces 64-hex strings and EVM addresses", () => {
  assert.equal(sanitizePath(`/tx/${LOWER_HASH}`), "/tx/:hash");
  assert.equal(scrubText(`0x${LOWER_HASH}`), ":hash");
  assert.equal(scrubText(HASH), ":hash");
  assert.equal(scrubText(EVM), ":address");
});

test("identifying routes report their pattern", () => {
  assert.equal(sanitizePath("/assets/ibc%2F27394FB092D2ECCD56123C74F36E4C1F926001CEADA9CA97EA622B25F41E5EB2"), "/assets/[key]");
  assert.equal(sanitizePath("/assets/uatom"), "/assets/[key]");
  assert.equal(sanitizePath(`/validators/${VALOPER}`), "/validators/[address]");
  assert.equal(sanitizePath(`/activity/${LOWER_HASH}`), "/activity/[hash]");
  assert.equal(sanitizePath(`/nfts/stargaze-1/${ADDRESS}/42?x=1`), "/nfts/[chainId]/[contract]/[tokenId]");
  // The list pages and public detail pages are left readable.
  assert.equal(sanitizePath("/assets"), "/assets");
  assert.equal(sanitizePath("/chains/cosmoshub-4"), "/chains/cosmoshub-4");
  assert.equal(sanitizePath("/governance/cosmoshub-4/812"), "/governance/cosmoshub-4/812");
});

test("page view fields are all sanitized, titles of identifying routes are the pattern", () => {
  const view = sanitizePageView("https://app.zunialab.com", `/validators/${VALOPER}`, `Validator ${VALOPER} · Zunia`);
  assert.deepEqual(view, {
    page_location: "https://app.zunialab.com/validators/[address]",
    page_path: "/validators/[address]",
    page_title: "/validators/[address]",
  });
  const other = sanitizePageView("https://app.zunialab.com", "/overview?a=1", `Overview of ${ADDRESS} · Zunia`);
  assert.equal(other.page_title, "Overview of :address · Zunia");
  assert.equal(other.page_location, "https://app.zunialab.com/overview");
  for (const value of Object.values(other)) assert.doesNotMatch(value, /cosmos1|a=1/);
});

/** A fake browser that records everything a page would do. */
function fakeEnv(hostname = "app.zunialab.com") {
  const appended: Array<{ src: string }> = [];
  const removed: string[] = [];
  const doc = {
    title: "Overview · Zunia",
    referrer: "",
    cookie: "_ga=GA1.1.1; _ga_ABC123=GS1; theme=dark",
    head: { appendChild: (node: { src: string }) => appended.push(node) },
    createElement: () => ({ src: "", async: false, setAttribute() {} }),
    querySelectorAll: () => appended.map((node) => ({ remove: () => removed.push(node.src) })),
  };
  const cookieWrites: string[] = [];
  Object.defineProperty(doc, "cookie", {
    get: () => "_ga=GA1.1.1; _ga_ABC123=GS1; theme=dark",
    set: (value: string) => cookieWrites.push(value),
  });
  const win: AnalyticsEnv["window"] = { location: { origin: `https://${hostname}`, hostname } };
  return { env: { document: doc, window: win } as unknown as AnalyticsEnv, appended, removed, cookieWrites };
}

test("nothing is loaded before consent", () => {
  const { env, appended } = fakeEnv();
  assert.equal(parseConsent(null), null);
  assert.equal(parseConsent('"denied"'), "denied");
  assert.equal(appended.length, 0);
  assert.equal(env.window.gtag, undefined);
  assert.equal(env.window.dataLayer, undefined);
  // A page view before loading sends nothing and creates nothing.
  sendPageView(env, "/overview", null);
  assert.equal(env.window.dataLayer, undefined);
});

test("analytics needs an ID, a production build and the real host", () => {
  assert.equal(analyticsConfigured("", "production"), false);
  assert.equal(analyticsConfigured("G-ABC123", "development"), false);
  assert.equal(analyticsConfigured("G-ABC123", "production"), true);
  assert.equal(analyticsHostOk("app.zunialab.com"), true);
  assert.equal(analyticsHostOk("localhost"), false);
  assert.equal(analyticsHostOk("preview-x.vercel.app"), false);
});

test("consent persistence uses a versioned key and rejects junk", () => {
  assert.match(CONSENT_KEY, /\.v\d+$/);
  assert.equal(parseConsent('"granted"'), "granted");
  assert.equal(parseConsent("granted"), null);
  assert.equal(parseConsent('"maybe"'), null);
  assert.equal(parseConsent("true"), null);
});

test("on allow: gtag.js loads with consent mode v2 and private config, page views are sanitized", () => {
  const { env, appended } = fakeEnv();
  enableAnalytics("G-TEST123", env);
  enableAnalytics("G-TEST123", env); // idempotent
  assert.equal(appended.length, 1);
  assert.equal(appended[0]!.src, "https://www.googletagmanager.com/gtag/js?id=G-TEST123");

  const calls = (env.window.dataLayer as ArrayLike<unknown>[]).map((entry) => Array.from(entry));
  assert.deepEqual(calls[0], [
    "consent",
    "default",
    { ad_storage: "denied", ad_user_data: "denied", ad_personalization: "denied", analytics_storage: "granted" },
  ]);
  assert.deepEqual(calls[2], [
    "config",
    "G-TEST123",
    { send_page_view: false, allow_google_signals: false, allow_ad_personalization_signals: false },
  ]);

  const location = sendPageView(env, `/validators/${VALOPER}?tab=1`, null);
  assert.equal(location, "https://app.zunialab.com/validators/[address]");
  const event = Array.from((env.window.dataLayer as ArrayLike<unknown>[]).at(-1)!);
  assert.equal(event[0], "event");
  assert.equal(event[1], "page_view");
  assert.doesNotMatch(JSON.stringify(event), /cosmos|tab=1/);
  assert.equal((event[2] as { page_referrer: string }).page_referrer, "");
  // Only page_view is ever sent.
  const events = (env.window.dataLayer as ArrayLike<unknown>[]).map((e) => Array.from(e)).filter((e) => e[0] === "event");
  assert.ok(events.every((e) => e[1] === "page_view"));
});

test("withdrawal stops gtag, removes the script and deletes the _ga cookies", () => {
  const { env, removed, cookieWrites } = fakeEnv();
  enableAnalytics("G-TEST123", env);
  disableAnalytics("G-TEST123", env);
  assert.equal(env.window["ga-disable-G-TEST123"], true);
  assert.equal(env.window.gtag, undefined);
  assert.equal(env.window.dataLayer, undefined);
  assert.equal(removed.length, 1);
  assert.deepEqual(gaCookieNames("_ga=1; _ga_ABC=2; _gid=3; theme=dark; session=4"), ["_ga", "_ga_ABC", "_gid"]);
  assert.ok(cookieWrites.some((w) => w.startsWith("_ga=; Max-Age=0") && w.includes("Domain=.zunialab.com")));
  assert.ok(cookieWrites.some((w) => w.startsWith("_ga_ABC123=; Max-Age=0")));
  assert.ok(cookieWrites.every((w) => !w.startsWith("theme")));
  // Page views after withdrawal go nowhere.
  sendPageView(env, "/overview", null);
  assert.equal(env.window.dataLayer, undefined);
});
