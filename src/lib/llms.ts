/**
 * /llms.txt (llmstxt.org): what this app is, for assistants and the crawlers
 * that feed them. Served by src/app/llms.txt/route.ts.
 *
 * Every fact is read from the module the app itself runs on, so a claim
 * cannot drift from the product:
 * - the summary is the landing page's meta description, with its network
 *   count (components/landing/content.ts);
 * - the wallets, and where to get each one, are the connect registry
 *   (lib/connect/wallets.ts, lib/connect/install.ts,
 *   lib/connect/walletconnect.ts);
 * - the pages, and whether each needs a wallet, are the navigation registry
 *   (lib/nav.ts): an entry badged "soon" has not shipped, so it is only
 *   named under "Do not cite";
 * - the chain counts are the catalog the app reads (lib/chains.ts), the
 *   example chain ids the sitemap's (lib/server/indexed-chains.ts), and the
 *   example asset address is built the way the app links one
 *   (components/assets/links.ts);
 * - the swap commission is the compiled rate (config/fees.ts), printed the
 *   way the Swap page prints it (lib/swap/fee.ts), and the venue is
 *   config/interchain.ts;
 * - the host is lib/site.ts.
 *
 * What no import can carry is written once here: the hosts that only
 * redirect to this one (nginx, in zunia-infra), the detail page addresses,
 * and the links to the rest of Zunia. src/lib/__tests__/llms.test.ts checks
 * those against the code that makes them true (the redirects aside, which
 * live in another repository): each detail address has a page, each link on
 * this host opens what it says, and the hardware wallet line still matches
 * the Permissions-Policy that would have to change first.
 *
 * Plain, factual, present tense; no em dash. Pure (no I/O), so `node --test`
 * covers it.
 */

import { assetHref } from "@/components/assets/links";
import { APP_NAME, LINKS, landingDescription, mainnetCount } from "@/components/landing/content";
import { CONNECT_PARAM } from "@/components/landing/connect-param";
import type { ConnectModalView } from "@/components/connect/ConnectModal";
import { SWAP_FEE_BPS } from "@/config/fees";
import { SWAP_VENUE_CHAIN_ID } from "@/config/interchain";
import { CHAINS, findChain } from "@/lib/chains";
import {
  ZUNIA_DOWNLOAD_PAGE,
  ZUNIA_EXTENSION_BUILDS,
  type Availability,
  type ExtensionBuild,
} from "@/lib/connect/install";
import { WALLETCONNECT_ENABLED } from "@/lib/connect/walletconnect";
import { EXTENSION_WALLETS, WALLETS, type ExtensionWallet, type WalletInstall } from "@/lib/connect/wallets";
import { ALL_NAV_ITEMS, type NavItem } from "@/lib/nav";
import { INDEXED_CHAIN_IDS } from "@/lib/server/indexed-chains";
import { SITE_HOST, SITE_URL } from "@/lib/site";
import { feeRateText } from "@/lib/swap/fee";

/**
 * Other names of this app. Each answers a permanent redirect to the same path
 * on this host: zunia-infra deploy/nginx/wallet.zunialab.com.conf (the
 * address before the v2 launch) and dashboard.zunialab.com.conf.
 */
export const REDIRECT_HOSTS = ["wallet.zunialab.com", "dashboard.zunialab.com"] as const;

/**
 * Pages that take an id in their address, as an assistant would write one.
 * Each opens without a wallet (its component passes `access="public"`); the
 * test maps each to its page file under src/app.
 */
export const DETAIL_PAGES = [
  { what: "a chain", path: "/chains/<chain id>" },
  { what: "a validator", path: "/validators/<operator address>?chain=<chain id>" },
  { what: "a proposal", path: "/governance/<chain id>/<proposal id>" },
  { what: "an asset", path: "/assets/<asset key>" },
  { what: "a transaction", path: "/activity/<hash>?chain=<chain id>" },
  { what: "an NFT", path: "/nfts/<chain id>/<contract>/<token id>" },
] as const;

/** The asset page's example: a key is `<chain id>:<denom>`, URL-encoded as the app links it. */
const EXAMPLE_ASSET_KEY = "cosmoshub-4:uatom";

/**
 * Where assistants find the rest of Zunia, beside the landing page's own
 * links. The docs host builds its llms.txt and serves the MCP server
 * (zunia-docs); its page paths carry their trailing slash, which the host
 * otherwise answers with a 301.
 */
