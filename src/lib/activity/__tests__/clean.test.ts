/**
 * Untrusted text: invisible and bidi characters removed, whitespace tamed,
 * length bounded, and the rows that carry such text read clean.
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { cleanText, stripInvisible } from "../clean";
import { decodeActivity, parseTxDetail } from "../decode";
import { sanitizeJson } from "../sanitize";
import { ACCOUNTS, fixture, testContext } from "./helpers";

const RLO = String.fromCharCode(0x202e);
const ZWSP = String.fromCharCode(0x200b);
const BOM = String.fromCharCode(0xfeff);
const BELL = String.fromCharCode(7);

describe("cleanText", () => {
  it("drops bidi overrides, zero-width and control characters", () => {
    assert.equal(cleanText(`invoice${RLO}gnp.exe`, 100), "invoicegnp.exe");
    assert.equal(cleanText(`osmo1${ZWSP}abc${BOM}${BELL}`, 100), "osmo1abc");
    assert.equal(stripInvisible(`a${RLO}b\nc`), "ab\nc");
  });

  it("collapses whitespace, keeping line breaks only when asked", () => {
    assert.equal(cleanText("  a \n\n\n b\t c  ", 100), "a b c");
    assert.equal(cleanText("a \r\n\r\n\r\n b", 100, { keepNewlines: true }), "a \n\n b");
  });

  it("bounds the length without splitting an emoji", () => {
    assert.equal(cleanText("abcdefghij", 5), "abcd…");
    const emoji = String.fromCodePoint(0x1f600);
    assert.equal(cleanText(`abc${emoji}def`, 5), "abc…");
  });
});

describe("rows and details carry clean text", () => {
  it("cleans a memo in the row and in the detail, and strings in the raw JSON", () => {
    const body = fixture("safro-receive.json") as { tx: { body: Record<string, unknown> } };
    const memo = `pay ${RLO}me\n\nnow${ZWSP}`;
    const raw = { ...body, tx: { ...body.tx, body: { ...body.tx.body, memo } } };
    const item = decodeActivity(raw, ACCOUNTS.vinjan, testContext("safrochain-1"));
    assert.equal(item?.memo, "pay me now");
    const detail = parseTxDetail(raw, testContext("safrochain-1"));
    assert.equal(detail?.memo, "pay me\n\nnow");
    assert.deepEqual(sanitizeJson({ [`k${RLO}`]: `v${ZWSP}` }), { k: "v" });
  });
});
