/**
 * The landing page's claims (src/components/landing/content.ts): the network
 * count, the featured chains, the FAQ's fee line and the structured data.
 */

import "@/lib/swap/__tests__/json-modules";
import assert from "node:assert/strict";
import { describe, test } from "node:test";

import { CHAINS, findChain, type ChainEntry } from "@/lib/chains";
import { MARQUEE_ROWS, NAV_LINKS, featuredChains, jsonLdText, landingFaq, landingJsonLd, mainnetCount } from "../content";
import { SITE_NAME } from "../seo";

function chain(chainId: string, extra: Partial<ChainEntry> = {}): ChainEntry {
  return {
    chainId,
    chainName: chainId,
    bech32Prefix: "x",
    coinType: 118,
    network: "mainnet",
    coinDenom: "X",
    coinMinimalDenom: "ux",
    coinDecimals: 6,
    feeDenom: "X",
    feeMinimalDenom: "ux",
    feeDecimals: 6,
    iconUrl: `https://example.com/${chainId}.png`,
    ...extra,
  };
}

describe("mainnetCount", () => {
  test("counts mainnets only", () => {
    assert.equal(mainnetCount([chain("a"), chain("b", { network: "testnet" }), chain("c")]), 2);
  });

  test("reads the shipped catalog by default", () => {
    assert.equal(mainnetCount(), CHAINS.filter((entry) => entry.network === "mainnet").length);
    assert.ok(mainnetCount() > 100);
  });
});

describe("featuredChains", () => {
  const table = new Map(
    [
      chain("safrochain-1"),
      chain("cosmoshub-4"),
      chain("osmo-test-5", { network: "testnet" }),
      chain("no-logo", { iconUrl: undefined }),
      chain("neutron-1"),
      chain("noble-1"),
      chain("stride-1"),
    ].map((entry) => [entry.chainId, entry]),
  );
  const find = (id: string) => table.get(id);

  test("keeps the order asked for and drops duplicates", () => {
    const ids = featuredChains(["cosmoshub-4", "safrochain-1", "cosmoshub-4"], find).map((entry) => entry.chainId);
    assert.deepEqual(ids, ["cosmoshub-4", "safrochain-1"]);
  });

  test("skips testnets, chains without a logo and ids the catalog lost", () => {
    assert.deepEqual(featuredChains(["osmo-test-5", "no-logo", "gone-1"], find), []);
  });

  test("never features a wound-down or departed chain", () => {
    assert.deepEqual(featuredChains(["neutron-1", "noble-1", "stride-1"], find), []);
  });

  test("every marquee chain is a catalog mainnet with a logo", () => {
    for (const row of MARQUEE_ROWS) {
      const featured = featuredChains(row, findChain);
      assert.deepEqual(
        featured.map((entry) => entry.chainId),
        [...row],
        `catalog drift: ${row.filter((id) => !featured.some((entry) => entry.chainId === id)).join(", ")}`,
      );
    }
  });
});

describe("landingFaq", () => {
  test("five answers, the fee line quoting the rate it is given", () => {
    const faq = landingFaq({ feeRate: "0.5%" });
    assert.equal(faq.length, 5);
    assert.ok(faq.some((entry) => entry.a.includes("Zunia fee of 0.5% of the amount sold")));
    assert.ok(faq.every((entry) => entry.q.endsWith("?") && entry.a.length > 40));
  });

  test("Zunia Mobile is connected by scanning a QR code, not paired", () => {
    const text = landingFaq({ feeRate: "0.5%" })
      .map((entry) => entry.a)
      .join(" ");
    assert.match(text, /Connect Zunia Mobile by scanning a QR code/);
    assert.doesNotMatch(text, /\bpair/i);
  });
});

describe("navigation", () => {
  test("no link to /mobile: Zunia Mobile is a way to connect, not a page", () => {
    assert.ok(NAV_LINKS.every((link) => link.href !== "/mobile" && link.label !== "Zunia Mobile"));
    assert.deepEqual(
      NAV_LINKS.map((link) => link.label),
      ["Markets", "Chains", "Governance", "Docs"],
    );
  });
});

describe("structured data", () => {
  test("Organization, WebSite and a free FinanceApplication", () => {
    const data = landingJsonLd({ mainnets: 222 }) as { "@graph": Array<Record<string, unknown>> };
    const types = data["@graph"].map((node) => node["@type"]);
    assert.deepEqual(types, ["Organization", "WebSite", "WebApplication"]);
    const app = data["@graph"][2];
    assert.equal(app.applicationCategory, "FinanceApplication");
    assert.deepEqual(app.offers, { "@type": "Offer", price: "0", priceCurrency: "USD" });
    assert.match(String(app.description), /222 Cosmos networks/);
  });

  test("the WebSite carries the public name the share cards use, the others as alternates", () => {
    const data = landingJsonLd({ mainnets: 222 }) as { "@graph": Array<Record<string, unknown>> };
    const site = data["@graph"][1];
    // Google reads the site name from this node first.
    assert.equal(site.name, SITE_NAME);
    assert.equal(SITE_NAME, "Zunia");
    assert.deepEqual(site.alternateName, ["Zunia Dashboard", "Zunia Wallet"]);
    assert.equal(data["@graph"][0].name, "Zunia Lab", "the publisher keeps the company name");
  });

  test("the script text cannot close its own element", () => {
    const text = jsonLdText({ name: "</script><script>alert(1)</script>" });
    assert.ok(!text.includes("<"));
    assert.deepEqual(JSON.parse(text), { name: "</script><script>alert(1)</script>" });
  });
});
