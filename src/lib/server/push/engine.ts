/**
 * The push watcher's passes: chain events in, Web Push notices out (spec §8
 * "Push"). `poller.ts` runs them on a timer with the real chain reads and the
 * real sender; this module takes both as arguments and imports nothing that
 * does I/O, so every rule below is exercised by `__tests__/engine.test.ts`.
 *
 * Fast pass (every ~60 s):
 * - incoming transfers: for each watched (chain, address), an LCD tx search
 *   for `transfer.recipient` above the subscription's last checked height. A
 *   subscription's first look at a chain only records the height (first run
 *   seeds silently: no flood of history);
 * - unbondings whose completion time has passed (from the slow pass's list).
 * Slow pass (every 10 min):
 * - votes entering their last 24 h on chains where the account delegates and
 *   has not voted (prefs.governance);
 * - the unbonding list per account (prefs.unbonding), remembered so a
 *   completion is announced although the chain drops the entry when it
 *   matures;
 * - subscriptions silent for 90 days are dropped.
 *
 * Cost is bounded on purpose, because every unit is a request from this
 * server's IP to a public node: watches are de-duplicated across
 * subscriptions, at most `maxPolls` are searched per fast pass (least recently
 * polled first, so a large set degrades to round-robin, not to starvation),
 * the slow pass walks subscriptions round-robin from where the last one
 * stopped, everything runs with bounded concurrency, and both passes stop
 * starting work at their deadline — the slow pass shares a timer with the
 * fast one, and an unbounded vote check must never hold incoming transfers
 * back. A subscription receives at most `MAX_PUSHES_PER_PASS` pushes per
 * pass; the rest are recorded, not sent.
 *
 * Delivery is at-least-once with ids: everything sent is recorded per
 * subscription (`sentIds`), so overlapping height ranges, two accounts on one
 * chain or a restart never send the same notice twice, and the browser's
 * `tag` collapses whatever slips through. Logs carry chain ids and counts —
 * never an address or an endpoint.
 */

import { noticeId } from "@/lib/notifications/ids";
import { buildPushPayload } from "@/lib/notifications/payload";
import { inQuietHours } from "@/lib/notifications/prefs";
import type { Notice, NoticeKind } from "@/lib/notifications/types";
import type { TokenIdentity } from "@/lib/token/types";
import {
  composeGovernanceEnding,
  composeIncoming,
  composeUnbondingDone,
  formatBaseUnits,
  type NamedCoin,
} from "@/lib/server/push/compose";
import type { UnbondingEntry, VotingProposal } from "@/lib/server/push/lcd";
import type { PushSender } from "@/lib/server/push/send";
import { pollerState, type PollerState } from "@/lib/server/push/status";
import type { PushStore } from "@/lib/server/push/store";
import { hasSent, markSent, PUSH_STORE_LIMITS, type PushRecord } from "@/lib/server/push/subscriptions";
import { readIncoming, type IncomingTransfer } from "@/lib/server/push/tx-parse";

export const ENGINE_LIMITS = {
  fastDeadlineMs: 50_000,
  slowDeadlineMs: 30_000,
  maxPollsPerPass: 240,
  chainConcurrency: 4,
  accountConcurrency: 3,
  /** Subscriptions handled at once (deliveries, slow-pass reads). */
  recordConcurrency: 4,
  /** Re-read a few blocks below the watermark: load-balanced nodes lag each other a little. */
  heightOverlap: 5,
  maxPushesPerPass: 4,
  governanceWindowMs: 24 * 3_600_000,
} as const;

/**
 * How old an event may be and still be pushed. Older ones are recorded, not
 * sent: a transfer from six hours ago means the server was down, and the feed
 * shows it. An unbonding gets a day, because quiet hours defer it (a 22:00–07:00
 * window holds a completion at 23:00 for eight hours, and it must still go out
 * at 07:00). A vote reminder is bounded by the vote's own end instead.
 */
const MAX_EVENT_AGE_MS: Partial<Record<NoticeKind, number>> = {
  transfer: 6 * 3_600_000,
  ibc: 6 * 3_600_000,
  swap: 6 * 3_600_000,
  unbonding: 24 * 3_600_000,
};

