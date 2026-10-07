"use client";

/**
 * /validators/[address]?chain= — one validator (spec §6, research V3).
 *
 * Profile first (identity, status, website, details), then the figures a
 * delegator weighs: voting power and rank, what delegators earn, commission,
 * uptime, bonded stake. Then your own position here with the stake / move /
 * unstake actions (they open the shared staking sheets in place; stake on a
 * jailed or inactive validator leads with "Move stake") beside its place in
 * the set; then the detail: commission now and how far it can legally rise
 * (30 / 90 days, from its max rate and max daily change), the signing window,
 * jail history, recorded slashes and self-delegation.
 *
 * The server passes a first-paint profile (moniker, details, commission) so
 * the page has content before the full read lands. A cold read that answers
 * "still loading" is retried on its own (`useStillLoadingRetry`); a failed
 * one stops every skeleton, and the callout under the profile says why.
 */

import { useMemo } from "react";
import {
  AddressText,
  AssetLogo,
  Badge,
  Button,
  Callout,
  Card,
  CardBody,
  CardHeader,
  ChainLogo,
  Disclosure,
  EmptyState,
  ExternalLink,
  InlineError,
  KeyValueList,
  Money,
  PartialDataBadge,
  Percent,
  RelativeTime,
  Skeleton,
  SourceTag,
  StatTile,
  StatusBadge,
  TokenAmount,
  useNow,
  type KeyValueItem,
} from "@/components/ui";
import { useConnectModal } from "@/components/connect/ConnectModal";
import { Page } from "@/components/shell/Page";
import { websiteHost } from "@/lib/chain/parse";
import { findChain } from "@/lib/chains";
import { cn } from "@/lib/cn";
import { useChainStats } from "@/lib/data/chains";
import { useStakingPositions } from "@/lib/data/staking";
import { useValidator, type ValidatorRow } from "@/lib/data/validators";
import { useWallet } from "@/lib/connect/context";
import { formatDate, shortenAddress, shortenHash } from "@/lib/format";
import { chainNameOf } from "@/components/staking/hooks";
import { DAY_MS, percentOf as pct, positive, steepCommissionRise, sumBase, toWhole, validatorFlags, valueOf } from "@/components/staking/model";
import { FlagBadges, Unavailable } from "@/components/staking/ValidatorBits";
import { StakingFlowsProvider, useStakingFlows } from "@/components/staking/flows/StakingFlows";
import { ConnectBanner } from "./ConnectBanner";
import { useStillLoadingRetry } from "./useStillLoadingRetry";

/** Flags the header's status badge already states (it says "Jailed", "Inactive", "Tombstoned"). */
const STATUS_FLAGS = new Set(["tombstoned", "jailed", "inactive"]);

export interface InitialProfile {
  moniker: string;
  identity: string | null;
  website: string | null;
  details: string | null;
  status: "bonded" | "unbonding" | "unbonded";
  jailed: boolean;
  commission: { rate: number; maxRate: number; maxChangeRate: number; updatedAt: string | null };
}

export function ValidatorDetailPage({ chainId, operator, initial }: { chainId: string; operator: string; initial: InitialProfile | null }) {
  const detail = useValidator(chainId, operator);
  const moniker = detail.data?.validator.moniker ?? initial?.moniker ?? shortenAddress(operator, 14, 6);
  const chainName = detail.data?.chainName ?? findChain(chainId)?.chainName ?? chainId;
  return (
    <Page
      title={moniker}
      access="public"
      breadcrumbs={[{ label: "Validators", href: `/validators?chain=${encodeURIComponent(chainId)}` }, { label: moniker }]}
      subtitle={`${chainName} validator`}
    >
      <StakingFlowsProvider>
        <DetailContent chainId={chainId} operator={operator} initial={initial} detail={detail} />
      </StakingFlowsProvider>
    </Page>
  );
}

function statusOf(v: Pick<ValidatorRow, "status" | "jailed" | "tombstoned">) {
  if (v.tombstoned) return <StatusBadge tone="danger" size="md">Tombstoned</StatusBadge>;
  if (v.jailed) return <StatusBadge tone="danger" size="md">Jailed</StatusBadge>;
  if (v.status !== "bonded") return <StatusBadge tone="warning" size="md">Inactive</StatusBadge>;
  return <StatusBadge tone="success" size="md">Active</StatusBadge>;
}

