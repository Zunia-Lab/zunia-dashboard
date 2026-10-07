/**
 * The generated robots.txt, sitemap.xml and web app manifest.
 *
 * Each of these is easy to break silently: a manifest without its `id` turns
 * every installed copy of the app into an orphan the next time `start_url`
 * moves, a sitemap that lists a chain the catalog dropped advertises a 404,
 * and a robots rule that covers `/api/` makes Google render every public page
 * as its error state (the pages load their data from `/api/*`, and Google's
 * renderer obeys robots.txt for those fetches).
 */

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";

import nextConfig from "../../../next.config";
import { SITE_URL } from "../../lib/site";
import manifest from "../manifest";
import robots from "../robots";
import sitemap from "../sitemap";

/**
 * The origin every URL in these files must use: app.zunialab.com, unless a
 * build overrides it with NEXT_PUBLIC_SITE_URL (src/lib/__tests__/site.test.ts
 * covers that rule).
 */
const SITE = SITE_URL;

/** The host before the v2 launch. It only redirects to the canonical one now. */
const OLD_HOST = "wallet.zunialab.com";

/**
 * The browser catalog, read from disk rather than imported: under the test
 * script's `--conditions=import` flag, tsx cannot load a `.json` import.
 */
const CATALOG = JSON.parse(
  readFileSync(join(import.meta.dirname, "../../data/chain-catalog.client.json"), "utf8"),
) as Array<{ chainId: string; network: string }>;

test("the manifest keeps the identity existing installs already have", () => {
  const m = manifest();
  // The public name: the site holds no keys, so the installed app is not a "wallet".
  assert.equal(m.name, "Zunia");
  assert.equal(m.short_name, "Zunia");
  // Installs made from the old static manifest derived their id from
  // start_url "/"; changing this would orphan them.
  assert.equal(m.id, "/");
  assert.equal(m.scope, "/");
  assert.equal(m.start_url, "/overview");
  assert.ok(m.start_url?.startsWith(m.scope ?? "/"), "start_url must be inside scope");
  assert.equal(m.display, "standalone");
  assert.equal("orientation" in m, false, "an orientation lock is wrong for a dashboard");
});

test("the manifest ships any and maskable icons at 192 and 512", () => {
  const icons = manifest().icons ?? [];
  for (const purpose of ["any", "maskable"] as const) {
    for (const size of ["192x192", "512x512"]) {
      assert.ok(
        icons.some((icon) => icon.purpose === purpose && icon.sizes === size),
        `missing ${purpose} ${size}`,
      );
    }
  }
  const shortcuts = (manifest().shortcuts ?? []).map((shortcut) => shortcut.url);
  assert.deepEqual(shortcuts, ["/overview", "/swap", "/activity"]);
});

test("robots leaves the API crawlable, keeps out /dev/ and points at the sitemap", () => {
  const r = robots();
  const rules = Array.isArray(r.rules) ? r.rules : [r.rules];
  const all = rules.find((rule) => rule.userAgent === "*");
  assert.ok(all, "a rule for every user agent");
  const disallow = Array.isArray(all.disallow) ? all.disallow : [all.disallow];
  assert.equal(
    disallow.some((path) => path?.startsWith("/api")),
    false,
    "public pages render from /api/; Google's renderer obeys robots.txt for those fetches",
  );
  assert.ok(disallow.includes("/dev/"));
  assert.equal(r.sitemap, `${SITE}/sitemap.xml`);
  assert.equal(r.host, undefined, "Host: is a Yandex-only line");
});

test("every /api response is kept out of the index by header, since robots.txt no longer does it", async () => {
  const rules = (await nextConfig.headers?.()) ?? [];
  const api = rules.find((rule) => rule.source === "/api/:path*" && !rule.has);
  assert.ok(
    api?.headers.some((header) => header.key === "X-Robots-Tag" && header.value === "noindex"),
    "X-Robots-Tag: noindex on /api/:path*",
  );
});

test("legacy URLs are real permanent redirects, answered before any page renders", async () => {
  const redirects = (await nextConfig.redirects?.()) ?? [];
  const to = (source: string) => redirects.find((rule) => rule.source === source);
  assert.equal(to("/portfolio")?.destination, "/overview");
  assert.equal(to("/dapps")?.destination, "/apps");
  // Zunia Mobile is an option of the Connect wallet modal, not a page.
  assert.equal(to("/mobile")?.destination, "/?connect=mobile");
  for (const source of ["/portfolio", "/dapps", "/mobile"]) {
    assert.equal(to(source)?.permanent, true, source);
  }
});

test(
  "robots and the sitemap name app.zunialab.com, never the old wallet host",
  { skip: process.env.NEXT_PUBLIC_SITE_URL ? "NEXT_PUBLIC_SITE_URL overrides the origin" : false },
  () => {
    assert.equal(SITE, "https://app.zunialab.com");
    assert.equal(robots().sitemap, "https://app.zunialab.com/sitemap.xml");
    for (const { url } of sitemap()) {
      assert.ok(url.startsWith("https://app.zunialab.com"), url);
      assert.ok(!url.includes(OLD_HOST), url);
    }
  },
);

test("the sitemap lists public pages only, once each, as absolute URLs", () => {
  const entries = sitemap();
  const urls = entries.map((entry) => entry.url);
  assert.equal(new Set(urls).size, urls.length, "no duplicates");
  for (const url of urls) {
    assert.ok(url === SITE || url.startsWith(`${SITE}/`), url);
    // `&` would need XML escaping; one query parameter at most.
    assert.ok(!url.includes("&"), url);
  }
  for (const path of ["/markets", "/chains", "/validators", "/governance", "/compare"]) {
    assert.ok(urls.includes(`${SITE}${path}`), path);
  }
  // Wallet pages never belong in search, and neither does a redirect:
  // `/mobile` now forwards to the Connect wallet modal.
  for (const path of ["/overview", "/settings", "/send", "/activity", "/networks", "/mobile", "/portfolio", "/dapps"]) {
    assert.equal(urls.some((url) => url.startsWith(`${SITE}${path}`)), false, path);
  }
});

test("every chain in the sitemap is a mainnet the catalog still has", () => {
  const chainIds = sitemap()
    .map((entry) => /\/chains\/([^/?#]+)$/.exec(entry.url)?.[1])
    .filter((id): id is string => Boolean(id))
    .map((id) => decodeURIComponent(id));
  assert.ok(chainIds.length >= 5);
  assert.equal(chainIds[0], "safrochain-1", "the home chain leads");
  for (const chainId of chainIds) {
    const row = CATALOG.find((chain) => chain.chainId === chainId);
    assert.equal(row?.network, "mainnet", chainId);
    // Each listed chain also gets its validator list.
    assert.ok(
      sitemap().some((entry) => entry.url === `${SITE}/validators?chain=${encodeURIComponent(chainId)}`),
      chainId,
    );
  }
});
