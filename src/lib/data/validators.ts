"use client";

/**
 * Validator data for the browser: one chain's full set (`useValidators`) and
 * one validator's profile (`useValidator`). Public data, so answers are kept
 * in the shared `useApi` store and persisted briefly for an instant repaint.
 */

import { rec } from "@/lib/chain/parse";
import type { ValidatorDetailResponse, ValidatorsResponse } from "@/lib/chain/types";
import { apiUrl, useApi, type ApiInitial, type ApiState } from "@/lib/useApi";

export type {
  ValidatorDetailResponse,
  ValidatorRow,
  ValidatorSetSummary,
  ValidatorsResponse,
} from "@/lib/chain/types";

function readSet(raw: unknown): ValidatorsResponse | null {
  const body = rec(raw);
  return body && Array.isArray(body.validators) && rec(body.summary) ? (raw as ValidatorsResponse) : null;
}

function readDetail(raw: unknown): ValidatorDetailResponse | null {
  const body = rec(raw);
  return body && rec(body.validator) ? (raw as ValidatorDetailResponse) : null;
}

/**
 * The validator set of `chainId`: the bonded set (default) or, with
 * `status: "all"`, inactive validators too (capped at 300 rows; `truncated`
 * says when). Refreshes every 5 min.
 */
export function useValidators(
  chainId: string | null | undefined,
  options: {
    status?: "bonded" | "all";
    /** The same route read on the server for the first HTML (used only while the URL matches). */
    initial?: ApiInitial | null;
  } = {},
): ApiState<ValidatorsResponse> {
  const status = options.status ?? "bonded";
  return useApi<ValidatorsResponse>(
    chainId ? apiUrl("/api/validators", { chainId, status: status === "all" ? "all" : null }) : null,
    // Not persisted: a Hub set is ~190 KB (300 KB with inactive), and a few
    // chains of those would crowd the shared localStorage budget. The server
    // cache answers these in a few hundred milliseconds anyway.
    { parse: readSet, keepPreviousData: true, persist: false, refreshMs: 5 * 60_000, dedupeMs: 60_000, initial: options.initial },
  );
}

/**
 * One validator by operator address. `chainId` may be null when the operator
 * prefix names a single mainnet; pass it whenever it is known.
 */
export function useValidator(
  chainId: string | null | undefined,
  address: string | null | undefined,
): ApiState<ValidatorDetailResponse> {
  return useApi<ValidatorDetailResponse>(
    address ? apiUrl(`/api/validators/${encodeURIComponent(address)}`, { chainId }) : null,
    { parse: readDetail, keepPreviousData: true, refreshMs: 5 * 60_000, dedupeMs: 60_000 },
  );
}
