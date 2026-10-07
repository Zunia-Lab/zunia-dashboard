"use client";

/**
 * Rewards forecast and compounding simulator (research S3).
 *
 * Starts from your stake and your actual APR; both can be changed to try
 * another amount. Compares keeping rewards aside with restaking them every
 * day / week / month, net of the claim + delegate fee — measured by
 * simulating that exact transaction on one chain, or (across chains, where
 * one restake is a transaction per chain) estimated from fixed gas at each
 * chain's average gas price (the price Zunia proposes when you sign),
 * labelled as such. Only validators that earn are counted: a restake skips
 * jailed and inactive ones. Suggests the restake threshold where the fee and
 * the compounding balance out (√(2 · fee · stake)).
 *
 * The cadence starts on the option that leaves the most after fees ("Never"
 * when every restake loses), marked in the control; once the user picks
 * one, their choice stays.
 *
 * The chart draws the rewards earned (from zero), not the whole stake: the
 * question is "what does this earn and what does restaking add", and on a
 * stake-sized axis both lines hug each other at the top. Everything here is
 * a projection — APR, price and fee held at today's values — so both lines
 * are dashed and the caption says so.
 */

import { useCallback, useMemo, useState } from "react";
import { LineChart, VIZ_ACCENT, VIZ_OTHER, type TickFormatter } from "@/components/charts";
import { Button, Card, CardBody, CardHeader, Input, Segmented, Select, Skeleton, SourceTag, useNow } from "@/components/ui";
import { Icon } from "@/components/icons";
import { findChain } from "@/lib/chains";
import { cn } from "@/lib/cn";
import { useTxPreview } from "@/lib/data/wallet";
import { fallbackGasLimit } from "@/lib/tx/fees";
import { currencySymbol, formatFiat, formatPercent, MASK, sanitizeDecimalInput } from "@/lib/format";
import { buildDelegate, buildWithdrawReward } from "@/lib/tx/messages";
import type { SignRequest } from "@/lib/tx/types";
import { usePrefs } from "@/providers/PrefsProvider";
import { DAY_MS, positive, wholeText, type ChainView, type StakingView } from "./model";
import { bestOption, project, RESTAKE_OPTIONS, restakeIntervalDays, restakeThreshold, type RestakeOption } from "./projection";

const HORIZONS = [
  { value: "1", label: "1Y" },
  { value: "2", label: "2Y" },
  { value: "5", label: "5Y" },
] as const;
type Horizon = (typeof HORIZONS)[number]["value"];

const YEAR_MS = 365.25 * DAY_MS;

/** Positions a restake goes through: stake on an active validator (jailed or inactive ones earn nothing to compound). */
function earningPositions(chain: ChainView) {
  return chain.positions.filter((p) => positive(p.amount) && p.validator.status === "bonded" && p.validator.jailed !== true);
}

/** Claim from every validator of the chain and delegate each reward back: one restake. */
function restakeRequest(chain: ChainView): SignRequest | null {
  const positions = earningPositions(chain);
  if (positions.length === 0 || !chain.address) return null;
  const messages = positions.flatMap((p) => [
    buildWithdrawReward({ delegatorAddress: chain.address, validatorAddress: p.validator.operatorAddress }),
    buildDelegate({
      delegatorAddress: chain.address,
      validatorAddress: p.validator.operatorAddress,
      // The pending amount (at least one base unit, so a fresh position
      // still simulates a real delegate).
      amount: { denom: chain.denom, amount: positive(p.rewards) ? p.rewards : "1" },
    }),
  ]);
  return { chainId: chain.chainId, messages: messages.slice(0, 64) };
}

/**
 * Estimated fee of one restake on a chain, in its staking token's value;
 * null when unknown. Fixed gas per message (not measured) at the average gas
 * price, the tier the sign flow proposes, for the validators a restake goes
 * through.
 */
function estimatedFeeValue(chain: ChainView): number | null {
  const catalog = findChain(chain.chainId);
  const price = catalog?.gasPriceStep?.average;
  if (!catalog || price === undefined || chain.price === null || catalog.feeMinimalDenom !== chain.denom || chain.decimals === null) return null;
  const count = earningPositions(chain).length;
  if (count === 0) return 0;
  const gas = fallbackGasLimit(
    Array.from({ length: count }, () => [
      { typeUrl: "/cosmos.distribution.v1beta1.MsgWithdrawDelegatorReward" },
      { typeUrl: "/cosmos.staking.v1beta1.MsgDelegate" },
    ]).flat(),
  );
  return ((gas * price) / 10 ** chain.decimals) * chain.price;
}

function optionLabel(value: RestakeOption): string {
  return RESTAKE_OPTIONS.find((option) => option.value === value)?.label.toLowerCase() ?? "";
}

