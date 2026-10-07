/**
 * The per-account LCD reads, path and cache name in one place.
 *
 * The staking and security readers cache these by path, and
 * `invalidateChainAccountReads` (after a broadcast) must drop exactly the
 * entries they wrote; building the strings in one module keeps the two from
 * drifting. Addresses are validated bech32 before they get here and are
 * still URL-encoded.
 */

import "server-only";

export interface AccountRead {
  path: string;
  /** Cache-entry name the reader uses (`lcd()`'s `name`). */
  name: string;
}

function enc(address: string): string {
  return encodeURIComponent(address);
}

export const ACCOUNT_READS = {
  /** One page of 200: more is not a wallet. */
  delegations: (address: string): AccountRead => ({
    path: `cosmos/staking/v1beta1/delegations/${enc(address)}?pagination.limit=200`,
    name: "delegations",
  }),
  rewards: (address: string): AccountRead => ({
    path: `cosmos/distribution/v1beta1/delegators/${enc(address)}/rewards`,
    name: "rewards",
  }),
  unbonding: (address: string): AccountRead => ({
    path: `cosmos/staking/v1beta1/delegators/${enc(address)}/unbonding_delegations?pagination.limit=100`,
    name: "unbonding",
  }),
  redelegations: (address: string): AccountRead => ({
    path: `cosmos/staking/v1beta1/delegators/${enc(address)}/redelegations?pagination.limit=100`,
    name: "redelegations",
  }),
  withdrawAddress: (address: string): AccountRead => ({
    path: `cosmos/distribution/v1beta1/delegators/${enc(address)}/withdraw_address`,
    name: "withdraw",
  }),
  authzGrants: (address: string): AccountRead => ({
    path: `cosmos/authz/v1beta1/grants/granter/${enc(address)}?pagination.limit=100`,
    name: "authz",
  }),
  feeGrants: (address: string): AccountRead => ({
    path: `cosmos/feegrant/v1beta1/issued/${enc(address)}?pagination.limit=100`,
    name: "feegrant",
  }),
} as const;
