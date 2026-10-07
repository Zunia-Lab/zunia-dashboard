/**
 * The palette lives twice: as CSS variables (src/styles/viz.css, both
 * themes) and as the slot count the components hand out. These must agree,
 * and the hexes must be the validated ones from design spec §8: a slot the
 * CSS does not define renders as nothing, and an unvalidated hex is exactly
 * the eyeballed colour the method forbids.
 */

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { test } from "node:test";

import { VIZ_SLOT_COUNT, VIZ_SLOTS } from "../palette";

const css = readFileSync(path.join(process.cwd(), "src/styles/viz.css"), "utf8");

/** The declarations of the first rule whose selector list contains `selector`. */
function block(selector: string): Record<string, string> {
  const rule = new RegExp(`(^|\\n)([^{}]*${selector.replace(/[[\]"().*]/g, "\\$&")}[^{}]*)\\{([^}]*)\\}`);
  const match = css.match(rule);
  assert.ok(match, `no rule for ${selector}`);
  const vars: Record<string, string> = {};
  for (const m of match[3].matchAll(/(--viz-[\w-]+)\s*:\s*([^;]+);/g)) vars[m[1]] = m[2].trim();
  return vars;
}

const LIGHT = ["#eb6834", "#2a78d6", "#1baf7a", "#4a3aa7", "#eda100", "#e87ba4"];
const DARK = ["#d95926", "#3987e5", "#199e70", "#9085e9", "#c98500", "#d55181"];

for (const [theme, selector, hexes, other] of [
  ["light", ":root", LIGHT, "#8a8a94"],
  ["dark", '[data-theme="dark"]', DARK, "#6e6e78"],
] as const) {
  test(`${theme} theme defines exactly the validated slots`, () => {
    const vars = block(selector);
    const slots = Object.keys(vars).filter((k) => /^--viz-\d+$/.test(k));
    assert.equal(slots.length, VIZ_SLOT_COUNT);
    assert.deepEqual(
      VIZ_SLOTS.map((v) => vars[v.slice(4, -1)]),
      hexes,
    );
    assert.equal(vars["--viz-other"], other);
    for (const role of ["--viz-accent", "--viz-accent-2", "--viz-grid", "--viz-axis", "--viz-surface", "--viz-pos", "--viz-neg"]) {
      assert.ok(vars[role], `${theme} is missing ${role}`);
    }
  });
}

test("the light block also answers to the explicit light theme", () => {
  assert.match(css, /:root,\s*\[data-theme="light"\],\s*\.zunia-light\s*\{/);
  assert.match(css, /\[data-theme="dark"\],\s*\.zunia-dark\s*\{/);
  assert.ok(
    css.indexOf('[data-theme="dark"],') > css.indexOf(":root,"),
    "dark must follow the :root defaults to win on <html data-theme=dark>",
  );
});