/** The chain reads the passes make (`lcd.ts` in production). */
export interface ChainReads {
  latestHeight(chainId: string): Promise<number>;
  searchIncoming(chainId: string, address: string, afterHeight: number): Promise<unknown[]>;
  votingProposals(chainId: string): Promise<VotingProposal[]>;
  hasDelegation(chainId: string, address: string): Promise<boolean>;
  voteStatus(
    chainId: string,
    proposal: Pick<VotingProposal, "id" | "api">,
    address: string,
  ): Promise<"voted" | "not-voted" | "unknown">;
  unbondingEntries(chainId: string, address: string): Promise<UnbondingEntry[]>;
  bondDenom(chainId: string): Promise<string>;
  counterpartyChainId(chainId: string, port: string, channel: string): Promise<string | null>;
}

export interface PushDeps extends ChainReads {
  /** Token naming (`identifyDenoms` in production). */
  identifyDenoms(chainId: string, denoms: readonly string[]): Promise<ReadonlyMap<string, TokenIdentity>>;
  chainName(chainId: string): string;
  send: PushSender;
}

export interface EngineOptions {
  readonly deps: PushDeps;
  readonly store: PushStore;
  readonly now: number;
  readonly deadlineMs?: number;
  /** Process-wide watcher state by default; tests pass `freshPollerState()`. */
  readonly state?: PollerState;
  /** Wall clock for deadlines (tests freeze or advance it). */
  readonly clock?: () => number;
  /**
   * Save the store even when only watermarks moved (default true). The timer
   * saves heights every few passes instead: after a restart a slightly older
   * height only re-reads a few blocks, and `sentIds` (always saved) keep those
   * from being pushed twice.
   */
  readonly saveHeights?: boolean;
}

export interface TransferPassOptions extends EngineOptions {
  readonly maxPolls?: number;
}

export interface SlowPassOptions extends EngineOptions {
  /** How close to its end a vote must be to be pushed (default 24 h). */
  readonly governanceWindowMs?: number;
}

export interface PassReport {
  subscriptions: number;
  watches: number;
  polled: number;
  chains: number;
  seeded: number;
  failedReads: number;
  detected: number;
  pushed: number;
  /** Recorded without a push: quiet hours, too old, over the per-pass budget. */
  suppressed: number;
  /** Subscriptions dropped (gone at the push service, or failing for good). */
  removed: number;
  /** Work left for the next pass: watches over the per-pass cap, or anything past the deadline. */
  deferred: number;
}

export interface SlowPassReport extends PassReport {
  proposalsEnding: number;
  pendingUnbondings: number;
  pruned: number;
}

function emptyReport(): PassReport {
  return {
    subscriptions: 0,
    watches: 0,
    polled: 0,
    chains: 0,
    seeded: 0,
    failedReads: 0,
    detected: 0,
    pushed: 0,
    suppressed: 0,
    removed: 0,
    deferred: 0,
  };
}

function errorText(error: unknown): string {
  return error instanceof Error ? error.message.slice(0, 160) : "unknown error";
}

/**
 * Runs `fn` over `items`, at most `limit` at a time. A local twin of
 * `mapLimit` (lib/server/http), which is server-only and so cannot load in
 * node:test. Unlike it, a task that throws is reported and the others carry
 * on: one rejected task must not reject the pass while its siblings keep
 * mutating records behind a pass that already "ended".
 */
async function eachLimit<T>(
  items: readonly T[],
  limit: number,
  fn: (item: T) => Promise<void>,
  onError: (error: unknown) => void,
): Promise<void> {
  let next = 0;
  const workers = Array.from({ length: Math.max(1, Math.min(limit, items.length)) }, async () => {
    for (;;) {
      const index = next;
      next += 1;
      if (index >= items.length) return;
      try {
        await fn(items[index]);
      } catch (error) {
        onError(error);
      }
    }
  });
  await Promise.all(workers);
}

interface Delivery {
  readonly deps: PushDeps;
  readonly store: PushStore;
  readonly now: number;
  readonly report: PassReport;
  /** Pushes per endpoint in this pass. */
  readonly budget: Map<string, number>;
  /** `endpoint|noticeId` being sent right now: two watches of one browser racing on one event. */
  readonly inflight: Set<string>;
  /** Something other than a watermark changed and must be saved. */
  dirty: boolean;
}

type Delivered = "sent" | "skipped" | "deferred" | "failed" | "removed";

/**
 * Quiet hours, on the user's own clock. A subscription that never said its
 * zone is never quiet: the server's clock is a guess (`inQuietHours` without a
 * zone reads the runtime's local hour, which on a server is not the user's).
 */
