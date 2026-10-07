import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

/** Anything `cn` accepts: strings, falsy values, arrays and `{class: bool}` maps. */
export type { ClassValue };

/**
 * Joins class names and resolves Tailwind conflicts, last one wins.
 *
 * clsx + tailwind-merge (the same pair @zunialab/ui's `cn` uses) rather than
 * a plain join: the dashboard's UI kit merges its base classes with a
 * caller's `className`, and with a plain join `<Card className="p-0">` would
 * keep both paddings and let stylesheet order pick one. Merging makes the
 * caller win.
 *
 * Imported directly, not through the @zunialab/ui entry point, so modules
 * that use it stay importable under `node --test` (that entry loads Radix,
 * which tsx cannot load).
 *
 * Caveat for custom utilities: tailwind-merge only knows Tailwind's own
 * scales. Write sizes as arbitrary values (`text-[13px]`,
 * `text-[length:var(--x)]`), never as an invented `text-foo` name, or a
 * `text-fg` passed later will be taken as the same group and drop it.
 */
export function cn(...parts: ClassValue[]): string {
  return twMerge(clsx(parts));
}
