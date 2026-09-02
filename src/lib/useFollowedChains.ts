"use client";

import { useStoredValue } from "@/lib/useStoredValue";

export const FOLLOWED_KEY = "zunia.dashboard.followed";
export const DEFAULT_FOLLOWED = [
  "safrochain-1",
  "cosmoshub-4",
  "osmosis-1",
  "celestia",
  "neutron-1",
];

/** The chain ids the dashboard reads for, persisted from the Networks page. */
export function useFollowedChains() {
  return useStoredValue<string[]>(FOLLOWED_KEY, DEFAULT_FOLLOWED);
}
