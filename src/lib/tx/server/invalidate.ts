/**
 * Forget this server's cached reads of one account after it transacted.
 *
 * Balances, staking positions and activity pages are cached per (chain,
 * address) for ~30 s so a dashboard full of cards costs one upstream read.
 * Right after a transaction that cache is exactly wrong: the page refreshes
 * (`revalidateApi("/api/")` in the sign hook) and would be served the
 * balances from before the send. The modules that own those caches export
 * their own invalidators for this moment; this is the one place the wallet
 * routes call them, so a new cache only has to be added here.
 *
 * Cheap and harmless when the account had nothing cached; the worst a forged
 * call can do is make one account's next read go upstream.
 */

import "server-only";
import { invalidate } from "@/lib/server/cache";
import { invalidateActivity } from "@/lib/server/activity/history";
import { invalidateChainAccountReads } from "@/lib/server/chain/staking";
import { invalidatePortfolioRead } from "@/lib/server/portfolio/read";

export function forgetAccountReads(chainId: string, address: string): void {
  invalidatePortfolioRead(chainId, address);
  invalidateActivity(chainId, address);
  // Staking positions, the account's votes and authz/fee grants.
  invalidateChainAccountReads(chainId, address);
  // The activity coverage check reads the account's sequence (activity/account.ts).
  invalidate(`activity:account:${chainId}:${address}`);
}