export interface RewardsForecastProps {
  view: StakingView;
  currency: string;
  single: ChainView | null;
  /** The answer on screen belongs to the previous scope (dimmed). */
  pending: boolean;
}

export function RewardsForecast({ view, currency, single, pending }: RewardsForecastProps) {
  const { hideAmounts } = usePrefs();
  const now = useNow();
  const staked = useMemo(() => view.chains.filter((chain) => positive(chain.staked)), [view.chains]);
  const pricedAll = view.totals.stakedValue !== null && view.totals.stakedValue > 0 && view.totals.weightedApr !== null;

  const [basisPick, setBasisPick] = useState<string | null>(null);
  const basis = single ? single.chainId : (basisPick ?? (pricedAll ? "all" : (staked[0]?.chainId ?? "all")));
  const chain = basis === "all" ? null : (staked.find((c) => c.chainId === basis) ?? single);

  const [horizon, setHorizon] = useState<Horizon>("2");
  // Null until the user picks: then the best cadence for the inputs is used.
  const [freqPick, setFreqPick] = useState<RestakeOption | null>(null);
  const [stakeText, setStakeText] = useState<string | null>(null);
  const [aprText, setAprText] = useState<string | null>(null);

  // Units: one chain's whole tokens, or fiat across chains.
  const unit = chain ? chain.symbol : currency.toUpperCase();
  const defaultStake = chain ? chain.stakedWhole : view.totals.stakedValue;
  const defaultApr = chain ? chain.aprWeighted : view.totals.weightedApr;
  const principal = stakeText !== null ? Number(stakeText || "0") : (defaultStake ?? 0);
  const apr = aprText !== null ? Number(aprText || "0") / 100 : (defaultApr ?? 0);

  // Fee per restake: measured on one chain (simulation, no wallet prompt).
  const request = useMemo(() => (chain ? restakeRequest(chain) : null), [chain]);
  const preview = useTxPreview(request);
  const measuredFee = preview.preview?.fee ?? null;
  const feeTokens = chain && measuredFee && measuredFee.denom === chain.denom ? Number(measuredFee.display) : null;
  const allFee = useMemo(() => {
    if (chain) return null;
    let total = 0;
    for (const c of staked) {
      const fee = estimatedFeeValue(c);
      if (fee === null) return null;
      total += fee;
    }
    return total;
  }, [chain, staked]);
  const fee = chain ? feeTokens : allFee;
  const feeKnown = fee !== null && Number.isFinite(fee);
  // Measured on one chain (simulation); fixed gas otherwise, or when the
  // simulation fell back to it.
  const feeEstimated = !chain || Boolean(preview.preview?.gas.estimate);

  const years = Number(horizon);
  // The cadence that leaves the most after fees; unknown while the fee is
  // (an unknown fee is not a free one, so nothing is recommended then).
  const recommended = useMemo(
    () => (feeKnown ? bestOption({ principal, apr, years, feePerRestake: fee ?? 0 }) : null),
    [feeKnown, principal, apr, years, fee],
  );
  const freq: RestakeOption = freqPick ?? recommended ?? "12";
  const perYear = RESTAKE_OPTIONS.find((option) => option.value === freq)?.perYear ?? 0;
  const projection = useMemo(
    () => project({ principal, apr, years, restakesPerYear: perYear, feePerRestake: feeKnown ? (fee ?? 0) : 0 }),
    [principal, apr, years, perYear, fee, feeKnown],
  );
  const threshold = feeKnown ? restakeThreshold(principal, fee ?? 0) : null;
  const interval = feeKnown ? restakeIntervalDays(principal, apr, fee ?? 0) : null;

  const tokenSymbol = chain ? chain.symbol : null;
  const fmt = useCallback(
    (value: number) =>
      hideAmounts
        ? MASK
        : tokenSymbol !== null
          ? `${wholeText(value, { maxFraction: Math.abs(value) < 1 ? 4 : 2, compact: Math.abs(value) >= 100_000 })} ${tokenSymbol}`
          : formatFiat(value, currency, { compact: Math.abs(value) >= 100_000 }),
    [hideAmounts, tokenSymbol, currency],
  );
  const symbolPrefix = tokenSymbol === null ? currencySymbol(currency) : "";
  const tick = useCallback<TickFormatter>(
    (value, { affix }) => (hideAmounts ? MASK : affix(value, symbolPrefix)),
    [hideAmounts, symbolPrefix],
  );

  const restakedLabel = perYear > 0 ? `Restaked ${optionLabel(freq)}` : "Restaked";
  const series = useMemo(() => {
    if (now === null || !(principal > 0)) return [];
    const at = (t: number) => now + t * YEAR_MS;
    const gained = projection.points.map((p) => ({ t: at(p.t), compound: p.compound - principal, simple: p.simple - principal }));
    return [
      { id: "compound", label: restakedLabel, color: VIZ_ACCENT, estimate: true, points: gained.map((p) => ({ t: p.t, v: p.compound })) },
      { id: "simple", label: "Kept aside", color: VIZ_OTHER, estimate: true, points: gained.map((p) => ({ t: p.t, v: p.simple })) },
    ];
  }, [now, principal, projection, restakedLabel]);

  const basisOptions = [
    ...(pricedAll ? [{ value: "all", label: `All networks (${currency.toUpperCase()})` }] : []),
    ...staked.map((c) => ({ value: c.chainId, label: `${c.chainName} (${c.symbol})` })),
  ];
  const showBasis = !single && basisOptions.length > 1;

  const simpleGain = projection.simpleEnd - principal;
  const compoundGain = projection.compoundEnd - principal;
  // Float noise of two equal sums is not a gain ("+<$0.00000001").
  const gain = Math.abs(projection.gain) < 1e-9 * Math.max(1, principal) ? 0 : projection.gain;
  const feeSource = chain ? (
    preview.preview?.gas.estimate ? (
      <SourceTag source="fixed gas" estimate />
    ) : (
      <SourceTag source="simulated" />
    )
  ) : (
    <SourceTag source="fixed gas, average price" estimate />
  );

  return (
    <Card as="section" aria-label="Rewards forecast" pending={pending}>
      <CardHeader
        title="Rewards forecast"
        subtitle="At today's APR, price and fees · an estimate"
        info="What your stake earns, and what restaking the rewards adds once its fees are paid. APR, token price and fee are held at today's values; real APR moves with inflation and the bonded ratio, and fee or MEV income is not included. A restake is skipped when the rewards would not cover its fee."
        actions={<Segmented ariaLabel="Forecast horizon" options={[...HORIZONS]} value={horizon} onChange={setHorizon} mono />}
      />
      <CardBody className="flex flex-col gap-4">
        <dl className="grid grid-cols-3 gap-3 rounded-[var(--d-radius-inner)] bg-[var(--d-card-2)] px-3.5 py-3">
          {[
            { label: "Per day", value: (principal * apr) / 365 },
            { label: "Per month", value: (principal * apr) / 12 },
            { label: "Per year", value: principal * apr },
          ].map((entry) => (
            <div key={entry.label} className="min-w-0">
              <dt className="text-[12px] text-fg-dim">{entry.label}</dt>
              {/* Wraps rather than truncates: a third of a phone-width card
                  cut "0.0141 OSMO" to "0.0141 OS…", hiding the unit. */}
              <dd className="mt-0.5 break-words text-[16px] font-semibold tracking-[-0.02em] tabular-nums text-fg sm:text-[18px]">
                {principal > 0 ? fmt(entry.value) : "—"}
              </dd>
            </div>
          ))}
        </dl>

        <div className={cn("grid grid-cols-2 gap-3", showBasis && "sm:grid-cols-[minmax(0,1.45fr)_minmax(0,1fr)_minmax(0,0.75fr)]")}>
          {showBasis ? (
            <Select
              label="Simulate"
              value={basis}
              onChange={(value) => {
                setBasisPick(value);
                setStakeText(null);
                setAprText(null);
              }}
              options={basisOptions}
              className="col-span-2 sm:col-span-1"
            />
          ) : null}
          <Input
            label="Stake"
            inputMode="decimal"
            value={hideAmounts && stakeText === null ? MASK : (stakeText ?? (defaultStake === null ? "" : String(Math.round(defaultStake * 100) / 100)))}
            readOnly={hideAmounts && stakeText === null}
            onChange={(event) => setStakeText(sanitizeDecimalInput(event.target.value, 6))}
            trailing={<span className="text-[12.5px]">{unit}</span>}
            hint={stakeText === null ? "your stake now" : "your own figure"}
          />
          <Input
            label="APR"
            inputMode="decimal"
            value={aprText ?? (defaultApr === null ? "" : (defaultApr * 100).toFixed(2))}
            onChange={(event) => setAprText(sanitizeDecimalInput(event.target.value, 2))}
            trailing={<span className="text-[12.5px]">%</span>}
            hint={aprText === null ? "after commission" : "your own figure"}
          />
        </div>

        <div className="flex flex-col gap-1.5 sm:flex-row sm:items-center sm:gap-3">
          <span className="shrink-0 text-[12.5px] font-medium text-fg-muted">
            Restake rewards
          </span>
          <Segmented
            ariaLabel="Restake frequency"
            options={RESTAKE_OPTIONS.map((option) =>
              option.value === recommended
                ? {
                    value: option.value,
                    label: option.label,
                    // Marked, not only preselected: the mark stays when another one is picked.
                    icon: <Icon name="sparkle" size={13} className="shrink-0 text-[var(--d-accent-text)]" />,
                    ariaLabel: `${option.label}, pays best for this stake`,
                  }
                : { value: option.value, label: option.label },
            )}
            value={freq}
            onChange={setFreqPick}
            size="md"
            fullWidth
            className="sm:flex-1"
          />
        </div>

        {series.length > 0 ? (
          <LineChart
            series={series}
            height={176}
            valueFormatter={fmt}
            tickFormatter={tick}
            yAxis="right"
            yDomain="zero"
            endLabels="none"
            title={`Rewards earned over ${years} year${years === 1 ? "" : "s"}${tokenSymbol ? `, in ${tokenSymbol}` : ""}`}
            ariaLabel={`Rewards earned over ${years} year${years === 1 ? "" : "s"}: kept aside ${fmt(simpleGain)}, ${restakedLabel.toLowerCase()} ${fmt(compoundGain)}. Estimate.`}
          />
        ) : now === null ? (
          <Skeleton className="h-[200px] w-full rounded-[12px]" />
        ) : (
          <p className="text-[13px] text-fg-dim">Enter a stake to see the projection.</p>
        )}

        {principal > 0 ? (
          <div className="flex flex-col gap-2">
            <dl className="grid grid-cols-3 gap-3 text-[13px]">
              <div className="min-w-0">
                <dt className="truncate text-[12px] text-fg-dim">Kept aside · {years}y</dt>
                <dd className="truncate font-medium tabular-nums text-fg">+{fmt(simpleGain)}</dd>
              </div>
              <div className="min-w-0">
                <dt className="truncate text-[12px] text-fg-dim">
                  Restaked<span className="max-sm:hidden"> {perYear > 0 ? optionLabel(freq) : ""}</span>
                </dt>
                <dd className="truncate font-medium tabular-nums text-fg">+{fmt(compoundGain)}</dd>
              </div>
              <div className="min-w-0">
                <dt className="truncate text-[12px] text-fg-dim">Restaking adds</dt>
                {perYear === 0 ? (
                  // Nothing restaked, nothing to compare (the two lines are one).
                  <dd className="truncate font-medium text-fg-dim">—</dd>
                ) : (
                  <dd className={cn("truncate font-medium tabular-nums", gain >= 0 ? "text-[var(--d-pos)]" : "text-[var(--z-danger)]")}>
                    {gain > 0 ? "+" : gain < 0 ? "−" : ""}
                    {fmt(Math.abs(gain))}
                    {simpleGain > 0 && gain !== 0 ? (
                      <span className="ml-1 font-normal text-fg-dim max-sm:hidden">
                        ({formatPercent((gain / simpleGain) * 100, { digits: 1, signed: true })})
                      </span>
                    ) : null}
                  </dd>
                )}
              </div>
            </dl>
            <p className="flex flex-wrap items-center gap-x-1.5 gap-y-1 text-[12px] leading-snug text-fg-dim">
              <span>
                {perYear > 0
                  ? `${projection.restakes} restakes, ${fmt(projection.fees)} in fees${projection.skipped > 0 ? ` (${projection.skipped} skipped: rewards under the fee)` : ""}.`
                  : "No restakes: rewards accrue without compounding."}
              </span>
              <span>
                Fee per restake: {feeKnown ? fmt(fee ?? 0) : preview.loading && chain ? "measuring…" : "unknown (not counted)"}
              </span>
              {feeKnown ? feeSource : null}
            </p>
          </div>
        ) : null}

        {threshold !== null && interval !== null && principal > 0 && apr > 0 ? (
          <div className="flex flex-col gap-2 rounded-[var(--d-radius-inner)] border border-[var(--d-hairline)] bg-[var(--d-card-2)] px-3.5 py-3 sm:flex-row sm:items-center">
            <Icon name="sparkle" size={18} className="hidden shrink-0 text-[var(--d-accent-text)] sm:block" />
            <p className="min-w-0 flex-1 text-[13px] leading-snug text-fg-muted">
              <span className="font-medium text-fg">Restake when rewards reach about {fmt(threshold)}</span>, roughly every{" "}
              {interval < 1 ? "day" : `${Math.round(interval)} days`} at this APR: where the fee and the compounding balance out.
              {recommended === "0" && interval > 31 ? " Even monthly restakes come sooner than that, so their fees cost more than they add." : null}
              {feeEstimated ? " The fee is an estimate, so take this as a rough guide." : null}
            </p>
            {recommended !== null && recommended !== freq ? (
              <Button size="sm" variant="secondary" className="shrink-0 self-start sm:self-center" onClick={() => setFreqPick(recommended)}>
                {recommended === "0" ? "Don't restake" : `Use ${optionLabel(recommended)}`}
              </Button>
            ) : null}
          </div>
        ) : null}
      </CardBody>
    </Card>
  );
}
