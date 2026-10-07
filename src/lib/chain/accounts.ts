/**
 * The `accounts=<chainId>:<address>,…` query parameter shared by the private
 * chain routes (`/api/staking`, `/api/security`) and the `voter=` parameter
 * of `/api/governance`.
 *
 * One address per chain: the dashboard asks about the connected wallet, which
 * has exactly one account on each chain. Building and splitting live here so
 * the browser hooks and the route handlers agree on the format; the server
 * still validates every chain id and bech32 address (`@/lib/server/chain`).
 *
 * Pure.
 */

export interface ChainAccount {
  chainId: string;
  address: string;
}

/** `chainId:address,chainId:address`, first address per chain wins. */
export function formatAccounts(accounts: readonly ChainAccount[]): string {
  const seen = new Set<string>();
  const parts: string[] = [];
  for (const { chainId, address } of accounts) {
    if (!chainId || !address || seen.has(chainId)) continue;
    seen.add(chainId);
    parts.push(`${chainId}:${address}`);
  }
  return parts.join(",");
}

export type SplitResult =
  | { ok: true; accounts: ChainAccount[] }
  | { ok: false; code: "accounts_malformed" | "accounts_too_many"; message: string };

/**
 * Splits the parameter into pairs without validating them. Duplicate chains
 * keep the first address; empty items are ignored.
 */
export function splitAccounts(raw: string | null | undefined, max: number): SplitResult {
  const items = (raw ?? "")
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
  const accounts: ChainAccount[] = [];
  const seen = new Set<string>();
  for (const item of items) {
    const at = item.indexOf(":");
    const chainId = at > 0 ? item.slice(0, at).trim() : "";
    const address = at > 0 ? item.slice(at + 1).trim() : "";
    if (!chainId || !address || chainId.length > 64 || address.length > 128) {
      return { ok: false, code: "accounts_malformed", message: "Each entry must be chainId:address" };
    }
    if (seen.has(chainId)) continue;
    seen.add(chainId);
    accounts.push({ chainId, address });
  }
  if (accounts.length > max) {
    return { ok: false, code: "accounts_too_many", message: `At most ${max} entries per request` };
  }
  return { ok: true, accounts };
}
