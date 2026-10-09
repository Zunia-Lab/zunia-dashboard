import assert from "node:assert/strict";
import { test } from "node:test";
import { ALL_NAV_ITEMS, NAV_GROUPS } from "@/lib/nav";

test("the Lite view hides only analysis pages from the menus", () => {
  const pro = ALL_NAV_ITEMS.filter((item) => item.pro).map((item) => item.href).sort();
  assert.deepEqual(pro, ["/chains", "/compare", "/validators"]);
});

test("every page a holder acts on stays in the Lite menus", () => {
  const shown = new Set(NAV_GROUPS.flatMap((group) => group.items.filter((item) => !item.pro).map((item) => item.href)));
  for (const href of ["/overview", "/assets", "/activity", "/swap", "/bridge", "/send", "/receive", "/staking", "/governance", "/insights", "/markets"]) {
    assert.ok(shown.has(href), `${href} is shown in Lite`);
  }
});

test("no menu group is left empty in Lite", () => {
  for (const group of NAV_GROUPS) assert.ok(group.items.some((item) => !item.pro), `${group.id} keeps an entry`);
});
