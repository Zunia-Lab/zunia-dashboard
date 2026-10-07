"use client";

/**
 * The reference half of an asset page, two cards that span it:
 *
 * - **Staking economics** (a chain's own coin): staking APR, real yield,
 *   inflation, bonded ratio against its goal, the unbonding wait and the
 *   Nakamoto coefficient, in one row of figures and the chain page's words.
 * - **Provenance**: what the token is and where it comes from, as a grid of
 *   facts (verification, type, origin, route, denoms, decimals, listings).
 */

import { useMemo, type ReactNode } from "react";
import { Meter } from "@/components/charts";
import {
  Badge,
  Button,
  Card,
  CardBody,
  CardFooter,
  CardHeader,
  ChainLogo,
  CopyButton,
  ExternalLink,
  InlineError,
  LogoStack,
  Percent,
  SourceTag,
} from "@/components/ui";
import { compareHref } from "@/components/compare/model";
import { useChainStats } from "@/lib/data/chains";
import { formatNumber, formatPercent } from "@/lib/format";
import { shortDenom, tokenKindLabel } from "@/lib/token/text";
import type { TokenIdentity } from "@/lib/token/types";
import { Figure, chainIcon, chainName } from "./AssetCells";
import { isUnlisted } from "./holdings";
import { useReadAt } from "./read-at";

/* ------------------------------------------------------------------ provenance */

const PROVENANCE_TEXT: Record<TokenIdentity["provenance"], string> = {
  native: "Issued on the chain itself",
  catalog: "Listed in the chain's registry",
  table: "Zunia token table (hash-verified)",
  "channel-walk": "Traced over its IBC channels",
  unknown: "Nothing identifies it",
};

function ChainName({ chainId, name }: { chainId: string; name?: string }) {
  return (
    <span className="inline-flex max-w-full items-center gap-1.5">
      <ChainLogo chainId={chainId} size={16} />
      <span className="truncate">{name ?? chainName(chainId)}</span>
    </span>
  );
}

function Mono({ text, copyLabel }: { text: string; copyLabel: string }) {
  return (
    <span className="inline-flex max-w-full items-center gap-0.5">
      <span className="truncate font-mono text-[12.5px]" title={text}>
        {shortDenom(text)}
      </span>
      <CopyButton value={text} label={copyLabel} />
    </span>
  );
}

export interface ProvenanceCardProps {
  identity: TokenIdentity;
  holdersChains?: string[];
  className?: string;
}

