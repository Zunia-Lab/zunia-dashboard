"use client";

/**
 * "Do now" for staking: positions whose validator earns nothing (jailed,
 * tombstoned, out of the active set) or is about to be jailed (uptime under
 * 95 %), each with the one action that fixes it — moving the stake, which is
 * instant and keeps it staked. Shown above the positions only when there is
 * something to do; the row badges carry the same facts in context.
 *
 * Facts, not advice: each line says what the chain reports and what it
 * costs (the stake earns nothing), and the button opens the reviewed move.
 */

import { Button, Callout, TokenAmount } from "@/components/ui";
import { attentionFlags, positive, type ChainView, type PositionView } from "./model";
import { useStakingFlows } from "./flows/StakingFlows";

interface Item {
  chain: ChainView;
  position: PositionView;
  /** The worst flag, which names the problem. */
  flag: ReturnType<typeof attentionFlags>[number];
}

const MAX_SHOWN = 3;

function problem(item: Item): string {
  switch (item.flag.id) {
    case "tombstoned":
      return "is tombstoned: this stake earns nothing, ever";
    case "jailed":
      return "is jailed: this stake earns nothing";
    case "inactive":
      return "is out of the active set: this stake earns nothing";
    case "uptime":
      return `keeps missing blocks (${item.flag.label.toLowerCase()}): it may be jailed`;
    default:
      return item.flag.detail;
  }
}

export function AttentionCallout({ chains }: { chains: readonly ChainView[] }) {
  const flows = useStakingFlows();
  const items: Item[] = [];
  for (const chain of chains) {
    for (const position of chain.positions) {
      if (!positive(position.amount)) continue;
      const flags = attentionFlags(position.flags);
      if (flags[0]) items.push({ chain, position, flag: flags[0] });
    }
  }
  if (items.length === 0) return null;
  const earningNothing = items.some((item) => item.flag.tone === "danger" || item.flag.id === "inactive");
  const shown = items.slice(0, MAX_SHOWN);

  return (
    <Callout
      tone={earningNothing ? "danger" : "warning"}
      title={`${items.length} position${items.length === 1 ? " needs" : "s need"} attention`}
    >
      <ul className="mt-1 flex flex-col gap-2">
        {shown.map((item) => (
          <li key={item.position.key} className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1.5">
            <span className="min-w-0 flex-1 basis-[18rem]">
              <span className="font-medium text-fg">{item.position.validator.moniker}</span> on {item.chain.chainName} {problem(item)} (
              {/* The kit's dim ticker falls under 4.5:1 on the callout's tint (light theme). */}
              <TokenAmount
                amount={item.position.amount}
                decimals={item.chain.decimals}
                symbol={item.chain.symbol}
                maxFraction={2}
                symbolClassName="text-fg-muted"
              />
              ).
            </span>
            <Button
              size="sm"
              variant={item.flag.tone === "danger" ? "primary" : "secondary"}
              iconLeft="swap"
              disabled={Boolean(item.position.redelegationLockUntil)}
              title={item.position.redelegationLockUntil ? "Recently moved here: the network refuses another move until it settles" : undefined}
              onClick={() => flows.open({ kind: "redelegate", chainId: item.chain.chainId, src: item.position.validator.operatorAddress })}
            >
              Move stake
            </Button>
          </li>
        ))}
      </ul>
      {items.length > MAX_SHOWN ? <p className="mt-1.5 text-[12.5px]">And {items.length - MAX_SHOWN} more in the positions below.</p> : null}
    </Callout>
  );
}