export const ZUNIA_LINKS = {
  websiteLlms: `${LINKS.zunialab}/llms.txt`,
  support: `${LINKS.zunialab}/support`,
  docsLlms: `${LINKS.docs}/llms.txt`,
  mcp: `${LINKS.docs}/mcp`,
  mcpSetup: `${LINKS.docs}/docs/get-started/ai/`,
} as const;

/** "a, b and c". */
function joinAnd(words: readonly string[]): string {
  if (words.length < 2) return words.join("");
  return `${words.slice(0, -1).join(", ")} and ${words[words.length - 1]}`;
}

function capitalize(text: string): string {
  return text.charAt(0).toUpperCase() + text.slice(1);
}

/** An absolute address on this host. */
function onSite(path: string): string {
  return path === "/" ? SITE_URL : `${SITE_URL}${path}`;
}

/** The landing page with its Connect wallet modal open on `view`. */
export function connectUrl(view: ConnectModalView): string {
  return `${SITE_URL}/?${CONNECT_PARAM}=${view}`;
}

function walletName(wallet: ExtensionWallet): string {
  return wallet === "zunia" ? "the Zunia extension" : WALLETS[wallet].label;
}

/** The browser wallets, from the registry: the ones offered, then the ones only still connected. */
export function walletsSentence(): string {
  const offered = EXTENSION_WALLETS.filter((wallet) => WALLETS[wallet].install !== null);
  const retired = EXTENSION_WALLETS.filter((wallet) => WALLETS[wallet].install === null);
  let sentence = `It connects ${joinAnd(offered.map(walletName))} in the browser`;
  if (retired.length > 0) {
    const names = joinAnd(retired.map(walletName));
    const one = retired.length === 1;
    sentence += `, and ${names} where ${one ? "it is" : "they are"} still installed (${names} ${one ? "is" : "are"} no longer offered for download)`;
  }
  return `${sentence}. Zunia Mobile connects by QR code: scan it with the Zunia app, then approve and sign each transaction on the phone.`;
}

/**
 * What a swap costs, as the swap code charges it (config/fees.ts): a rate
 * `swapFeeFor` (lib/swap/fee.ts) would not charge is no commission here either.
 */
export function swapCommissionText(bps: number = SWAP_FEE_BPS): string {
  if (!Number.isSafeInteger(bps) || bps <= 0 || bps >= 10_000) return "Swaps pay no Zunia commission.";
  return [
    `A swap made on the Swap page also pays a Zunia commission of ${feeRateText(bps)} of the amount sold.`,
    "The commission is taken in the token sold, in the same transaction as the swap, and goes to the Zunia treasury address on the chain that signs the swap; the Swap page and its confirm screen show it before signing.",
    "A swap signed on a chain without a treasury address pays none.",
    "Sends, IBC transfers, staking and votes pay no Zunia commission.",
  ].join(" ");
}

const BUILD_NAME: Readonly<Record<ExtensionBuild, string>> = { chromium: "Chromium", safari: "Safari", firefox: "Firefox" };

const STANDING: Readonly<Record<Availability, string>> = {
  available: "available",
  review: "in store review",
  development: "in development",
  planned: "planned",
};

/** Where each Zunia extension build stands, except the one `listing` already links. */
function otherBuilds(listing: string): string {
  const parts = (Object.keys(ZUNIA_EXTENSION_BUILDS) as ExtensionBuild[])
    .filter((build) => ZUNIA_EXTENSION_BUILDS[build].listing !== listing)
    .map((build) => {
      const { availability, listing: own } = ZUNIA_EXTENSION_BUILDS[build];
      return availability === "available" && own
        ? `the ${BUILD_NAME[build]} build is at ${own}`
        : `the ${BUILD_NAME[build]} build is ${STANDING[availability]}`;
    });
  return parts.length > 0 ? `. ${capitalize(joinAnd(parts))}` : "";
}

function whereToGet(wallet: ExtensionWallet, install: WalletInstall): string {
  const where =
    install.browsers === "chromium-desktop"
      ? "Chrome Web Store, for Chromium browsers on a computer"
      : `${WALLETS[wallet].label}'s own download page, which picks the build for the browser or phone`;
  return wallet === "zunia" ? `${where}${otherBuilds(install.url)}` : where;
}

/** One link per wallet that can still be installed, from the registry. */
function walletLinks(): string[] {
  return EXTENSION_WALLETS.flatMap((wallet) => {
    const install = WALLETS[wallet].install;
    if (!install) return [];
    const name = wallet === "zunia" ? "Zunia extension" : WALLETS[wallet].label;
    return [`- [${name}](${install.url}): ${whereToGet(wallet, install)}`];
  });
}

function pageLine(item: Pick<NavItem, "label" | "href" | "description">): string {
  return `- [${item.label}](${onSite(item.href)}): ${item.description}`;
}

