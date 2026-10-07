/**
 * A validator's website is whatever its operator typed into
 * `description.website`: the dashboard links to it from indexable pages, so
 * the reader must refuse the shapes that open a different site than they
 * name, and the label must show where the link really goes.
 */

import assert from "node:assert/strict";
import { test } from "node:test";

import { safeWebsite, websiteHost } from "../parse";

test("safeWebsite keeps http(s) sites and adds the scheme a bare host lacks", () => {
  assert.equal(safeWebsite("ynukalabs.com"), "https://ynukalabs.com/");
  assert.equal(safeWebsite("  https://polkachu.com/networks  "), "https://polkachu.com/networks");
  assert.equal(safeWebsite("http://example.org"), "http://example.org/");
  // An "@" in the path is not a credential.
  assert.equal(safeWebsite("https://linktr.ee/@validator"), "https://linktr.ee/@validator");
});

test("safeWebsite refuses other schemes and junk", () => {
  assert.equal(safeWebsite("ftp://x"), null);
  assert.equal(safeWebsite("javascript:alert(1)"), null);
  assert.equal(safeWebsite("data:text/html,hi"), null);
  assert.equal(safeWebsite("not a url"), null);
  assert.equal(safeWebsite(""), null);
  assert.equal(safeWebsite(42), null);
});

test("safeWebsite refuses embedded credentials: the text before @ only looks like the host", () => {
  assert.equal(safeWebsite("https://cosmos.network@evil.example"), null);
  assert.equal(safeWebsite("https://cosmos.network:secret@evil.example/claim"), null);
  assert.equal(safeWebsite("http://user@example.org"), null);
  // Without a scheme the same trick still parses as a user name.
  assert.equal(safeWebsite("cosmos.network@evil.example"), null);
  // An empty user part parses as none at all: the raw text is checked too.
  assert.equal(safeWebsite("https://@evil.example"), null);
  assert.equal(safeWebsite("https://:@evil.example"), null);
});

test("websiteHost names where the link goes, never the path", () => {
  assert.equal(websiteHost("https://www.ynukalabs.com/about?ref=x"), "ynukalabs.com");
  assert.equal(websiteHost("https://evil.example/cosmos.network"), "evil.example");
  assert.equal(websiteHost("https://staking.cosmos.network/"), "staking.cosmos.network");
  assert.equal(websiteHost("http://example.org:8080/x"), "example.org");
  // "www." goes only where a name is left after it.
  assert.equal(websiteHost("https://www.com/"), "www.com");
});

test("websiteHost shows an internationalised host in the punycode form the browser opens", () => {
  // A Cyrillic "о" (U+043E) in place of the Latin one: it must not read as "cosmos.network".
  assert.equal(websiteHost("https://cosmоs.network/"), "xn--cosms-mye.network");
});

test("websiteHost is null for anything that is not an http(s) URL", () => {
  assert.equal(websiteHost(null), null);
  assert.equal(websiteHost(""), null);
  assert.equal(websiteHost("ynukalabs.com"), null);
  assert.equal(websiteHost("mailto:ops@example.org"), null);
  assert.equal(websiteHost("javascript:alert(1)"), null);
});
