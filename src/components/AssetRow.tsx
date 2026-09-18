"use client";

import Link from "next/link";
import {
  TokenLogo,
  amountPrimaryClass,
  amountSecondaryClass,
  cn,
} from "@zunialab/ui";
import {
  formatAmount,
  formatFiat,
  type ChainHolding,
} from "@/lib/usePortfolio";
import { usePrefs } from "@/providers/PrefsProvider";

export function AssetRow({
  holding,
  currency = "USD",
}: {
  holding: ChainHolding;
  currency?: string;
}) {
  const { mask } = usePrefs();
  const amount = formatAmount(holding.available, holding.decimals);

  return (
    <Link
      href={`/assets/${encodeURIComponent(holding.symbol)}?chainId=${encodeURIComponent(holding.chainId)}`}
      className="flex items-center gap-3 rounded-[12px] px-3 py-3 transition-colors duration-[var(--z-duration-base)] hover:bg-[var(--z-state-hover)] sm:gap-4 sm:px-4 sm:py-3.5"
    >
      <TokenLogo
        src={holding.iconUrl}
        symbol={holding.symbol}
        size={40}
      />

      <span className="min-w-0 flex-1">
        <span className="block truncate text-[15px] font-medium text-fg">
          {holding.chainName}
        </span>
        <span className="mt-1 flex items-center gap-2 font-mono text-[12.5px] text-fg-dim">
          {holding.price === null ? (
            <span>no price feed</span>
          ) : (
            <>
              <span>{formatFiat(holding.price, currency)}</span>
              {holding.change24h === null ? null : (
                <span
                  className={
                    holding.change24h >= 0
                      ? "text-[var(--z-success)]"
                      : "text-[var(--z-danger)]"
                  }
                >
                  {holding.change24h >= 0 ? "+" : ""}
                  {holding.change24h.toFixed(1)}%
                </span>
              )}
            </>
          )}
        </span>
      </span>

      {/*
        Capped and truncating: `holding.error` is an upstream message of
        arbitrary length, and an uncapped shrink-0 column pushed the row wider
        than the card, which put a horizontal scrollbar on the whole page.
      */}
      <span className="max-w-[48%] shrink-0 text-right">
        <span className={cn(amountPrimaryClass, "block truncate text-[16px]")}>
          {mask(
            holding.value === null
              ? `${amount} ${holding.symbol}`
              : formatFiat(holding.value, currency),
          )}
        </span>
        <span
          className={cn(amountSecondaryClass, "truncate")}
          title={holding.error}
        >
          {holding.error
            ? holding.error
            : mask(`${amount} ${holding.symbol}`)}
        </span>
      </span>
    </Link>
  );
}
