"use client";

/**
 * `GET /api/assets/[key]`: the public half of an asset page (identity,
 * market figures with their source, 30 days of daily prices, chains it is
 * held on). Holdings come from `usePortfolio`, filtered by `identity.key`.
 */

import { apiUrl, useApi, type ApiState } from "@/lib/useApi";
import { readAssetDetailResponse, type AssetDetailResponse } from "@/lib/token/wire";
import { usePrefs } from "@/providers/PrefsProvider";

export type { AssetDetailResponse };

export function useAsset(key: string | null | undefined): ApiState<AssetDetailResponse> {
  const { currency } = usePrefs();
  const url = key ? apiUrl(`/api/assets/${encodeURIComponent(key)}`, { currency }) : null;
  return useApi<AssetDetailResponse>(url, {
    parse: readAssetDetailResponse,
    keepPreviousData: true,
    dedupeMs: 60_000,
  });
}
