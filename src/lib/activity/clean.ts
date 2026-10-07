/**
 * Untrusted text from a transaction, made safe to show.
 *
 * Memos, contract labels and call names, proposal titles, validator monikers
 * and the fields of an IBC packet are whatever their author typed (a
 * packet's denom and receiver are even written by another chain). React
 * escapes them, so they cannot inject markup; what escaping does not stop is
 * text that *looks* like something else: a right-to-left override that turns
 * "…gnp.exe" into "…exe.png", zero-width characters that make two addresses
 * look equal, control characters that break a row's layout. Those are
 * removed, runs of whitespace are collapsed (line breaks kept only where a
 * caller asks, for the detail view's memo) and the length is bounded.
 *
 * Pure.
 */

/** C0/C1 controls (minus tab and line breaks), zero-width and bidi formatting characters, BOM. */
const INVISIBLE = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F-\u009F\u00AD\u061C\u180E\u200B-\u200F\u202A-\u202E\u2060-\u2064\u2066-\u206F\uFEFF]/g;

/** `value` without the characters {@link cleanText} removes, nothing else changed (for raw JSON views). */
export function stripInvisible(value: string): string {
  return value.replace(INVISIBLE, "");
}

export function cleanText(value: string, max: number, options: { keepNewlines?: boolean } = {}): string {
  let out = stripInvisible(value);
  out = options.keepNewlines
    ? out.replace(/\r\n?/g, "\n").replace(/[^\S\n]+/g, " ").replace(/\n{3,}/g, "\n\n")
    : out.replace(/\s+/g, " ");
  out = out.trim();
  if (out.length <= max) return out;
  let cut = out.slice(0, Math.max(0, max - 1));
  // Never end on half of a surrogate pair (an emoji cut in two).
  if (/[\uD800-\uDBFF]$/.test(cut)) cut = cut.slice(0, -1);
  return `${cut.trimEnd()}…`;
}
