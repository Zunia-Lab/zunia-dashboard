/**
 * Validation for the push routes' request bodies. Pure (no I/O, no secrets),
 * so it is tested directly; the catalog lookup is passed in.
 *
 * What a subscription is allowed to contain, and why:
 *
 * - **endpoint**: https on a known browser push service only. The server POSTs
 *   to this URL from its own IP on every notification; accepting any URL
 *   would make the push sender a request-forgery tool aimed at internal
 *   services or a third party.
 * - **keys**: a P-256 public point (65 bytes) and a 16-byte auth secret, the
 *   RFC 8291 shapes; anything else cannot be encrypted to anyway.
 * - **accounts**: catalog chains only, bech32 addresses of that chain's
 *   prefix, at most 32 — every account is a recurring LCD poll paid by the
 *   server.
 * - **prefs**: the shared `parseNotifyPrefs`, field by field.
 */

import { bech32 } from "bech32";
import { isTimeZone, parseNotifyPrefs } from "@/lib/notifications/prefs";
import type { NotifyPrefs } from "@/lib/notifications/types";

export class PushInputError extends Error {
  readonly code: string;
  constructor(code: string, message: string) {
    super(message);
    this.name = "PushInputError";
    this.code = code;
  }
}

/** Exact hosts of the browser push services in use (Chrome/Edge-on-FCM, Firefox, Safari). */
export const PUSH_SERVICE_HOSTS: readonly string[] = [
  "fcm.googleapis.com",
  "updates.push.services.mozilla.com",
  "web.push.apple.com",
];

/** Host suffixes: Edge on Windows uses regional WNS hosts (`wns2-par02p.notify.windows.com`). */
export const PUSH_SERVICE_SUFFIXES: readonly string[] = [".notify.windows.com"];

export const MAX_ACCOUNTS = 32;
const MAX_ENDPOINT_LENGTH = 1_024;

export interface PushAccount {
  readonly chainId: string;
  readonly address: string;
}

export interface PushSubscriptionInput {
  readonly endpoint: string;
  readonly keys: { readonly p256dh: string; readonly auth: string };
}

export interface SubscribeRequest {
  readonly subscription: PushSubscriptionInput;
  readonly accounts: readonly PushAccount[];
  readonly prefs: NotifyPrefs;
  /** BCP 47 tag from the browser; stored for when copy is localised. */
  readonly locale: string;
  /** IANA zone, for quiet hours. Null when the browser did not say. */
  readonly timeZone: string | null;
  /** A previous endpoint of the same browser (after `pushsubscriptionchange`), to drop. */
  readonly replaces: string | null;
}

export type ChainLookup = (chainId: string) => { readonly bech32Prefix: string } | undefined;

/** True for an https URL on a known push service, with nothing odd in it. */
export function isAllowedPushEndpoint(raw: unknown): raw is string {
  if (typeof raw !== "string" || raw.length > MAX_ENDPOINT_LENGTH) return false;
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return false;
  }
  if (url.protocol !== "https:" || url.username || url.password || url.port) return false;
  const host = url.hostname.toLowerCase();
  return (
    PUSH_SERVICE_HOSTS.includes(host) ||
    PUSH_SERVICE_SUFFIXES.some((suffix) => host.endsWith(suffix) && host.length > suffix.length)
  );
}

const BASE64URL = /^[A-Za-z0-9_-]+={0,2}$/;

/** RFC 4648 §5 base64url (padding tolerated); null when it is not. */
export function decodeBase64Url(value: unknown): Uint8Array | null {
  if (typeof value !== "string" || value.length === 0 || value.length > 256 || !BASE64URL.test(value)) {
    return null;
  }
  const normalized = value.replace(/=+$/, "").replace(/-/g, "+").replace(/_/g, "/");
  if (normalized.length % 4 === 1) return null;
  try {
    return new Uint8Array(Buffer.from(normalized, "base64"));
  } catch {
    return null;
  }
}

/** An uncompressed P-256 point, the only key format push encryption uses. */
export function isP256PublicKey(value: unknown): value is string {
  const bytes = decodeBase64Url(value);
  return bytes !== null && bytes.length === 65 && bytes[0] === 0x04;
}

