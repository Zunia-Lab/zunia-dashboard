# Deploying the dashboard (app.zunialab.com)

Production runs on the Hetzner host behind Cloudflare:

- nginx serves `app.zunialab.com` (`zunia-infra/deploy/nginx/app.zunialab.com.conf`) and forwards to `next start` on 127.0.0.1:3012, run by `zunia-dashboard.service`.
- `wallet.zunialab.com`, the address before the v2 launch, answers a permanent **301** to `https://app.zunialab.com`, path and query kept (`zunia-infra/deploy/nginx/wallet.zunialab.com.conf`). Keep that redirect forever: the old host is named in docs, llms.txt files and links already shared.
- `zunia-redeploy.timer` rebuilds when `origin/main` moves, within about 2 minutes.
- `zunia-infra/docs/hetzner.md` has the details.

**Pushing to `main` deploys.**

## 1. Server environment (one time, before the first v2 deploy)

Edit `/srv/zunia/shared/dashboard.env` (mode 600, owner `zunia`). The redeploy script copies it to `.env.production.local` before every build.

```bash
# Web Push: native notifications while no Zunia tab is open
cd /srv/zunia/repos/zunia-dashboard && /srv/zunia/toolchain/node/bin/npx web-push generate-vapid-keys --json
```

Put the two keys in `dashboard.env`:

```bash
VAPID_PUBLIC_KEY=<publicKey>
VAPID_PRIVATE_KEY=<privateKey>          # secret: never commit it, never paste it in a chat
VAPID_SUBJECT=mailto:security@zunialab.com

# Where push subscriptions are kept (persistent, writable by zunia)
ZUNIA_DASHBOARD_DATA_DIR=/srv/zunia/shared/dashboard
```

Then create that directory:

```bash
sudo install -d -o zunia -g zunia -m 700 /srv/zunia/shared/dashboard
```

**Already handled:**
- The redeploy script writes `NEXT_PUBLIC_ZUNIA_CONNECT_API_BASE=https://api.zunialab.com`. Connecting with Zunia Mobile needs it.
- `NEXT_PUBLIC_SITE_URL` needs no entry. It defaults to `https://app.zunialab.com`, which canonical links, the sitemap, robots.txt, the structured data and the share cards use (`src/lib/site.ts`). Set it only on a preview or staging build.
- `ZUNIA_XCS_CONTRACT` is no longer needed. The verified CrossChainSwaps contract is built in and checked on chain.
- The dashboard no longer reads `INDEXER_URL`, `BACKEND_URL` or `INDEXER_API_KEY`, because activity reads public chain nodes directly. Leaving them set is harmless.

**Optional:**
- `COINGECKO_API_KEY`: a demo key fills market caps and all-time highs for assets Numia does not cover. Without a key, CoinGecko answers 429 from shared IPs; everything else still works.
- `ZUNIA_PUSH_POLLER=off`: stops the push poller on a secondary instance.
- `ZUNIA_WARM_CACHES=off`: skips warming the market cache at boot.

## 2. The app.zunialab.com address (one time, in this order)

The dashboard build already names `app.zunialab.com` everywhere, so ship it in the same deploy that turns on the redirect. The order matters: Cloudflare runs SSL in Full (strict) mode, so a proxied name without a certificate on the origin answers 526.

1. **Certificate:** expand the origin certificate with `app.zunialab.com` (the certbot command is in `zunia-infra/docs/hetzner.md`). Check it with `openssl s_client -servername app.zunialab.com`.
2. **nginx:** enable `app.zunialab.com.conf` (a symlink in `sites-enabled`, like the other vhosts) and switch `wallet.zunialab.com.conf` to the 301, then `nginx -t && systemctl reload nginx`.
3. **DNS:** a proxied `A`/`AAAA` record for `app`, with the same addresses as `wallet`. Redirect in one place only: the nginx 301, not also a Cloudflare redirect rule.
4. **The first week:** the 301 carries `Cache-Control: public, max-age=3600`, so browsers check it again after an hour and the move can still be taken back. Remove that header once `app` has settled; browsers then keep the redirect as permanent.
5. **Monitoring:** Uptime Kuma watches `https://app.zunialab.com/api/health`. Add a check that `wallet.zunialab.com` still answers 301 (maximum redirects 0).

