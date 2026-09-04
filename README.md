<p align="center">
  <img src="https://raw.githubusercontent.com/Zunia-Lab/zunia-brand/main/png/icons/app/zunia-icon-256.png" alt="Zunia" width="96" />
</p>

# zunia-dashboard

> Web portfolio and activity UI at [wallet.zuniawallet.com](https://wallet.zuniawallet.com).

## Overview

Next.js App Router dashboard. **Non-custodial:** keys stay in the Zunia or Keplr extension or the mobile app. The browser never talks to chain RPC directly — reads go through `app/api/*` → `INDEXER_URL` / `BACKEND_URL`.

## Routes

`/`, `/portfolio`, `/chains/[chainId]`, `/staking`, `/activity`, `/governance`, `/missions`, `/dapps`, `/notifications`, `/settings`

Connect modes: Zunia (`window.zunia`), Keplr (`window.keplr`), WalletConnect stub.

Also: Web Push (`public/sw.js` + VAPID UI), PWA manifest, iOS Home Screen prompt, ADR-36 device binding stubs under `/api/device/*`.

## Quick start

```bash
pnpm install
cp .env.example .env.local   # set INDEXER_URL / BACKEND_URL / VAPID / WC
pnpm dev
```

Open [http://localhost:3000](http://localhost:3000).

## License

Apache-2.0.
