/**
 * GET /api/push/config — whether this server can send Web Push, and the VAPID
 * public key the browser subscribes with.
 *
 * Read at request time (`connection()`), never inlined at build: setting the
 * keys and restarting is enough, no rebuild (the production bundle once
 * shipped without its build-time key and push failed with an env-variable
 * name on screen). When the keys are absent the answer says so in words a
 * user can read, and the UI shows push as unavailable rather than pretending.
 *
 * `watching` tells the UI whether the background watcher runs in this
 * process: with it off, a test push still works but no chain event will
 * produce one, and the settings screen should say that.
 */

import { connection } from "next/server";
import { PUSH_DISABLED_REASON, readVapidConfig } from "@/lib/server/push/config";
import { watcherStatus } from "@/lib/server/push/status";
import { publicJson } from "@/lib/server/respond";

export const runtime = "nodejs";

export interface PushConfigResponse {
  enabled: boolean;
  publicKey: string | null;
  /** Why push is off, for users. Present only when `enabled` is false. */
  reason?: string;
  /** The chain watcher runs in this server process. */
  watching: boolean;
  updatedAt: number;
}

export async function GET(): Promise<Response> {
  await connection();
  const vapid = readVapidConfig();
  const body: PushConfigResponse = vapid
    ? { enabled: true, publicKey: vapid.publicKey, watching: watcherStatus().watching, updatedAt: Date.now() }
    : { enabled: false, publicKey: null, reason: PUSH_DISABLED_REASON, watching: false, updatedAt: Date.now() };
  // Short: a key added or rotated on the server shows up within a minute.
  return publicJson(body, { maxAge: 60, sMaxAge: 60, swr: 60 });
}
