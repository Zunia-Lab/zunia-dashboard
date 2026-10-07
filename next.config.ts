import path from "node:path";
import type { NextConfig } from "next";
import { HTML_LIMITED_BOT_UA_RE } from "next/dist/shared/lib/router/utils/html-bots";

// The @zunialab/* packages are symlinked out of the sibling zunia-ui checkout
// while the npm scope is private, so Turbopack has to trace from the parent
// directory to see them. Drop this once the packages are published.
const workspaceRoot = path.join(process.cwd(), "..");

const isDev = process.env.NODE_ENV === "development";

/**
 * Origins the browser opens for Zunia Connect (QR pairing with the phone):
 * `POST /v1/connect/sessions` over https and the relay socket over wss. The
 * production pair is always allowed; a build pointed at another relay (a local
 * backend in development) adds that one too, so the policy follows the
 * `NEXT_PUBLIC_ZUNIA_CONNECT_API_BASE` the bundle was built with.
 */
function connectOrigins(): string[] {
  const origins = new Set(["https://api.zunialab.com", "wss://api.zunialab.com"]);
  const base = process.env.NEXT_PUBLIC_ZUNIA_CONNECT_API_BASE?.trim();
  if (base) {
    try {
      const url = new URL(base);
      origins.add(url.origin);
      origins.add(`${url.protocol === "https:" ? "wss:" : "ws:"}//${url.host}`);
    } catch {
      // A malformed base breaks pairing on its own; it must not break headers.
    }
  }
  return [...origins];
}

/**
 * Schemes the wallet extensions load from inside our pages: the Zunia
 * extension injects its provider as a `<script src="chrome-extension://…">`
 * and renders its connect prompt in an extension-origin iframe. Chromium does
 * not apply page CSP to those; Firefox and Safari can.
 */
const EXTENSION_SCHEMES = "chrome-extension: moz-extension: safari-web-extension:";

/**
 * The target policy, shipped as Report-Only first (zunia-infra review §4):
 * violations show up in the browser console of whoever runs the test matrix
 * (Chrome/Firefox/Safari × Zunia/Keplr, QR pairing, installed iOS app) without
 * breaking anything for users. It becomes enforced once that matrix is clean.
 *
 * - `script-src 'unsafe-inline'` is a stopgap: Next's inline flight payloads
 *   and the theme boot script carry no nonce while pages are statically
 *   rendered. The strict version is a per-request nonce, minted in a
 *   `proxy.ts` (there is none today) and read by every page it covers.
 *   `'unsafe-eval'` is development-only (React's dev build uses eval).
 * - `img-src https:` because chain and validator logos come from many hosts
 *   (raw.githubusercontent.com, keybase's S3, NFT gateways, token lists);
 *   narrowing it needs a same-origin image proxy first.
 * - No `upgrade-insecure-requests`: browsers ignore it in a report-only policy.
 * - No report endpoint yet, so reports are console-only.
 */
const REPORT_ONLY_CSP = [
  "default-src 'self'",
  `script-src 'self' 'unsafe-inline'${isDev ? " 'unsafe-eval'" : ""} ${EXTENSION_SCHEMES}`,
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' https: data: blob:",
  "font-src 'self'",
  `connect-src 'self' ${connectOrigins().join(" ")}`,
  "worker-src 'self'",
  "manifest-src 'self'",
  "media-src 'self' blob:",
  `frame-src ${EXTENSION_SCHEMES}`,
  "object-src 'none'",
  "base-uri 'none'",
  "form-action 'self'",
  "frame-ancestors 'none'",
].join("; ");

/**
 * Enforced today. None of these can break a page: the dashboard is never
 * framed, embeds no plugins and sets no `<base>`. `frame-ancestors` is what
 * stops another site from framing a signing screen under a decoy (clickjacking
 * a send, swap or connect); X-Frame-Options says the same to older browsers.
 */
const ENFORCED_CSP = "frame-ancestors 'none'; object-src 'none'; base-uri 'self'";

/**
 * `camera=(self)` is the QR scanner in the recipient field. Everything else a
 * wallet page could be talked into requesting is off; when Ledger support
 * lands, `hid` and `usb` become `(self)`.
 */
