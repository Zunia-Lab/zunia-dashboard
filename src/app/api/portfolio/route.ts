/**
 * GET /api/portfolio?accounts=<chainId>:<address>,…&currency=usd|eur|gbp
 *
 * Every non-zero holding of the given accounts — bank balances, delegations,
 * rewards (any denom) and unbonding entries — named by token identity and
 * priced by the pricing rule (`lib/server/prices/rules.ts`). Up to 32
 * accounts, one per chain, each address checked against its chain's prefix.
 *
 * A chain that cannot be read, or has not answered within 20 s, keeps its row
 * (status "error") and the rest still answers, with `errors` saying what is
 * missing. Only when no chain at all answered is the response a 503 (never
 * 502: Cloudflare replaces 502 bodies). Private: keyed by addresses, never
 * cached by a shared cache (each chain's read is cached 30 s server side).
 * Contract: `PortfolioResponse` in `lib/token/wire.ts`.
 */

import type { NextRequest } from "next/server";
import { parseAccounts } from "@/lib/server/portfolio/accounts";
import { loadPortfolio } from "@/lib/server/portfolio/load";
import { rateLimit } from "@/lib/server/rate-limit";
import { privateJson, upstreamFailure } from "@/lib/server/respond";
import { badRequest, parseEnum } from "@/lib/server/validate";
import type { FiatCurrency } from "@/lib/token/types";

export const runtime = "nodejs";

const CURRENCIES: readonly FiatCurrency[] = ["usd", "eur", "gbp"];

export async function GET(req: NextRequest) {
  let accounts;
  let currency: FiatCurrency;
  try {
    accounts = parseAccounts(req.nextUrl.searchParams.get("accounts"));
    currency = parseEnum(req.nextUrl.searchParams.get("currency")?.toLowerCase(), CURRENCIES, "usd", "currency");
  } catch (error) {
    return badRequest(error);
  }

  // One token per chain: a 32-chain read costs 32, so a loop of them drains
  // the bucket long before it drains the public nodes' patience with us.
  const limited = rateLimit(req, { scope: "portfolio", capacity: 96, refillPerSecond: 2, cost: accounts.length });
  if (limited) return limited;

  try {
    const { response } = await loadPortfolio(accounts, currency);
    if (response.chains.length > 0 && response.chains.every((chain) => chain.status === "error")) {
      return upstreamFailure("None of the requested chains answered. Try again in a moment.", 503);
    }
    return privateJson(response);
  } catch {
    return upstreamFailure("The portfolio could not be read right now.", 503);
  }
}
