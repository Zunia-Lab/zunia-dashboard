"use client";

/**
 * Activity for the current scope, newest first, with "load more".
 *
 * Accounts: one per scoped chain (or `chains`), the wallet's own address for
 * that chain (`addressFor`: the key the wallet gave, else a same-key-scheme
 * re-encoding, else unknown). A chain the wallet cannot name an address for
 * (an Ethereum-key chain with no key shared yet) is listed in
 * `unavailableChains`, never read with a guessed address.
 *
 * Paging: the first page is a `useApi` read (shared, polled every 60 s, kept
 * on screen while a new scope loads); further pages follow `nextCursor`. When
 * the first page refreshes, rows it pushed down are kept from the page the
 * user already saw, so polling never opens a gap above the loaded pages.
 *
 * Date ranges (`since`): rows older than `since` are left out, and older
 * pages are loaded on their own (at most `maxPages`) until the list is
 * complete back to `since`, so a "30D" view counts thirty days, not whatever
 * the first page held. `reachedSince` says whether it got there.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { loadedExtent, mergeLoaded, shouldAutoLoad } from "@/lib/activity/paging";
import {
  ACTIVITY_DEFAULT_LIMIT,
  ACTIVITY_MAX_ACCOUNTS,
  ACTIVITY_MAX_LIMIT,
  activityUrl,
  parseActivityPage,
  parseTxDetailBody,
  txUrl,
  type ActivityCoverage,
  type ActivityError,
  type ActivityItem,
  type ActivityKind,
  type ActivityPage,
  type TxDetail,
} from "@/lib/data/activity";
import { networkError, parseError, readApiError, shapeError } from "@/lib/api-error";
import { useApi, type ApiError, type ApiStatus } from "@/lib/useApi";
import { useChainScope } from "@/lib/useChainScope";
import { useWallet } from "@/providers/WalletProvider";

/**
 * @deprecated The old row type, whose `kind` was free text ("sent", "ibc"…).
 * Every `ActivityItem` is one; new code reads `ActivityItem` and its kinds.
 */
export type ActivityTx = Omit<ActivityItem, "kind"> & { kind?: string };

export interface ActivityAccountRef {
  chainId: string;
  address: string;
}

export interface UseActivityOptions {
  /** Only these kinds (filtered server-side; prefer filtering loaded rows for chips). */
  kinds?: readonly ActivityKind[];
  /** Chains to read; defaults to the chain scope. */
  chains?: readonly string[];
  /** Rows per page, 1–100 (default 50). */
  pageSize?: number;
  /** Poll interval for the first page (default 60 s). */
  refreshMs?: number;
  /**
   * Epoch ms: only rows at or after it, and older pages are loaded on their
   * own until the list is complete back to it (bounded by `maxPages`). Pass a
   * stable value (a preset's start rounded to the minute), not `Date.now()`
   * of every render.
   */
  since?: number | null;
  /** Pages loaded on their own for `since`, after the first (default 10). */
  maxPages?: number;
}

export interface UseActivityResult {
  /** Every loaded row (at or after `since`), newest first, one per account and transaction. */
  items: ActivityItem[];
  /** How far back each account's list is complete (from the deepest page loaded). */
  coverage: ActivityCoverage[];
  /** Chains that failed in the latest reads (partial data is still shown). */
  errors: ActivityError[];
  status: ApiStatus;
  /** First load, nothing to show yet. */
  loading: boolean;
  /** The first page is refreshing behind rows already on screen. */
  refreshing: boolean;
  /** The rows on screen belong to the previous scope or filter while the new one loads. */
  stale: boolean;
  loadingMore: boolean;
  hasMore: boolean;
  loadMore: () => void;
  /**
   * ISO time the loaded list is complete down to (older rows may exist:
   * `hasMore`); null when everything the nodes keep is loaded.
   */
  loadedUntil: string | null;
  /** With `since`: the loaded list is complete back to it (always true without `since`). */
  reachedSince: boolean;
  /**
   * With `since`: older pages are being loaded on their own to complete the
   * range (counts over it are still growing). Lets a page say "loading" rather
   * than "not loaded" while it walks back.
   */
  autoLoading: boolean;
  /**
   * With `since`: the page budget (`maxPages`) is spent and the range is still
   * not complete; older rows exist and "Load more" is the user's call.
   */
  autoLoadLimitReached: boolean;
  /** The first page's error, else the last "load more" error. */
  error: ApiError | null;
  /** Re-reads from the newest page, dropping loaded older pages. */
  refetch: () => void;
  connected: boolean;
  /** What is being read. */
  accounts: ActivityAccountRef[];
  /** Scoped chains with no address for this wallet. */
  unavailableChains: string[];
  /** Scoped chains beyond the per-request account cap (24). */
  truncated: string[];
  /** @deprecated Chains whose history failed (`errors` scope `history`). */
  failedChains: string[];
  /** @deprecated Same as `unavailableChains`. */
  skipped: string[];
  /** @deprecated Always false: activity is never sample data any more. */
  sample: boolean;
}

