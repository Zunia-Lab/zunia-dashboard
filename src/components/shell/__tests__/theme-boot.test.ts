/**
 * The pre-paint theme script and ThemeProvider's rule must agree: a stored
 * light/dark wins, "system" follows the OS, anything else is dark. The
 * script also restores the sidebar preference and the chrome colour.
 */

import assert from "node:assert/strict";
import { test } from "node:test";

import {
  THEME_BOOT_SCRIPT,
  THEME_COLORS,
  applyDocumentTheme,
  parseSidebarPref,
  parseViewPref,
  resolveBootTheme,
} from "../theme-boot";

interface FakeDoc {
  attrs: Record<string, string>;
  classes: Set<string>;
  colorScheme: string;
  metas: Array<{ content: string }>;
}

function fakeDocument() {
  const state: FakeDoc = { attrs: {}, classes: new Set(), colorScheme: "", metas: [{ content: "#fff" }, { content: "#000" }] };
  const documentElement = {
    setAttribute: (name: string, value: string) => {
      state.attrs[name] = value;
    },
    classList: {
      toggle: (name: string, on: boolean) => {
        if (on) state.classes.add(name);
        else state.classes.delete(name);
      },
    },
    style: {
      set colorScheme(value: string) {
        state.colorScheme = value;
      },
    },
  };
  const doc = {
    documentElement,
    querySelectorAll: () => state.metas.map((meta) => ({ setAttribute: (_: string, value: string) => (meta.content = value) })),
  };
  return { state, doc };
}

function runScript(stored: Record<string, string>, systemDark: boolean): FakeDoc {
  const { state, doc } = fakeDocument();
  const storage = { getItem: (key: string) => (key in stored ? stored[key] : null) };
  const matchMedia = () => ({ matches: systemDark });
  new Function("document", "localStorage", "matchMedia", THEME_BOOT_SCRIPT)(doc, storage, matchMedia);
  return state;
}

const CASES: Array<[string | null, boolean]> = [
  [null, false],
  [null, true],
  ["light", true],
  ["dark", false],
  ["system", false],
  ["system", true],
  ["garbage", false],
];

test("resolveBootTheme: stored wins, system follows the OS, default dark", () => {
  assert.equal(resolveBootTheme(null, false), "dark");
  assert.equal(resolveBootTheme(undefined, true), "dark");
  assert.equal(resolveBootTheme("light", true), "light");
  assert.equal(resolveBootTheme("dark", false), "dark");
  assert.equal(resolveBootTheme("system", false), "light");
  assert.equal(resolveBootTheme("system", true), "dark");
  assert.equal(resolveBootTheme("purple", false), "dark");
});

test("the inline script applies exactly what resolveBootTheme decides", () => {
  for (const [stored, systemDark] of CASES) {
    const state = runScript(stored === null ? {} : { "zunia-theme": stored }, systemDark);
    const expected = resolveBootTheme(stored, systemDark);
    assert.equal(state.attrs["data-theme"], expected, `stored=${stored} system=${systemDark}`);
    assert.equal(state.classes.has("zunia-dark"), expected === "dark");
    assert.equal(state.classes.has("zunia-light"), expected === "light");
    assert.equal(state.colorScheme, expected);
    for (const meta of state.metas) assert.equal(meta.content, THEME_COLORS[expected]);
  }
});

test("the inline script restores a stored sidebar preference only", () => {
  assert.equal(runScript({ "zunia.dashboard.sidebar": JSON.stringify("collapsed") }, true).attrs["data-sidebar"], "collapsed");
  assert.equal(runScript({ "zunia.dashboard.sidebar": JSON.stringify("expanded") }, true).attrs["data-sidebar"], "expanded");
  assert.equal(runScript({ "zunia.dashboard.sidebar": "{oops" }, true).attrs["data-sidebar"], undefined);
  assert.equal(runScript({}, true).attrs["data-sidebar"], undefined);
});

test("the inline script survives a storage that throws", () => {
  const { state, doc } = fakeDocument();
  const storage = {
    getItem: () => {
      throw new Error("blocked");
    },
  };
  new Function("document", "localStorage", "matchMedia", THEME_BOOT_SCRIPT)(doc, storage, () => ({ matches: false }));
  assert.equal(state.attrs["data-theme"], "dark");
});

test("parseSidebarPref reads the JSON value useStoredValue writes", () => {
  assert.equal(parseSidebarPref(JSON.stringify("collapsed")), "collapsed");
  assert.equal(parseSidebarPref(JSON.stringify("expanded")), "expanded");
  assert.equal(parseSidebarPref("collapsed"), null);
  assert.equal(parseSidebarPref(null), null);
  assert.equal(parseSidebarPref(JSON.stringify(true)), null);
});

test("applyDocumentTheme mirrors the script", () => {
  const { state, doc } = fakeDocument();
  applyDocumentTheme(doc as unknown as Document, "light");
  assert.equal(state.attrs["data-theme"], "light");
  assert.ok(state.classes.has("zunia-light"));
  assert.ok(!state.classes.has("zunia-dark"));
  assert.equal(state.colorScheme, "light");
  for (const meta of state.metas) assert.equal(meta.content, THEME_COLORS.light);
});

test("the inline script sets the Lite / Pro view, Pro unless Lite is stored", () => {
  assert.equal(runScript({ "zunia.dashboard.view": JSON.stringify("lite") }, true).attrs["data-view"], "lite");
  assert.equal(runScript({ "zunia.dashboard.view": JSON.stringify("pro") }, true).attrs["data-view"], "pro");
  assert.equal(runScript({ "zunia.dashboard.view": "{oops" }, true).attrs["data-view"], "pro");
  assert.equal(runScript({}, true).attrs["data-view"], "pro");
});

test("parseViewPref agrees with the script", () => {
  assert.equal(parseViewPref(JSON.stringify("lite")), "lite");
  assert.equal(parseViewPref(JSON.stringify("pro")), "pro");
  assert.equal(parseViewPref("lite"), "pro");
  assert.equal(parseViewPref(null), "pro");
});