/**
 * Commission now, what it can reach in 30 and 90 days, and its hard cap, on
 * one scale. Each label sits under its own value (clamped to the track), so
 * the picture is the numbers, not an even row of captions.
 */
function CommissionScale({ rate, reach30, reach90, max }: { rate: number; reach30: number; reach90: number; max: number }) {
  const top = Math.max(max, 0.2);
  const at = (value: number) => Math.min(100, Math.max(0, (value / top) * 100));
  const candidates = [
    { id: "now", value: rate, label: `Now ${pct(rate, 1)}`, strong: true },
    ...(reach30 > rate + 1e-9 ? [{ id: "30", value: reach30, label: `30 d ${pct(reach30, 1)}`, strong: false }] : []),
    ...(max > Math.max(rate, reach30) + 1e-9 ? [{ id: "max", value: max, label: `cap ${pct(max, 0)}`, strong: false }] : []),
  ];
  // Labels closer than a fifth of the track share one caption ("30 d 18.0% · cap 20%").
  const marks: typeof candidates = [];
  for (const mark of candidates) {
    const last = marks[marks.length - 1];
    if (last && at(mark.value) - at(last.value) < 20) {
      marks[marks.length - 1] = { ...last, label: `${last.label} · ${mark.label}` };
    } else {
      marks.push(mark);
    }
  }
  return (
    <div className="flex flex-col gap-1.5" aria-hidden>
      <div className="relative h-2.5 overflow-hidden rounded-full bg-[var(--d-glass-2)]">
        <span className="absolute inset-y-0 left-0 rounded-full bg-[color-mix(in_srgb,var(--viz-warn)_30%,transparent)]" style={{ width: `${at(reach90)}%` }} />
        <span className="absolute inset-y-0 left-0 rounded-full bg-[color-mix(in_srgb,var(--viz-warn)_65%,transparent)]" style={{ width: `${at(reach30)}%` }} />
        <span className="absolute inset-y-0 left-0 rounded-full bg-[var(--viz-accent)]" style={{ width: `max(3px, ${at(rate)}%)` }} />
        <span className="absolute inset-y-0 w-0.5 bg-fg" style={{ left: `calc(${at(max)}% - 1px)` }} />
      </div>
      <div className="relative h-4 text-[11.5px] tabular-nums text-fg-dim">
        {marks.map((mark, index) => {
          const x = at(mark.value);
          // First label anchors left, the last right, the rest centre on
          // their value; edges clamp so nothing runs off the card.
          const transform = index === 0 && x < 12 ? "translateX(0)" : x > 88 ? "translateX(-100%)" : "translateX(-50%)";
          return (
            <span
              key={mark.id}
              className={cn("absolute top-0 whitespace-nowrap", mark.strong && "font-medium text-fg-muted")}
              style={{ left: `${index === 0 && x < 12 ? 0 : x}%`, transform }}
            >
              {mark.label.charAt(0).toUpperCase() + mark.label.slice(1)}
            </span>
          );
        })}
      </div>
    </div>
  );
}

