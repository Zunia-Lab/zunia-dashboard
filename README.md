<p align="center">
  <img src="https://raw.githubusercontent.com/Zunia-Lab/zunia-brand/main/png/icons/app/zunia-icon-256.png" alt="Zunia" width="96" />
</p>

# zunia-dashboard

> Zunia's decision desk for Cosmos: balances, staking, governance, swaps and IBC across every chain you follow, at [app.zunialab.com](https://app.zunialab.com). The former address, wallet.zunialab.com, permanently redirects there.

**Non-custodial.** Keys never reach the dashboard. Every transaction is approved and signed in the wallet: the Zunia extension (`window.zunia`), Keplr (`window.keplr`), Leap (`window.leap`, shut down in May 2026, still connected where installed), Cosmostation (`window.cosmostation.providers.keplr`), or Zunia Mobile. The browser wallets are one registry, `src/lib/connect/wallets.ts`; where the Zunia extension can be installed, per browser, is `src/lib/connect/install.ts`. Zunia Mobile is one of the options in the Connect wallet modal: scan its QR code with the Zunia app (the session runs over Zunia Connect), then approve each transaction on the phone. The dashboard never asks for a recovery phrase.

## Routes

**Public** (render without a wallet, indexable):

| Route | What it is |
|---|---|
| `/` | Landing and connect |
| `/markets` | Cosmos prices, volumes and movers |
| `/chains`, `/chains/[chainId]` | Staking economics and validator sets by chain |
| `/validators?chain=`, `/validators/[address]?chain=` | Validator comparison and profiles |
| `/governance` and proposal pages | Proposals across chains, with tallies and deadlines |
| `/compare` | Chains and assets side by side |
| `/missions`, `/apps` | Coming soon |

**Wallet** (a connect panel until a wallet is linked; noindex): `/overview` (`/portfolio` redirects here), `/assets` and asset pages, `/activity`, `/activity/[hash]`, `/send`, `/receive`, `/swap`, `/bridge`, `/staking`, `/insights`, `/nfts`, `/nfts/[chainId]/[contract]/[tokenId]`, `/notifications`, `/settings`, `/networks`. `/dapps` redirects to `/apps`, and `/mobile` to `/?connect=mobile`, which opens the Connect wallet modal on Zunia Mobile. These are permanent (308) redirects in `next.config.ts`.

**Generated:** `/robots.txt`, `/sitemap.xml`, `/manifest.webmanifest`, `/icon`, `/apple-icon`, `/opengraph-image`. The service worker for Web Push is `public/sw.js`.

## Architecture

- Next.js 16 App Router on Turbopack, React 19, Tailwind v4, strict TypeScript. The UI kit and tokens come from `@zunialab/ui` and `@zunialab/tokens`, wallet transports from `@zunialab/sdk-*`, and the IBC and route engine from `@zunialab/interchain`.
- Pages under `src/app/(app)/` render inside the app frame (`src/components/shell/`). `/` and the error pages are full-bleed.
- The wallet pages (overview, activity, send, receive, swap, bridge, staking, insights, NFTs, notifications, settings, networks) sit in the `src/app/(app)/(wallet)/` route group, which holds the loading boundary that paints their skeleton at once. The public pages stay outside it on purpose: a loading boundary streams the response, a streamed response has already sent its 200, and those pages decide real 404s on the server (an unknown chain, a proposal or validator that does not exist). A malformed URL (a chain id the catalog does not know, a proposal id that is not a number, an address that decodes to no operator, an asset key no table names) is refused by the page itself before any read, and is a real 404 for the same reason.
- The browser talks only to same-origin `/api/*`, plus the wallet providers and the Zunia Connect relay. Route handlers read:
  - chain LCDs (REST) from the server catalog;
  - prices from Numia, Osmosis SQS and Coinstore, with CoinGecko as a secondary source.
