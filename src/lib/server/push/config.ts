/**
 * VAPID configuration, read from the environment at request time.
 *
 * The public key is served by `/api/push/config` instead of being inlined as
 * `NEXT_PUBLIC_VAPID_PUBLIC_KEY`: an inlined key needs a rebuild to change and
 * the production bundle shipped without it (prod-readiness §2.3). Reading at
 * runtime means setting the three variables and restarting is all it takes.
 *
 * Keys are checked for shape (a 65-byte P-256 point and a 32-byte scalar,
 * base64url) so a pasted-with-quotes or truncated key reads as "not
 * configured" with an operator log line, instead of every send failing.
 * Values are never logged.
 */

import "server-only";
import { decodeBase64Url, isP256PublicKey } from "@/lib/server/push/validate";

export interface VapidConfig {
  readonly publicKey: string;
  readonly privateKey: string;
  readonly subject: string;
}

/** What users are told when push is off. Never an env variable name. */
export const PUSH_DISABLED_REASON = "Push is not configured on this server";

const DEFAULT_SUBJECT = "mailto:security@zunialab.com";
const WARNED_KEY = "__zuniaPushConfigWarned";

function warnOnce(message: string): void {
  const g = globalThis as unknown as Record<string, boolean | undefined>;
  if (g[WARNED_KEY]) return;
  g[WARNED_KEY] = true;
  console.warn(`[push] ${message}`);
}

/** The VAPID details, or null when push is not (correctly) configured. */
export function readVapidConfig(): VapidConfig | null {
  const publicKey = process.env.VAPID_PUBLIC_KEY?.trim() ?? "";
  const privateKey = process.env.VAPID_PRIVATE_KEY?.trim() ?? "";
  if (!publicKey && !privateKey) return null;
  if (!isP256PublicKey(publicKey) || decodeBase64Url(privateKey)?.length !== 32) {
    warnOnce("VAPID keys are set but malformed (expected base64url P-256 keys); push stays off");
    return null;
  }
  const subject = process.env.VAPID_SUBJECT?.trim() || DEFAULT_SUBJECT;
  if (!/^mailto:[^\s@]+@[^\s@]+$/.test(subject) && !/^https:\/\/\S+$/.test(subject)) {
    warnOnce("VAPID subject must be a mailto: or https: URL; push stays off");
    return null;
  }
  return { publicKey, privateKey, subject };
}

/** True when the background watcher may run in this process. */
export function pollerEnabled(): boolean {
  return process.env.ZUNIA_PUSH_POLLER !== "off" && readVapidConfig() !== null;
}
