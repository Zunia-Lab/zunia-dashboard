"use client";

/**
 * The way out of the Insights page into a comparison: the networks (or, on
 * one network, the assets) that hold most of your value, side by side on
 * /compare with actual APR, real yield, inflation, unbonding and price
 * performance. Built from your own holdings so the first comparison is the
 * one that matters to you; the default set when there is nothing to pick.
 */

import { useMemo, type ReactNode } from "react";
import { DEFAULT_REFS, MAX_ENTITIES, compareHref, type EntityRef } from "@/components/compare/model";
import { Icon } from "@/components/icons";
import { AssetLogo, Button, Card, ChainLogo } from "@/components/ui";
import { findChain } from "@/lib/chains";
import type { PortfolioState } from "@/lib/data/portfolio";
import { groupAssets } from "@/lib/token/holdings";

interface CompareChoice {
  ref: EntityRef;
  label: string;
  logo: ReactNode;
}

export function CompareTeaser({ portfolio, singleChain }: { portfolio: PortfolioState; singleChain: boolean }) {
  const data = portfolio.data;
  const picks = useMemo<{ items: CompareChoice[]; mine: boolean }>(() => {
    if (data && !singleChain) {
      const chains = data.chains
        .filter((chain) => chain.status === "ok" && chain.value !== null && chain.value > 0)
        .sort((a, b) => (b.value as number) - (a.value as number))
        .slice(0, MAX_ENTITIES);
      if (chains.length >= 2) {
        return {
          mine: true,
          items: chains.map((chain) => ({
            ref: { kind: "chain", id: chain.chainId },
            label: chain.chainName,
            logo: <ChainLogo chainId={chain.chainId} size={18} />,
          })),
        };
      }
    }
    if (data) {
      const groups = groupAssets(data.assets)
        .filter((group) => group.value !== null && group.value > 0)
        .slice(0, MAX_ENTITIES);
      if (groups.length >= 2) {
        return {
          mine: true,
          items: groups.map((group) => ({
            ref: { kind: "asset", id: group.key },
            label: group.identity.ticker,
            logo: <AssetLogo src={group.identity.logoUrl} symbol={group.identity.ticker} size={18} />,
          })),
        };
      }
    }
    return {
      mine: false,
      items: DEFAULT_REFS.map((ref) => ({
        ref,
        label: findChain(ref.id)?.chainName ?? ref.id,
        logo: <ChainLogo chainId={ref.id} size={18} />,
      })),
    };
  }, [data, singleChain]);

  const href = compareHref(picks.items.map((item) => item.ref));
  const chains = picks.items[0]?.ref.kind === "chain";

  return (
    <Card className="overflow-hidden">
      <div className="flex flex-col gap-4 @min-[760px]:flex-row @min-[760px]:items-center @min-[760px]:justify-between">
        <div className="flex min-w-0 items-start gap-3.5">
          <span aria-hidden className="flex size-10 shrink-0 items-center justify-center rounded-[12px] bg-[var(--d-accent-soft)] text-[var(--d-accent-text)]">
            <Icon name="compare" size={19} />
          </span>
          <div className="min-w-0">
            <h2 className="text-[15px] font-medium tracking-[-0.015em] text-fg">Compare before you decide</h2>
            <p className="mt-1 max-w-[62ch] text-[13px] leading-[1.5] text-fg-muted">
              {chains
                ? "Actual staking APR, real yield after inflation, unbonding days, Nakamoto coefficient and price performance, side by side."
                : "Indexed price performance, drawdown and volatility, side by side."}{" "}
              {picks.mine ? (chains ? "Starting with the networks that hold most of your value." : "Starting with your largest assets.") : null}
            </p>
            <ul aria-label="Compared" className="mt-2.5 flex flex-wrap gap-1.5">
              {picks.items.map((item) => (
                <li
                  key={`${item.ref.kind}:${item.ref.id}`}
                  className="inline-flex h-7 items-center gap-1.5 rounded-full border border-[var(--d-hairline)] bg-[var(--d-glass)] pl-1 pr-2.5 text-[12.5px] font-medium text-fg"
                >
                  {item.logo}
                  {item.label}
                </li>
              ))}
            </ul>
          </div>
        </div>
        <Button variant="secondary" href={href} iconRight="arrowRight" className="self-start @min-[760px]:self-center">
          Open compare
        </Button>
      </div>
    </Card>
  );
}