function isQuiet(record: PushRecord, now: number): boolean {
  return record.timeZone !== null && inQuietHours(record.prefs.quietHours, now, record.timeZone);
}

/**
 * Pushes `notice` to `record` unless it was already handled. `whenQuiet`
 * decides what quiet hours do: `skip` records it unsent (a transfer: the feed
 * will show it), `defer` leaves it for a later pass (a vote reminder or an
 * unbonding that is still true after quiet hours).
 */
async function deliver(
  record: PushRecord,
  notice: Notice,
  ctx: Delivery,
  urgency: "normal" | "high",
  whenQuiet: "skip" | "defer",
): Promise<Delivered> {
  const key = `${record.endpoint}|${notice.id}`;
  if (hasSent(record, notice.id) || ctx.inflight.has(key) || !ctx.store.get(record.endpoint)) return "skipped";
  const skip = (): Delivered => {
    markSent(record, [notice.id]);
    ctx.dirty = true;
    ctx.report.suppressed += 1;
    return "skipped";
  };
  const maxAge = MAX_EVENT_AGE_MS[notice.kind];
  if (maxAge !== undefined && ctx.now - notice.at > maxAge) return skip();
  if (isQuiet(record, ctx.now)) return whenQuiet === "skip" ? skip() : "deferred";
  const used = ctx.budget.get(record.endpoint) ?? 0;
  if (used >= ENGINE_LIMITS.maxPushesPerPass) return whenQuiet === "skip" ? skip() : "deferred";
  ctx.budget.set(record.endpoint, used + 1);

  ctx.inflight.add(key);
  let outcome: Awaited<ReturnType<PushSender>>;
  try {
    outcome = await ctx.deps.send(record, buildPushPayload(notice), { urgency });
  } catch {
    // The production sender never throws; anything else is a retryable miss.
    outcome = { status: "failed", code: null, retryable: true };
  } finally {
    ctx.inflight.delete(key);
  }
  ctx.dirty = true;
  if (outcome.status === "sent") {
    markSent(record, [notice.id]);
    record.lastPushAt = ctx.now;
    record.failures = 0;
    ctx.report.pushed += 1;
    return "sent";
  }
  if (outcome.status === "gone") {
    ctx.store.remove(record.endpoint);
    ctx.report.removed += 1;
    return "removed";
  }
  record.failures += 1;
  if (record.failures >= PUSH_STORE_LIMITS.maxFailures) {
    ctx.store.remove(record.endpoint);
    ctx.report.removed += 1;
    return "removed";
  }
  // A message the service refused (413, 400) will not work next time either.
  if (!outcome.retryable) markSent(record, [notice.id]);
  return "failed";
}

/**
 * A ticker a push may print. An unlisted local token (`listed: false`, anyone's
 * `factory/<self>/<name>`) gets its symbol from its own denom — text whoever
 * minted it chose — so only listed identities with known decimals qualify.
 */
export function trustedIdentity(identity: TokenIdentity | undefined): identity is TokenIdentity & { decimals: number } {
  return Boolean(
    identity && identity.provenance !== "unknown" && identity.listed !== false && identity.decimals !== null,
  );
}

async function incomingNotice(
  deps: PushDeps,
  chainId: string,
  event: IncomingTransfer,
  now: number,
): Promise<Notice | null> {
  const identities = await deps
    .identifyDenoms(
      chainId,
      event.coins.map((coin) => coin.denom),
    )
    .catch(() => new Map<string, TokenIdentity>());
  const coins: NamedCoin[] = event.coins.map((coin) => {
    const identity = identities.get(coin.denom);
    return trustedIdentity(identity)
      ? { ...coin, ticker: identity.ticker, decimals: identity.decimals }
      : { ...coin, ticker: null, decimals: null };
  });
  let sourceChainName: string | null = null;
  if (event.ibc) {
    const source = await deps.counterpartyChainId(chainId, event.ibc.port, event.ibc.channel).catch(() => null);
    sourceChainName = source ? deps.chainName(source) : null;
  }
  return composeIncoming(
    {
      chainId,
      chainName: deps.chainName(chainId),
      hash: event.hash,
      at: event.at,
      coins,
      senders: event.senders,
      ibc: event.ibc ? { sourceChainName, sender: event.ibc.sender } : null,
      refund: event.refund,
    },
    now,
  );
}

