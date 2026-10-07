"use client";

import { DEFAULT_FOLLOWED } from "@/lib/followed-defaults";
import { useStoredValue } from "@/lib/useStoredValue";

export { DEFAULT_FOLLOWED };

export const FOLLOWED_KEY = "zunia.dashboard.followed";

/** The chain ids the dashboard reads for, persisted from the Networks page. */
export function useFollowedChains() {
  return useStoredValue<string[]>(FOLLOWED_KEY, DEFAULT_FOLLOWED);
}
