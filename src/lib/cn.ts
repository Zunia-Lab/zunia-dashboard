/** Minimal className helper — dashboard does not depend on ui internals. */
export function cn(...parts: Array<string | false | null | undefined>) {
  return parts.filter(Boolean).join(" ");
}