function DetailContent({
  chainId,
  operator,
  initial,
  detail,
}: {
  chainId: string;
  operator: string;
  initial: InitialProfile | null;
  detail: ReturnType<typeof useValidator>;
}) {
  const { account } = useWallet();
  const connect = useConnectModal();
  const flows = useStakingFlows();
  const now = useNow();
  const stats = useChainStats([chainId]);
  const positions = useStakingPositions({ chainIds: account ? [chainId] : [] });
  const chainStats = stats.statsFor(chainId);
  const stillLoading = useStillLoadingRetry(detail, `${chainId}:${operator}`).retrying;
  // Failed for good (a timeout is retried first, and reads as loading meanwhile).
  const failed = detail.status === "error" && !stillLoading;

  const data = detail.data?.validator.operatorAddress === operator ? detail.data : null;
  const v = data?.validator ?? null;
  const notFound = detail.error?.status === 404;
  const symbol = data?.symbol ?? chainStats?.nativeSymbol ?? findChain(chainId)?.coinDenom ?? "";
  const decimals = data?.decimals ?? chainStats?.nativeDecimals ?? null;
  const price = chainStats?.price?.price ?? null;
  const currency = stats.data?.currency ?? "usd";

  const staking = positions.chainFor(chainId);
  const mine = staking?.delegations.find((d) => d.validator.operatorAddress === operator) ?? null;
  const myStaked = mine && positive(mine.amount) ? mine.amount : null;
  const myRewards = mine && staking ? sumBase(mine.rewards.filter((c) => c.denom === staking.denom).map((c) => c.amount)) : "0";
  const myShare = useMemo(() => {
    if (!myStaked || !staking?.totals.staked) return null;
    const total = Number(staking.totals.staked);
    return total > 0 ? Number(myStaked) / total : null;
  }, [myStaked, staking]);

  const flags = v
    ? validatorFlags({
        operatorAddress: v.operatorAddress,
        moniker: v.moniker,
        status: v.status,
        jailed: v.jailed,
        tombstoned: v.tombstoned,
        commissionRate: v.commission.rate,
        commissionMaxRate: v.commission.maxRate,
        commissionReachable30d: v.commission.reachable30d,
        uptime: v.uptime,
        rank: v.rank,
        votingPower: v.votingPower,
        inNakamotoSet: v.inNakamotoSet,
        apr: v.apr,
      })
    : [];
  // The header's status badge already says jailed / inactive / tombstoned.
  const headerFlags = flags.filter((flag) => !STATUS_FLAGS.has(flag.id));

  if (notFound) {
    return (
      <Card>
        <EmptyState
          icon="validators"
          title="Validator not found"
          body={`${chainNameOf(chainId)} has no validator at ${shortenAddress(operator, 14, 6)}.`}
          action={<Button href={`/validators?chain=${encodeURIComponent(chainId)}`}>All validators</Button>}
        />
      </Card>
    );
  }

  const profile = {
    moniker: v?.moniker ?? initial?.moniker ?? null,
    website: v?.website ?? initial?.website ?? null,
    details: v?.details ?? initial?.details ?? null,
    identity: v?.identity ?? initial?.identity ?? null,
  };
  const websiteLabel = websiteHost(profile.website);
  const canStake = v ? !v.jailed && v.tombstoned !== true && v.status === "bonded" : initial ? !initial.jailed && initial.status === "bonded" : false;
  // Why the stake buttons are off, in words (a disabled button alone explains nothing).
  const blockedReason = v
    ? v.tombstoned
      ? "Tombstoned for double-signing: it can never earn again."
      : v.jailed
        ? "Jailed: stake here earns nothing until the operator unjails it."
        : v.status !== "bonded"
          ? "Outside the active set: stake here earns nothing."
          : null
    : initial && (initial.jailed || initial.status !== "bonded")
      ? "Not in the active set: stake here earns nothing."
      : null;
  const cutoff = data?.summary.cutoffTokens ?? null;
  const cutoffMultiple = v && cutoff && Number(cutoff) > 0 ? Number(v.tokens) / Number(cutoff) : null;
  const jailedBefore = v?.jailedUntil && now !== null && Date.parse(v.jailedUntil) < now && Date.parse(v.jailedUntil) > 0 ? v.jailedUntil : null;

  const commissionItems: KeyValueItem[] = v
    ? [
        { key: "rate", label: "Rate now", value: pct(v.commission.rate, 2), emphasis: true },
        { key: "max", label: "Hard cap (max rate)", value: pct(v.commission.maxRate, 2), info: "Set when the validator was created; it can never be raised." },
        { key: "change", label: "Max change per day", value: pct(v.commission.maxChangeRate, 2), info: "The largest change the chain allows in one step, once every 24 hours." },
        {
          key: "updated",
          label: "Last changed",
          value: v.commission.updatedAt ? <RelativeTime at={Date.parse(v.commission.updatedAt)} /> : "—",
          // Past 30 days the relative time is already a date: the full date
          // under it would only repeat it.
          sub:
            v.commission.updatedAt && now !== null && Math.abs(now - Date.parse(v.commission.updatedAt)) < 30 * DAY_MS
              ? formatDate(Date.parse(v.commission.updatedAt), "long")
              : undefined,
        },
        { key: "r30", label: "Highest within 30 days", value: pct(v.commission.reachable30d, 2) },
        { key: "r90", label: "Highest within 90 days", value: pct(v.commission.reachable90d, 2) },
      ]
    : [];

  const reliabilityItems: KeyValueItem[] = v
    ? [
        {
          key: "uptime",
          label: "Uptime",
          value: v.uptime === null ? "—" : pct(v.uptime, 2),
          emphasis: true,
          sub:
            v.missedBlocks !== null && v.signedWindow
              ? `${v.missedBlocks.toLocaleString("en-US")} missed of the last ${v.signedWindow.toLocaleString("en-US")} blocks`
              : v.status !== "bonded"
                ? "Only measured while in the active set"
                : undefined,
          info:
            chainStats?.slashing?.minSignedPerWindow != null
              ? `A validator that signs less than ${pct(chainStats.slashing.minSignedPerWindow, 0)} of the window is jailed${
                  chainStats.slashing.slashFractionDowntime ? ` and slashed ${pct(chainStats.slashing.slashFractionDowntime, 2)}` : ""
                }.`
              : "Share of blocks signed over the chain's current signing window.",
        },
        {
          key: "jail",
          label: "Jail record",
          value: v.jailed ? "Jailed now" : jailedBefore ? "Jailed before" : "Never jailed",
          // A jail term that has ended does not unjail anyone: the operator
          // must send an unjail transaction, and until then it stays out.
          sub: v.jailed
            ? jailedBefore
              ? `Jail term ended ${formatDate(Date.parse(jailedBefore), "long")}; not unjailed yet`
              : v.jailedUntil
                ? `Until at least ${formatDate(Date.parse(v.jailedUntil), "long")}`
                : undefined
            : jailedBefore
              ? `Released ${formatDate(Date.parse(jailedBefore), "long")}`
              : undefined,
        },
        { key: "tomb", label: "Tombstoned", value: v.tombstoned === null ? "—" : v.tombstoned ? "Yes, permanently" : "No" },
        {
          key: "slashes",
          label: "Slashes recorded",
          value: data?.slashes === null || data?.slashes === undefined ? "—" : String(data.slashes.length),
          sub:
            data?.slashes && data.slashes.length > 0
              ? data.slashes
                  .slice(0, 3)
                  .map((slash) => pct(slash.fraction, 2))
                  .join(", ")
              : data?.slashes
                ? "None recorded"
                : "Could not be read",
        },
        {
          key: "self",
          label: "Self-delegation",
          value:
            data?.selfDelegation && decimals !== null ? (
              <TokenAmount amount={data.selfDelegation.amount} decimals={decimals} symbol={symbol} compact masked={false} />
            ) : (
              "—"
            ),
          sub: data?.selfDelegation?.ratio != null ? `${pct(data.selfDelegation.ratio, 2)} of its stake` : undefined,
          info: "The operator's own stake in its validator: skin in the game if it misbehaves.",
        },
      ]
    : [];

  const loadingFirst = !v && !failed;
  // Why a key figure is "—" once the read failed (the callout has the Retry).
  const unread = !v && failed ? "This validator could not be read" : undefined;
  const earnsNothing = Boolean(myStaked && v && !canStake);

  const positionCard = (
    <Card as="section" aria-label="Your position">
      <CardHeader title="Your position" subtitle={`With ${profile.moniker ?? "this validator"} on ${chainNameOf(chainId)}`} />
      <CardBody className="flex flex-col gap-4">
        {positions.loading ? (
          <SkeletonRows />
        ) : !myStaked && (!staking || staking.status === "error" || staking.totals.staked === null) ? (
          // Unreadable is not "none": never say "you don't stake here" when
          // the read failed.
          <InlineError
            title={`Couldn't read your stake on ${chainNameOf(chainId)}`}
            message={staking?.error ?? positions.error?.message ?? "The network did not answer in time."}
            onRetry={positions.refetch}
            retrying={positions.refreshing}
          />
        ) : myStaked && staking ? (
          <>
            <KeyValueList
              divided
              items={[
                {
                  key: "staked",
                  label: "Staked",
                  emphasis: true,
                  value: <TokenAmount amount={myStaked} decimals={staking.decimals} symbol={staking.symbol} maxFraction={4} />,
                  sub: <Money value={valueOf(toWhole(myStaked, staking.decimals), price)} currency={currency} reason="No price for this token" />,
                },
                {
                  key: "rewards",
                  label: "Pending rewards",
                  value: <TokenAmount amount={myRewards} decimals={staking.decimals} symbol={staking.symbol} maxFraction={6} />,
                  sub: <Money value={valueOf(toWhole(myRewards, staking.decimals), price)} currency={currency} reason="No price for this token" />,
                },
                { key: "apr", label: "Earning", value: v?.apr == null ? "—" : `${pct(v.apr, 2)} APR` },
                { key: "share", label: "Share of your stake here", value: myShare === null ? "—" : pct(myShare, 1) },
              ]}
            />
            {earnsNothing ? (
              // Stake here earns nothing: moving it (instant, no unbonding)
              // is the one action that matters, so it leads.
              <Callout
                tone="danger"
                title="Your stake here earns nothing"
                action={
                  <Button size="sm" variant="primary" iconLeft="swap" onClick={() => flows.open({ kind: "redelegate", chainId, src: operator })}>
                    Move stake
                  </Button>
                }
              >
                {blockedReason} Moving it to an active validator is instant and keeps it staked.
              </Callout>
            ) : null}
            <div className="flex flex-wrap gap-2">
              <Button
                size="sm"
                variant={earnsNothing ? "secondary" : "primary"}
                iconLeft="download"
                disabled={!positive(myRewards)}
                onClick={() => flows.open({ kind: "claim", chainIds: [chainId], validator: operator })}
              >
                Claim
              </Button>
              {canStake ? (
                <Button size="sm" iconLeft="plus" onClick={() => flows.open({ kind: "delegate", chainId, validator: operator })}>
                  Stake more
                </Button>
              ) : null}
              {earnsNothing ? null : (
                <Button size="sm" iconLeft="swap" onClick={() => flows.open({ kind: "redelegate", chainId, src: operator })}>
                  Move away
                </Button>
              )}
              <Button size="sm" variant="ghost" iconLeft="minus" onClick={() => flows.open({ kind: "undelegate", chainId, validator: operator })}>
                Unstake
              </Button>
            </div>
          </>
        ) : (
          <div className="flex flex-col gap-3">
            <p className="text-[13.5px] text-fg-muted">
              You don&apos;t stake with {profile.moniker ?? "this validator"}.
              {v?.apr != null && v.apr > 0 ? ` Stake here earns about ${pct(v.apr, 1)} a year after commission.` : ""}
            </p>
            <div className="flex flex-wrap gap-2">
              <Button size="sm" variant="primary" iconLeft="plus" disabled={!canStake} onClick={() => flows.open({ kind: "delegate", chainId, validator: operator })}>
                Stake
              </Button>
              <Button size="sm" iconLeft="swap" disabled={!canStake} onClick={() => flows.open({ kind: "redelegate", chainId, dst: operator })}>
                Move stake here
              </Button>
            </div>
          </div>
        )}
      </CardBody>
    </Card>
  );

  const placeCard = (
    <Card as="section" aria-label="In the set">
      <CardHeader title="Place in the set" subtitle="Where its voting power sits among the active validators" />
      <CardBody className="@container flex flex-col gap-3">
        {v && v.status === "bonded" && v.cumulative !== null ? (
          <div className="grid gap-3 @[620px]:grid-cols-[minmax(0,1.35fr)_minmax(0,1fr)] @[620px]:items-start @[620px]:gap-x-10">
            <div className="flex min-w-0 flex-col gap-3">
            <div className="relative h-3 overflow-hidden rounded-full bg-[var(--d-glass-2)]" aria-hidden>
              <span
                className="absolute inset-y-0 left-0 bg-[color-mix(in_srgb,var(--viz-accent)_26%,transparent)]"
                style={{ width: `${Math.max(0, v.cumulative - v.votingPower) * 100}%` }}
              />
              <span
                className={cn("absolute inset-y-0", v.inNakamotoSet ? "bg-[var(--viz-warn)]" : "bg-[var(--viz-accent)]")}
                style={{ left: `${Math.max(0, v.cumulative - v.votingPower) * 100}%`, width: `max(3px, ${v.votingPower * 100}%)` }}
              />
              <span className="absolute inset-y-0 w-0.5 bg-fg" style={{ left: "calc(33.333% - 1px)" }} />
            </div>
            <p className="text-[13px] leading-relaxed text-fg-muted">
              {v.inNakamotoSet ? (
                <>
                  <span className="font-medium text-fg">In the Nakamoto set.</span> One of the {data?.summary.nakamoto ?? "few"} largest
                  validators that together hold over a third of voting power, enough to halt {chainNameOf(chainId)}.
                </>
              ) : (
                <>
                  <span className="font-medium text-fg">Outside the Nakamoto set.</span> It takes the largest {data?.summary.nakamoto ?? "few"}{" "}
                  validators to pass a third of voting power; this one is not among them.
                </>
              )}{" "}
              The top {v.rank ?? "?"} down to it hold {pct(v.cumulative, 1)} together.
            </p>
            </div>
            <KeyValueList
              items={[
                { key: "vp", label: "Voting power", value: pct(v.votingPower, 3) },
                { key: "rank", label: "Rank", value: `#${v.rank ?? "—"} of ${data?.summary.active ?? "—"}` },
                { key: "nak", label: "Nakamoto coefficient", value: String(data?.summary.nakamoto ?? "—") },
              ]}
            />
          </div>
        ) : v && v.status !== "bonded" ? (
          <p className="text-[13.5px] text-fg-muted">
            Not in the active set right now, so it holds no voting power and earns nothing for its delegators.
            {unbondingLine(v.unbondingTime, now)}
          </p>
        ) : v ? (
          // Active, but the set's distribution was not read: not "outside the set".
          <p className="text-[13px] text-fg-dim">Its place in the set could not be read just now.</p>
        ) : loadingFirst ? (
          <SkeletonRows />
        ) : (
          <NotRead />
        )}
        {data ? (
          <div className="flex items-center justify-between gap-2 pt-1">
            <SourceTag source="Chain LCD" at={data.updatedAt} />
            <Disclosure summary="Addresses">
              <div className="flex flex-col gap-1.5 pt-1">
                {v?.accountAddress ? <AddressText address={v.accountAddress} head={12} tail={6} /> : null}
                {v?.consensusAddress ? <AddressText address={v.consensusAddress} head={12} tail={6} /> : null}
              </div>
            </Disclosure>
          </div>
        ) : null}
      </CardBody>
    </Card>
  );

  return (
    <>
      <Card variant="hero" as="section" aria-label="Profile">
        <div className="flex flex-col gap-4 md:flex-row md:items-start">
          <div className="flex min-w-0 flex-1 items-start gap-4">
            <AssetLogo src={v?.logoUrl ?? null} symbol={profile.moniker ?? "?"} size={56} className="shadow-[0_0_0_1px_var(--d-hairline)] rounded-full" />
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-center gap-2">
                <h2 className="min-w-0 truncate text-[22px] font-semibold leading-tight tracking-[-0.025em] text-fg">
                  {profile.moniker ?? <Skeleton className="inline-block h-5 w-40" />}
                </h2>
                {v ? statusOf(v) : initial ? statusOf({ status: initial.status, jailed: initial.jailed, tombstoned: null }) : null}
                {v?.rank ? <Badge tone="neutral" size="md">#{v.rank} of {data?.summary.active ?? "?"}</Badge> : null}
              </div>
              <div className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-[13px] text-fg-dim">
                <span className="inline-flex items-center gap-1.5">
                  <ChainLogo chainId={chainId} size={16} />
                  {chainNameOf(chainId)}
                </span>
                <AddressText address={operator} head={14} tail={6} />
                {profile.website && websiteLabel ? (
                  // The operator's own claim: labelled by the host it opens
                  // (see `websiteHost`), and `ugc` so this indexable page
                  // never vouches for it to search engines.
                  <ExternalLink href={profile.website} ugc className="min-w-0 max-w-full text-[13px]">
                    <span className="truncate">{websiteLabel}</span>
                  </ExternalLink>
                ) : null}
                {profile.identity ? (
                  // A full 40-character PGP fingerprint runs past a phone's card: shortened, whole on hover.
                  <span className="min-w-0 break-all font-mono text-[11.5px]" title={profile.identity}>
                    Keybase {profile.identity.length > 16 ? shortenHash(profile.identity, 8, 6) : profile.identity}
                  </span>
                ) : null}
              </div>
              {headerFlags.length > 0 ? <FlagBadges flags={headerFlags} className="mt-2.5" /> : null}
              {profile.details ? (
                <p className="mt-3 max-w-[72ch] whitespace-pre-line text-[13.5px] leading-relaxed text-fg-muted">{profile.details}</p>
              ) : null}
            </div>
          </div>
          <div className="flex shrink-0 flex-col gap-2 md:w-[220px]">
            <div className="flex flex-wrap gap-2 max-md:[&>*]:flex-1 md:flex-col md:items-stretch">
              <Button
                variant="primary"
                iconLeft="plus"
                disabled={!canStake}
                onClick={() => flows.open({ kind: "delegate", chainId, validator: operator })}
              >
                Stake with {profile.moniker && profile.moniker.length <= 16 ? profile.moniker : "this validator"}
              </Button>
              <Button variant="secondary" iconLeft="swap" disabled={!canStake} onClick={() => flows.open({ kind: "redelegate", chainId, dst: operator })}>
                Move stake here
              </Button>
            </div>
            {!canStake && blockedReason ? <p className="text-[12px] leading-snug text-fg-dim md:text-right">{blockedReason}</p> : null}
          </div>
        </div>
      </Card>

      {failed && !v ? (
        <InlineError
          title={detail.error?.code === "upstream_timeout" ? "Still loading" : "Couldn't load this validator"}
          message={detail.error?.message ?? "The chain could not be read."}
          onRetry={detail.refetch}
          retrying={detail.refreshing}
        />
      ) : null}

      <section
        aria-label="Key figures"
        // Five tiles: 2 + 2 + 1 wide on phones, 3 + 2 (wider) on tablets, one row from xl.
        className="grid grid-cols-2 gap-[var(--d-gap)] max-md:[&>*:last-child]:col-span-2 md:grid-cols-6 md:[&>*]:col-span-2 md:[&>*:nth-child(n+4)]:col-span-3 xl:grid-cols-5 xl:[&>*]:col-span-1 xl:[&>*:nth-child(n+4)]:col-span-1"
      >
        <StatTile
          label="Voting power"
          icon="layers"
          loading={loadingFirst}
          value={v ? (v.status === "bonded" ? pct(v.votingPower, 2) : <Unavailable reason="Not in the active set" />) : <Unavailable reason={unread} />}
          sub={v?.rank ? `rank #${v.rank}${v.cumulative !== null ? ` · top ${v.rank} hold ${pct(v.cumulative, 1)}` : ""}` : v ? "not in the active set" : undefined}
        />
        <StatTile
          label="Delegator APR"
          icon="trendingUp"
          loading={loadingFirst}
          value={<Percent value={v?.apr == null ? null : v.apr * 100} reason={unread ?? data?.summary.aprNote ?? "APR unavailable"} />}
          sub={
            // A zero from the jail or the active set is not the commission's doing.
            v?.tombstoned
              ? "tombstoned: earns nothing"
              : v?.jailed
                ? "jailed: earns nothing"
                : v && v.status !== "bonded"
                  ? "inactive: earns nothing"
                  : data?.summary.aprActual != null && v
                    ? `after ${pct(v.commission.rate, 1)} commission`
                    : "after commission"
          }
          info="The chain's actual APR (real block time, after the community tax) minus this validator's commission. Zero while jailed or inactive. Mint rewards only."
        />
        <StatTile
          label="Commission"
          icon="compare"
          loading={loadingFirst && !initial}
          value={pct(v?.commission.rate ?? initial?.commission.rate ?? null, 2)}
          sub={
            v
              ? v.commission.reachable30d > v.commission.rate + 1e-9
                ? `up to ${pct(v.commission.reachable30d, 0)} in 30 days`
                : `cap ${pct(v.commission.maxRate, 0)}`
              : initial
                ? `cap ${pct(initial.commission.maxRate, 0)}`
                : undefined
          }
          tone={v && steepCommissionRise(v.commission.rate, v.commission.reachable30d) ? "warning" : "default"}
        />
        <StatTile
          label="Uptime"
          icon="pulse"
          loading={loadingFirst}
          value={
            v?.uptime == null ? (
              <Unavailable reason={v && v.status !== "bonded" ? "Only measured while in the active set" : unread} />
            ) : (
              pct(v.uptime, 2)
            )
          }
          sub={
            v?.missedBlocks != null && v.signedWindow
              ? `${v.missedBlocks.toLocaleString("en-US")} missed of ${v.signedWindow.toLocaleString("en-US")}`
              : v && v.status !== "bonded"
                ? // Short: a half-width tile on phones (the "—" carries the full reason).
                  "measured while active"
                : unread
                  ? undefined
                  : "current window"
          }
          tone={v?.uptime != null && v.uptime < 0.95 ? "negative" : "default"}
        />
        <StatTile
          label="Bonded stake"
          icon="staking"
          loading={loadingFirst}
          value={v && decimals !== null ? <TokenAmount amount={v.tokens} decimals={decimals} symbol={symbol} compact masked={false} /> : <Unavailable reason={unread} />}
          sub={cutoffMultiple !== null ? `${cutoffMultiple.toFixed(1)}× the active-set cutoff` : data?.summary.activeSetFull === false ? "the set has open slots" : undefined}
        />
      </section>

      {account ? (
        <div className="grid items-start gap-[var(--d-gap)] lg:grid-cols-2">
          {positionCard}
          {placeCard}
        </div>
      ) : (
        <>
          <ConnectBanner onConnect={() => connect.open()}>
            <span className="font-medium text-fg">Connect to see your position.</span> Your stake and rewards with{" "}
            {profile.moniker ?? "this validator"} appear here, and you can stake or move stake to it.
          </ConnectBanner>
          {placeCard}
        </>
      )}
      <div className="grid items-start gap-[var(--d-gap)] lg:grid-cols-2">
        <Card as="section" aria-label="Commission">
          <CardHeader
            title="Commission"
            subtitle="Its share of the rewards it earns for delegators"
            info="Validators set their own commission inside limits fixed at creation: a hard cap (max rate) and a max change per day. The 30 and 90 day figures are the highest those limits allow from today."
          />
          <CardBody className="flex flex-col gap-4">
            {v ? (
              <>
                <CommissionScale rate={v.commission.rate} reach30={v.commission.reachable30d} reach90={v.commission.reachable90d} max={v.commission.maxRate} />
                <KeyValueList divided items={commissionItems} />
              </>
            ) : loadingFirst ? (
              <SkeletonRows />
            ) : (
              <NotRead />
            )}
          </CardBody>
        </Card>

        <Card as="section" aria-label="Reliability">
          <CardHeader
            title="Reliability"
            subtitle="Signing record, jail history and skin in the game"
            actions={data?.errors?.length ? <PartialDataBadge errors={data.errors} /> : null}
          />
          <CardBody>{v ? <KeyValueList divided items={reliabilityItems} /> : loadingFirst ? <SkeletonRows /> : <NotRead />}</CardBody>
        </Card>
      </div>

    </>
  );
}

/**
 * "Unbonding until <date>" while the validator's unbonding is still ahead;
 * "Unbonded since <date>" once it has passed (a jailed validator's date can
 * be a year old).
 */
function unbondingLine(unbondingTime: string | null | undefined, now: number | null): string {
  const at = unbondingTime ? Date.parse(unbondingTime) : Number.NaN;
  // The zero time ("1970-01-01") means never unbonded.
  if (!Number.isFinite(at) || at <= 0 || now === null) return "";
  return at > now ? ` Unbonding until ${formatDate(at, "long")}.` : ` Unbonded since ${formatDate(at, "long")}.`;
}

/**
 * A card's place-holder once the read has failed for good. Neutral on
 * purpose: the callout under the profile carries the reason and the one
 * Retry (four alerts for one read would be noise).
 */
function NotRead() {
  return <p className="text-[13px] text-fg-dim">Not available until this validator is read.</p>;
}

function SkeletonRows() {
  return (
    <div className="flex flex-col gap-3" aria-hidden>
      {[0, 1, 2, 3].map((i) => (
        <div key={i} className="flex items-center justify-between">
          <Skeleton className="h-3" width={110 + (i % 2) * 30} />
          <Skeleton className="h-3" width={70 + (i % 3) * 16} />
        </div>
      ))}
    </div>
  );
}
