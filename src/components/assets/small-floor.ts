"use client";

/**
 * The viewer's small-balance floor, kept in this browser under
 * `SMALL_FLOOR_KEY` (Settings may offer $1 / $10 / $100; until a viewer
 * picks one it is $1). One read for the whole Assets page, so the "Hide <"
 * switch, the fold, the footer's count and the strip's best / worst movers
 * never use two different floors.
 */

import { useStoredValue } from "@/lib/useStoredValue";
import { SMALL_FLOOR_KEY, SMALL_VALUE, smallFloorOf } from "./holdings";

export function useSmallFloor(): number {
  const [stored] = useStoredValue<unknown>(SMALL_FLOOR_KEY, SMALL_VALUE);
  return smallFloorOf(stored);
}
