/**
 * Chain pages ask to be indexed only for curated mainnets that exist in the
 * catalog: a catalog change that drops one must fail here, not advertise a
 * 404 page to search engines.
 */

import assert from "node:assert/strict";
import { test } from "node:test";

import { findChain } from "@/lib/chains";
import { INDEXED_CHAINS, chainIndexable, chainMetadata } from "../seo";

test("every indexed chain is a catalog mainnet", () => {
  for (const chainId of INDEXED_CHAINS) {
    const chain = findChain(chainId);
    assert.ok(chain, `${chainId} is in the catalog`);
    assert.equal(chain?.network, "mainnet", `${chainId} is a mainnet`);
  }
});

test("curated mainnets index; other mainnets and testnets do not", () => {
  const hub = findChain("cosmoshub-4");
  assert.ok(hub && chainIndexable(hub));
  const meta = chainMetadata(hub);
  assert.deepEqual(meta.robots, { index: true, follow: true, googleBot: { index: true, follow: true } });
  assert.equal(meta.alternates?.canonical, "/chains/cosmoshub-4");
  assert.match(String(meta.title), /Cosmos Hub \(ATOM\)/);

  assert.equal(chainIndexable({ chainId: "chihuahua-1", network: "mainnet" }), false);
  assert.equal(chainIndexable({ chainId: "cosmoshub-4", network: "testnet" }), false);
  const testnet = findChain("90u-4");
  assert.ok(testnet);
  const testMeta = chainMetadata(testnet);
  assert.equal((testMeta.robots as { index: boolean }).index, false);
  assert.match(String(testMeta.title), /testnet/i);
  // "Terp Testnet (90u-4) testnet" said it twice.
  assert.equal((String(testMeta.title).match(/testnet/gi) ?? []).length, 1, String(testMeta.title));
});

test("chain pages share with the picture and the large card, indexed or not", () => {
  // A page's own openGraph replaces the root's whole: without the image
  // restated, a shared chain link was a bare "summary" card.
  for (const chainId of ["cosmoshub-4", "chihuahua-1", "90u-4"]) {
    const chain = findChain(chainId);
    assert.ok(chain, `${chainId} is in the catalog`);
    const meta = chainMetadata(chain);
    const og = meta.openGraph as { images?: unknown[]; siteName?: string; title?: string } | undefined;
    assert.equal(og?.images?.length, 1, `${chainId} og:image`);
    assert.equal(og?.siteName, "Zunia");
    assert.match(String(og?.title), /· Zunia$/);
    assert.equal((meta.twitter as { card?: string } | undefined)?.card, "summary_large_image");
  }
});