/** Pushes unbondings whose completion time has passed (no chain read needed). */
async function deliverDueUnbondings(record: PushRecord, ctx: Delivery): Promise<void> {
  if (!record.prefs.unbonding) {
    if (record.pendingUnbondings.length > 0) {
      record.pendingUnbondings = [];
      ctx.dirty = true;
    }
    return;
  }
  for (const entry of [...record.pendingUnbondings]) {
    if (entry.completesAt > ctx.now) continue;
    const forget = () => {
      record.pendingUnbondings = record.pendingUnbondings.filter((row) => row.id !== entry.id);
      ctx.dirty = true;
    };
    // Completed before this browser subscribed: history, not news.
    if (entry.completesAt <= record.createdAt) {
      forget();
      continue;
    }
    const notice = composeUnbondingDone({
      id: entry.id,
      chainId: entry.chainId,
      chainName: ctx.deps.chainName(entry.chainId),
      completesAt: entry.completesAt,
      text: entry.text,
    });
    const result = await deliver(record, notice, ctx, "normal", "defer");
    if (result === "sent" || result === "skipped") forget();
  }
}

interface Watch {
  readonly key: string;
  readonly chainId: string;
  readonly address: string;
  readonly records: PushRecord[];
}

function context(options: EngineOptions, report: PassReport): Delivery {
  return {
    deps: options.deps,
    store: options.store,
    now: options.now,
    report,
    budget: new Map(),
    inflight: new Set(),
    dirty: false,
  };
}

/** Incoming transfers (and due unbondings), for every subscription. */
export async function runTransferPass(options: TransferPassOptions): Promise<PassReport> {
  const { deps, store, now } = options;
  const clock = options.clock ?? Date.now;
  const state = options.state ?? pollerState();
  const report = emptyReport();
  const ctx = context(options, report);
  const deadline = clock() + (options.deadlineMs ?? ENGINE_LIMITS.fastDeadlineMs);
  const onError = (error: unknown) => {
    report.failedReads += 1;
    console.warn(`[push] transfer pass task failed (${errorText(error)})`);
  };
  const records = store.all();
  report.subscriptions = records.length;

  await eachLimit(records, ENGINE_LIMITS.recordConcurrency, (record) => deliverDueUnbondings(record, ctx), onError);

  const watches = new Map<string, Watch>();
  for (const record of records) {
    if (!record.prefs.transfers) {
      // Re-enabling later starts from that moment, not from a stale height.
      if (Object.keys(record.lastHeights).length > 0) {
        record.lastHeights = {};
        ctx.dirty = true;
      }
      continue;
    }
    for (const account of record.accounts) {
      const key = `${account.chainId}|${account.address}`;
      let watch = watches.get(key);
      if (!watch) {
        watch = { key, chainId: account.chainId, address: account.address, records: [] };
        watches.set(key, watch);
      }
      watch.records.push(record);
    }
  }
  report.watches = watches.size;
  // Forget the poll times of watches nobody holds any more (the map would
  // otherwise grow with every subscription that ever existed).
  for (const key of state.lastPolled.keys()) if (!watches.has(key)) state.lastPolled.delete(key);

  const chosen = [...watches.values()]
    .sort((a, b) => (state.lastPolled.get(a.key) ?? 0) - (state.lastPolled.get(b.key) ?? 0))
    .slice(0, options.maxPolls ?? ENGINE_LIMITS.maxPollsPerPass);
  report.deferred += watches.size - chosen.length;
  const byChain = new Map<string, Watch[]>();
  for (const watch of chosen) byChain.set(watch.chainId, [...(byChain.get(watch.chainId) ?? []), watch]);
  report.chains = byChain.size;

  const heights = new Map<string, number>();
  const searched = new Set<string>();
  /** `endpoint|chainId` pairs whose delivery failed and must be retried: watermark held. */
  const hold = new Set<string>();

  await eachLimit(
    [...byChain],
    ENGINE_LIMITS.chainConcurrency,
    async ([chainId, list]) => {
      let height: number;
      try {
        height = await deps.latestHeight(chainId);
      } catch (error) {
        report.failedReads += 1;
        console.warn(`[push] ${chainId}: height read failed (${errorText(error)})`);
        return;
      }
      heights.set(chainId, height);
      await eachLimit(
        list,
        ENGINE_LIMITS.accountConcurrency,
        async (watch) => {
          if (clock() > deadline) {
            report.deferred += 1;
            return;
          }
          state.lastPolled.set(watch.key, now);
          report.polled += 1;
          const active = watch.records.filter((record) => record.lastHeights[chainId] !== undefined);
          if (active.length === 0) {
            searched.add(watch.key);
            return;
          }
          const from =
            Math.min(...active.map((record) => record.lastHeights[chainId])) - ENGINE_LIMITS.heightOverlap;
          let rows: unknown[];
          try {
            rows = await deps.searchIncoming(chainId, watch.address, from);
          } catch (error) {
            report.failedReads += 1;
            console.warn(`[push] ${chainId}: transfer search failed (${errorText(error)})`);
            return;
          }
          searched.add(watch.key);
          const events = rows
            .map((row) => readIncoming(row, watch.address))
            .filter((event): event is IncomingTransfer => event !== null)
            .sort((a, b) => a.height - b.height);
          for (const event of events) {
            const fresh = active.filter(
              (record) =>
                event.height > record.lastHeights[chainId] - ENGINE_LIMITS.heightOverlap &&
                !hasSent(record, noticeId.transfer(event.hash)),
            );
            if (fresh.length === 0) continue;
            report.detected += 1;
            const notice = await incomingNotice(deps, chainId, event, now);
            for (const record of fresh) {
              if (!notice) {
                markSent(record, [noticeId.transfer(event.hash)]);
                ctx.dirty = true;
                continue;
              }
              const result = await deliver(record, notice, ctx, "high", "skip");
              if (result === "failed") hold.add(`${record.endpoint}|${chainId}`);
            }
          }
        },
        onError,
      );
    },
    onError,
  );

  // Advance each subscription's height per chain, only when every one of its
  // accounts on that chain was read this pass (and nothing waits for a retry).
  let heightsMoved = false;
  for (const record of records) {
    if (!record.prefs.transfers || !store.get(record.endpoint)) continue;
    for (const chainId of new Set(record.accounts.map((account) => account.chainId))) {
      const height = heights.get(chainId);
      if (height === undefined || hold.has(`${record.endpoint}|${chainId}`)) continue;
      const complete = record.accounts
        .filter((account) => account.chainId === chainId)
        .every((account) => searched.has(`${chainId}|${account.address}`));
      if (!complete) continue;
      const previous = record.lastHeights[chainId];
      if (previous === undefined) {
        report.seeded += 1;
        // A new watch's starting point is worth saving at once.
        ctx.dirty = true;
      }
      const next = Math.max(previous ?? 0, height);
      if (next !== previous) heightsMoved = true;
      record.lastHeights[chainId] = next;
    }
  }
  if (ctx.dirty || (heightsMoved && options.saveHeights !== false)) store.touch();
  return report;
}

