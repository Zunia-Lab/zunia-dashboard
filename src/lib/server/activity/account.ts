/**
 * An account's on-chain record: does the chain know it, and how many
 * transactions has it signed (its sequence)?
 *
 * The coverage verdict compares the sequence with the signed transactions the
 * node's search returned: equal means every transaction the account ever
 * signed is inside the node's window, which is the evidence for calling a
 * pruned node's list complete (lib/activity/window.ts `coverageOf`).
 */

import "server-only";
import { cached } from "@/lib/server/cache";
import { fetchJson, UpstreamError } from "@/lib/server/http";
import { restOf } from "@/lib/server/chains";
import type { AccountFacts } from "@/lib/activity/window";

function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null && !Array.isArray(value) ? (value as Record<string, unknown>) : null;
}

/**
 * The sequence of any account shape: BaseAccount, vesting accounts
 * (`base_vesting_account.base_account`), Ethermint/Injective `EthAccount`
 * (`base_account`).
 */
function sequenceOf(account: Record<string, unknown> | null, depth = 0): number | null {
  if (!account || depth > 3) return null;
  const raw = account.sequence;
  if (typeof raw === "string" && /^\d{1,15}$/.test(raw)) return Number(raw);
  if (typeof raw === "number" && Number.isSafeInteger(raw) && raw >= 0) return raw;
  return sequenceOf(asRecord(account.base_account), depth + 1) ?? sequenceOf(asRecord(account.base_vesting_account), depth + 1);
}

/** Never throws: what cannot be read is null. */
export async function accountFacts(chainId: string, address: string): Promise<AccountFacts> {
  const rest = restOf(chainId);
  if (!rest) return { exists: null, sequence: null };
  try {
    return await cached(`activity:account:${chainId}:${address}`, { ttlMs: 30_000, errorTtlMs: 10_000 }, async () => {
      try {
        const body = await fetchJson<{ account?: unknown }>(
          `${rest}/cosmos/auth/v1beta1/accounts/${encodeURIComponent(address)}`,
          { timeoutMs: 6_000 },
        );
        return { exists: true, sequence: sequenceOf(asRecord(body.account)) };
      } catch (error) {
        // gRPC NotFound: the chain has never seen this account.
        if (error instanceof UpstreamError && error.kind === "http" && error.status === 404) {
          return { exists: false, sequence: 0 };
        }
        throw error;
      }
    });
  } catch {
    return { exists: null, sequence: null };
  }
}