const PERMISSIONS_POLICY =
  "camera=(self), microphone=(), geolocation=(), payment=(), usb=(), hid=(), serial=(), bluetooth=(), browsing-topics=()";

/**
 * Query parameters that carry a wallet address into an API route: `address`
 * (account, NFT holdings, balances, a tx seen from one account), `accounts`
 * (`chainId:address` lists for portfolio, history, activity, staking,
 * security) and `voter` (governance with your vote).
 *
 * There is no blanket `Cache-Control` on `/api/:path*`, on purpose: headers
 * from this file are written onto the response before the route handler runs,
 * and Next only copies a handler's header when the response does not already
 * have it (next/dist/server/send-response.js). A blanket `no-store` would
 * therefore silently replace every `publicJson` cache policy (market and chain
 * data that Cloudflare is meant to cache).
 *
 * That same precedence is what makes this rule a safety net rather than a
 * second source of truth: it is keyed on the *request*, so any route — today's
 * or one added later — that is handed an address answers `private, no-store`
 * even if it mistakenly calls `publicJson`. A shared cache holding one
 * visitor's balances under a URL another can guess would tie a person to an
 * address. Routes still set their own policy (`privateJson`); for them this
 * changes nothing.
 */
const ADDRESS_QUERY_KEYS = ["address", "accounts", "voter"] as const;

/**
 * Crawlers that get blocking metadata (title, canonical, robots, description
 * in `<head>`) instead of streamed metadata.
 *
 * Next streams `generateMetadata` into `<body>` for everyone not on its list,
 * and on the dynamic pages (`/validators?chain=`, `/validators/<address>`,
 * proposal pages) the tags then sit in `<body>` for good. Google only honours
 * `rel=canonical` in `<head>`, and a body-placed robots tag is unreliable —
 * which matters for the testnet validator pages, which rely on `noindex`.
 * Googlebot is missing from Next's list (Next treats it as a JS-rendering
 * bot), and so are the AI search crawlers.
 *
 * Setting this option replaces Next's default list, so the default is imported
 * and extended rather than copied: an upstream addition keeps flowing through.
 * Next compiles the source case-insensitively. Ordinary browsers keep streamed
 * metadata; only these crawlers wait for `generateMetadata`, which awaits the
 * same cached reads as the page.
 */
const HTML_LIMITED_BOTS = new RegExp(
  [
    HTML_LIMITED_BOT_UA_RE.source,
    "Googlebot",
    "GPTBot",
    "OAI-SearchBot",
    "ChatGPT-User",
    "ClaudeBot",
    "Claude-SearchBot",
    "Claude-User",
    "PerplexityBot",
    "Perplexity-User",
    "CCBot",
    "Amazonbot",
    "meta-externalagent",
  ].join("|"),
  "i",
);

