/**
 * The chain reads the push poller needs, on each chain's catalog LCD.
 *
 * Every read goes through `fetchJson` (timeout, per-host concurrency cap,
 * typed failure) and, where the answer is shared by many subscriptions or
 * changes slowly, through `cached` — a thousand subscribers on Osmosis cost one
 * proposals read per five minutes, not a thousand.
 *
 * Tx search spelling: SDK ≥ 0.50 takes `query=` with a full CometBFT query, so
 * `transfer.recipient='…' AND tx.height>N` filters on the node and an idle
 * address costs a ~60-byte answer. Older nodes take `events=`, which allows no
 * height range: the newest page comes back and is filtered here. Which one a
 * chain speaks is remembered after the first answer. `limit` (not
 * `pagination.limit`, which SDK ≥ 0.46 ignores) bounds the page.
 */

import "server-only";
import { cached } from "@/lib/server/cache";
import { restOf } from "@/lib/server/chains";
import { fetchJson, UpstreamError } from "@/lib/server/http";
import { parseChainTime } from "@/lib/notifications/ids";

const SEARCH_LIMIT = 20;
const STYLE_KEY = "__zuniaPushSearchStyle";

function styles(): Map<string, "query" | "events"> {
  const g = globalThis as unknown as Record<string, Map<string, "query" | "events"> | undefined>;
  let map = g[STYLE_KEY];
  if (!map) {
    map = new Map();
    g[STYLE_KEY] = map;
  }
  return map;
}

function restFor(chainId: string): string {
  const rest = restOf(chainId);
  if (!rest || !rest.startsWith("https://")) throw new Error(`${chainId} has no https REST endpoint`);
  return rest;
}

const q = encodeURIComponent;

/** Latest block height (shared by every account on the chain for ~15 s). */
export function latestHeight(chainId: string): Promise<number> {
  return cached(`push:height:${chainId}`, { ttlMs: 15_000, staleMs: 0, errorTtlMs: 10_000 }, async () => {
    const body = await fetchJson<{
      sdk_block?: { header?: { height?: string } };
      block?: { header?: { height?: string } };
    }>(`${restFor(chainId)}/cosmos/base/tendermint/v1beta1/blocks/latest`, { timeoutMs: 6_000 });
    const height = Number((body.sdk_block ?? body.block)?.header?.height);
    if (!Number.isSafeInteger(height) || height <= 0) throw new Error(`${chainId}: no block height`);
    return height;
  });
}

/** Tx responses newer than `afterHeight` in which `address` is a transfer recipient. */
export async function searchIncoming(chainId: string, address: string, afterHeight: number): Promise<unknown[]> {
  const rest = restFor(chainId);
  const condition = `transfer.recipient='${address}'`;
  const known = styles().get(chainId);
  const order = known === "events" ? (["events", "query"] as const) : (["query", "events"] as const);
  let lastError: unknown = null;
  for (const style of order) {
    const filter = style === "query" ? `${condition} AND tx.height>${Math.max(0, Math.floor(afterHeight))}` : condition;
    try {
      const body = await fetchJson<{ tx_responses?: unknown[] }>(
        `${rest}/cosmos/tx/v1beta1/txs?${style}=${q(filter)}&order_by=ORDER_BY_DESC&limit=${SEARCH_LIMIT}`,
        { timeoutMs: 12_000 },
      );
      styles().set(chainId, style);
      const rows = Array.isArray(body.tx_responses) ? body.tx_responses : [];
      return style === "query"
        ? rows
        : rows.filter((row) => Number((row as { height?: unknown }).height) > afterHeight);
    } catch (error) {
      lastError = error;
      // Only a refusal of the spelling is worth trying the other one for; a
      // timeout or a 5xx would just fail twice.
      if (!(error instanceof UpstreamError && error.kind === "http" && (error.status === 400 || error.status === 501))) {
        break;
      }
    }
  }
  throw lastError;
}

export interface VotingProposal {
  readonly id: string;
  readonly title: string;
  readonly votingEndTime: number;
  readonly api: "v1" | "v1beta1";
}

interface ProposalRow {
  id?: string;
  proposal_id?: string;
  title?: string;
  voting_end_time?: string;
  content?: { title?: string };
  messages?: Array<{ content?: { title?: string } }>;
  metadata?: string;
}

function proposalTitle(row: ProposalRow): string {
  const title = row.title || row.content?.title || row.messages?.[0]?.content?.title || "";
  return title.trim().slice(0, 200) || "Untitled proposal";
}

/** Proposals in their voting period (shared by every subscriber on the chain, 5 min). */
export function votingProposals(chainId: string): Promise<VotingProposal[]> {
  return cached(`push:gov:${chainId}`, { ttlMs: 5 * 60_000, errorTtlMs: 60_000 }, async () => {
    const rest = restFor(chainId);
    const read = async (api: "v1" | "v1beta1"): Promise<VotingProposal[]> => {
      const status = api === "v1" ? "PROPOSAL_STATUS_VOTING_PERIOD" : "2";
      const body = await fetchJson<{ proposals?: ProposalRow[] }>(
        `${rest}/cosmos/gov/${api}/proposals?proposal_status=${status}&pagination.limit=50`,
        { timeoutMs: 8_000 },
      );
      return (body.proposals ?? []).flatMap((row) => {
        const id = String(row.id ?? row.proposal_id ?? "");
        const end = parseChainTime(row.voting_end_time);
        return /^\d{1,12}$/.test(id) && end !== null ? [{ id, title: proposalTitle(row), votingEndTime: end, api }] : [];
      });
    };
    try {
      return await read("v1");
    } catch (error) {
      if (error instanceof UpstreamError && error.kind === "http" && (error.status === 404 || error.status === 501)) {
        return read("v1beta1");
      }
      throw error;
    }
  });
}

