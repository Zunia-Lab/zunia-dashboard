"use client";

/**
 * The wallet's side of a chain's page: its position here (value, stake,
 * rewards, unbonding, its APR after commission, and the Stake / Claim
 * actions that open the Staking page's own review sheets), and the assets
 * it holds on the chain. Without a wallet the position card is the page's
 * "Connect to see your position" panel. Amounts follow the privacy setting.
 */

import { Meter } from "@/components/charts";
import {
  AssetLogo,
  Button,
  Card,
  CardHeader,
  EmptyState,
  KeyValueList,
  Money,
  Percent,
  RelativeTime,
  SkeletonText,
  TokenAmount,
  type KeyValueItem,
} from "@/components/ui";
import type { ChainEntry } from "@/lib/chains";
import type { StakingChain } from "@/lib/data/staking";
import { formatPercent, formatTokenAmount } from "@/lib/format";
import { UNPRICED_TEXT, type PortfolioResponse } from "@/lib/token/wire";
import { Dash } from "./cells";
import { CLAIM_FEE_MULTIPLE, claimCheck } from "./claim";
import { toPct } from "./model";

/* ------------------------------------------------------------------ position */

interface PositionCardProps {
  chain: ChainEntry;
  connected: boolean;
  /**
   * A remembered wallet is still restoring: show the loading frame, not the
   * connect prompt (a returning user was asked to connect for the seconds a
   * phone session or a slow extension takes to answer, and a click on that
   * flash opened the connect dialog over a session about to land).
   */
  restoring?: boolean;
  followed: boolean;
  /** The chain's actual APR (fraction), for the "Stake" prompt; null when unknown. */
  stakingApr: number | null;
  portfolio: PortfolioResponse | null;
  portfolioLoading: boolean;
  staking: StakingChain | null;
  stakingLoading: boolean;
  onConnect: () => void;
  onFollow: () => void;
  className?: string;
}

export function PositionCard({
  chain,
  connected,
  restoring = false,
  followed,
  stakingApr,
  portfolio,
  portfolioLoading,
  staking,
  stakingLoading,
  onConnect,
  onFollow,
  className,
}: PositionCardProps) {
  if (!connected && !restoring) {
    return (
      <Card variant="hero" className={className}>
        <CardHeader title="Your position" icon="wallet" />
        <div className="flex flex-1 flex-col justify-between gap-4">
          <p className="text-[13.5px] leading-[1.55] text-fg-muted">
            Connect to see what you hold and stake on {chain.chainName}, your rewards and your APR after commission. Keys stay in
            your wallet.
          </p>
          <Button variant="primary" iconLeft="wallet" onClick={onConnect} className="self-start">
            Connect wallet
          </Button>
        </div>
      </Card>
    );
  }
  const held = portfolio?.chains.find((entry) => entry.chainId === chain.chainId) ?? null;
  const currency = portfolio?.currency;
  const decimals = staking?.decimals ?? chain.coinDecimals;
  const symbol = staking?.symbol ?? chain.coinDenom;
  const next = staking?.nextUnbonding ?? null;
  const loading = (!connected && restoring) || (portfolioLoading && !held) || (stakingLoading && !staking);

  const rows: KeyValueItem[] = [
    {
      key: "staked",
      label: "Staked",
      value: staking ? <TokenAmount amount={staking.totals.staked} decimals={decimals} symbol={symbol} compact reason="Delegations could not be read" /> : <Dash reason="Not read" />,
      sub: held?.staked !== null && held?.staked !== undefined ? <Money value={held.staked} currency={currency} compact /> : undefined,
    },
    {
      key: "rewards",
      label: "Claimable rewards",
      value: staking ? <TokenAmount amount={staking.totals.rewards} decimals={decimals} symbol={symbol} reason="Rewards could not be read" /> : <Dash reason="Not read" />,
      sub: held?.rewards !== null && held?.rewards !== undefined ? <Money value={held.rewards} currency={currency} compact /> : undefined,
    },
    {
      key: "unbonding",
      label: "Unbonding",
      value: staking ? <TokenAmount amount={staking.totals.unbonding} decimals={decimals} symbol={symbol} compact reason="Unbonding could not be read" /> : <Dash reason="Not read" />,
      sub: next ? (
        <>
          Next release <RelativeTime at={Date.parse(next.completionTime)} />
        </>
      ) : undefined,
    },
    {
      key: "apr",
      label: "Your APR",
      info: "Stake-weighted APR after each validator's commission; inactive validators earn nothing.",
      value: <Percent value={toPct(staking?.apr.weighted)} reason={staking && staking.delegations.length === 0 ? "Nothing staked here" : "Not computable"} />,
    },
  ];

  const chainParam = encodeURIComponent(chain.chainId);
  const delegations = staking?.delegations.length ?? 0;
  // Act on what the page just showed: stake when nothing is staked here yet
  // (the chain pays a known APR), claim when rewards wait and are worth the
  // fee (the Overview's test, see ./claim). Both open the Staking page's own
  // review sheets, which sign nothing before confirming.
  const canStake = Boolean(staking) && delegations === 0 && stakingApr !== null && stakingApr > 0 && chain.network === "mainnet";
  const claim = claimCheck(chain, staking);

  return (
    <Card variant="hero" className={className}>
      <CardHeader title="Your position" icon="wallet" />
      {loading ? (
        <SkeletonText lines={5} />
      ) : (
        <>
          <div>
            <p className="d-label">Value on {chain.chainName}</p>
            <p className="mt-1.5 text-[28px] font-semibold leading-none tracking-[-0.03em]">
              {held ? (
                <Money value={held.value} currency={currency} reason={held.error ?? "Nothing held here has a price"} />
              ) : followed ? (
                <Dash reason="Your wallet has no address on this chain" />
              ) : (
                <Dash reason="Follow this chain to value your holdings on it" />
              )}
            </p>
            {!followed ? (
              <p className="mt-2 text-[12.5px] text-fg-dim">
                Your portfolio reads followed chains only.{" "}
                <button type="button" onClick={onFollow} className="d-hit font-medium text-[var(--d-accent-text)] hover:underline">
                  Follow {chain.chainName}
                </button>
              </p>
            ) : null}
          </div>
          {/* Without a staking read (a chain not followed, so not read) the
              rows would be four dashes: the follow prompt above says why. */}
          {staking || followed ? <KeyValueList items={rows} divided /> : null}
          <div className="mt-auto flex flex-wrap items-center gap-2 pt-1">
            {canStake ? (
              <Button size="sm" variant="primary" iconLeft="staking" href={`/staking?action=delegate&chain=${chainParam}`}>
                Stake {symbol}
              </Button>
            ) : null}
            {claim.kind === "offer" ? (
              <Button size="sm" variant="secondary" href={`/staking?action=claim&chain=${chainParam}`}>
                Claim rewards
              </Button>
            ) : claim.kind === "costly" ? (
              // The fact behind the missing button, with its figure: an
              // estimate of a protocol cost, not a holding, so never masked.
              <span
                className="text-[12.5px] leading-snug text-fg-dim"
                title={`Claim rewards shows once they are worth ${CLAIM_FEE_MULTIPLE}× the estimated fee, as on Overview. Est.: the network's average gas price × a generous gas limit; real fees are usually lower.`}
              >
                {claim.feeShare >= 1
                  ? `Rewards below the claim fee (≈ ${formatTokenAmount(claim.fee, decimals)} ${symbol}, est.)`
                  : `The claim fee (≈ ${formatTokenAmount(claim.fee, decimals)} ${symbol}, est.) would take ${formatPercent(claim.feeShare * 100, { digits: 0 })} of them`}
              </span>
            ) : null}
            <Button size="sm" variant="ghost" href={`/staking?chain=${chainParam}`} iconRight="arrowRight" className="ml-auto">
              {delegations > 0 ? `${delegations} validator${delegations === 1 ? "" : "s"} on Staking` : "Staking"}
            </Button>
          </div>
        </>
      )}
    </Card>
  );
}