const nextConfig: NextConfig = {
  allowedDevOrigins: ["127.0.0.1"],
  // Advertises the framework and version to every scanner for no benefit.
  poweredByHeader: false,
  transpilePackages: [
    "@zunialab/ui",
    "@zunialab/tokens",
    "@zunialab/fonts",
    "@zunialab/sdk-react",
    "@zunialab/sdk-web",
    "@zunialab/sdk-core",
  ],
  outputFileTracingRoot: workspaceRoot,
  turbopack: {
    root: workspaceRoot,
  },
  htmlLimitedBots: HTML_LIMITED_BOTS,
  /**
   * Logos go through Next's image optimizer (components/ui/Logos.tsx). The
   * chain registry ships them up to 2500×2500, so /markets pulled 1.2 MB of
   * PNGs into 28px slots; resized to the slot (1x/2x WebP) they are 1–2 KB
   * each, and they come from our own origin, so GitHub and S3 no longer see
   * which tokens and validators a visitor's page lists.
   *
   * Only these four prefixes may be fetched (anything else answers 400: no
   * other host, path, port or protocol, no query string). They must stay the
   * list in components/ui/logo-hosts.ts, which decides which logos the kit
   * sends here; logo-hosts.test.ts fails when the two drift apart. SVGs skip
   * the optimizer (`dangerouslyAllowSVG` stays off): next/image hands the
   * browser their own URL.
   *
   * A week of cache instead of the default 4 hours: a logo at a registry URL
   * practically never changes, and every miss is a fetch from this server's
   * single IP, which GitHub throttles when unauthenticated. The cache
   * (.next/cache/images) survives `next build`. A logo the server cannot
   * fetch falls back to its monogram; `unoptimized: true` here is the switch
   * back to every browser loading logos from their hosts.
   */
  images: {
    remotePatterns: [
      { protocol: "https", hostname: "raw.githubusercontent.com", port: "", pathname: "/cosmos/chain-registry/master/**", search: "" },
      { protocol: "https", hostname: "raw.githubusercontent.com", port: "", pathname: "/Zunia-Lab/zunia-chain-registry/main/images/**", search: "" },
      { protocol: "https", hostname: "raw.githubusercontent.com", port: "", pathname: "/osmosis-labs/assetlists/main/**", search: "" },
      { protocol: "https", hostname: "s3.amazonaws.com", port: "", pathname: "/keybase_processed_uploads/**", search: "" },
    ],
    minimumCacheTTL: 604_800,
  },
  /**
   * Moved pages, as real permanent redirects (308).
   *
   * These run before any rendering. A `permanentRedirect()` inside a page under
   * `(app)/` cannot do that: the app frame's loading boundary has already
   * committed a 200, so a visitor (or a link checker, a preview bot, an old
   * client) got the full frame plus a `<meta http-equiv="refresh">` and no
   * `Location` header, and the production build prerendered exactly that as a
   * static 200 page. The page files left behind are unreachable.
   *
   * - `/portfolio` became Overview; `/dapps` became Apps.
   * - `/mobile` is no longer a page: Zunia Mobile is one way to connect a
   *   wallet, so the URL opens the landing page's Connect wallet modal on the
   *   Zunia Mobile (QR code) view.
   *
   * A query string on the old URL is carried over by Next.
   */
  async redirects() {
    return [
      { source: "/portfolio", destination: "/overview", permanent: true },
      { source: "/dapps", destination: "/apps", permanent: true },
      { source: "/mobile", destination: "/?connect=mobile", permanent: true },
    ];
  },
  // Later entries win for the same header key, so the specific rules come
  // after the site-wide one.
  async headers() {
    return [
      {
        source: "/:path*",
        headers: [
          { key: "X-Frame-Options", value: "DENY" },
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
          { key: "Permissions-Policy", value: PERMISSIONS_POLICY },
          { key: "Cross-Origin-Opener-Policy", value: "same-origin" },
          { key: "Content-Security-Policy", value: ENFORCED_CSP },
          { key: "Content-Security-Policy-Report-Only", value: REPORT_ONLY_CSP },
        ],
      },
      {
        source: "/api/:path*",
        headers: [
          // JSON is not a search result. robots.txt leaves /api/ crawlable,
          // because the public pages render from it and Google's renderer
          // obeys robots.txt for those fetches; this header is what keeps it
          // out of the index.
          { key: "X-Robots-Tag", value: "noindex" },
          // Same-origin JSON must not be pulled into another site's page
          // through a no-cors `<img>`/`<script>` request.
          { key: "Cross-Origin-Resource-Policy", value: "same-origin" },
        ],
      },
      // One rule per key: entries in `has` must all match, and any one of
      // these parameters is enough to make a response personal.
      ...ADDRESS_QUERY_KEYS.map((key) => ({
        source: "/api/:path*",
        has: [{ type: "query" as const, key }],
        headers: [{ key: "Cache-Control", value: "private, no-store" }],
      })),
      {
        // The worker must never be served stale: a cached sw.js keeps an old
        // push handler alive for every installed client (Cloudflare used to
        // hold it for 4 h). Its own CSP replaces the page policy above.
        source: "/sw.js",
        headers: [
          { key: "Cache-Control", value: "no-cache, max-age=0, must-revalidate" },
          { key: "Content-Security-Policy", value: "default-src 'self'" },
          { key: "Service-Worker-Allowed", value: "/" },
        ],
      },
    ];
  },
};

export default nextConfig;
