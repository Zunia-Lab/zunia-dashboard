/**
 * `useApi` with a server-read answer: the server render carries it (a public
 * page's first HTML has its data), only for the exact URL it was read for,
 * and the module store shared by every request is never written on the server.
 */
import assert from "node:assert/strict";
import { test } from "node:test";
import { createElement } from "react";
import { renderToString } from "react-dom/server";

import { useApi, type ApiInitial } from "../useApi";

function Probe({ url, initial }: { url: string | null; initial?: ApiInitial | null }) {
  const state = useApi<{ v: number }>(url, { initial });
  return createElement("p", null, `${state.status}|${state.data?.v ?? "none"}|${state.loading}|${state.updatedAt ?? "-"}`);
}

const render = (url: string | null, initial?: ApiInitial | null) => renderToString(createElement(Probe, { url, initial }));

test("the server render shows the server-read answer for its URL", () => {
  assert.match(render("/api/markets?currency=usd", { url: "/api/markets?currency=usd", data: { v: 7 }, at: 1_234 }), /ready\|7\|false\|1234/);
});

test("another URL (currency, scope, wallet) ignores it and renders as before", () => {
  assert.match(render("/api/markets?currency=eur", { url: "/api/markets?currency=usd", data: { v: 7 }, at: 1_234 }), /loading\|none\|true\|-/);
  assert.match(render("/api/markets?currency=usd"), /loading\|none\|true\|-/);
  assert.match(render(null, { url: "/api/markets?currency=usd", data: { v: 7 }, at: 1_234 }), /idle\|none\|false\|-/);
});

test("a server render leaves no trace for the next request", () => {
  render("/api/x", { url: "/api/x", data: { v: 1 }, at: 1 });
  assert.match(render("/api/x"), /loading\|none\|true\|-/, "the seed did not leak into the module store");
});
