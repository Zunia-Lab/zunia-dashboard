/**
 * Price a swap on the venue chain.
 *
 * Both denoms are as denominated on the venue: the pool sells the voucher that
 * arrived over IBC, not the token as it was named on the source chain. The
 * caller gets those from `/api/interchain/plan`, which derives them through the
 * engine rather than guessing.
 *
 * `priceImpact` and `poolFee` are passed through as `null` when the venue did
 * not report them. Rendering an unreported impact as `0` is exactly the class
 * of defect this flow was rebuilt to remove: a confident zero for a failed read
 * is worse than an em dash, because a user acts on it.
 */

import { NextRequest } from "next/server";
import {
  createLcdClient,
  isInterchainError,
  quoteOsmosisSwap,
} from "@zunialab/interchain";
import { findChain } from "@/lib/chains";
import { describeError, lcdFor } from "@/lib/server/interchain";
import { routerEndpoint } from "@/lib/server/interchain-config";
import { swapVenueConfig } from "@/lib/server/swap-venue";

export const runtime = "nodejs";

interface QuoteBody {
  chainId?: unknown;
  tokenInDenom?: unknown;
  tokenInAmount?: unknown;
  tokenOutDenom?: unknown;
  slippagePercent?: unknown;
}

function str(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function bad(message: string) {
  return Response.json({ ok: false, code: "bad-request", message }, { status: 400 });
}

export async function POST(req: NextRequest) {
  let body: QuoteBody;
  try {
    body = (await req.json()) as QuoteBody;
  } catch {
    return bad("The request body was not JSON.");
  }

  const venue = await swapVenueConfig();
  if (!venue.available) {
    return Response.json({
      ok: false,
      code: "not-configured",
      message: venue.reason ?? "Cross-chain swap is not configured.",
    });
  }

  const chainId = str(body.chainId) || venue.chainId;
  if (chainId !== venue.chainId) {
    return bad(
      `Quotes are only served for the configured swap venue (${venue.chainId}).`,
    );
  }
  const tokenInDenom = str(body.tokenInDenom);
  const tokenOutDenom = str(body.tokenOutDenom);
  const tokenInAmount = str(body.tokenInAmount);
  if (!tokenInDenom || !tokenOutDenom) return bad("Both denoms are required.");
  if (!/^\d+$/.test(tokenInAmount) || tokenInAmount === "0") {
    return bad("The input amount must be a positive whole number of base units.");
  }
  if (tokenInDenom === tokenOutDenom) {
    return bad("The input and output denoms are the same, so there is nothing to swap.");
  }
  const slippagePercent =
    typeof body.slippagePercent === "number" && Number.isFinite(body.slippagePercent)
      ? body.slippagePercent
      : undefined;

  const chain = findChain(chainId);
  const lcd = lcdFor(chain);
  if (!chain || !lcd) {
    return Response.json({
      ok: false,
      code: "unsupported-chain",
      message: `${chainId} has no REST endpoint in this build's catalog, so nothing can be quoted.`,
    });
  }

  const routerUrl = routerEndpoint();
  const router = routerUrl
    ? createLcdClient({
        chainId,
        endpoints: [routerUrl],
        timeoutMs: 9_000,
        retries: 1,
      })
    : undefined;

  try {
    const quote = await quoteOsmosisSwap(
      {
        tokenInDenom,
        tokenInAmount,
        tokenOutDenom,
        ...(slippagePercent === undefined ? {} : { slippagePercent }),
        ...(router ? { router } : {}),
        request: { signal: req.signal },
      },
      lcd,
    );
    return Response.json({
      ok: true,
      quote: {
        inputDenom: quote.inputDenom,
        inputAmount: quote.inputAmount,
        outputDenom: quote.outputDenom,
        outputAmount: quote.outputAmount,
        minReceived: quote.minReceived,
        slippagePercent: quote.slippagePercent,
        // The engine reports 0 impact with a warning when it had no spot price.
        // That warning is the difference between "no impact" and "we could not
        // tell", so it decides whether a number is claimed at all.
        priceImpact: quote.spotPrice === null ? null : quote.priceImpact,
        poolFee: quote.effectiveFeeFraction === null ? null : quote.poolFee,
        spotPrice: quote.spotPrice,
        source: quote.source,
        route: quote.route,
        warnings: quote.warnings,
        fetchedAt: quote.fetchedAt,
      },
    });
  } catch (error) {
    return Response.json({
      ok: false,
      code: isInterchainError(error) ? error.code : "server-error",
      message: describeError(error, "This pair could not be priced."),
    });
  }
}
