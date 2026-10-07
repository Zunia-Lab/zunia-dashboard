/**
 * The push subscription store: an in-memory index backed by one JSON file at
 * `$ZUNIA_DASHBOARD_DATA_DIR/push-subscriptions.json` (default `.data/` in the
 * working directory — the deployment must keep that directory on persistent
 * disk, out of git, readable by the service user only).
 *
 * Production is one long-lived Node process (spec §8), and the route handlers
 * and the poller started from `instrumentation.ts` run in it — but Next builds
 * them as separate module graphs, each with its own copy of this module. The
 * index therefore lives on `globalThis`, so a subscription posted to a route
 * is the one the poller sees, and a dev-server reload does not drop it.
 */

import "server-only";
import { join, resolve } from "node:path";
import { JsonFile } from "@/lib/server/push/file-store";
import {
  parseStoreFile,
  pruneStale,
  serializeStore,
  upsertRecord,
  type PushRecord,
  type UpsertResult,
} from "@/lib/server/push/subscriptions";
import type { SubscribeRequest } from "@/lib/server/push/validate";

const GLOBAL_KEY = "__zuniaPushStore";
const FILE_NAME = "push-subscriptions.json";

interface StoreGlobal {
  records: Map<string, PushRecord>;
  file: JsonFile;
  ready: Promise<void> | null;
  exitHook: boolean;
}

/**
 * Where the push records live: `ZUNIA_DASHBOARD_DATA_DIR`, else `.data/` in
 * the working directory.
 *
 * Written so the bundler can see the path is data, not code: a bare
 * `resolve(variable)` made Turbopack's file tracer give up and trace the whole
 * project into the push routes' and instrumentation's server bundles (760
 * files where /api/markets has 127). The default is a fixed subfolder of the
 * working directory, which the tracer scopes; the operator's directory is
 * runtime configuration and is marked to be ignored.
 */
export function pushDataDir(): string {
  const configured = process.env.ZUNIA_DASHBOARD_DATA_DIR?.trim();
  if (configured) return resolve(/* turbopackIgnore: true */ configured);
  return join(process.cwd(), ".data");
}

function globalStore(): StoreGlobal {
  const g = globalThis as unknown as Record<string, StoreGlobal | undefined>;
  let store = g[GLOBAL_KEY];
  if (!store) {
    store = {
      records: new Map(),
      file: new JsonFile(join(pushDataDir(), FILE_NAME), {
        debounceMs: 2_000,
        // The message only: never the path contents, never an endpoint.
        onError: (error) =>
          console.warn(`[push] store write failed: ${error instanceof Error ? error.message : "unknown error"}`),
      }),
      ready: null,
      exitHook: false,
    };
    g[GLOBAL_KEY] = store;
  }
  return store;
}

export interface PushStore {
  size(): number;
  all(): PushRecord[];
  get(endpoint: string): PushRecord | undefined;
  upsert(request: SubscribeRequest, now: number): UpsertResult;
  remove(endpoint: string): boolean;
  /** Marks the store changed (after mutating records in place); saved shortly. */
  touch(): void;
  prune(now: number): number;
  flush(): Promise<void>;
}

function api(store: StoreGlobal): PushStore {
  const save = () => store.file.schedule(() => serializeStore(store.records, Date.now()));
  return {
    size: () => store.records.size,
    all: () => [...store.records.values()],
    get: (endpoint) => store.records.get(endpoint),
    upsert(request, now) {
      const result = upsertRecord(store.records, request, now);
      if (result.ok) save();
      return result;
    },
    remove(endpoint) {
      const removed = store.records.delete(endpoint);
      if (removed) save();
      return removed;
    },
    touch: save,
    prune(now) {
      const removed = pruneStale(store.records, now);
      if (removed > 0) save();
      return removed;
    },
    flush: () => store.file.flush(),
  };
}

/** The loaded store. The first call reads the file; later calls share that read. */
export async function loadPushStore(): Promise<PushStore> {
  const store = globalStore();
  store.ready ??= (async () => {
    const raw = await store.file.read();
    const loaded = parseStoreFile(raw);
    // Anything posted while the file was being read wins over the file.
    for (const [endpoint, record] of loaded) {
      if (!store.records.has(endpoint)) store.records.set(endpoint, record);
    }
    if (!store.exitHook) {
      store.exitHook = true;
      // Async work never completes during `exit`; the sync save is the only
      // one that lands, and it keeps sent ids from replaying after a restart.
      process.once("exit", () => {
        try {
          store.file.flushSync();
        } catch {
          /* nothing left to report to */
        }
      });
    }
  })().catch((error: unknown) => {
    store.ready = null;
    throw error;
  });
  await store.ready;
  return api(store);
}
