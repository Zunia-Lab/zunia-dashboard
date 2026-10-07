/**
 * Every claim and link the public landing page makes, in one place.
 *
 * The landing page is the one surface a search engine and a first-time
 * visitor read before anything else, so each sentence here has to stay true:
 * counts are computed from the catalog the dashboard actually reads, the fee
 * rate comes from the compiled swap config, and links point at hosts that
 * exist. Wound-down or departed chains (Neutron, Noble, Stride; design spec
 * §0) are never featured, although users may still follow them.
 *
 * Pure: no React, no I/O, so `node --test` covers it.
 */

import { CHAINS, findChain, type ChainEntry } from "@/lib/chains";
import { SITE_URL } from "@/lib/site";
import { SITE_NAME } from "./seo";

/**
 * The public origin (app.zunialab.com). Defined once in `@/lib/site`, with the
 * layout, robots and sitemap; re-exported so this module's imports keep working.
 */
export { SITE_URL };

/** Where the page sends people. Every host here resolves today. */
export const LINKS = {
  zunialab: "https://zunialab.com",
  docs: "https://docs.zunialab.com",
  updates: "https://updates.zunialab.com",
  mapZone: "https://ibcmap.zunialab.com",
  x: "https://x.com/ZuniaLab",
  github: "https://github.com/Zunia-Lab",
  /** The repository this dashboard is built from (public, like the extension). */
  source: "https://github.com/Zunia-Lab/zunia-dashboard",
  security: "mailto:security@zunialab.com",
  securityEmail: "security@zunialab.com",
  privacy: "https://zunialab.com/legal/privacy",
  terms: "https://zunialab.com/legal/terms",
} as const;

/**
 * The top navigation: public pages first, then the docs (external). No
 * "Zunia Mobile" entry: it is a way to connect, not a page (product
 * decision, 2026-10-07), reached from the Connect wallet button beside these
 * links and from the page's "Connect your way" section.
 */
export const NAV_LINKS: ReadonlyArray<{ label: string; href: string; external?: boolean }> = [
  { label: "Markets", href: "/markets" },
  { label: "Chains", href: "/chains" },
  { label: "Governance", href: "/governance" },
  { label: "Docs", href: LINKS.docs, external: true },
];

/** Chains that wound down or left Cosmos: never featured in marketing copy. */
const NOT_FEATURED: ReadonlySet<string> = new Set(["neutron-1", "noble-1", "stride-1"]);

/** Mainnets in the catalog the dashboard reads (the "N networks" of the hero). */
export function mainnetCount(chains: ReadonlyArray<Pick<ChainEntry, "network">> = CHAINS): number {
  return chains.filter((chain) => chain.network === "mainnet").length;
}

/** What a marquee chip needs; plain data so it crosses the server/client line. */
export interface FeaturedChain {
  chainId: string;
  chainName: string;
  coinDenom: string;
  iconUrl: string;
}

/**
 * The interchain marquee: the home chain and the hub/venue first, then
 * established, IBC-connected mainnets whose registry logos load. Two rows so
 * the strip reads as a crowd, not a list.
 */
export const MARQUEE_ROWS: ReadonlyArray<readonly string[]> = [
  [
    "safrochain-1",
    "cosmoshub-4",
    "osmosis-1",
    "celestia",
    "akashnet-2",
    "injective-1",
    "dydx-mainnet-1",
    "juno-1",
    "kava_2222-10",
    "archway-1",
    "axelar-dojo-1",
    "pacific-1",
    "secret-4",
    "kaiyo-1",
    "dymension_1100-1",
    "bbn-1",
    "atomone-1",
    "crypto-org-chain-mainnet-1",
    "agoric-3",
    "sentinelhub-2",
  ],
  [
    "regen-1",
    "jackal-1",
    "mantra-1",
    "lava-mainnet-1",
    "core-1",
    "migaloo-1",
    "chihuahua-1",
    "cheqd-mainnet-1",
    "irishub-1",
    "sommelier-3",
    "bitsong-2b",
    "comdex-1",
    "gravity-bridge-3",
    "kyve-1",
    "pirin-1",
    "shentu-2.2",
    "teritori-1",
    "ssc-1",
    "elys-1",
    "nillion-1",
    "phoenix-1",
    "pio-mainnet-1",
  ],
];

/**
 * Catalog entries for `ids`, in order: mainnets with a logo only, each once,
 * never a wound-down chain. An id the catalog lost is skipped rather than
 * shown as a broken chip.
 */
export function featuredChains(
  ids: readonly string[],
  find: (chainId: string) => ChainEntry | undefined = findChain,
): FeaturedChain[] {
  const seen = new Set<string>();
  const out: FeaturedChain[] = [];
  for (const id of ids) {
    if (seen.has(id) || NOT_FEATURED.has(id)) continue;
    const entry = find(id);
    if (!entry || entry.network !== "mainnet" || !entry.iconUrl) continue;
    seen.add(id);
    out.push({ chainId: entry.chainId, chainName: entry.chainName, coinDenom: entry.coinDenom, iconUrl: entry.iconUrl });
  }
  return out;
}