async function unbondingText(deps: PushDeps, chainId: string, balance: string): Promise<string> {
  try {
    const denom = await deps.bondDenom(chainId);
    const identity = (await deps.identifyDenoms(chainId, [denom])).get(denom);
    return trustedIdentity(identity) ? `${formatBaseUnits(balance, identity.decimals)} ${identity.ticker}` : "";
  } catch {
    return "";
  }
}

/** One subscription's slow work: its vote reminders, then its unbonding list. */
async function slowRecord(
  record: PushRecord,
  ctx: Delivery,
  ending: ReadonlyMap<string, readonly VotingProposal[]>,
): Promise<void> {
  const { deps, now, report } = ctx;
  // Accounts of one subscription run one after another: they share its
  // `sentIds` and `pendingUnbondings`, which must not be raced.
  if (record.prefs.governance) {
    for (const account of record.accounts) {
      const list = (ending.get(account.chainId) ?? []).filter(
        (proposal) => !hasSent(record, noticeId.governanceEnding(account.chainId, proposal.id)),
      );
      if (list.length === 0) continue;
      const delegates = await deps.hasDelegation(account.chainId, account.address).catch(() => null);
      if (delegates !== true) continue;
      for (const proposal of list) {
        const status = await deps
          .voteStatus(account.chainId, proposal, account.address)
          .catch(() => "unknown" as const);
        // Unknown is never pushed as "you haven't voted".
        if (status !== "not-voted") continue;
        await deliver(
          record,
          composeGovernanceEnding({
            chainId: account.chainId,
            chainName: deps.chainName(account.chainId),
            proposalId: proposal.id,
            title: proposal.title,
            endsAt: proposal.votingEndTime,
            now,
          }),
          ctx,
          "normal",
          "defer",
        );
      }
    }
  }

  if (record.prefs.unbonding) {
    for (const account of record.accounts) {
      let entries: UnbondingEntry[];
      try {
        entries = await deps.unbondingEntries(account.chainId, account.address);
      } catch (error) {
        report.failedReads += 1;
        console.warn(`[push] ${account.chainId}: unbonding read failed (${errorText(error)})`);
        continue;
      }
      const listed = new Set<string>();
      for (const entry of entries) {
        const id = noticeId.unbonding(account.chainId, entry.validator, entry.completesAt);
        listed.add(id);
        if (record.pendingUnbondings.some((row) => row.id === id) || hasSent(record, id)) continue;
        if (record.pendingUnbondings.length >= PUSH_STORE_LIMITS.pendingUnbondings) break;
        // Read the words first, then append: `record.pendingUnbondings.push(…await…)`
        // would push into whichever array was current *before* the await.
        const text = await unbondingText(deps, account.chainId, entry.balance);
        record.pendingUnbondings = [
          ...record.pendingUnbondings,
          { id, chainId: account.chainId, address: account.address, completesAt: entry.completesAt, text },
        ];
        ctx.dirty = true;
      }
      // Gone from the list before its time: cancelled. Gone after: completed
      // (kept, the fast pass announces it).
      const kept = record.pendingUnbondings.filter(
        (row) =>
          row.chainId !== account.chainId ||
          row.address !== account.address ||
          listed.has(row.id) ||
          row.completesAt <= now,
      );
      if (kept.length !== record.pendingUnbondings.length) {
        record.pendingUnbondings = kept;
        ctx.dirty = true;
      }
    }
  }
  await deliverDueUnbondings(record, ctx);
}