/** What the token is and where it comes from, as a grid of facts across the page. */
export function ProvenanceCard({ identity, holdersChains, className }: ProvenanceCardProps) {
  const unknown = identity.provenance === "unknown";
  const home = !unknown && identity.originChainId === identity.chainId;
  const verdict = isUnlisted(identity)
    ? { tone: "neutral" as const, text: "Unlisted" }
    : identity.proven
      ? { tone: "success" as const, text: home ? "Native" : "Canonical route" }
      : { tone: "warning" as const, text: "Route not proven" };
  const known = [identity.chainId, ...(holdersChains ?? []).filter((id) => id !== identity.chainId)];

  const facts: { key: string; label: string; value: ReactNode; sub?: ReactNode; info?: ReactNode; wide?: boolean }[] = [
    {
      key: "verdict",
      label: "Verification",
      value: (
        <Badge tone={verdict.tone} size="sm" dot>
          {verdict.text}
        </Badge>
      ),
      info: "Proven means the denom's trace was checked against its hash and the route is the asset's canonical channel; an unproven voucher is never priced as the asset it names.",
    },
    {
      key: "kind",
      label: "Type",
      value: (
        <span className="inline-flex items-center gap-1.5">
          {tokenKindLabel(identity.kind)}
          {identity.alloyed ? <Badge size="sm">Alloyed</Badge> : null}
          {identity.bridge ? <Badge size="sm">via {identity.bridge}</Badge> : null}
        </span>
      ),
    },
    {
      key: "origin",
      label: "Origin",
      value: identity.originChainId ? <ChainName chainId={identity.originChainId} name={identity.originChainName} /> : "Unknown",
    },
    ...(home
      ? []
      : [
          {
            key: "held",
            label: "Held as",
            value: <ChainName chainId={identity.chainId} name={identity.chainName} />,
            sub: identity.path ? <span className="font-mono">{identity.path}</span> : undefined,
          },
        ]),
    { key: "how", label: "Identified by", value: PROVENANCE_TEXT[identity.provenance] },
    { key: "denom", label: "Denom", value: <Mono text={identity.denom} copyLabel="denom" /> },
    {
      key: "decimals",
      label: "Decimals",
      value: identity.decimals ?? "Unknown",
      sub: identity.decimals === null ? "Amounts shown in base units" : undefined,
    },
    ...(identity.osmosisDenom && identity.osmosisDenom !== identity.denom
      ? [{ key: "osmo", label: "On Osmosis", value: <Mono text={identity.osmosisDenom} copyLabel="Osmosis denom" /> }]
      : []),
    ...(identity.coinGeckoId
      ? [
          {
            key: "gecko",
            label: "CoinGecko",
            value: (
              <ExternalLink href={`https://www.coingecko.com/en/coins/${encodeURIComponent(identity.coinGeckoId)}`} className="text-[13.5px]">
                {identity.coinGeckoId}
              </ExternalLink>
            ),
          },
        ]
      : []),
    ...(known.length > 1
      ? [
          {
            key: "known",
            label: `Known on ${known.length} chains`,
            value: (
              <LogoStack
                size={18}
                max={6}
                items={known.map((id) => ({ src: chainIcon(id), label: chainName(id) }))}
                label={`Known on ${known.map(chainName).join(", ")}`}
              />
            ),
          },
        ]
      : []),
  ];

  return (
    <Card className={className}>
      <CardHeader title="Provenance" subtitle="What this token is and where it comes from" />
      <dl className="grid grid-cols-2 gap-x-6 gap-y-4 sm:grid-cols-3 lg:grid-cols-4 min-[90rem]:grid-cols-5">
        {facts.map((fact) => (
          <Figure key={fact.key} label={fact.label} value={fact.value} sub={fact.sub} info={fact.info} size="text" />
        ))}
      </dl>
    </Card>
  );
}

/* ------------------------------------------------------------------ staking economics */

const APR_SOURCE: Record<string, string> = {
  lcd: "Chain LCD",
  "osmosis-mint": "Osmosis mint",
  "cosmos.directory": "cosmos.directory (third party)",
};

/** "21 days", "14 days" (not "14.04 days": a chain's period plus an hour of epoch). */
function daysText(days: number | null): string {
  if (days === null || !Number.isFinite(days)) return "—";
  return `${formatNumber(days, { maxFraction: days < 10 ? 1 : 0 })} ${days === 1 ? "day" : "days"}`;
}

/** A fraction as the chain page prints it in a caption: "15.4%". */
function pct(fraction: number, digits = 1): string {
  return formatPercent(fraction * 100, { digits });
}

/**
 * What staking this coin pays and costs on its chain, in one row: staking
 * APR, real yield, inflation, bonded ratio against its goal, the unbonding
 * wait and the Nakamoto coefficient.
 *
 * Labels and captions are the chain page's (Staking APR · "Published X%",
 * Real yield · "After X% inflation", Inflation · "Parameter X%", Bonded ·
 * "Goal X%", Unbonding · "Min commission X%", Nakamoto · "of N validators"):
 * the same six facts read one way wherever they appear.
 */
