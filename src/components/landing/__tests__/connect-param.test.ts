/**
 * `?connect=` on the landing page (src/components/landing/connect-param.ts):
 * which view of the Connect wallet modal a link asks for, and the address
 * left once the one-shot parameter is spent.
 */

import assert from "node:assert/strict";
import { describe, test } from "node:test";

import { readConnectRequest } from "../connect-param";

const at = (search: string, hash = "") => ({ pathname: "/", search, hash });

describe("readConnectRequest", () => {
  test("no parameter, no request", () => {
    assert.equal(readConnectRequest(at("")), null);
    assert.equal(readConnectRequest(at("?stay=1")), null);
  });

  test("/mobile's redirect asks for Zunia Mobile's QR view", () => {
    assert.deepEqual(readConnectRequest(at("?connect=mobile")), { view: "mobile", cleanUrl: "/" });
  });

  test("the wallet list, whatever the case or padding", () => {
    assert.deepEqual(readConnectRequest(at("?connect=wallets")), { view: "wallets", cleanUrl: "/" });
    assert.equal(readConnectRequest(at("?connect=%20Mobile%20"))?.view, "mobile");
  });

  test("an unknown value opens nothing but is still removed", () => {
    for (const search of ["?connect=", "?connect", "?connect=ledger", "?connect=toString", "?connect=__proto__"]) {
      assert.deepEqual(readConnectRequest(at(search)), { view: null, cleanUrl: "/" }, search);
    }
  });

  test("other parameters and the hash survive", () => {
    assert.equal(readConnectRequest(at("?stay=1&connect=mobile", "#faq"))?.cleanUrl, "/?stay=1#faq");
    assert.equal(readConnectRequest(at("?connect=mobile&utm_source=x&stay=1"))?.cleanUrl, "/?utm_source=x&stay=1");
  });

  test("a repeated parameter is removed whole; the first value decides", () => {
    assert.deepEqual(readConnectRequest(at("?connect=mobile&connect=wallets")), { view: "mobile", cleanUrl: "/" });
  });
});
