/**
 * Server start-up hooks (Next calls `register` once per server instance,
 * before it serves requests).
 *
 * Two jobs, both Node.js-only and both fire-and-forget so `register` never
 * blocks start-up:
 *
 * - **Warm the public caches.** Production is one long-lived process that a
 *   redeploy restarts, dropping every in-memory read, so without this the
 *   first visitors after a deploy pay the cold fan-outs: /api/markets ~11 s
 *   (Numia, Coinstore, CoinGecko), chain stats ~6 s, governance 3–6 s, a
 *   validator set 3 s. At boot the same loaders the routes use are run for the
 *   chains a first visit follows (`DEFAULT_FOLLOWED`), one after another so
 *   the warm-up never competes with the first real requests for the per-host
 *   connection cap; errors are ignored. `ZUNIA_WARM_CACHES=off` skips it.
 * - **Start the Web Push watcher**, only when the VAPID keys are set
 *   (`ZUNIA_PUSH_POLLER=off` keeps it off on a replica or a dev machine with
 *   keys).
 *
 * The loaders are imported inside the runtime check, as the Next docs
 * prescribe, so the edge build never sees `web-push` or `node:fs`. The one
 * static import is a plain list of chain ids.
 */

// The browser's first-visit list itself, not a copy that could drift from it:
// it lives in a module without "use client" so server code can read it
// (`@/lib/useFollowedChains` re-exports it for the hook), and warming exactly
// what a first visit asks for is the point.
import { DEFAULT_FOLLOWED } from "@/lib/followed-defaults";

function warned(what: string) {
  return (error: unknown) => {
    // A cold cache is a slower first request, never an outage.
    console.warn(`[warmup] ${what} not warmed: ${error instanceof Error ? error.message : "unknown error"}`);
  };
}

async function warmChainCaches(): Promise<void> {
  const [{ findServerChain }, { readChainStats }, { readChainProposals, INHERITED_BUDGET }, { readEconomics }, { readValidatorSet }, { attachValidatorLogos }] =
    await Promise.all([
      import("./lib/server/chains"),
      import("./lib/server/chain/stats"),
      import("./lib/server/chain/governance"),
      import("./lib/server/chain/economics"),
      import("./lib/server/chain/validator-set"),
      import("./lib/server/validator-logos"),
    ]);
  for (const chainId of DEFAULT_FOLLOWED) {
    const chain = findServerChain(chainId);
    if (!chain) continue;
    // Overview, Chains and Compare (chain stats), then Governance's two
    // default lists, then the validator set with its logo directory (the
    // Keybase lookups land in the cache in the background).
    await readChainStats(chain).catch(warned(`${chainId} stats`));
    for (const filter of ["voting", "all"] as const) {
      await readChainProposals(chain, filter, null, { remaining: INHERITED_BUDGET }).catch(warned(`${chainId} governance`));
    }
    await Promise.all([readEconomics(chain), readValidatorSet(chain, { status: "bonded", chainApr: null })])
      // Waits for the logo directory (Keybase lookups start only once it has
      // answered), never for Keybase itself.
      .then(([, set]) => attachValidatorLogos(chain, set.rows, { waitMs: 15_000, keybaseWaitMs: 0 }))
      .catch(warned(`${chainId} validators`));
  }
}

export async function register(): Promise<void> {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;

  if (process.env.ZUNIA_WARM_CACHES !== "off") {
    void import("./lib/server/prices/markets")
      .then(({ getMarkets }) => getMarkets("usd"))
      .catch(warned("markets"))
      // Markets first: the landing page and /markets need it most.
      .then(() => warmChainCaches())
      .catch(warned("chain caches"));
  }

  if (!process.env.VAPID_PUBLIC_KEY || !process.env.VAPID_PRIVATE_KEY) return;
  if (process.env.ZUNIA_PUSH_POLLER === "off") return;
  try {
    const { startPushPoller } = await import("./lib/server/push/poller");
    startPushPoller();
  } catch (error) {
    // A watcher that cannot start must never take the site down with it.
    console.warn(`[push] watcher not started: ${error instanceof Error ? error.message : "unknown error"}`);
  }
}
