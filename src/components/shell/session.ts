/**
 * The connected session in a few words, for the account panel and Live: how
 * the wallet is connected, and for Zunia Mobile how the phone link stands and
 * when it ends. The top bar has no phone indicator (Zunia Mobile is one way
 * to connect, like the extensions), so these two surfaces carry it.
 *
 * Pure, so `node --test` covers the wording.
 */

import type { MobileStatus } from "@/lib/connect/mobile";
import { formatDuration } from "@/lib/format";

/**
 * "Connected · ends in 22 h 46 min" while a phone session is live. The relay
 * keeps a session 24 hours and never renews it, so the time left is worth
 * showing; whole minutes only, since the clock behind `now` ticks every 30 s.
 * `now` is null in the server and hydrating renders (no time left then).
 */
export function phoneSessionLine(status: MobileStatus, expiresAt: number | undefined, now: number | null): string {
  if (status === "reconnecting") return "Reconnecting to your phone…";
  if (status !== "connected") return "Phone not connected";
  if (!expiresAt || now === null) return "Connected";
  const left = expiresAt - now;
  if (left < 60_000) return "Connected · ends in under a minute";
  return `Connected · ends in ${formatDuration(Math.round(left / 60_000) * 60)}`;
}

/** "5 networks shared": what the wallet gave an account for. */
export function networksShared(count: number): string {
  return `${count} ${count === 1 ? "network" : "networks"} shared`;
}