/** The pages "Do not cite" names: badged "soon" in the navigation, so not shipped. */
function unshippedLine(soon: readonly NavItem[]): string | null {
  if (soon.length === 0) return null;
  const names = joinAnd(soon.map((item) => item.label));
  if (soon.length === 1) return `- ${names}. Its page says coming soon; it has not shipped.`;
  return `- ${names}. Their pages say coming soon; ${soon.length === 2 ? "neither" : "none"} has shipped.`;
}

/** The text served at /llms.txt. */
export function llmsTxt(): string {
  const mainnets = mainnetCount();
  const testnets = CHAINS.filter((chain) => chain.network === "testnet").length;
  const venue = findChain(SWAP_VENUE_CHAIN_ID)?.chainName ?? SWAP_VENUE_CHAIN_ID;
  const shipped = ALL_NAV_ITEMS.filter((item) => item.badge !== "soon");
  const soon = ALL_NAV_ITEMS.filter((item) => item.badge === "soon");
  const publicPages = shipped.filter((item) => item.access === "public");
  const walletPages = shipped.filter((item) => item.access === "wallet");
  const detail = DETAIL_PAGES.map(({ what, path }) => `${what} at ${path}`);
  const redirects = joinAnd(REDIRECT_HOSTS);

  const doNotCite = [
    `- A Zunia web app at any address other than ${SITE_HOST}. ${redirects} only redirect here.`,
    "- Anyone who asks for a recovery phrase or a private key. This app never does.",
    WALLETCONNECT_ENABLED ? null : "- WalletConnect. This app does not offer it.",
    "- Hardware wallets. This app does not support them yet.",
    unshippedLine(soon),
    "- A Zunia commission on sends, IBC transfers, staking or votes. Only swaps pay one.",
  ].filter((line): line is string => line !== null);

  return `# ${APP_NAME}

> ${landingDescription(mainnets)}

${APP_NAME} is the web app of Zunia, a self-custody wallet for the Cosmos ecosystem, published by Zunia Lab at ${SITE_URL}. It holds no key and never asks for a recovery phrase. It reads public chain data for the addresses a connected wallet shares, and every transaction it prepares is approved and signed in that wallet.

${walletsSentence()}

Reading is free. Each transaction pays its network fee, shown before signing. ${swapCommissionText()} Every swap executes on ${venue}.

The chain catalog the app reads lists ${mainnets} Cosmos mainnets and ${testnets} testnets. Pages that need a connected wallet show a Connect wallet panel until one is connected. Detail pages open without a wallet: ${joinAnd(detail)}. A chain id is the catalog's, such as ${joinAnd(INDEXED_CHAIN_IDS.slice(0, 3))}. An asset key is <chain id>:<denom>, URL-encoded, as in ${assetHref(EXAMPLE_ASSET_KEY)}.

${SITE_HOST} is the only address of this app. ${redirects} answer with a permanent redirect to the same path here.

## Pages that open without a wallet

- [Home](${SITE_URL}): What the app does, its FAQ, and the ways to connect
${publicPages.map(pageLine).join("\n")}

## Pages that need a connected wallet

${walletPages.map(pageLine).join("\n")}

## Connect

- [Connect a wallet](${connectUrl("wallets")}): Opens the wallet list on arrival
- [Connect Zunia Mobile](${connectUrl("mobile")}): Opens the QR code for the Zunia app on arrival
${walletLinks().join("\n")}
- [Zunia downloads](${ZUNIA_DOWNLOAD_PAGE}): Every Zunia build and app, and where each stands

## Zunia

- [Website](${LINKS.zunialab}): Zunia, its downloads and support
- [Website llms.txt](${ZUNIA_LINKS.websiteLlms}): Facts about Zunia as a whole
- [Documentation](${LINKS.docs}): Guides, chain list, and integration reference
- [Docs llms.txt](${ZUNIA_LINKS.docsLlms}): Every docs page, each also as Markdown
- [Zunia MCP server](${ZUNIA_LINKS.mcpSetup}): ${ZUNIA_LINKS.mcp}, Streamable HTTP, no key. Read-only: searches the docs and returns integration guides, package versions and chain data to a coding assistant
- [Updates](${LINKS.updates}): Changelog, versions, and bug and feature reports
- [Source](${LINKS.source}): This app's code, Apache 2.0
- [Support](${ZUNIA_LINKS.support}): Guides and the contact addresses
- [Privacy](${LINKS.privacy})
- [Terms](${LINKS.terms})

## Do not cite

${doNotCite.join("\n")}
`;
}