/* ------------------------------------------------------------------ holdings */

export function HoldingsCard({ chain, portfolio, className }: { chain: ChainEntry; portfolio: PortfolioResponse; className?: string }) {
  const assets = portfolio.assets.filter((asset) => asset.chainId === chain.chainId);
  const total = assets.reduce((sum, asset) => sum + (asset.value ?? 0), 0);
  return (
    <Card className={className}>
      {/* "here" keeps the title whole on a phone; the subtitle names the chain. */}
      <CardHeader
        title="Your assets here"
        icon="assets"
        subtitle={`${assets.length} asset${assets.length === 1 ? "" : "s"} on ${chain.chainName}`}
        actions={
          <Button size="sm" variant="ghost" href="/assets" iconRight="arrowRight">
            All assets
          </Button>
        }
      />
      {assets.length === 0 ? (
        <EmptyState inline icon="assets" title="Nothing held here" body={`This wallet holds no tokens on ${chain.chainName}.`} />
      ) : (
        <ul className="-mx-[var(--d-pad)] -mb-[var(--d-pad)] divide-y divide-[var(--d-hairline)] border-t border-[var(--d-hairline)]">
          {assets.map((asset) => {
            // A dust holding's share (9.3e-9) reached the meter's
            // aria-valuenow in exponent form, which is not a valid ARIA
            // number: a positive share is floored at a millionth, which
            // still reads "<0.1%" and draws nothing.
            const share = asset.value !== null && total > 0 ? (asset.value > 0 ? Math.max(asset.value / total, 1e-6) : 0) : null;
            return (
              <li key={`${asset.identity.key}-${asset.chainId}`} className="flex items-center gap-3 px-[var(--d-pad)] py-2.5">
                <AssetLogo src={asset.identity.logoUrl} symbol={asset.identity.ticker} size={28} />
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-[14px] font-medium">{asset.identity.ticker}</span>
                  <span className="block truncate text-[12px] text-fg-dim">{asset.identity.name}</span>
                </span>
                <span className="hidden w-28 sm:block">
                  {share !== null ? <Meter value={share} size="sm" ariaLabel={`${asset.identity.ticker} share of your value here`} /> : null}
                </span>
                <span className="flex flex-col items-end text-right tabular-nums">
                  <Money value={asset.value} currency={portfolio.currency} reason={asset.unpriced ? UNPRICED_TEXT[asset.unpriced] : undefined} className="text-[14px]" />
                  <TokenAmount amount={asset.total} symbol={asset.identity.ticker} compact className="text-[12px] text-fg-dim" />
                </span>
              </li>
            );
          })}
        </ul>
      )}
    </Card>
  );
}
