/**
 * Which way a pair swaps (src/lib/swap/path.ts), ported from
 * zunia-extension lib/__tests__/pool-swap.test.ts "which way a pair swaps".
 */

import assert from "node:assert/strict";
import { describe, test } from "node:test";

import { isPoolPath, signingChainFor, swapPathFor } from "../path";

const osmosis = { chainId: "osmosis-1" };
const injective = { chainId: "injective-1" };

describe("which way a pair swaps", () => {
  test("swaps funds on Osmosis in its pools, unless the contract can deliver the whole output elsewhere", () => {
    assert.equal(swapPathFor(osmosis, osmosis, "no"), "pool");
    assert.equal(swapPathFor(osmosis, osmosis, "yes"), "pool");
    assert.equal(swapPathFor(osmosis, osmosis, "unknown"), "pool");
    assert.equal(swapPathFor(osmosis, injective, "yes"), "contract");
    assert.equal(swapPathFor(osmosis, injective, "no"), "pool-deliver");
    assert.equal(swapPathFor(osmosis, injective, "unknown"), "pool-deliver");
  });

  test("sends funds elsewhere through the contract, and moves them to Osmosis first when it has no route", () => {
    assert.equal(swapPathFor(injective, osmosis, "yes"), "contract");
    assert.equal(swapPathFor(injective, osmosis, "unknown"), "contract");
    assert.equal(swapPathFor(injective, osmosis, "no"), "move-first");
    assert.equal(swapPathFor(injective, { chainId: "cosmoshub-4" }, "no"), "move-first");
  });

  test("names the pool paths and the chain that signs", () => {
    assert.equal(isPoolPath("pool"), true);
    assert.equal(isPoolPath("pool-deliver"), true);
    assert.equal(isPoolPath("contract"), false);
    assert.equal(isPoolPath("move-first"), false);
    assert.equal(isPoolPath(null), false);
    assert.equal(signingChainFor("pool", "osmosis-1"), "osmosis-1");
    assert.equal(signingChainFor("pool-deliver", "osmosis-1"), "osmosis-1");
    assert.equal(signingChainFor("contract", "cosmoshub-4"), "cosmoshub-4");
    assert.equal(signingChainFor("contract", "osmosis-1"), "osmosis-1");
  });
});
