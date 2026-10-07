/**
 * Links built from chain data: only absolute http(s) URLs and mailto become
 * external links, only real app paths become internal ones.
 */

import assert from "node:assert/strict";
import { test } from "node:test";

import { isAppPath, isSafeExternalHref } from "../safe-href";

test("isSafeExternalHref accepts absolute http(s) URLs and mailto", () => {
  assert.equal(isSafeExternalHref("https://www.mintscan.io/cosmos"), true);
  assert.equal(isSafeExternalHref("http://validator.example/about"), true);
  assert.equal(isSafeExternalHref("  https://zunialab.com  "), true);
  assert.equal(isSafeExternalHref("mailto:security@zunialab.com"), true);
});

test("isSafeExternalHref refuses scripts, data, relative and malformed hrefs", () => {
  assert.equal(isSafeExternalHref("javascript:alert(1)"), false);
  assert.equal(isSafeExternalHref("JaVaScRiPt:alert(1)"), false);
  assert.equal(isSafeExternalHref("data:text/html;base64,PHNjcmlwdD4="), false);
  assert.equal(isSafeExternalHref("vbscript:msgbox"), false);
  // A validator's "website" without a scheme would resolve against our origin.
  assert.equal(isSafeExternalHref("example.com"), false);
  assert.equal(isSafeExternalHref("//evil.example"), false);
  assert.equal(isSafeExternalHref("/validators"), false);
  assert.equal(isSafeExternalHref("https://"), false);
  assert.equal(isSafeExternalHref("https://exa mple.com"), false);
  assert.equal(isSafeExternalHref(""), false);
  assert.equal(isSafeExternalHref(null), false);
  assert.equal(isSafeExternalHref(undefined), false);
});

test("isSafeExternalHref refuses URLs with credentials (a host hidden behind a fake one)", () => {
  // Shown without its scheme this reads "cosmos.network@evil.example" and opens evil.example.
  assert.equal(isSafeExternalHref("https://cosmos.network@evil.example/"), false);
  assert.equal(isSafeExternalHref("https://user:pass@validator.example"), false);
  assert.equal(isSafeExternalHref("https://:cosmos.network@evil.example"), false);
  assert.equal(isSafeExternalHref("https://@evil.example"), false);
  assert.equal(isSafeExternalHref("HTTP://Cosmos.Network@EVIL.example/path"), false);
  // An "@" after the host is ordinary: profile paths, queries, fragments.
  assert.equal(isSafeExternalHref("https://medium.com/@zunialab"), true);
  assert.equal(isSafeExternalHref("https://example.com/?ref=a@b"), true);
  assert.equal(isSafeExternalHref("https://example.com/#a@b"), true);
});

test("isAppPath accepts app paths only", () => {
  assert.equal(isAppPath("/validators/cosmosvaloper1abc?chain=cosmoshub-4"), true);
  assert.equal(isAppPath("/"), true);
  assert.equal(isAppPath("//evil.example"), false);
  assert.equal(isAppPath("/\\evil.example"), false);
  assert.equal(isAppPath("https://zunialab.com"), false);
  assert.equal(isAppPath("javascript:alert(1)"), false);
  assert.equal(isAppPath("validators"), false);
  assert.equal(isAppPath(undefined), false);
});