/** Votes ending soon, the unbonding lists, and housekeeping. */
export async function runSlowPass(options: SlowPassOptions): Promise<SlowPassReport> {
  const { deps, store, now } = options;
  const clock = options.clock ?? Date.now;
  const state = options.state ?? pollerState();
  const report: SlowPassReport = { ...emptyReport(), proposalsEnding: 0, pendingUnbondings: 0, pruned: 0 };
  const ctx = context(options, report);
  const deadline = clock() + (options.deadlineMs ?? ENGINE_LIMITS.slowDeadlineMs);
  const windowMs = options.governanceWindowMs ?? ENGINE_LIMITS.governanceWindowMs;
  const onError = (error: unknown) => {
    report.failedReads += 1;
    console.warn(`[push] slow pass task failed (${errorText(error)})`);
  };
  report.pruned = store.prune(now);
  const records = store.all().filter((record) => record.prefs.governance || record.prefs.unbonding);
  report.subscriptions = records.length;

  // Governance: one proposals read per chain, shared by every subscriber.
  const chains = [
    ...new Set(
      records
        .filter((record) => record.prefs.governance)
        .flatMap((record) => record.accounts.map((account) => account.chainId)),
    ),
  ];
  const ending = new Map<string, VotingProposal[]>();
  await eachLimit(
    chains,
    ENGINE_LIMITS.chainConcurrency,
    async (chainId) => {
      try {
        const list = (await deps.votingProposals(chainId)).filter(
          (proposal) => proposal.votingEndTime > now && proposal.votingEndTime - now <= windowMs,
        );
        ending.set(chainId, list);
        report.proposalsEnding += list.length;
      } catch (error) {
        report.failedReads += 1;
        console.warn(`[push] ${chainId}: proposals read failed (${errorText(error)})`);
      }
    },
    onError,
  );

  // Round-robin from where the last pass stopped, so a deadline delays the
  // tail of the list by one pass instead of starving it.
  const start = records.length > 0 ? state.slowCursor % records.length : 0;
  const ordered = [...records.slice(start), ...records.slice(0, start)];
  let handled = 0;
  await eachLimit(
    ordered,
    ENGINE_LIMITS.recordConcurrency,
    async (record) => {
      if (clock() > deadline) {
        report.deferred += 1;
        return;
      }
      handled += 1;
      await slowRecord(record, ctx, ending);
    },
    onError,
  );
  state.slowCursor = records.length > 0 ? (start + handled) % records.length : 0;
  for (const record of records) report.pendingUnbondings += record.pendingUnbondings.length;
  if (ctx.dirty) store.touch();
  return report;
}