/** @deprecated Kept for pages written against the old hook. */
export type ActivityResult = UseActivityResult;

interface Accounts {
  accounts: ActivityAccountRef[];
  unavailable: string[];
  truncated: string[];
}

/** The wallet's address per chain (see the module comment). */
function useActivityAccounts(chainIds: readonly string[]): Accounts {
  const { account, addressFor } = useWallet();
  const key = chainIds.join(",");
  return useMemo(() => {
    const out: Accounts = { accounts: [], unavailable: [], truncated: [] };
    if (!account) return out;
    for (const chainId of key ? key.split(",") : []) {
      const address = addressFor(chainId) ?? (chainId === account.chainId ? account.address : null);
      if (!address) {
        out.unavailable.push(chainId);
      } else if (out.accounts.length >= ACTIVITY_MAX_ACCOUNTS) {
        out.truncated.push(chainId);
      } else {
        out.accounts.push({ chainId, address });
      }
    }
    return out;
  }, [account, addressFor, key]);
}

interface MoreState {
  /** The first-page URL these pages continue. */
  key: string | null;
  /** First-page rows at the moment the first older page was asked for. */
  anchor: ActivityItem[];
  pages: ActivityPage[];
  loading: boolean;
  error: ApiError | null;
}

const NO_MORE: MoreState = { key: null, anchor: [], pages: [], loading: false, error: null };
const DEFAULT_MAX_PAGES = 10;

