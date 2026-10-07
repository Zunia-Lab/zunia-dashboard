/**
 * Sorting for DataTable. Pure, so node:test covers it.
 *
 * Rules a financial table needs: unknown values (null, undefined, NaN — an
 * unpriced asset, a validator with no uptime yet) sort last in both
 * directions, never as zero at the top of a descending list; ties keep the
 * caller's order (stable); text compares with numeric collation so "Chain 10"
 * follows "Chain 9".
 */

export type SortDir = "asc" | "desc";

export interface SortState {
  key: string;
  dir: SortDir;
}

export type SortValue = number | string | null | undefined;

const collator = new Intl.Collator("en", { numeric: true, sensitivity: "base" });

function normalize(value: SortValue): number | string | null {
  if (value === null || value === undefined) return null;
  if (typeof value === "number") return Number.isNaN(value) ? null : value;
  return value;
}

export function sortRows<T>(rows: readonly T[], valueOf: (row: T) => SortValue, dir: SortDir): T[] {
  const decorated = rows.map((row, index) => ({ row, index, value: normalize(valueOf(row)) }));
  decorated.sort((a, b) => {
    if (a.value === null || b.value === null) {
      if (a.value === null && b.value === null) return a.index - b.index;
      return a.value === null ? 1 : -1;
    }
    // Compare, not subtract: Infinity − Infinity is NaN, which a comparator
    // must never return (the sort's order becomes undefined).
    const order =
      typeof a.value === "number" && typeof b.value === "number"
        ? a.value < b.value
          ? -1
          : a.value > b.value
            ? 1
            : 0
        : collator.compare(String(a.value), String(b.value));
    if (order === 0) return a.index - b.index;
    return dir === "asc" ? order : -order;
  });
  return decorated.map((entry) => entry.row);
}

/**
 * The sort after a header click: a new column starts descending when its
 * values are figures (largest first is what a balance column is read for),
 * ascending for text; the same column flips.
 */
export function nextSort(current: SortState | null | undefined, key: string, descFirst: boolean): SortState {
  if (!current || current.key !== key) return { key, dir: descFirst ? "desc" : "asc" };
  return { key, dir: current.dir === "asc" ? "desc" : "asc" };
}
