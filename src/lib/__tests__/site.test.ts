/**
 * The site's public address (src/lib/site.ts): one origin for canonical links,
 * the sitemap, robots.txt and the host printed on cards and footers.
 *
 * What would break silently: a trailing slash (`https://host//markets` in the
 * sitemap), an override with a path (canonicals under a directory the app is
 * not served from), or a malformed override that either lands in every
 * canonical link or throws inside the root layout.
 */

import assert from "node:assert/strict";
import { test } from "node:test";

import { DEFAULT_SITE_URL, SITE_HOST, SITE_URL, siteUrlFrom } from "../site";

test("defaults to app.zunialab.com, the canonical host since the v2 launch", () => {
  assert.equal(DEFAULT_SITE_URL, "https://app.zunialab.com");
  for (const raw of [undefined, null, "", "   "]) {
    assert.equal(siteUrlFrom(raw), DEFAULT_SITE_URL, String(raw));
  }
});

test("an override keeps only its origin: no trailing slash, no path, no query", () => {
  assert.equal(siteUrlFrom("https://preview.zunialab.com/"), "https://preview.zunialab.com");
  assert.equal(siteUrlFrom(" https://preview.zunialab.com/overview?x=1#y "), "https://preview.zunialab.com");
  assert.equal(siteUrlFrom("HTTPS://App.ZuniaLab.com:443/"), "https://app.zunialab.com");
  // A local production build checked in a browser.
  assert.equal(siteUrlFrom("http://127.0.0.1:3003"), "http://127.0.0.1:3003");
});

test("a value that is not an http(s) URL falls back to the default instead of being trusted", () => {
  for (const raw of ["app.zunialab.com", "//app.zunialab.com", "https://", "javascript:alert(1)", "ftp://app.zunialab.com"]) {
    assert.equal(siteUrlFrom(raw), DEFAULT_SITE_URL, raw);
  }
});

test("the exported origin and host agree", () => {
  assert.equal(SITE_URL, siteUrlFrom(process.env.NEXT_PUBLIC_SITE_URL));
  assert.ok(!SITE_URL.endsWith("/"), SITE_URL);
  assert.equal(SITE_HOST, new URL(SITE_URL).host);
  assert.ok(!SITE_HOST.includes("/"), SITE_HOST);
});
