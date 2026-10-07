import assert from "node:assert/strict";
import { test } from "node:test";
import { readBridgePrefill, readReceiveChain, readSendPrefill } from "../prefill";

test("readBridgePrefill takes chain ids or the swap page's row keys", () => {
  assert.deepEqual(readBridgePrefill({ from: "cosmoshub-4", to: "osmosis-1", amount: "12,5", asset: "uatom" }), {
    from: "cosmoshub-4",
    to: "osmosis-1",
    denom: "uatom",
    amount: "12.5",
  });
  assert.deepEqual(readBridgePrefill({ from: "osmosis-1:ibc/27394FB092D2ECCD", to: "cosmoshub-4:uatom" }), {
    from: "osmosis-1",
    to: "cosmoshub-4",
    denom: "ibc/27394FB092D2ECCD",
  });
  assert.deepEqual(readBridgePrefill({ asset: "juno-1:cw20:juno1abc" }), { from: "juno-1", denom: "cw20:juno1abc" });
  assert.deepEqual(readBridgePrefill({ from: ["safrochain-1", "x"], amount: "1e9", to: "<script>" }), { from: "safrochain-1" });
  assert.deepEqual(readBridgePrefill({}), {});
});

test("readSendPrefill keeps only well-formed parts", () => {
  assert.deepEqual(
    readSendPrefill({ asset: "cosmoshub-4:uatom", to: "OSMO1GV86DP8WMNMMATDCKGR5XKEVNPMY4662STL5RM", amount: "1" }),
    { from: "cosmoshub-4", denom: "uatom", recipient: "osmo1gv86dp8wmnmmatdckgr5xkevnpmy4662stl5rm", amount: "1" },
  );
  assert.deepEqual(readSendPrefill({ chain: "osmosis-1", to: "javascript:alert(1)" }), { from: "osmosis-1" });
});

test("readReceiveChain", () => {
  assert.equal(readReceiveChain({ chain: "osmosis-1" }), "osmosis-1");
  assert.equal(readReceiveChain({ chain: "../etc" }), undefined);
  assert.equal(readReceiveChain({}), undefined);
});