export function StakingEconomicsCard({ chainId, ticker, className }: { chainId: string; ticker: string; className?: string }) {
  const chainIds = useMemo(() => [chainId], [chainId]);
  const state = useChainStats(chainIds);
  const stats = state.statsFor(chainId);
  const loading = state.loading;
  const apr = stats?.apr;
  const aprValue = apr?.actual ?? apr?.naive ?? null;
  const reasons = stats?.reasons ?? {};
  const readAt = useReadAt(state.data?.updatedAt);
  const inflationActual = stats?.inflation.actual ?? null;
  const inflationParam = stats?.inflation.param ?? null;
  const inflation = inflationActual ?? inflationParam;
  const thirdParty = apr?.source === "cosmos.directory";
  // "Published" is the rate the mint's parameters imply; the figure above it
  // is what the chain actually pays at its observed block time.
  const published = apr?.actual != null && apr.naive != null && Math.abs(apr.actual - apr.naive) > 0.0005 ? apr.naive : null;

  return (
    <Card className={className} pending={state.stale}>
      <CardHeader
        title="Staking economics"
        subtitle={`Staking ${ticker} on ${chainName(chainId)}`}
        refreshing={state.refreshing && !state.stale}
        info="APR is what delegators earn before validator commission and fees, from the chain's own mint and staking state, corrected for the block time actually observed. Real yield is APR minus inflation: what staking adds to your share of the supply."
        actions={
          <>
            <Button size="sm" variant="ghost" iconLeft="validators" href={`/validators?chain=${encodeURIComponent(chainId)}`}>
              Validators
            </Button>
            <Button size="sm" variant="ghost" iconLeft="compare" href={compareHref([{ kind: "chain", id: chainId }])}>
              Compare
            </Button>
          </>
        }
      />
      {state.status === "error" && !stats ? (
        <InlineError
          title="Staking figures unavailable"
          message={state.error?.message ?? "This chain's staking state could not be read right now."}
          onRetry={state.refetch}
          retrying={state.refreshing}
        />
      ) : (
        <CardBody>
          <dl className="grid grid-cols-2 gap-x-6 gap-y-5 md:grid-cols-3 xl:grid-cols-6">
            <Figure
              label="Staking APR"
              size="lg"
              loading={loading}
              value={<Percent value={aprValue !== null ? aprValue * 100 : null} digits={1} reason={reasons.apr ?? apr?.note} />}
              sub={
                published !== null
                  ? `Published ${pct(published)}`
                  : apr?.actual == null && apr?.naive != null
                    ? "Published rate: block time not measured"
                    : thirdParty
                      ? "cosmos.directory (3P)"
                      : "Before commission"
              }
            />
            <Figure
              label="Real yield"
              size="lg"
              loading={loading}
              value={
                <Percent
                  value={stats?.realYield != null ? stats.realYield * 100 : null}
                  digits={1}
                  signed
                  reason={reasons.realYield ?? "Inflation unknown"}
                  className={stats?.realYield != null && stats.realYield < 0 ? "text-[var(--d-neg)]" : undefined}
                />
              }
              sub={inflationActual !== null ? `After ${pct(inflationActual)} inflation` : "APR minus inflation"}
            />
            <Figure
              label="Inflation"
              size="lg"
              loading={loading}
              value={<Percent value={inflation !== null ? inflation * 100 : null} digits={1} reason={reasons.inflation ?? "Not published by this chain"} />}
              sub={
                inflationActual === null
                  ? inflationParam !== null
                    ? "Mint parameter"
                    : undefined
                  : inflationParam !== null
                    ? `Parameter ${pct(inflationParam)}`
                    : "No mint parameter"
              }
            />
            <Figure
              label="Bonded"
              size="lg"
              loading={loading}
              value={<Percent value={stats?.bondedRatio != null ? stats.bondedRatio * 100 : null} digits={1} reason={reasons.bondedRatio} />}
              sub={stats?.goalBonded != null ? `Goal ${pct(stats.goalBonded, 0)}` : "No bonding goal"}
            >
              {stats?.bondedRatio != null ? (
                <Meter
                  value={stats.bondedRatio}
                  size="sm"
                  ariaLabel={`Bonded ratio${stats.goalBonded != null ? ` against a goal of ${pct(stats.goalBonded, 0)}` : ""}`}
                  markers={stats.goalBonded != null ? [{ value: stats.goalBonded, label: "Goal" }] : undefined}
                  className="max-w-[160px]"
                />
              ) : null}
            </Figure>
            <Figure
              label="Unbonding"
              size="lg"
              loading={loading}
              value={daysText(stats?.unbondingDays ?? null)}
              sub={stats?.minCommission != null ? `Min commission ${pct(stats.minCommission, 0)}` : "to get staked coins back"}
            />
            <Figure
              label="Nakamoto"
              size="lg"
              loading={loading}
              value={stats?.nakamoto != null ? formatNumber(stats.nakamoto) : "—"}
              sub={stats?.activeValidators != null ? `of ${formatNumber(stats.activeValidators)} validators` : undefined}
              info="The fewest validators that together hold more than a third of the stake: enough to halt the chain. Higher is harder to stop."
            />
          </dl>
        </CardBody>
      )}
      <CardFooter className="justify-between">
        <SourceTag source={apr?.source ? (APR_SOURCE[apr.source] ?? apr.source) : "Chain LCD"} at={readAt} />
        <span className="text-[12px]">Mint rewards only: fees and MEV are not included</span>
      </CardFooter>
    </Card>
  );
}