export function useActivity(options: UseActivityOptions = {}): UseActivityResult {
  const { account } = useWallet();
  const { scopedChainIds } = useChainScope();
  const chainIds = options.chains ?? scopedChainIds;
  const { accounts, unavailable, truncated } = useActivityAccounts(chainIds);
  const pageSize = Math.min(Math.max(Math.floor(options.pageSize ?? ACTIVITY_DEFAULT_LIMIT), 1), ACTIVITY_MAX_LIMIT);
  const kindsKey = options.kinds ? [...new Set(options.kinds)].sort().join(",") : "";
  const since = typeof options.since === "number" && Number.isFinite(options.since) ? options.since : null;
  const maxPages = Math.max(0, Math.floor(options.maxPages ?? DEFAULT_MAX_PAGES));

  const firstUrl = useMemo(
    () =>
      accounts.length > 0
        ? activityUrl({ accounts, limit: pageSize, kinds: kindsKey ? (kindsKey.split(",") as ActivityKind[]) : undefined })
        : null,
    [accounts, pageSize, kindsKey],
  );

  const first = useApi<ActivityPage>(firstUrl, {
    parse: parseActivityPage,
    refreshMs: options.refreshMs ?? 60_000,
    keepPreviousData: true,
  });

  const [more, setMore] = useState<MoreState>(NO_MORE);
  const inflight = useRef<string | null>(null);
  // Pages belong to one first-page URL; a new scope or filter starts over.
  const current = more.key === firstUrl ? more : NO_MORE;
  const lastPage = current.pages.length > 0 ? current.pages[current.pages.length - 1] : first.stale ? null : first.data;
  const nextCursor = lastPage?.nextCursor ?? null;

  const loadMore = useCallback(() => {
    if (!firstUrl || !first.data || first.stale || !nextCursor || inflight.current === nextCursor) return;
    const cursor = nextCursor;
    const key = firstUrl;
    const anchor = first.data.items;
    inflight.current = cursor;
    setMore((prev) => {
      const same = prev.key === key;
      return {
        key,
        anchor: same && prev.pages.length > 0 ? prev.anchor : anchor,
        pages: same ? prev.pages : [],
        loading: true,
        error: null,
      };
    });
    const url = activityUrl({
      accounts,
      limit: pageSize,
      kinds: kindsKey ? (kindsKey.split(",") as ActivityKind[]) : undefined,
      cursor,
    });
    void (async () => {
      let page: ActivityPage | null = null;
      let error: ApiError | null = null;
      try {
        const response = await fetch(url, { headers: { accept: "application/json" } });
        if (!response.ok) error = await readApiError(response);
        else page = parseActivityPage(await response.json());
        if (!error && !page) error = shapeError();
      } catch (err) {
        error = err instanceof SyntaxError ? parseError(err) : networkError(err);
      } finally {
        if (inflight.current === cursor) inflight.current = null;
      }
      setMore((prev) => {
        if (prev.key !== key) return prev;
        return page ? { ...prev, pages: [...prev.pages, page], loading: false } : { ...prev, loading: false, error };
      });
    })();
  }, [accounts, first.data, first.stale, firstUrl, kindsKey, nextCursor, pageSize]);

  const { refetch: refetchFirst } = first;
  const refetch = useCallback(() => {
    inflight.current = null;
    setMore(NO_MORE);
    refetchFirst();
  }, [refetchFirst]);

  // While a new scope loads, `first.data` is the previous scope's page
  // (keepPreviousData, flagged by `stale`); older pages were reset.
  const allItems = useMemo(
    () => mergeLoaded(first.data, current.anchor, current.pages),
    [first.data, current.anchor, current.pages],
  );

  const items = useMemo(
    () => (since === null ? allItems : allItems.filter((item) => Date.parse(item.time) >= since)),
    [allItems, since],
  );

  const { loadedUntil, reachedSince } = loadedExtent(lastPage, allItems, since);

  // Date ranges: walk older pages until the range is complete, a page fails,
  // or the page budget is spent (then "Load more" is the user's call).
  const autoLoad = shouldAutoLoad({
    since,
    reachedSince,
    loading: current.loading,
    failed: current.error !== null,
    pagesLoaded: current.pages.length,
    maxPages,
    nextCursor,
    stale: first.stale,
  });
  useEffect(() => {
    if (autoLoad) loadMore();
  }, [autoLoad, loadMore]);
  const walking = since !== null && !reachedSince && !first.stale && nextCursor !== null;
  const autoLoading = walking && (autoLoad || (current.loading && current.pages.length < maxPages));
  const autoLoadLimitReached = walking && !current.loading && current.error === null && current.pages.length >= maxPages;

  const coverage = lastPage?.coverage ?? first.data?.coverage ?? [];
  const errors = useMemo(() => {
    const seen = new Set<string>();
    const out: ActivityError[] = [];
    for (const error of [...(first.data?.errors ?? []), ...(lastPage?.errors ?? [])]) {
      const key = `${error.chainId ?? ""}|${error.scope}`;
      if (seen.has(key)) continue;
      seen.add(key);
      out.push(error);
    }
    return out;
  }, [first.data, lastPage]);

  return {
    items,
    coverage,
    errors,
    status: first.status,
    loading: first.loading,
    refreshing: first.refreshing,
    stale: first.stale,
    loadingMore: current.loading,
    hasMore: nextCursor !== null,
    loadMore,
    loadedUntil,
    reachedSince,
    autoLoading,
    autoLoadLimitReached,
    error: first.error ?? current.error,
    refetch,
    connected: Boolean(account),
    accounts,
    unavailableChains: unavailable,
    truncated,
    failedChains: errors.filter((error) => error.scope === "history" && error.chainId).map((error) => error.chainId as string),
    skipped: unavailable,
    sample: false,
  };
}

export interface UseTxResult {
  tx: TxDetail | null;
  status: ApiStatus;
  loading: boolean;
  refreshing: boolean;
  error: ApiError | null;
  /** The node does not have the hash (yet): poll, or say it may be pruned. */
  notFound: boolean;
  refetch: () => void;
}

/**
 * One transaction, decoded. With `address` the answer includes that account's
 * row (`tx.forAddress`). Pass `refreshMs` to poll a just-broadcast hash until
 * the node has it.
 */
export function useTx(
  chainId: string | null | undefined,
  hash: string | null | undefined,
  options: { address?: string | null; refreshMs?: number } = {},
): UseTxResult {
  const url = chainId && hash ? txUrl(chainId, hash, options.address) : null;
  const state = useApi<TxDetail>(url, { parse: parseTxDetailBody, refreshMs: options.refreshMs });
  return {
    tx: state.data,
    status: state.status,
    loading: state.loading,
    refreshing: state.refreshing,
    error: state.error,
    notFound: state.data === null && state.error?.status === 404,
    refetch: state.refetch,
  };
}