export interface FaqEntry {
  q: string;
  a: string;
}

/**
 * The five questions a first visit asks: custody, cost, numbers, phone,
 * wallets. `feeRate` is the compiled swap commission ("0.5%"), passed in so
 * the answer can never disagree with what a swap charges.
 */
export function landingFaq({ feeRate }: { feeRate: string }): FaqEntry[] {
  return [
    {
      q: "Does Zunia hold my funds or my keys?",
      a:
        "No. The dashboard is non-custodial: it reads public chain data for the addresses your wallet shares, and every transaction goes to your wallet — the Zunia extension, Keplr or Zunia Mobile — to be approved and signed there. It never sees a private key and never asks for a recovery phrase.",
    },
    {
      q: "What does it cost?",
      a: `Reading your portfolio, markets, chains and governance is free. Each transaction pays its network fee, shown before you sign. Swaps carry a Zunia fee of ${feeRate} of the amount sold, taken in the token you sell and shown as its own line in the quote. Sends, IBC transfers, staking and votes carry no Zunia fee.`,
    },
    {
      q: "Where do the numbers come from?",
      a:
        "Balances, staking, governance and validators are read from each chain's public nodes. Prices come from Numia's Osmosis market data, and SAF from the Coinstore SAF/USDT market. Every figure can show its source and age, estimates are labelled, and an asset without a price is shown in tokens, never as $0.",
    },
    {
      q: "Can I use my phone?",
      a:
        "Yes, in beta. Connect Zunia Mobile by scanning a QR code: the phone shows and signs every transaction, over an end-to-end encrypted relay. The iOS and Android apps are in review on the App Store and Google Play.",
    },
    {
      q: "Which wallets work?",
      a:
        "The Zunia browser extension for Chrome, Keplr, and Zunia Mobile, connected by scanning a QR code. Hardware wallets are not supported on the dashboard yet. Moving from a wallet that shut down? Import its recovery phrase into the Zunia extension or app — never into a web page.",
    },
  ];
}

/** The product sentence search results and link previews show. */
export function landingDescription(mainnets: number): string {
  return `Balances, staking, governance, swaps and IBC across ${mainnets} Cosmos networks, analysed and compared in one non-custodial dashboard. Your keys stay in your wallet.`;
}

/**
 * Other names the site goes by: the product lock-up, and "Zunia Wallet", the
 * installed app's name until the v2 launch (the manifest now says "Zunia").
 */
const SITE_ALTERNATE_NAMES = ["Zunia Dashboard", "Zunia Wallet"] as const;

/**
 * Structured data for the landing page: who publishes it (the same
 * Organization node zunialab.com declares, so the two merge), the site, and
 * the app itself (free, a finance web app).
 *
 * Google picks a site's name from the home page's WebSite node first, so it
 * carries the public name (SITE_NAME, as the share cards say); "Zunia
 * Dashboard" there put a third name in search results. The app keeps its
 * product name.
 */
export function landingJsonLd({ mainnets }: { mainnets: number }): Record<string, unknown> {
  const organizationId = `${LINKS.zunialab}/#organization`;
  const description = landingDescription(mainnets);
  return {
    "@context": "https://schema.org",
    "@graph": [
      {
        "@type": "Organization",
        "@id": organizationId,
        name: "Zunia Lab",
        url: LINKS.zunialab,
        logo: { "@type": "ImageObject", url: `${SITE_URL}/apple-icon`, width: 180, height: 180 },
        sameAs: [LINKS.x, LINKS.github],
        contactPoint: [{ "@type": "ContactPoint", contactType: "security", email: LINKS.securityEmail }],
      },
      {
        "@type": "WebSite",
        "@id": `${SITE_URL}/#website`,
        name: SITE_NAME,
        alternateName: [...SITE_ALTERNATE_NAMES],
        url: SITE_URL,
        description,
        inLanguage: "en",
        publisher: { "@id": organizationId },
      },
      {
        "@type": "WebApplication",
        "@id": `${SITE_URL}/#app`,
        name: "Zunia Dashboard",
        url: SITE_URL,
        description,
        applicationCategory: "FinanceApplication",
        operatingSystem: "Any",
        browserRequirements: "Requires a modern web browser with JavaScript",
        isAccessibleForFree: true,
        offers: { "@type": "Offer", price: "0", priceCurrency: "USD" },
        featureList: [
          `Portfolio across ${mainnets} Cosmos networks`,
          "Staking APR adjusted for observed block times",
          "Governance proposals across chains",
          "Swaps on Osmosis pools",
          "IBC transfers with packet tracking",
        ],
        publisher: { "@id": organizationId },
      },
    ],
  };
}

/**
 * JSON for a `<script type="application/ld+json">`: `<` is escaped so no
 * string in the payload can close the script element (Next's JSON-LD guide).
 */
export function jsonLdText(data: unknown): string {
  return JSON.stringify(data).replace(/</g, "\\u003c");
}
