/**
 * Which way a pair swaps (src/lib/swap/path.ts).
 */

import assert from "node:assert/strict";
import { describe, test } from "node:test";

import { isPoolPath, signingChainFor, swapPathFor } from "../path";

const osmosis = { chainId: "osmosis-1" };
const injective = { chainId: "injective-1" };
const safrochain = { chainId: "safrochain-1" };

describe("which way a pair swaps", () => {
  test("swaps funds on Osmosis in its pools, delivering elsewhere in the same transaction", () => {
    assert.equal(swapPathFor(osmosis, osmosis), "pool");
    assert.equal(swapPathFor(osmosis, injective), "pool-deliver");
  });

  test("swaps funds anywhere else in one signature, whatever the pair (SAF on Safrochain to USDC on Osmosis included)", () => {
    assert.equal(swapPathFor(safrochain, osmosis), "contract");
    assert.equal(swapPathFor(injective, osmosis), "contract");
    assert.equal(swapPathFor(injective, { chainId: "cosmoshub-4" }), "contract");
    assert.equal(swapPathFor(safrochain, safrochain), "contract");
  });

  test("names the pool paths and the chain that signs", () => {
    assert.equal(isPoolPath("pool"), true);
    assert.equal(isPoolPath("pool-deliver"), true);
    assert.equal(isPoolPath("contract"), false);
    assert.equal(isPoolPath("move-first"), false);
    assert.equal(isPoolPath(null), false);
    assert.equal(signingChainFor("pool", "osmosis-1"), "osmosis-1");
    assert.equal(signingChainFor("pool-deliver", "osmosis-1"), "osmosis-1");
    assert.equal(signingChainFor("contract", "safrochain-1"), "safrochain-1");
  });
});
