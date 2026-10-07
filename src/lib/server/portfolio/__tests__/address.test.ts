/**
 * Account addresses per chain: the home chain's `addr_safro` prefix must
 * pass, a neighbour chain's address must not.
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { bech32 } from "bech32";
import { checkChainAddress } from "../address";

const SAFRO = { chainId: "safrochain-1", bech32Prefix: "addr_safro" };
const HUB = { chainId: "cosmoshub-4", bech32Prefix: "cosmos" };
const LAVA = { chainId: "lava-mainnet-1", bech32Prefix: "lava@" };

describe("checkChainAddress", () => {
  it("accepts the treasury on Safrochain, the Hub and Lava's `@` prefix", () => {
    assert.deepEqual(checkChainAddress("addr_safro1gv86dp8wmnmmatdckgr5xkevnpmy4662qudn7e", SAFRO), {
      ok: true,
      address: "addr_safro1gv86dp8wmnmmatdckgr5xkevnpmy4662qudn7e",
    });
    assert.equal(checkChainAddress(" cosmos1gv86dp8wmnmmatdckgr5xkevnpmy4662csvy4f ", HUB).ok, true);
    const words = bech32.decode("cosmos1gv86dp8wmnmmatdckgr5xkevnpmy4662csvy4f").words;
    assert.equal(checkChainAddress(bech32.encode("lava@", words), LAVA).ok, true);
  });

  it("accepts 32-byte contract addresses", () => {
    const contract = bech32.encode("cosmos", bech32.toWords(new Uint8Array(32).fill(7)));
    assert.equal(checkChainAddress(contract, HUB).ok, true);
  });

  it("refuses another chain's prefix, a bad checksum, odd lengths and path tricks", () => {
    assert.deepEqual(checkChainAddress("osmo1gv86dp8wmnmmatdckgr5xkevnpmy4662stl5rm", HUB), {
      ok: false,
      code: "address_prefix",
      message: "address for cosmoshub-4 must start with cosmos1",
    });
    assert.equal(checkChainAddress("cosmos1gv86dp8wmnmmatdckgr5xkevnpmy4662csvy4g", HUB).ok, false);
    const short = bech32.encode("cosmos", bech32.toWords(new Uint8Array(19)));
    assert.deepEqual(checkChainAddress(short, HUB), {
      ok: false,
      code: "address_invalid",
      message: "address has an unexpected length",
    });
    for (const raw of ["", "cosmos1../../balances", "COSMOS1GV86DP8WMNMMATDCKGR5XKEVNPMY4662CSVY4F", "cosmos1abc?x=1"]) {
      assert.equal(checkChainAddress(raw, HUB).ok, false, raw);
    }
  });
});