function parseSubscription(raw: unknown): PushSubscriptionInput {
  if (!raw || typeof raw !== "object") {
    throw new PushInputError("subscription_required", "subscription is required");
  }
  const row = raw as Record<string, unknown>;
  if (!isAllowedPushEndpoint(row.endpoint)) {
    throw new PushInputError("endpoint_invalid", "This browser's push service is not supported");
  }
  const keys = row.keys && typeof row.keys === "object" ? (row.keys as Record<string, unknown>) : {};
  const auth = decodeBase64Url(keys.auth);
  if (!isP256PublicKey(keys.p256dh) || !auth || auth.length !== 16) {
    throw new PushInputError("keys_invalid", "The subscription keys are not valid");
  }
  return { endpoint: row.endpoint, keys: { p256dh: keys.p256dh, auth: keys.auth as string } };
}

/** The account list: catalog chains, matching bech32 prefixes, de-duplicated, capped. */
export function parseAccounts(raw: unknown, lookup: ChainLookup): PushAccount[] {
  if (!Array.isArray(raw) || raw.length === 0) {
    throw new PushInputError("accounts_required", "At least one account is required");
  }
  if (raw.length > MAX_ACCOUNTS) {
    throw new PushInputError("accounts_too_many", `At most ${MAX_ACCOUNTS} accounts per device`);
  }
  const seen = new Set<string>();
  const accounts: PushAccount[] = [];
  for (const entry of raw) {
    const row = entry && typeof entry === "object" ? (entry as Record<string, unknown>) : {};
    const chainId = typeof row.chainId === "string" ? row.chainId.trim() : "";
    const address = typeof row.address === "string" ? row.address.trim() : "";
    const chain = chainId.length > 0 && chainId.length <= 64 ? lookup(chainId) : undefined;
    if (!chain) throw new PushInputError("chain_unknown", `Unknown chain ${chainId.slice(0, 64)}`);
    // Prefixes may hold "_" or "@" (Safrochain's `addr_safro`, Lava's `lava@`):
    // bech32 allows any printable character there, and one refused account
    // refuses the whole subscription.
    if (address.length > 128 || !/^[a-z0-9_@]+1[a-z0-9]+$/.test(address)) {
      throw new PushInputError("address_invalid", "An address is not a bech32 address");
    }
    let decoded: { prefix: string; words: number[] };
    try {
      decoded = bech32.decode(address, 200);
    } catch {
      throw new PushInputError("address_invalid", "An address is not a bech32 address");
    }
    if (decoded.prefix !== chain.bech32Prefix) {
      throw new PushInputError("address_prefix", `Addresses on ${chainId} start with ${chain.bech32Prefix}1`);
    }
    const length = bech32.fromWords(decoded.words).length;
    if (length !== 20 && length !== 32) {
      throw new PushInputError("address_invalid", "An address has an unexpected length");
    }
    const key = `${chainId}|${address}`;
    if (seen.has(key)) continue;
    seen.add(key);
    accounts.push({ chainId, address });
  }
  return accounts;
}

function parseLocale(raw: unknown): string {
  return typeof raw === "string" && raw.length <= 35 && /^[A-Za-z]{2,3}(-[A-Za-z0-9]{1,8}){0,4}$/.test(raw)
    ? raw
    : "en";
}

function bodyRecord(raw: unknown): Record<string, unknown> {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    throw new PushInputError("body_invalid", "Expected a JSON object");
  }
  return raw as Record<string, unknown>;
}

export function parseSubscribeRequest(raw: unknown, lookup: ChainLookup): SubscribeRequest {
  const body = bodyRecord(raw);
  const subscription = parseSubscription(body.subscription);
  const accounts = parseAccounts(body.accounts, lookup);
  const timeZone = typeof body.timeZone === "string" && isTimeZone(body.timeZone) ? body.timeZone : null;
  const replaces =
    isAllowedPushEndpoint(body.replaces) && body.replaces !== subscription.endpoint ? body.replaces : null;
  return {
    subscription,
    accounts,
    prefs: parseNotifyPrefs(body.prefs),
    locale: parseLocale(body.locale),
    timeZone,
    replaces,
  };
}

/** `{endpoint}` for DELETE /api/push/subscribe and POST /api/push/test. */
export function parseEndpointRequest(raw: unknown): string {
  const body = bodyRecord(raw);
  if (!isAllowedPushEndpoint(body.endpoint)) {
    throw new PushInputError("endpoint_invalid", "endpoint is not a push subscription endpoint");
  }
  return body.endpoint;
}