/** Whether the address delegates anything on the chain (its vote has weight). */
export function hasDelegation(chainId: string, address: string): Promise<boolean> {
  return cached(`push:delegates:${chainId}:${address}`, { ttlMs: 10 * 60_000, errorTtlMs: 60_000 }, async () => {
    const body = await fetchJson<{ delegation_responses?: unknown[] }>(
      `${restFor(chainId)}/cosmos/staking/v1beta1/delegations/${q(address)}?pagination.limit=1`,
      { timeoutMs: 8_000 },
    );
    return Array.isArray(body.delegation_responses) && body.delegation_responses.length > 0;
  });
}

/**
 * Whether the address voted on the proposal.
 *
 * Gov answers a missing vote with an error, not an empty body: HTTP 400 with
 * gRPC code 3 "voter … not found for proposal" (checked on osmosis-1 and
 * cosmoshub-4, 2026-10-07), 404 on some versions. The address is validated
 * bech32 and the proposal id comes from the chain's own list, so those two
 * statuses mean "not voted"; anything else is "unknown", and unknown is never
 * pushed as "you haven't voted".
 */
export function voteStatus(
  chainId: string,
  proposal: Pick<VotingProposal, "id" | "api">,
  address: string,
): Promise<"voted" | "not-voted" | "unknown"> {
  return cached(`push:vote:${chainId}:${proposal.id}:${address}`, { ttlMs: 10 * 60_000, errorTtlMs: 60_000 }, async () => {
    try {
      await fetchJson(
        `${restFor(chainId)}/cosmos/gov/${proposal.api}/proposals/${q(proposal.id)}/votes/${q(address)}`,
        { timeoutMs: 8_000 },
      );
      return "voted" as const;
    } catch (error) {
      if (error instanceof UpstreamError && error.kind === "http" && (error.status === 400 || error.status === 404)) {
        return "not-voted" as const;
      }
      return "unknown" as const;
    }
  });
}

export interface UnbondingEntry {
  readonly validator: string;
  readonly completesAt: number;
  /** Base units of the bond denom still unbonding. */
  readonly balance: string;
}

export function unbondingEntries(chainId: string, address: string): Promise<UnbondingEntry[]> {
  return cached(`push:unbonding:${chainId}:${address}`, { ttlMs: 5 * 60_000, errorTtlMs: 60_000 }, async () => {
    const body = await fetchJson<{
      unbonding_responses?: Array<{
        validator_address?: string;
        entries?: Array<{ completion_time?: string; balance?: string }>;
      }>;
    }>(`${restFor(chainId)}/cosmos/staking/v1beta1/delegators/${q(address)}/unbonding_delegations?pagination.limit=50`, {
      timeoutMs: 8_000,
    });
    const out: UnbondingEntry[] = [];
    for (const response of body.unbonding_responses ?? []) {
      const validator = response.validator_address ?? "";
      for (const entry of response.entries ?? []) {
        const completesAt = parseChainTime(entry.completion_time);
        const balance = entry.balance ?? "";
        if (validator && completesAt !== null && /^\d{1,80}$/.test(balance)) out.push({ validator, completesAt, balance });
      }
    }
    return out;
  });
}

/** The staking denom (cached a day: it does not change). */
export function bondDenom(chainId: string): Promise<string> {
  return cached(`push:bond-denom:${chainId}`, { ttlMs: 24 * 3_600_000, errorTtlMs: 5 * 60_000 }, async () => {
    const body = await fetchJson<{ params?: { bond_denom?: string } }>(
      `${restFor(chainId)}/cosmos/staking/v1beta1/params`,
      { timeoutMs: 8_000 },
    );
    const denom = body.params?.bond_denom ?? "";
    if (!/^[a-zA-Z][a-zA-Z0-9/:._-]{1,127}$/.test(denom)) throw new Error(`${chainId}: no bond denom`);
    return denom;
  });
}

/**
 * The chain id at the other end of an IBC channel, from the channel's light
 * client. A channel's counterparty is fixed when it opens, so this is cached
 * for a day.
 */
export function counterpartyChainId(chainId: string, port: string, channel: string): Promise<string | null> {
  return cached(`push:counterparty:${chainId}:${port}:${channel}`, { ttlMs: 24 * 3_600_000, errorTtlMs: 5 * 60_000 }, async () => {
    const body = await fetchJson<{
      identified_client_state?: { client_state?: { chain_id?: string } };
    }>(`${restFor(chainId)}/ibc/core/channel/v1/channels/${q(channel)}/ports/${q(port)}/client_state`, {
      timeoutMs: 8_000,
    });
    const id = body.identified_client_state?.client_state?.chain_id ?? "";
    return /^[a-zA-Z0-9._-]{1,64}$/.test(id) ? id : null;
  });
}
