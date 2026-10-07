/**
 * Security review of one account on one chain (I7 in the research report):
 * the authz grants it gave, the fee allowances it issued, and whether its
 * staking rewards are paid to another address.
 *
 * Each read degrades on its own: a chain that predates x/authz answers 501
 * for the grants route, which is reported as "not supported" in `errors`,
 * never as "no grants" — the difference between "nothing found" and "could
 * not check" is the whole point of a security review.
 *
 * Cache: 60 s per account (a revoke must show up on the next refresh).
 */

import "server-only";
import type { ServerChainEntry } from "@/lib/server/chains";
import { parseAuthzGrants, parseFeeGrants } from "@/lib/chain/security";
import type { AuthzGrantRow, FeeGrantRow, PartError } from "@/lib/chain/types";
import { ACCOUNT_READS } from "./account-paths";
import { describeLcdError, describeMiss, lcd, type LcdResult } from "./lcd";
import { readWithdrawAddress } from "./staking";

const TTL = 60_000;
const STALE = 15_000;

export interface AccountSecurity {
  chainId: string;
  address: string;
  authzGrants: AuthzGrantRow[];
  feeGrants: FeeGrantRow[];
  withdrawAddress: string | null;
  status: "ok" | "partial" | "error";
  errors: PartError[];
}

async function settle<T>(read: Promise<LcdResult<T>>): Promise<{ data: T | null; error: string | null }> {
  try {
    const result = await read;
    return result.ok ? { data: result.data, error: null } : { data: null, error: describeMiss(result.miss) };
  } catch (error) {
    return { data: null, error: describeLcdError(error) };
  }
}

export async function readAccountSecurity(chain: ServerChainEntry, address: string): Promise<AccountSecurity> {
  const id = chain.chainId;
  const authzRead = ACCOUNT_READS.authzGrants(address);
  const feeRead = ACCOUNT_READS.feeGrants(address);
  const [authz, feegrant, withdraw] = await Promise.all([
    settle(
      lcd(chain, authzRead.path, {
        ttlMs: TTL,
        staleMs: STALE,
        name: authzRead.name,
        map: (body) => parseAuthzGrants(body, id),
      }),
    ),
    settle(
      lcd(chain, feeRead.path, {
        ttlMs: TTL,
        staleMs: STALE,
        name: feeRead.name,
        map: (body) => parseFeeGrants(body, id),
      }),
    ),
    settle(readWithdrawAddress(chain, address)),
  ]);
  const errors: PartError[] = [];
  if (authz.error) errors.push({ chainId: id, scope: "authz", message: authz.error });
  if (feegrant.error) errors.push({ chainId: id, scope: "feegrant", message: feegrant.error });
  if (withdraw.error) errors.push({ chainId: id, scope: "withdraw-address", message: withdraw.error });
  const failed = [authz, feegrant, withdraw].filter((part) => part.error !== null).length;
  return {
    chainId: id,
    address,
    authzGrants: authz.data ?? [],
    feeGrants: feegrant.data ?? [],
    withdrawAddress: withdraw.data,
    status: failed === 0 ? "ok" : failed === 3 ? "error" : "partial",
    errors,
  };
}
