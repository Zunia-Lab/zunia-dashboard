/**
 * The paging cursor: it round-trips, it is bound to its account list, and
 * anything a client could tamper with is refused rather than half-read.
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { accountsKey, decodeCursor, encodeCursor, type ActivityCursor } from "../cursor";

const accounts = [
  { chainId: "osmosis-1", address: "osmo1gv86dp8wmnmmatdckgr5xkevnpmy4662stl5rm" },
  { chainId: "safrochain-1", address: "addr_safro1gv86dp8wmnmmatdckgr5xkevnpmy4662qudn7e" },
];

describe("cursor", () => {
  it("round-trips", () => {
    const cursor: ActivityCursor = {
      key: accountsKey(accounts),
      accounts: [
        { upper: 72036806, oldest: Date.UTC(2026, 9, 6), oldestSigned: true, signedSeen: 12 },
        { upper: null, oldest: null, oldestSigned: false, signedSeen: 0 },
      ],
    };
    const encoded = encodeCursor(cursor);
    assert.match(encoded, /^v1\.[A-Za-z0-9_-]+$/);
    assert.deepEqual(decodeCursor(encoded, 2), cursor);
  });

  it("carries the finished and gap flags per account, and the `before` bound", () => {
    const cursor: ActivityCursor = {
      key: accountsKey(accounts),
      accounts: [
        { upper: 10, oldest: 5, oldestSigned: false, signedSeen: 1, done: true },
        { upper: 7, oldest: null, oldestSigned: false, signedSeen: 0, gapped: true },
      ],
      before: Date.UTC(2026, 6, 1),
    };
    assert.deepEqual(decodeCursor(encodeCursor(cursor), 2), cursor);
    const forge = (value: unknown) => `v1.${btoa(JSON.stringify(value)).replace(/=+$/, "")}`;
    assert.equal(decodeCursor(forge({ k: "0123abcd", a: [[1, null, 0, 0, 4]] }), 1), null, "unknown flag");
    assert.equal(decodeCursor(forge({ k: "0123abcd", a: [[1, null, 0, 0, 1]], b: -5 }), 1), null, "negative before");
    assert.deepEqual(decodeCursor(forge({ k: "0123abcd", a: [[1, null, 0, 0, 3]] }), 1)?.accounts[0], {
      upper: 1,
      oldest: null,
      oldestSigned: false,
      signedSeen: 0,
      done: true,
      gapped: true,
    });
  });

  it("is bound to the account list and its order", () => {
    assert.match(accountsKey(accounts), /^[0-9a-f]{8}$/);
    assert.equal(accountsKey(accounts), accountsKey([...accounts]));
    assert.notEqual(accountsKey(accounts), accountsKey([...accounts].reverse()));
  });

  it("refuses malformed or tampered cursors", () => {
    const good = encodeCursor({ key: accountsKey(accounts), accounts: [{ upper: 5, oldest: null, oldestSigned: false, signedSeen: 0 }] });
    const forge = (value: unknown) => `v1.${btoa(JSON.stringify(value)).replace(/=+$/, "")}`;
    assert.equal(decodeCursor(good, 2), null, "wrong account count");
    assert.equal(decodeCursor("v2.abc", 1), null);
    assert.equal(decodeCursor("v1.%%%", 1), null);
    assert.equal(decodeCursor(`v1.${"A".repeat(5000)}`, 1), null);
    assert.equal(decodeCursor(forge({ k: "zzzzzzzz", a: [[1, null, 0, 0]] }), 1), null, "key not hex");
    assert.equal(decodeCursor(forge({ k: "0123abcd", a: [[-1, null, 0, 0]] }), 1), null, "negative height");
    assert.equal(decodeCursor(forge({ k: "0123abcd", a: [[1.5, null, 0, 0]] }), 1), null, "fractional height");
    assert.equal(decodeCursor(forge({ k: "0123abcd", a: [[1, null, 2, 0]] }), 1), null, "flag not 0/1");
    assert.equal(decodeCursor(forge({ k: "0123abcd", a: [[1, null, 0, null]] }), 1), null, "missing count");
    assert.deepEqual(decodeCursor(forge({ k: "0123abcd", a: [[1, null, 0, 0]] }), 1), {
      key: "0123abcd",
      accounts: [{ upper: 1, oldest: null, oldestSigned: false, signedSeen: 0 }],
    });
  });
});
