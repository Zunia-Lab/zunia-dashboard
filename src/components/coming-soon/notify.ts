/**
 * The "Notify me" flag of a coming-soon page.
 *
 * A local promise, stored on this device only (`zunia.dashboard.notify.<id>`):
 * the server keeps no list of who asked, so the flag is all there is, and the
 * page says so. Pure, so the shape rules are tested.
 */

export type ComingSoonId = "missions" | "apps";

export interface NotifyFlag {
  /** ISO time the visitor asked. */
  at: string;
}

export function notifyKey(id: ComingSoonId): string {
  return `zunia.dashboard.notify.${id}`;
}

/** A stored value, or null when it is absent or not a flag this page wrote. */
export function readNotifyFlag(value: unknown): NotifyFlag | null {
  if (!value || typeof value !== "object") return null;
  const at = (value as { at?: unknown }).at;
  if (typeof at !== "string" || !Number.isFinite(Date.parse(at))) return null;
  return { at };
}

export function newNotifyFlag(now: Date = new Date()): NotifyFlag {
  return { at: now.toISOString() };
}
