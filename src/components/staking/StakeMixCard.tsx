"use client";

/**
 * Where the stake sits and how healthy that is, in one card: an allocation
 * bar (by network across chains, by validator within one) and five checks
 * with their numbers — earning, decentralisation, commission today and what
 * it can rise to, weakest uptime, concentration on one validator.
 *
 * Facts, not advice: each line states a measured share and what it means.
 */

import { useCallback, useMemo } from "react";
import { StackedBar, stableColorMap, type PartDatum } from "@/components/charts";
import { Card, CardBody, CardHeader, Divider, Tooltip } from "@/components/ui";
import { Icon, type IconName } from "@/components/icons";
import { cn } from "@/lib/cn";
import { formatFiat, formatPercent, MASK } from "@/lib/format";
import { usePrefs } from "@/providers/PrefsProvider";
import { stakeHealth, steepCommissionRise, wholeText, type ChainView } from "./model";

type Tone = "good" | "warn" | "bad" | "neutral";

const TONE_CLASS: Record<Tone, string> = {
  good: "text-[var(--d-pos)]",
  warn: "text-[var(--z-warning)]",
  bad: "text-[var(--z-danger)]",
  neutral: "text-fg-dim",
};

const TONE_ICON: Record<Tone, IconName> = { good: "success", warn: "warning", bad: "danger", neutral: "info" };

function HealthRow({ tone, label, value, detail }: { tone: Tone; label: string; value: string; detail: string }) {
  return (
    <li className="flex items-start gap-2.5 py-2">
      <Icon name={TONE_ICON[tone]} size={16} className={cn("mt-0.5 shrink-0", TONE_CLASS[tone])} />
      <div className="min-w-0 flex-1">
        <div className="flex items-baseline justify-between gap-3">
          <span className="text-[13.5px] text-fg">{label}</span>
          <span className="shrink-0 text-[13.5px] font-medium tabular-nums text-fg">{value}</span>
        </div>
        <p className="mt-0.5 text-[12px] leading-snug text-fg-dim">{detail}</p>
      </div>
    </li>
  );
}

/**
 * A share that never rounds to a lie: 99.997% reads ">99.9%", not "100.0%",
 * and 0.003% reads "<0.1%", not "0.0%".
 */
const pct = (fraction: number, digits = 1) => {
  const step = 10 ** -digits / 100;
  if (fraction > 0 && fraction < 1 && fraction > 1 - step) return `>${formatPercent(100 - 10 ** -digits, { digits })}`;
  if (fraction > 0 && fraction < step) return `<${formatPercent(10 ** -digits, { digits })}`;
  return formatPercent(fraction * 100, { digits });
};

