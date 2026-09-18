/**
 * Spendable balances on one chain, with `ibc/…` denoms named where the chain
 * will say what they are.
 *
 * `/api/portfolio` only reads each chain's own staking token, which is enough
 * for a total but useless for a swap: the asset a user most wants to move is
 * usually a voucher they received over IBC, and its denom is a hash. The
 * engine's `identifyDenoms` resolves those in one pass — a point lookup per
 * hash up to a threshold, then a single paginated sweep — so a wallet holding
 * thirty vouchers does not cost thirty requests.
 *
 * A denom that could not be resolved is returned with `symbol: null` and the
 * reason. The picker then shows the raw hash, which is honest; showing a
 * guessed symbol for an unresolved voucher is how someone sends the wrong
 * token.
 */

import { NextRequest } from "next/server";
import { isInterchainError } from "@zunialab/interchain";
import { findChain } from "@/lib/chains";
import { denomResolver, lcdFor } from "@/lib/server/interchain";

export const runtime = "nodejs";

interface RawBalance {
  readonly denom?: unknown;
  readonly amount?: unknown;
}

function readBalances(body: unknown): { denom: string; amount: string }[] {
  if (typeof body !== "object" || body === null) return [];
  const rows = (body as { balances?: unknown }).balances;
  if (!Array.isArray(rows)) return [];
  const out: { denom: string; amount: string }[] = [];
  for (const row of rows as RawBalance[]) {
    const denom = typeof row?.denom === "string" ? row.denom : null;
    const amount = typeof row?.amount === "string" ? row.amount : null;
    if (!denom || !amount || !/^\d+$/.test(amount) || amount === "0") continue;
    out.push({ denom, amount });
  }
  return out;
}

export async function GET(req: NextRequest) {
  const chainId = req.nextUrl.searchParams.get("chainId")?.trim() ?? "";
  const address = req.nextUrl.searchParams.get("address")?.trim() ?? "";
  if (!chainId || !address) {
    return Response.json(
      {
        ok: false,
        code: "bad-request",
        message: "A chain id and an address are required.",
      },
      { status: 400 },
    );
  }

  const chain = findChain(chainId);
  const lcd = lcdFor(chain);
  if (!chain || !lcd) {
    return Response.json({
      ok: false,
      code: "unsupported-chain",
      message: chain
        ? `${chain.chainName} has no REST endpoint in this build's catalog, so its balances cannot be read.`
        : `${chainId} is not in this build's chain catalog.`,
    });
  }

  let raw: { denom: string; amount: string }[];
  try {
    const body = await lcd.getJson(
      `/cosmos/bank/v1beta1/balances/${encodeURIComponent(address)}`,
      { query: { "pagination.limit": 200 }, cacheTtlMs: 10_000 },
    );
    raw = readBalances(body);
  } catch (error) {
    return Response.json({
      ok: false,
      code: isInterchainError(error) ? error.code : "server-error",
      message:
        error instanceof Error
          ? `Could not read balances on ${chain.chainName}. ${error.message}`
          : `Could not read balances on ${chain.chainName}.`,
    });
  }

  const notes: string[] = [];
  const identified = new Map<string, { baseDenom: string; originChainId: string | null }>();
  const ibcDenoms = raw.filter((row) => row.denom.startsWith("ibc/"));
  if (ibcDenoms.length > 0) {
    try {
      // The bound resolver, not a freshly built context: it carries the
      // channel counterparty lookup, without which a voucher's origin chain
      // cannot be proven and every row would come back with a null origin.
      const resolved = await denomResolver.identifyDenoms(
        chainId,
        ibcDenoms.map((row) => row.denom),
      );
      for (const [denom, entry] of resolved) {
        identified.set(denom, {
          baseDenom: entry.baseDenom,
          originChainId: entry.originChainId,
        });
      }
    } catch (error) {
      notes.push(
        error instanceof Error
          ? `Some IBC denoms could not be named: ${error.message}`
          : "Some IBC denoms could not be named.",
      );
    }
  }

  const balances = raw.map((row) => {
    const isIbc = row.denom.startsWith("ibc/");
    const trace = identified.get(row.denom);
    const baseDenom = trace?.baseDenom ?? (isIbc ? row.denom : row.denom);
    const originChainId = isIbc ? (trace?.originChainId ?? null) : chainId;
    const origin = originChainId ? findChain(originChainId) : undefined;
    // The symbol is only claimed when the origin chain is known AND calls this
    // its own base denom. Anything else stays null and renders as the raw
    // denom: a voucher labelled with a symbol we inferred is how the wrong
    // asset gets sent.
    const named =
      origin && origin.coinMinimalDenom === baseDenom ? origin : undefined;
    return {
      denom: row.denom,
      amount: row.amount,
      baseDenom,
      symbol: named?.coinDenom ?? null,
      decimals: named?.coinDecimals ?? null,
      originChainId,
      originChainName: origin?.chainName ?? null,
      isIbc,
      traceError:
        isIbc && !trace
          ? "This chain did not return a denom trace for this voucher."
          : null,
    };
  });

  balances.sort((a, b) => {
    // Named assets first, then by descending amount. A picker whose first row
    // is an unnameable hash reads as broken.
    if ((a.symbol === null) !== (b.symbol === null)) return a.symbol === null ? 1 : -1;
    const byAmount = BigInt(b.amount) - BigInt(a.amount);
    if (byAmount !== BigInt(0)) return byAmount > BigInt(0) ? 1 : -1;
    return a.denom.localeCompare(b.denom);
  });

  return Response.json({ ok: true, balances, notes });
}
