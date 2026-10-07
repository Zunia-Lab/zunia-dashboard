"use client";

/**
 * Idle balance to stake (research S5): on each network, the liquid staking
 * token above a fee reserve, what it would earn at a typical validator
 * (chain actual APR after the median commission), and the network's actual
 * inflation, which an unstaked balance does not earn back. One click opens
 * the stake sheet with the amount filled in.
 *
 * "Nothing idle" is only said once the balances were read: while they (or
 * the first prices and APRs, which value and order the rows) load, the card
 * shows rows of skeleton, and a failed read says so.
 */

import { Button, Card, CardBody, CardFooter, CardHeader, ChainLogo, Money, Skeleton, TokenAmount } from "@/components/ui";
import { percentOf } from "./model";
import type { IdleItem } from "./hooks";
import { useStakingFlows } from "./flows/StakingFlows";

export interface IdleCardProps {
  items: IdleItem[];
  currency: string;
  loading: boolean;
  /** The balances could not be read. */
  error?: boolean;
  /** The prices and APRs could not be read: rows say so rather than "APR unavailable". */
  ratesError?: boolean;
  /** One chain in scope (the copy names no networks). */
  single?: boolean;
}

export function IdleCard({ items, currency, loading, error = false, ratesError = false, single = false }: IdleCardProps) {
  const flows = useStakingFlows();
  const priced = items.length > 0 && items.every((item) => item.idleValue !== null);
  const totalValue = priced ? items.reduce((sum, item) => sum + (item.idleValue ?? 0), 0) : null;
  const yearly = priced && items.every((item) => item.yearlyValue !== null) ? items.reduce((sum, item) => sum + (item.yearlyValue ?? 0), 0) : null;
  // `loading` is only ever a first read (a refresh keeps the rows), so the
  // skeleton stands even over rows from balances read before the prices.
  const first = loading;

  return (
    <Card as="section" aria-label="Idle balance to stake">
      <CardHeader
        title="Idle to stake"
        subtitle={
          totalValue !== null ? (
            <>
              <Money value={totalValue} currency={currency} compact={totalValue >= 100_000} /> idle
              {yearly !== null ? (
                <>
                  {" "}
                  · could earn ≈ <Money value={yearly} currency={currency} compact={yearly >= 100_000} /> a year
                </>
              ) : null}
            </>
          ) : (
            "Liquid balance above a fee reserve"
          )
        }
        info="Your liquid staking token on each network, minus a reserve for three staking transactions' fees. The rate is the network's actual APR after the median validator commission (an estimate). Inflation is the network's actual issuance: an unstaked balance does not earn it back, so its share of supply shrinks."
      />
      <CardBody>
        {first ? (
          <div className="flex flex-col gap-3.5" aria-hidden>
            {[0, 1].map((i) => (
              <div key={i} className="flex items-center gap-3">
                <Skeleton circle width={28} />
                <span className="flex flex-1 flex-col gap-1.5">
                  <Skeleton className="h-3" width="45%" />
                  <Skeleton className="h-2.5" width="70%" />
                </span>
                <Skeleton className="h-8 w-16 rounded-[10px]" />
              </div>
            ))}
          </div>
        ) : error && items.length === 0 ? (
          <p className="text-[13px] leading-snug text-fg-dim">Your balances could not be read just now, so the idle amount is unknown.</p>
        ) : items.length === 0 ? (
          <p className="text-[13px] leading-snug text-fg-dim">
            Nothing idle worth staking: your liquid {single ? "balance is" : "balances are"} at or under the fee reserve.
          </p>
        ) : (
          <ul className="-my-1 flex flex-col divide-y divide-[var(--d-hairline)]">
            {items.slice(0, 5).map((item) => (
              <li key={item.chainId} className="flex items-center gap-3 py-2.5">
                <ChainLogo chainId={item.chainId} chain={{ chainName: item.chainName, coinDenom: item.symbol, iconUrl: item.iconUrl }} size={28} />
                <div className="min-w-0 flex-1">
                  <div className="flex items-baseline justify-between gap-2">
                    <span className="truncate text-[14px] font-medium text-fg">{item.chainName}</span>
                    <TokenAmount
                      amount={item.idle}
                      decimals={item.decimals}
                      symbol={item.symbol}
                      maxFraction={2}
                      className="shrink-0 text-[13.5px] text-fg"
                    />
                  </div>
                  <p className="mt-0.5 flex flex-wrap gap-x-1.5 text-[12px] leading-snug text-fg-dim">
                    <span>
                      {item.apr !== null ? `Earns ≈ ${percentOf(item.apr, 1)}` : ratesError ? "APR couldn't be read just now" : "APR unavailable"}
                      {item.yearlyValue !== null ? (
                        <>
                          {" "}
                          (<Money value={item.yearlyValue} currency={currency} />
                          /yr)
                        </>
                      ) : null}
                    </span>
                    {item.inflation !== null && item.inflation > 0 ? <span>· inflation {percentOf(item.inflation, 1)}</span> : null}
                  </p>
                </div>
                <Button
                  size="sm"
                  variant="secondary"
                  className="shrink-0"
                  onClick={() => flows.open({ kind: "delegate", chainId: item.chainId, amount: item.idle })}
                  aria-label={`Stake ${item.symbol} on ${item.chainName}`}
                >
                  Stake
                </Button>
              </li>
            ))}
          </ul>
        )}
      </CardBody>
      {items.length > 0 && !first ? (
        <CardFooter className="text-[12px]">
          {items.length > 5 ? `${items.length - 5} more network${items.length - 5 === 1 ? "" : "s"} not shown · ` : null}
          Keeps a reserve for three transactions&apos; fees{single ? "" : " on each network"}.
        </CardFooter>
      ) : null}
    </Card>
  );
}