**What users notice, once.** Wallet approvals, local data and installs belong to one origin. On `app.zunialab.com` everyone approves the site again in the Zunia extension or Keplr (one prompt), connects Zunia Mobile again, reinstalls the installed app and turns push back on. The address book, followed chains and preferences stored under `wallet.zunialab.com` do not carry over. Say so in the release note.

## 3. Cloudflare

- **Caching → Cache Rules:** bypass the cache for `app.zunialab.com/sw.js`, or set Browser Cache TTL to "Respect existing headers". Otherwise service-worker updates can lag up to 4 hours.
- **SSL/TLS → Edge Certificates:** enable HSTS with a max-age of 6 months or more. Turn on "include subdomains" only after checking every subdomain, mail included.
- **Security → Bots:** leave "Block AI bots" off if AI search should read the public pages (the sitemap).

## 4. Deploy

The v2 work is on the `dashboard-v2` branch. Commit it, then fast-forward `main`:

```bash
git checkout main && git merge --ff-only dashboard-v2 && git push origin main
```

The timer runs `pnpm install --frozen-lockfile && pnpm build`, then restarts the service. To follow it:

```bash
journalctl -u zunia-redeploy -f
journalctl -u zunia-dashboard -f
```

## 5. Smoke test (about 2 minutes)

```bash
curl -sI https://app.zunialab.com/ | grep -i -E "x-frame-options|content-security|referrer|permissions"
curl -s https://app.zunialab.com/api/health          # ok: true
curl -s https://app.zunialab.com/api/push/config     # enabled: true (after step 1)
curl -sI https://app.zunialab.com/mobile | head -3   # 308 to /?connect=mobile
curl -s -o /dev/null -w '%{http_code}\n' https://app.zunialab.com/chains/not-a-chain   # 404
curl -s https://app.zunialab.com/robots.txt | grep -i sitemap   # Sitemap: https://app.zunialab.com/sitemap.xml
curl -s https://app.zunialab.com/markets | grep -o '<link rel="canonical"[^>]*>'   # href on app.zunialab.com
curl -sI 'https://wallet.zunialab.com/governance?x=1' | grep -i -E "^HTTP|^location"   # 301, location https://app.zunialab.com/governance?x=1
```

Then check these in Chrome:

1. The landing page loads with live markets.
2. Connect wallet lists the Zunia extension (Add to Chrome where it is not installed), the Cosmos wallets the browser has (or Get Keplr / Get Cosmostation), and the Zunia Mobile zone, which shows a QR code.
3. Connect with the extension: its prompt names `app.zunialab.com`. Overview shows your balances.
4. Pick a chain in the rail: the figures switch to that chain.
5. Swap shows a quote for OSMO → ATOM. A tiny real swap checks signing end to end.
6. Staking → Stake → choose a network: the validator list appears.
7. In Settings → Notifications, turn on browser alerts and push, then press "Send test".

Finally, add `app.zunialab.com` in Google Search Console and Bing Webmaster Tools and submit `https://app.zunialab.com/sitemap.xml`.

## Rollback

There are two ways back:
- `git revert` the merge on `main` and push.
- On the server checkout, `git reset --hard <previous sha>` and rebuild.

Either way the build is replaced in place, so a rollback takes one rebuild (2–3 minutes). A rollback does not move the address: `app.zunialab.com` serves whichever build is live, and `wallet.zunialab.com` keeps redirecting. Giving the address back to `wallet.zunialab.com` means undoing the nginx redirect as well; during the first week, browsers drop the cached 301 within an hour.
