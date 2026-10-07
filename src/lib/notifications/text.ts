/**
 * The few wording helpers notification copy needs, shared by the in-page feed
 * and the push server so both say the same thing about the same event.
 *
 * Deliberately tiny: amounts arrive already formatted by whoever read them
 * (the activity and staking reads name tokens by identity); this file only
 * phrases durations, percentages and lists.
 */

/**
 * "45 min", "5 h", "3 days". Rounded down: "ends in 5 h" with 5 h 50 left is
 * conservative, "ends in 6 h" would be a promise the chain does not keep.
 */
export function durationText(ms: number): string {
  const minutes = Math.max(1, Math.floor(ms / 60_000));
  if (minutes < 60) return `${minutes} min`;
  const hours = Math.floor(minutes / 60);
  if (hours < 48) return `${hours} h`;
  return `${Math.floor(hours / 24)} days`;
}

/** 0.05 → "5%", 0.075 → "7.5%". */
export function percentText(fraction: number): string {
  const value = Math.round(fraction * 10_000) / 100;
  return `${Number.isInteger(value) ? value.toFixed(0) : String(value)}%`;
}

/** ["A"] → "A"; ["A","B"] → "A and B"; ["A","B","C","D"] → "A, B and 2 more". */
export function joinNames(names: readonly string[], max = 2, unit = "more"): string {
  const list = names.filter(Boolean);
  if (list.length === 0) return "";
  if (list.length === 1) return list[0];
  if (list.length <= max) return `${list.slice(0, -1).join(", ")} and ${list[list.length - 1]}`;
  const shown = list.slice(0, max);
  return `${shown.join(", ")} and ${list.length - max} ${unit}`;
}

/** Cut to `max` characters on a word boundary when possible, with an ellipsis. */
export function clip(text: string, max: number): string {
  const value = text.replace(/\s+/g, " ").trim();
  if (value.length <= max) return value;
  // `slice(0, max - 1)` with max 0 is `slice(0, -1)`: almost the whole text.
  if (max < 2) return max === 1 ? "…" : "";
  const cut = value.slice(0, max - 1);
  const space = cut.lastIndexOf(" ");
  return `${space > max * 0.6 ? cut.slice(0, space) : cut}…`;
}

/** What privacy mode shows instead of an amount. */
export const AMOUNT_MASK = "••••";

/**
 * A number as it appears in an amount ("12.5", "1,234.56", "0.000012"), but
 * not a digit inside a word: the "1" of `osmo1…`, a chain id's "-4", "#1049".
 */
const AMOUNT_NUMBER = /(?<![\w.,#-])\d[\d,]*(?:\.\d+)?(?![\w])/g;

/**
 * Kinds whose text carries an amount the user may want hidden. (A rewards
 * notice names chains, never an amount: its "2 more networks" stays.)
 */
const AMOUNT_KINDS = new Set(["transfer", "ibc", "swap", "unbonding"]);

/**
 * Notice text for privacy mode.
 *
 * The exact formatted amount (`data.amount`) is replaced first. That alone is
 * not enough: a transfer's body is the activity read's own sentence, which may
 * format the same amount differently ("0.50 OSMO" next to `amount` "0.5
 * OSMO"), and a swap names two amounts. So for kinds that carry amounts every
 * free-standing number is masked as well; votes and validator alerts keep
 * theirs (a proposal number or a commission rate is not the user's money).
 */
export function maskAmounts(text: string, kind: string, amount?: unknown): string {
  let out = typeof amount === "string" && amount.trim() ? text.split(amount).join(AMOUNT_MASK) : text;
  if (AMOUNT_KINDS.has(kind)) out = out.replace(AMOUNT_NUMBER, AMOUNT_MASK);
  return out;
}

/** "osmo1abcd…wxyz": enough to recognise, short enough for a notification line. */
export function shortAddress(address: string): string {
  if (address.length <= 20) return address;
  // The bech32 separator is the last "1": the data charset has no "1" in it.
  const sep = address.lastIndexOf("1");
  const head = sep > 0 ? address.slice(0, sep + 5) : address.slice(0, 9);
  return `${head}…${address.slice(-4)}`;
}
