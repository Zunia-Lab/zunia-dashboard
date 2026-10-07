/** Where a visitor without the Zunia extension is sent to get it, browser by browser. */
import assert from "node:assert/strict";
import { test } from "node:test";

import { browserFor, ZUNIA_DOWNLOAD_PAGE, ZUNIA_EXTENSION_BUILDS, zuniaInstallHint } from "../install";

const UA = {
  chrome: "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36",
  chromeWindows: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36",
  chromeOs: "Mozilla/5.0 (X11; CrOS x86_64 14541.0.0) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36",
  // Brave sends Chrome's user agent word for word; `navigator.brave` gives it away.
  brave: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36",
  edge: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36 Edg/141.0.0.0",
  opera: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36 OPR/125.0.0.0",
  vivaldi: "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36 Vivaldi/7.6.3797.52",
  firefox: "Mozilla/5.0 (Macintosh; Intel Mac OS X 10.15; rv:143.0) Gecko/20100101 Firefox/143.0",
  firefoxWindows: "Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:143.0) Gecko/20100101 Firefox/143.0",
  safari: "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/26.0 Safari/605.1.15",
  iphoneSafari: "Mozilla/5.0 (iPhone; CPU iPhone OS 26_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/26.0 Mobile/15E148 Safari/604.1",
  iphoneChrome: "Mozilla/5.0 (iPhone; CPU iPhone OS 26_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) CriOS/141.0.7390.41 Mobile/15E148 Safari/604.1",
  ipad: "Mozilla/5.0 (iPad; CPU OS 26_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/26.0 Mobile/15E148 Safari/604.1",
  androidChrome: "Mozilla/5.0 (Linux; Android 15; Pixel 9) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Mobile Safari/537.36",
  androidTablet: "Mozilla/5.0 (Linux; Android 15; SM-X910) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36",
  androidFirefox: "Mozilla/5.0 (Android 15; Mobile; rv:143.0) Gecko/143.0 Firefox/143.0",
  samsung: "Mozilla/5.0 (Linux; Android 15; SM-S928B) AppleWebKit/537.36 (KHTML, like Gecko) SamsungBrowser/28.0 Chrome/130.0.0.0 Mobile Safari/537.36",
};

const STORE = "https://chromewebstore.google.com/detail/zunia/ngokakoekdogobjmokipglbcclelgajk";

test("Chromium on a computer: the Chrome Web Store listing, one click, named for the browser and recommended", () => {
  const cases: Array<[string, { brave?: boolean }, string]> = [
    [UA.chrome, {}, "Add to Chrome"],
    [UA.chromeWindows, {}, "Add to Chrome"],
    [UA.chromeOs, {}, "Add to Chrome"],
    [UA.brave, { brave: true }, "Add to Brave"],
    [UA.edge, {}, "Add to Edge"],
    [UA.opera, {}, "Add to Opera"],
    [UA.vivaldi, {}, "Add to Vivaldi"],
    // Arc and others send Chrome's words: the store says "Add to Chrome" to them too.
    ["", {}, "Add to Chrome"],
  ];
  for (const [ua, hints, action] of cases) {
    const browser = browserFor(ua, hints);
    assert.equal(browser.build, "chromium", action);
    assert.equal(browser.chromiumDesktop, true, action);
    assert.deepEqual(zuniaInstallHint(browser), {
      kind: "store",
      url: STORE,
      action,
      line: "Free on the Chrome Web Store.",
      chip: { label: "Recommended", tone: "recommended" },
    });
  }
  // Without its flag Brave reads as Chrome: the same listing, only the word differs.
  assert.equal(zuniaInstallHint(browserFor(UA.brave)).action, "Add to Chrome");
});

test("Firefox: not on AMO yet, so the download section of zunialab.com, saying it is coming", () => {
  for (const ua of [UA.firefox, UA.firefoxWindows]) {
    const browser = browserFor(ua);
    assert.deepEqual(browser, { build: "firefox", name: "Firefox", mobile: false, chromiumDesktop: false });
    assert.deepEqual(zuniaInstallHint(browser), {
      kind: "website",
      url: "https://zunialab.com/#download",
      action: "Get Zunia",
      line: "Coming to Firefox — see zunialab.com",
      chip: { label: "Coming soon", tone: "soon" },
    });
  }
});

test("Safari, on a Mac, an iPhone or an iPad: in review, so the download section too", () => {
  const mac = browserFor(UA.safari);
  assert.deepEqual(mac, { build: "safari", name: "Safari", mobile: false, chromiumDesktop: false });
  // On iPhone and iPad only Safari runs extensions, whichever browser the page is open in.
  for (const ua of [UA.iphoneSafari, UA.iphoneChrome, UA.ipad]) {
    assert.deepEqual(browserFor(ua), { build: "safari", name: "Safari", mobile: true, chromiumDesktop: false }, ua);
  }
  for (const browser of [mac, browserFor(UA.iphoneSafari), browserFor(UA.iphoneChrome), browserFor(UA.ipad)]) {
    assert.deepEqual(zuniaInstallHint(browser), {
      kind: "website",
      url: ZUNIA_DOWNLOAD_PAGE,
      action: "Get Zunia",
      line: "In review for Safari — see zunialab.com",
      chip: { label: "In review", tone: "soon" },
    });
  }
});

test("Android phones and tablets: no store build runs there, so the download section", () => {
  for (const ua of [UA.androidChrome, UA.androidTablet, UA.androidFirefox, UA.samsung]) {
    const browser = browserFor(ua, { brave: false });
    assert.equal(browser.mobile, true, ua);
    assert.equal(browser.chromiumDesktop, false, ua);
    assert.deepEqual(zuniaInstallHint(browser), {
      kind: "website",
      url: ZUNIA_DOWNLOAD_PAGE,
      action: "Get Zunia",
      line: "Extensions run in desktop browsers — see zunialab.com",
      chip: null,
    });
  }
  // Brave on Android too.
  assert.equal(zuniaInstallHint(browserFor(UA.androidChrome, { brave: true })).kind, "website");
});

test("the builds mirror the website's DOWNLOADS: Chrome available, Safari in review, Firefox planned", () => {
  assert.deepEqual(ZUNIA_EXTENSION_BUILDS, {
    chromium: { availability: "available", listing: STORE },
    safari: { availability: "review", listing: null },
    firefox: { availability: "planned", listing: null },
  });
});
