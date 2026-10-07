/**
 * The few words every transfer surface repeats: a chain's name from its id,
 * and the "since Sep 22" that says how far back a history-backed figure
 * reaches. One spelling for Send, Bridge, Receive and their cards.
 */

import { chainById } from "@/components/ui";
import { formatDate } from "@/lib/format";

/** The catalog name, the id itself for a chain the catalog lacks, `unknown` without an id. */
export function chainName(chainId: string | null | undefined, unknown = "—"): string {
  if (!chainId) return unknown;
  return chainById(chainId)?.chainName ?? chainId;
}

/** "since Sep 22" (the oldest loaded row), or null when nothing is loaded. */
export function sinceText(oldest: number | null | undefined): string | null {
  return typeof oldest === "number" && Number.isFinite(oldest) ? `since ${formatDate(oldest, "short")}` : null;
}
