/**
 * Failed reads are described for the page: the routes' own messages are kept,
 * and what the browser or the parser said goes to `detail`, never on screen.
 */
import assert from "node:assert/strict";
import { test } from "node:test";

import { API_ERROR_TEXT, httpErrorText, networkError, parseError, readApiError, shapeError } from "../api-error";

test("a route's own message and code are kept", async () => {
  const error = await readApiError(Response.json({ error: "upstream_failed", message: "The chain's node could not be read" }, { status: 503 }));
  assert.deepEqual(error, { kind: "http", status: 503, code: "upstream_failed", message: "The chain's node could not be read" });
});

test("an HTTP error without a usable message gets a plain sentence", async () => {
  const html = await readApiError(new Response("<html>Bad gateway</html>", { status: 502 }));
  assert.equal(html.message, httpErrorText(502));
  assert.equal(html.code, undefined);
  const long = await readApiError(Response.json({ message: "x".repeat(500) }, { status: 500 }));
  assert.equal(long.message, httpErrorText(500));
  const empty = await readApiError(Response.json({ message: "" }, { status: 429 }));
  assert.equal(empty.message, httpErrorText(429));
});

test("the browser's and the parser's words go to detail, not to the page", () => {
  const network = networkError(new TypeError("Failed to fetch"));
  assert.equal(network.message, API_ERROR_TEXT.network);
  assert.equal(network.detail, "Failed to fetch");
  const parse = parseError(new SyntaxError("Unexpected token < in JSON at position 0"));
  assert.equal(parse.message, API_ERROR_TEXT.parse);
  assert.match(parse.detail ?? "", /Unexpected token/);
  assert.equal(shapeError().message, API_ERROR_TEXT.shape);
  assert.equal(networkError(undefined).detail, undefined);
});

test("messages end without a full stop, so a card can append its own sentence", () => {
  for (const text of [...Object.values(API_ERROR_TEXT), httpErrorText(503)]) {
    assert.doesNotMatch(text, /[.!]$/, text);
    assert.doesNotMatch(text, /fetch|JSON|Request failed/i, text);
  }
});
