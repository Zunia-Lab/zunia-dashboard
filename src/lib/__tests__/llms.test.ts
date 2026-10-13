/**
 * /llms.txt (src/lib/llms.ts, served by src/app/llms.txt/route.ts): the file
 * assistants read about this app.
 *
 * Most of it is computed from the registries the app runs on; these tests
 * check that it still is, and pin the few sentences no import can carry to
 * the code that makes them true. A product change that would leave the file
 * wrong fails here instead.
 */

import "@/lib/swap/__tests__/json-modules";
import assert from "node:assert/strict";
import { readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, test } from "node:test";

import nextConfig from "../../../next.config";
import { GET } from "../../app/llms.txt/route";
import robots from "../../app/robots";
import { readConnectRequest } from "@/components/landing/connect-param";
import { APP_NAME, landingDescription, mainnetCount } from "@/components/landing/content";
import { SWAP_FEE_BPS } from "@/config/fees";
import { CHAINS } from "@/lib/chains";
import { ZUNIA_EXTENSION_BUILDS, type ExtensionBuild } from "@/lib/connect/install";
import { WALLETCONNECT_ENABLED } from "@/lib/connect/walletconnect";
import { EXTENSION_WALLETS, WALLETS } from "@/lib/connect/wallets";
import { DETAIL_PAGES, REDIRECT_HOSTS, ZUNIA_LINKS, connectUrl, llmsTxt, swapCommissionText } from "@/lib/llms";
import { ALL_NAV_ITEMS } from "@/lib/nav";
import { SITE_HOST, SITE_URL } from "@/lib/site";
import { feeRateText } from "@/lib/swap/fee";

const TEXT = llmsTxt();
const LINES = TEXT.split("\n");

const HEADINGS = [
  "Pages that open without a wallet",
  "Pages that need a connected wallet",
  "Connect",
  "Zunia",
  "Do not cite",
];

/** The lines under `## heading`, up to the next heading, blank lines dropped. */
function section(heading: string): string[] {
  const start = LINES.indexOf(`## ${heading}`);
  assert.ok(start >= 0, `## ${heading}`);
  const rest = LINES.slice(start + 1);
  const end = rest.findIndex((line) => line.startsWith("## "));
  return (end === -1 ? rest : rest.slice(0, end)).filter((line) => line.trim() !== "");
}

/** Every page route under src/app, as segments, with route groups dropped. */
function pageRoutes(dir = join(import.meta.dirname, "../../app"), segments: string[] = []): string[][] {
  const routes: string[][] = [];
  for (const name of readdirSync(dir)) {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) {
      routes.push(...pageRoutes(path, /^\(.+\)$/.test(name) ? segments : [...segments, name]));
    } else if (name === "page.tsx") {
      routes.push(segments);
    }
  }
  return routes;
}

describe("llms.txt format (llmstxt.org)", () => {
  test("one title, the landing page's own summary, then the sections in order", () => {
    assert.equal(LINES[0], `# ${APP_NAME}`);
    assert.equal(LINES[2], `> ${landingDescription(mainnetCount())}`);
    assert.equal(LINES.filter((line) => line.startsWith("# ")).length, 1);
    assert.deepEqual(
      LINES.filter((line) => line.startsWith("## ")),
      HEADINGS.map((heading) => `## ${heading}`),
    );
    assert.ok(TEXT.endsWith("\n"));
  });

  test("every section but the last is a list of links", () => {
    for (const heading of HEADINGS.slice(0, -1)) {
      for (const line of section(heading)) {
        assert.match(line, /^- \[[^\]]+\]\(https:\/\/[^\s)]+\)(: \S.*)?$/, line);
      }
    }
    for (const line of section("Do not cite")) assert.match(line, /^- \S/, line);
  });

  test("plain text: no em dash, no unfilled value", () => {
    assert.ok(!TEXT.includes("—"), "no em dash");
    assert.ok(!/undefined|null|NaN|\[object /.test(TEXT));
  });
});