- Every route handler follows the same rules:
  - every upstream call has a timeout (`src/lib/server/http.ts`);
  - inputs are validated (`src/lib/server/validate.ts`);
  - fan-out routes are rate limited per client (`src/lib/server/rate-limit.ts`);
  - reads go through an in-process cache (`src/lib/server/cache.ts`);
  - cache headers are set explicitly (`src/lib/server/respond.ts`): `publicJson` for market and chain data, `privateJson` for anything keyed by an address.
- When an upstream fails, a route answers with a JSON 503. It never serves sample data.
- The chain catalog has two copies:
  - `src/data/chain-catalog.json`, server only, with endpoints;
  - `src/data/chain-catalog.client.json`, for the browser, without endpoints. Regenerate it with `node scripts/slim-chain-catalog.mjs`.
- Security headers are set in `next.config.ts`:
  - the CSP is report-only for now, plus an enforced `frame-ancestors 'none'`;
  - any `/api` request that carries an address (`address`, `accounts`, `voter`) is answered `private, no-store`, whatever the route sets.
- NFT metadata is the one place the server fetches a URL chosen by a stranger (a token's `token_uri`). `src/lib/nft/remote-guard.ts` allows https only, checks every resolved address and every redirect hop before requesting it, and caps size and time.

## Development

**Prerequisites:**
- Node 22 or later.
- pnpm 9, at the version pinned in `packageManager`.
- `zunia-ui` and `zunia-sdk` checked out next to this repository and built (`pnpm install && pnpm build` in each). Until the `@zunialab` npm scope is published, `package.json` links those packages to the sibling checkouts.

```bash
pnpm install
cp .env.example .env.local   # then adjust; every variable is explained there
pnpm dev                     # http://localhost:3000
```

| Script | |
|---|---|
| `pnpm dev` | Development server (Turbopack) |
| `pnpm build`, `pnpm start` | Production build and server |
| `pnpm typecheck` | `tsc --noEmit`. On a fresh clone, run `pnpm exec next typegen` first. |
| `pnpm lint` | ESLint |
| `pnpm test` | Unit tests (`node:test` with tsx): `src/**/*.test.ts` |

CI (`.github/workflows/ci.yml`) checks out zunia-ui and zunia-sdk next to the dashboard and builds them. It then runs typegen, typecheck, lint, test and build on Node 22. Test fixtures from other repositories are vendored (see `src/lib/tx/__tests__/vectors/`), so tests never read a sibling checkout.

## Configuration

Every variable is documented in `.env.example`.
- **Required in production:** `NEXT_PUBLIC_ZUNIA_CONNECT_API_BASE`. It is a build-time value.
- **Public address:** `NEXT_PUBLIC_SITE_URL` (build time) defaults to `https://app.zunialab.com`. Canonical links, the sitemap, robots.txt, structured data and the host printed on share cards all use it (`src/lib/site.ts`). Set it only for a preview or staging host.
- **Optional:**
  - a CoinGecko key;
  - VAPID keys for Web Push;
  - the cross-chain swap contract;
  - the NFT keys.

## Deployment

Production runs on a Hetzner host behind Cloudflare and nginx. `next start` listens on 127.0.0.1:3012 under the systemd unit `zunia-dashboard.service`, which reads its environment from `/srv/zunia/shared/dashboard.env`. The deploy tooling is in `zunia-infra/deploy/`; the steps and smoke tests are in [docs/DEPLOY.md](docs/DEPLOY.md).
- nginx serves the dashboard on `app.zunialab.com`. `wallet.zunialab.com` answers a permanent 301 there, path and query kept.
- `NEXT_PUBLIC_*` values are baked in at build time, so changing one needs a rebuild. Server-only values need a restart.
- Server-side data (push subscriptions) lives in `ZUNIA_DASHBOARD_DATA_DIR`, outside the checkout, so a redeploy keeps it.
- HSTS belongs at the edge (nginx or Cloudflare), not in this app.

## Security

Report vulnerabilities privately to [security@zunialab.com](mailto:security@zunialab.com). See [SECURITY.md](SECURITY.md).

## License

Apache-2.0.