export function StakeMixCard({
  chains,
  currency,
  single,
  pending,
  pricesError = false,
}: {
  chains: ChainView[];
  currency: string;
  single: ChainView | null;
  /** The answer on screen belongs to the previous scope (dimmed). */
  pending: boolean;
  /** The prices read failed: shares by value cannot be drawn, for that reason. */
  pricesError?: boolean;
}) {
  const { hideAmounts } = usePrefs();
  const staked = useMemo(() => chains.filter((chain) => chain.positions.length > 0), [chains]);

  // By network across chains (value); by validator within one (tokens).
  const parts = useMemo<PartDatum[]>(() => {
    if (single) {
      return single.positions
        .filter((p) => p.whole !== null && p.whole > 0)
        .map((p) => ({ id: p.validator.operatorAddress, label: p.validator.moniker, value: p.whole ?? 0 }));
    }
    return staked
      .filter((chain) => chain.stakedValue !== null && chain.stakedValue > 0)
      .map((chain) => ({ id: chain.chainId, label: chain.chainName, value: chain.stakedValue ?? 0 }));
  }, [single, staked]);
  const colors = useMemo(() => stableColorMap(parts.map((part) => part.id)), [parts]);
  const unpriced = single ? [] : staked.filter((chain) => chain.stakedValue === null);

  const health = useMemo(() => stakeHealth(single ? [single] : staked, single ? "tokens" : "value"), [single, staked]);

  const tokenSymbol = single ? single.symbol : null;
  const formatter = useCallback(
    (value: number) =>
      hideAmounts
        ? MASK
        : tokenSymbol !== null
          ? `${wholeText(value, { maxFraction: value < 1 ? 4 : 2, compact: value >= 10_000 })} ${tokenSymbol}`
          : formatFiat(value, currency, { compact: value >= 10_000 }),
    [hideAmounts, tokenSymbol, currency],
  );

  const rows: Array<{ key: string; tone: Tone; label: string; value: string; detail: string }> = [];
  if (health.earningShare !== null) {
    const idle = 1 - health.earningShare;
    const count = health.idlePositions;
    rows.push({
      key: "earning",
      tone: count > 0 ? "bad" : "good",
      label: "Earning",
      value: pct(health.earningShare),
      detail:
        count > 0
          ? `${count} validator${count === 1 ? " is" : "s are"} jailed or inactive, so ${pct(idle, 2)} of your stake earns nothing. Move it.`
          : "Every validator you use is active and not jailed.",
    });
  }
  if (health.nakamotoShare !== null) {
    rows.push({
      key: "nakamoto",
      tone: health.nakamotoShare >= 0.5 ? "warn" : health.nakamotoShare > 0 ? "neutral" : "good",
      label: "In the Nakamoto set",
      value: pct(health.nakamotoShare),
      detail:
        health.nakamotoShare > 0
          ? "Share of your stake with the few validators that together could halt their chain. Smaller validators spread power out."
          : "None of your stake adds to the largest validators' share of power.",
    });
  }
  if (health.commission !== null) {
    const rise = health.commissionReach30d !== null ? health.commissionReach30d - health.commission : 0;
    rows.push({
      key: "commission",
      tone: health.commissionReach30d !== null && steepCommissionRise(health.commission, health.commissionReach30d) ? "warn" : "neutral",
      label: "Commission",
      value: pct(health.commission),
      detail:
        health.commissionReach30d !== null && rise > 0.0005
          ? `Weighted by stake. Your validators may raise it to ${pct(health.commissionReach30d)} on average within 30 days, within their own limits.`
          : "Weighted by stake. Your validators cannot raise it within 30 days.",
    });
  }
  if (health.lowestUptime) {
    const low = health.lowestUptime.uptime;
    rows.push({
      key: "uptime",
      tone: low < 0.95 ? "bad" : low < 0.99 ? "warn" : "good",
      label: "Weakest uptime",
      value: pct(low, 2),
      detail: `${health.lowestUptime.moniker}, over the chain's current signing window.`,
    });
  }
  if (health.largest && health.weighed > 1) {
    rows.push({
      key: "largest",
      tone: health.largest.share >= 0.75 ? "warn" : "neutral",
      label: "Largest validator",
      value: pct(health.largest.share),
      detail: `${health.largest.moniker} holds this share of your stake${single ? "" : " (by value)"}. One validator's downtime or slash hits it whole.`,
    });
  }

  return (
    <Card pending={pending} as="section" aria-label="Stake mix and health">
      <CardHeader
        title="Stake mix"
        subtitle={single ? `By validator on ${single.chainName}` : "By network, by value"}
        info="The checks below are measured from on-chain data: validator status, the Nakamoto set (the smallest group holding over a third of voting power), commission limits, and signed blocks in the current window."
      />
      <CardBody className="flex flex-col gap-3">
        {parts.length > 0 ? (
          <StackedBar
            data={parts}
            colors={colors}
            maxSegments={5}
            valueFormatter={formatter}
            ariaLabel={single ? `Your stake on ${single.chainName} by validator` : "Your staked value by network"}
            legendFooter={
              unpriced.length > 0 ? (
                <span>
                  Not counted (no price): {unpriced.map((chain) => chain.chainName).join(", ")}
                </span>
              ) : undefined
            }
          />
        ) : staked.length === 0 ? (
          <p className="text-[13px] text-fg-dim">Nothing staked in this scope yet.</p>
        ) : (
          // Stake exists but cannot be weighed: say why, never "nothing staked".
          <p className="text-[13px] leading-snug text-fg-dim">
            {single
              ? single.decimals === null
                ? "This token's decimals are unknown, so shares between validators can't be drawn."
                : "Nothing staked in this scope yet."
              : pricesError
                ? "Prices couldn't be read just now, so shares by value can't be drawn."
                : `No price for ${staked.map((chain) => chain.chainName).join(", ")}: shares by value can't be drawn.`}
          </p>
        )}
        {rows.length > 0 ? (
          <>
            <Divider />
            <ul aria-label="Stake health" className="-my-1 flex flex-col divide-y divide-[var(--d-hairline)]">
              {rows.map(({ key, ...row }) => (
                <HealthRow key={key} {...row} />
              ))}
            </ul>
            {health.excluded > 0 ? (
              <Tooltip content="Across networks, shares are of value; positions without a price cannot be weighed.">
                <p className="text-[12px] text-fg-dim">
                  {health.excluded} unpriced position{health.excluded === 1 ? "" : "s"} not weighed.
                </p>
              </Tooltip>
            ) : null}
          </>
        ) : null}
      </CardBody>
    </Card>
  );
}
