/**
 * `account_number` and `sequence` for an amino sign document.
 *
 * The unwrapping used to be hand-rolled here, and covered three of the shapes a
 * Cosmos REST gateway can answer with. `@zunialab/interchain`'s `getAccount`
 * covers those plus `/account_info`, the legacy `result.value` envelope, vesting
 * and module wrappers, a gateway that answers 200 with a gRPC status body, and
 * the `null` account a never-used address returns — all of which reach a user
 * as "unauthorized" at signing time if they are read wrong.
 */

import { NextResponse } from "next/server";
import { getAccount, isInterchainError } from "@zunialab/interchain";
import { findChain } from "@/lib/chains";
import { lcdFor } from "@/lib/server/interchain";

export const runtime = "nodejs";

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const chainId = searchParams.get("chainId")?.trim();
  const address = searchParams.get("address")?.trim();
  if (!chainId || !address) {
    return NextResponse.json(
      { error: "chainId and address are required" },
      { status: 400 },
    );
  }

  const chain = findChain(chainId);
  const lcd = lcdFor(chain);
  if (!lcd) {
    return NextResponse.json(
      { error: `No REST endpoint for chain ${chainId}` },
      { status: 400 },
    );
  }

  try {
    const account = await getAccount(lcd, chainId, address);
    return NextResponse.json({
      accountNumber: account.accountNumber,
      sequence: account.sequence,
    });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "account fetch failed";
    return NextResponse.json(
      {
        error: message,
        ...(isInterchainError(error) ? { code: error.code } : {}),
      },
      { status: 502 },
    );
  }
}
