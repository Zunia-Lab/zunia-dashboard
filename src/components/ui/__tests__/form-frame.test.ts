/**
 * FIELD_FRAME's disabled look. A bare `has-[:disabled]` also matches the
 * disabled placeholder <option> every Select renders (and a disabled button
 * inside the frame, like AmountInput's Max), and its `pointer-events: none`
 * then made every such Select dead: Staking's "Choose a network", Move
 * stake's "Choose one of your validators". The variant must name the field's
 * own control.
 */

import assert from "node:assert/strict";
import { test } from "node:test";

import { FIELD_FRAME } from "../Form";

/** The selector inside each `has-[…]:utility` class of the frame. */
function hasSelectors(classes: string): { cls: string; selector: string }[] {
  return classes
    .split(/\s+/)
    .filter((cls) => cls.startsWith("has-["))
    .map((cls) => ({ cls, selector: cls.slice("has-[".length, cls.lastIndexOf("]:")) }));
}

test("the frame still dims and blocks a disabled field", () => {
  const disabled = hasSelectors(FIELD_FRAME).filter(({ selector }) => selector.includes(":disabled"));
  assert.deepEqual(
    disabled.map(({ cls }) => cls.slice(cls.lastIndexOf("]:") + 2)).sort(),
    ["opacity-50", "pointer-events-none"],
  );
});

test("the disabled look keys on input, select or textarea, never any :disabled descendant", () => {
  for (const { cls, selector } of hasSelectors(FIELD_FRAME)) {
    if (!selector.includes(":disabled")) continue;
    assert.match(selector, /^:is\((?:input|select|textarea)(?:,(?:input|select|textarea))*\):disabled$/, cls);
  }
});
