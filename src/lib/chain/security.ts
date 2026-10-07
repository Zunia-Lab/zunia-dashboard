/**
 * Security review readers: authz grants an account gave, fee allowances it
 * issued — the Cosmos equivalent of EVM token approvals.
 *
 * An authz grant lets another address sign specific messages for you
 * (REStake bots, trading desks, phishing sites asking to "verify"); a fee
 * grant lets it spend your balance on fees. Both outlive the session that
 * created them, so the dashboard lists them with what they allow and when
 * they expire.
 *
 * Pure: parsing only.
 */

import { arr, coins, parseTime, pick, rec, shortTypeName, str } from "./parse";
import type { AuthzGrantRow, Coin, FeeGrantRow } from "./types";

/** `AUTHORIZATION_TYPE_DELEGATE` → `delegate`. */
function stakeAction(raw: unknown): string | undefined {
  const value = str(raw);
  if (!value) return undefined;
  return value.replace(/^AUTHORIZATION_TYPE_/, "").toLowerCase();
}

/** `cosmos/authz/v1beta1/grants/granter/{addr}` */
export function parseAuthzGrants(body: unknown, chainId: string): AuthzGrantRow[] {
  const out: AuthzGrantRow[] = [];
  for (const item of arr(pick(body, ["grants"]))) {
    const grant = rec(item);
    const granter = str(grant?.granter);
    const grantee = str(grant?.grantee);
    const authorization = rec(grant?.authorization);
    const typeUrl = str(authorization?.["@type"]);
    if (!grant || !granter || !grantee || !authorization || !typeUrl) continue;

    const row: AuthzGrantRow = {
      chainId,
      granter,
      grantee,
      authorization: shortTypeName(typeUrl),
      authorizationTypeUrl: typeUrl,
      expiration: parseTime(grant.expiration),
    };
    const msg = str(authorization.msg);
    if (msg) row.msgTypeUrl = msg;
    const action = stakeAction(authorization.authorization_type);
    if (action) row.stakeAction = action;
    const allow = arr(pick(authorization, ["allow_list", "address"]))
      .map((value) => str(value))
      .filter((value): value is string => Boolean(value));
    if (allow.length) row.validators = allow;
    const limit: Coin[] = [
      ...coins(authorization.spend_limit),
      ...coins(authorization.max_tokens ? [authorization.max_tokens] : []),
    ];
    if (limit.length) row.spendLimit = limit;
    out.push(row);
  }
  return out;
}

/**
 * The innermost allowance: `AllowedMsgAllowance` wraps another allowance and
 * `PeriodicAllowance` keeps its spend limit and expiry under `basic`.
 */
function unwrapAllowance(allowance: Record<string, unknown>): {
  spendLimit: Coin[];
  expiration: string | null;
  allowedMessages: string[];
} {
  const allowedMessages = arr(allowance.allowed_messages)
    .map((value) => str(value))
    .filter((value): value is string => Boolean(value));
  const inner = rec(allowance.allowance);
  if (inner) {
    const nested = unwrapAllowance(inner);
    return { ...nested, allowedMessages: [...allowedMessages, ...nested.allowedMessages] };
  }
  const basic = rec(allowance.basic) ?? allowance;
  return {
    spendLimit: coins(basic.spend_limit),
    expiration: parseTime(basic.expiration),
    allowedMessages,
  };
}

/** `cosmos/feegrant/v1beta1/issued/{addr}` */
export function parseFeeGrants(body: unknown, chainId: string): FeeGrantRow[] {
  const out: FeeGrantRow[] = [];
  for (const item of arr(pick(body, ["allowances"]))) {
    const grant = rec(item);
    const granter = str(grant?.granter);
    const grantee = str(grant?.grantee);
    const allowance = rec(grant?.allowance);
    const typeUrl = str(allowance?.["@type"]);
    if (!grant || !granter || !grantee || !allowance || !typeUrl) continue;
    const { spendLimit, expiration, allowedMessages } = unwrapAllowance(allowance);
    const row: FeeGrantRow = {
      chainId,
      granter,
      grantee,
      allowance: shortTypeName(typeUrl),
      allowanceTypeUrl: typeUrl,
      expiration,
    };
    if (spendLimit.length) row.spendLimit = spendLimit;
    if (allowedMessages.length) row.allowedMessages = allowedMessages;
    out.push(row);
  }
  return out;
}