describe("llms.txt facts", () => {
  test("every shipped page, from the navigation, under whether it needs a wallet", () => {
    const open = section("Pages that open without a wallet");
    const gated = section("Pages that need a connected wallet");
    for (const item of ALL_NAV_ITEMS) {
      const line = `- [${item.label}](${SITE_URL}${item.href}): ${item.description}`;
      if (item.badge === "soon") {
        assert.ok(!TEXT.includes(`](${SITE_URL}${item.href})`), `${item.href} has not shipped`);
        continue;
      }
      assert.ok((item.access === "public" ? open : gated).includes(line), line);
    }
  });

  test("pages badged soon are named only as not shipped", () => {
    const soon = ALL_NAV_ITEMS.filter((item) => item.badge === "soon");
    const doNotCite = section("Do not cite").join("\n");
    for (const item of soon) assert.ok(doNotCite.includes(item.label), item.label);
    if (soon.length > 0) assert.match(doNotCite, /coming soon/);
  });

  test("the wallets are the connect registry's", () => {
    const connect = section("Connect");
    for (const wallet of EXTENSION_WALLETS) {
      const { label, install } = WALLETS[wallet];
      assert.ok(TEXT.includes(label), label);
      if (install) {
        assert.ok(connect.some((line) => line.includes(`](${install.url})`)), `${label} links to its install`);
      } else {
        assert.ok(TEXT.includes(`${label} is no longer offered for download`), label);
        assert.ok(!connect.some((line) => line.startsWith(`- [${label}]`)), `${label} has nothing to install`);
      }
    }
    assert.match(TEXT, /Zunia Mobile connects by QR code/);
    assert.equal(TEXT.includes("- WalletConnect. This app does not offer it."), !WALLETCONNECT_ENABLED);
  });

  test("each Zunia extension build is said to stand where install.ts puts it", () => {
    const name: Record<ExtensionBuild, string> = { chromium: "Chromium", safari: "Safari", firefox: "Firefox" };
    const standing = { review: "in store review", development: "in development", planned: "planned" } as const;
    for (const build of Object.keys(ZUNIA_EXTENSION_BUILDS) as ExtensionBuild[]) {
      const { availability, listing } = ZUNIA_EXTENSION_BUILDS[build];
      if (availability === "available") {
        assert.ok(listing && TEXT.includes(listing), `${build}: its listing`);
      } else {
        assert.ok(TEXT.includes(`${name[build]} build is ${standing[availability]}`), build);
      }
    }
  });

  test("the swap commission is the compiled rate, printed as the Swap page prints it", () => {
    assert.ok(TEXT.includes(`commission of ${feeRateText(SWAP_FEE_BPS)} of the amount sold`));
    assert.match(swapCommissionText(25), /commission of 0\.25% of the amount sold/);
    assert.equal(swapCommissionText(0), "Swaps pay no Zunia commission.");
  });

  test("the chain counts are the catalog's", () => {
    const mainnets = CHAINS.filter((chain) => chain.network === "mainnet").length;
    const testnets = CHAINS.filter((chain) => chain.network === "testnet").length;
    assert.equal(mainnets + testnets, CHAINS.length);
    assert.ok(TEXT.includes(`lists ${mainnets} Cosmos mainnets and ${testnets} testnets`));
  });

  test("every detail address it gives has a page", () => {
    const routes = pageRoutes();
    for (const { path } of DETAIL_PAGES) {
      const wanted = path.split("?")[0].split("/").filter(Boolean);
      const found = routes.some(
        (route) =>
          route.length === wanted.length &&
          route.every((segment, index) =>
            /^\[.+\]$/.test(segment) ? /^<.+>$/.test(wanted[index]) : segment === wanted[index],
          ),
      );
      assert.ok(found, path);
      assert.ok(TEXT.includes(path), path);
    }
  });

  test("the links on this host open what they say", () => {
    assert.equal(readConnectRequest(new URL(connectUrl("wallets")))?.view, "wallets");
    assert.equal(readConnectRequest(new URL(connectUrl("mobile")))?.view, "mobile");
    const pages = new Set(["/", ...ALL_NAV_ITEMS.map((item) => item.href)]);
    for (const [, url] of TEXT.matchAll(/\]\((https:\/\/[^)\s]+)\)/g)) {
      const parsed = new URL(url);
      if (parsed.origin !== new URL(SITE_URL).origin) continue;
      assert.ok(pages.has(parsed.pathname), url);
    }
  });

  test("no hardware wallet, as long as the app cannot reach a USB or HID device", async () => {
    // next.config.ts: "when Ledger support lands, `hid` and `usb` become `(self)`".
    // When they do, this line of the file has to change with them.
    const rules = (await nextConfig.headers?.()) ?? [];
    const site = rules.find((rule) => rule.source === "/:path*" && !rule.has);
    const policy = site?.headers.find((header) => header.key === "Permissions-Policy")?.value ?? "";
    assert.match(policy, /\busb=\(\)/);
    assert.match(policy, /\bhid=\(\)/);
    assert.ok(TEXT.includes("- Hardware wallets. This app does not support them yet."));
  });

  test("one host, and the old names only redirect to it", () => {
    assert.ok(TEXT.includes(`${SITE_HOST} is the only address of this app.`));
    for (const host of REDIRECT_HOSTS) {
      assert.notEqual(host, SITE_HOST);
      assert.ok(TEXT.includes(host), host);
    }
  });

  test("it points assistants at the website, the docs llms.txt and the MCP server", () => {
    const zunia = section("Zunia").join("\n");
    for (const url of [ZUNIA_LINKS.websiteLlms, ZUNIA_LINKS.docsLlms, ZUNIA_LINKS.mcpSetup]) {
      assert.ok(zunia.includes(`](${url})`), url);
    }
    assert.ok(zunia.includes(`${ZUNIA_LINKS.mcp}, Streamable HTTP, no key`));
    // The docs host answers a page path without its trailing slash with a 301.
    assert.ok(ZUNIA_LINKS.mcpSetup.endsWith("/"));
  });
});

describe("GET /llms.txt", () => {
  test("is plain UTF-8 text, cached for an hour like the website's", async () => {
    const response = GET();
    assert.equal(response.status, 200);
    assert.equal(response.headers.get("Content-Type"), "text/plain; charset=utf-8");
    assert.equal(response.headers.get("Cache-Control"), "public, max-age=3600");
    assert.equal(await response.text(), TEXT);
  });

  test("robots.txt leaves it crawlable", () => {
    const r = robots();
    const rules = Array.isArray(r.rules) ? r.rules : [r.rules];
    for (const rule of rules) {
      const disallow = [rule.disallow ?? []].flat();
      for (const path of disallow) assert.ok(!"/llms.txt".startsWith(path), path);
    }
  });
});
