/**
 * Small shapes shared by the swap engine's modules.
 *
 * `MsgJson` is a message as the engine reasons about it: the protobuf type URL
 * and the message's fields in proto-JSON (snake_case) spelling, the shape the
 * extension's kernel signs and the shape amino carries in `value`. The
 * read-back checks (./checks.ts) only ever read this view, and only after
 * ./messages.ts has proved it is exactly what the protobuf bytes say.
 */

export interface MsgJson {
  readonly typeUrl: string;
  readonly value: Readonly<Record<string, unknown>>;
}

/** A coin exactly as a message carries it: base units, digits only. */
export interface MessageCoin {
  readonly denom: string;
  readonly amount: string;
}

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** Exactly these keys, in any order, and no other. */
export function hasExactly(value: Readonly<Record<string, unknown>>, keys: readonly string[]): boolean {
  const own = Object.keys(value);
  return own.length === keys.length && keys.every((key) => Object.hasOwn(value, key));
}

/** Only keys from `allowed` (some may be absent). */
export function hasOnly(value: Readonly<Record<string, unknown>>, allowed: ReadonlySet<string>): boolean {
  return Object.keys(value).every((key) => allowed.has(key));
}
