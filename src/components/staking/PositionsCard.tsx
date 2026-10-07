"use client";

/**
 * Your stake, grouped by network (spec §6): a chain row with its totals,
 * then one row per validator — identity and risk badges, staked amount and
 * value, pending rewards, the APR it earns, its share of your stake there —
 * and a row menu with Claim / Stake more / Move / Unstake.
 *
 * In single-chain scope the chain rows are dropped (the scope says which
 * chain). Rows are not links (the moniker is), so the phone cards can hold
 * the row menu.
 *
 * Networks that did not answer are named once, in one callout at the top
 * with one Retry (every per-chain Retry re-read the same thing); their chain
 * rows stay, marked "positions unreadable", so the table still says where
 * stake may be missing.
 */

import { useMemo, type ReactNode } from "react";
import {
  Button,
  Card,
  CardBody,
  CardHeader,
  ChainLogo,
  DataTable,
  EmptyState,
  IconButton,
  InfoTip,
  InlineError,
  Menu,
  Money,
  PartialDataBadge,
  Percent,
  ShareBar,
  TokenAmount,
  type Column,
  type MenuEntry,
} from "@/components/ui";
import { Icon } from "@/components/icons";
import { cn } from "@/lib/cn";
import { formatDate, formatPercent, MASK } from "@/lib/format";
import { usePrefs } from "@/providers/PrefsProvider";
import { MAX_ENTRIES, positive, steepCommissionRise, validatorHref, type ChainView, type PositionView } from "./model";
import { FlagBadges, ValidatorIdentity } from "./ValidatorBits";
import { useStakingFlows } from "./flows/StakingFlows";

type Row =
  | { kind: "chain"; key: string; chain: ChainView; share: number | null }
  | { kind: "position"; key: string; chain: ChainView; position: PositionView };

/** Names for a sentence: "Akash", "Akash and Celestia", "Akash, Celestia and Safrochain". */
function listNames(names: readonly string[]): string {
  if (names.length <= 1) return names[0] ?? "";
  return `${names.slice(0, -1).join(", ")} and ${names[names.length - 1]}`;
}

/**
 * Commission (and how far it can legally rise within 30 days), rank, and
 * uptime when it is not perfect.
 * The rise lives here rather than in a badge: nearly every validator can
 * raise its rate, and a badge on every row would drown the ones that matter.
 */
function validatorLine(position: PositionView): ReactNode {
  const v = position.validator;
  const rise = v.commissionRate !== null && v.commissionReachable30d !== null ? v.commissionReachable30d - v.commissionRate : 0;
  return (
    <>
      {v.commissionRate !== null ? `${formatPercent(v.commissionRate * 100, { digits: 1 })} commission` : "Commission —"}
      {rise > 1e-9 && v.commissionReachable30d !== null ? (
        <span
          className={steepCommissionRise(v.commissionRate ?? 0, v.commissionReachable30d) ? "text-[var(--z-warning)]" : undefined}
          title={`Its own limits let it raise commission to ${formatPercent(v.commissionReachable30d * 100, { digits: 1 })} within 30 days`}
        >
          {" "}
          (≤{formatPercent(v.commissionReachable30d * 100, { digits: 0 })} in 30d)
        </span>
      ) : null}
      {v.rank ? ` · #${v.rank}` : ""}
      {/* A perfect window is the norm; only a gap earns the space. */}
      {v.uptime !== null && v.uptime < 1 - 1e-12 ? ` · ${formatPercent(v.uptime * 100, { digits: 2 })} uptime` : ""}
    </>
  );
}

/** Badges for a row: everything but the commission rise, which the sub line carries. */
function rowFlags(position: PositionView) {
  return position.flags.filter((flag) => flag.id !== "commission");
}

/** Dust reads in full ("0.000001 SAF"), anything else to two places. */
function fractionFor(whole: number | null): number {
  return whole !== null && whole > 0 && whole < 0.01 ? 6 : 2;
}

/** Sub-cent values below a hundredth of a cent read "<$0.0001", not eight zeros. */
function precisionFor(value: number | null): number | undefined {
  return value !== null && value > 0 && value < 0.0001 ? 4 : undefined;
}

const MENU_ICON = <Icon name="dots" size={18} strokeWidth={3} />;

function menuFor(row: { chain: ChainView; position: PositionView }, open: ReturnType<typeof useStakingFlows>["open"]): MenuEntry[] {
  const { chain, position } = row;
  const v = position.validator;
  const locked = position.redelegationLockUntil;
  const earning = v.status === "bonded" && v.jailed !== true && v.tombstoned !== true;
  return [
    {
      label: "Claim rewards",
      icon: "download",
      disabled: !positive(position.rewards),
      description: positive(position.rewards) ? undefined : "Nothing pending",
      onSelect: () => open({ kind: "claim", chainIds: [chain.chainId], validator: v.operatorAddress }),
    },
    {
      label: "Stake more",
      icon: "plus",
      // Stake on a jailed or inactive validator earns nothing: not offered.
      disabled: !earning,
      description: earning ? undefined : v.jailed ? "Jailed: earns nothing" : "Inactive: earns nothing",
      onSelect: () => open({ kind: "delegate", chainId: chain.chainId, validator: v.operatorAddress }),
    },
    {
      label: "Move to another validator",
      icon: "swap",
      disabled: Boolean(locked),
      description: locked ? `Locked until ${formatDate(Date.parse(locked), "short")}` : "Instant, keeps earning",
      onSelect: () => open({ kind: "redelegate", chainId: chain.chainId, src: v.operatorAddress }),
    },
    {
      label: "Unstake",
      icon: "minus",
      disabled: position.unbondingEntries >= MAX_ENTRIES,
      description: position.unbondingEntries >= MAX_ENTRIES ? `${MAX_ENTRIES} unstakes pending` : undefined,
      onSelect: () => open({ kind: "undelegate", chainId: chain.chainId, validator: v.operatorAddress }),
    },
    { type: "separator" },
    { label: "Validator details", icon: "validators", href: validatorHref(chain.chainId, v.operatorAddress) },
  ];
}

export interface PositionsCardProps {
  chains: ChainView[] | null;
  currency: string;
  /** One chain in scope: no chain rows. */
  single: boolean;
  loading: boolean;
  /** The first prices are still on their way: a missing value is not "no price" yet. */
  pricesLoading?: boolean;
  /** The prices read failed: a missing value is not the token's lack of a price. */
  pricesError?: boolean;
  /** The answer on screen belongs to the previous scope (dimmed). */
  pending: boolean;
  error: { message: string } | null;
  onRetry: () => void;
  /** Chains in scope without an address (wallet did not share them). */
  skipped: string[];
  totalValue: number | null;
}

export function PositionsCard({
  chains,
  currency,
  single,
  loading,
  pricesLoading = false,
  pricesError = false,
  pending,
  error,
  onRetry,
  skipped,
  totalValue,
}: PositionsCardProps) {
  const flows = useStakingFlows();
  const { hideAmounts } = usePrefs();
  const noPrice = pricesLoading ? "Reading the price…" : pricesError ? "Prices could not be read just now" : "No price for this token";

  const rows = useMemo<Row[]>(() => {
    if (!chains) return [];
    const out: Row[] = [];
    for (const chain of chains) {
      const hasPositions = chain.positions.length > 0;
      if (!hasPositions && chain.status !== "error") continue;
      if (!single) {
        out.push({
          kind: "chain",
          key: `chain:${chain.chainId}`,
          chain,
          share: totalValue && chain.stakedValue !== null ? (chain.stakedValue / totalValue) * 100 : null,
        });
      }
      for (const position of chain.positions) out.push({ kind: "position", key: position.key, chain, position });
    }
    return out;
  }, [chains, single, totalValue]);

  // Answered with nothing: the callout at the top names them once.
  const unreachable = (chains ?? []).filter((chain) => chain.status === "error" && chain.positions.length === 0);
  const positionsCount = rows.filter((row) => row.kind === "position").length;
  const chainCount = new Set(rows.filter((row) => row.kind === "position").map((row) => row.chain.chainId)).size;
  // The badge is for what the callout does not already say: chains that
  // answered in part (rewards or unbonding unreadable).
  const partial = (chains ?? []).flatMap((chain) =>
    chain.status === "ok" || unreachable.includes(chain)
      ? []
      : chain.errors.length > 0
        ? chain.errors
        : [{ chainId: chain.chainId, scope: "staking", message: chain.error ?? "Partly unreadable" }],
  );
  const unreachableNotice =
    unreachable.length === 0 ? null : (
      <InlineError
        title={unreachable.length === 1 ? `Couldn't read ${unreachable[0]?.chainName}` : `Couldn't read ${unreachable.length} networks`}
        message={
          unreachable.length === 1
            ? (unreachable[0]?.error ?? "The network did not answer.")
            : `${listNames(unreachable.map((chain) => chain.chainName))} did not answer, so their stake is missing below.`
        }
        onRetry={onRetry}
      />
    );

  const columns: Column<Row>[] = [
    {
      key: "validator",
      header: single ? "Validator" : "Network / validator",
      minWidth: 220,
      cell: (row) => {
        if (row.kind === "chain") {
          const count = row.chain.positions.length;
          return (
            <span className="flex min-w-0 items-center gap-2.5">
              <ChainLogo chainId={row.chain.chainId} chain={{ chainName: row.chain.chainName, coinDenom: row.chain.symbol, iconUrl: row.chain.iconUrl }} size={22} />
              <span className="truncate font-medium text-fg">{row.chain.chainName}</span>
              <span className="shrink-0 text-[12.5px] text-fg-dim" title={count === 0 && row.chain.staked === null ? row.chain.error : undefined}>
                {count === 0 && row.chain.staked === null ? "positions unreadable" : `${count} validator${count === 1 ? "" : "s"}`}
              </span>
              {row.chain.status === "partial" ? <PartialDataBadge errors={row.chain.errors} /> : null}
            </span>
          );
        }
        const { position, chain } = row;
        return (
          <span className={cn("flex min-w-0 flex-col gap-1.5 py-2", !single && "pl-3 sm:pl-6")}>
            <ValidatorIdentity
              // Bounded so the long commission line truncates instead of
              // widening the table past its card on tablets and laptops.
              className="max-w-[170px] lg:max-w-[220px] xl:max-w-[300px] 2xl:max-w-[420px]"
              moniker={position.validator.moniker}
              logoUrl={position.validator.logoUrl}
              href={validatorHref(chain.chainId, position.validator.operatorAddress)}
              sub={validatorLine(position)}
            />
            {rowFlags(position).length > 0 || position.redelegationLockUntil ? (
              <span className="flex max-w-[170px] flex-wrap items-center gap-1 pl-[38px] lg:max-w-[220px] xl:max-w-[300px] 2xl:max-w-[420px]">
                <FlagBadges flags={rowFlags(position)} />
                {position.redelegationLockUntil ? (
                  <span className="text-[11.5px] text-fg-dim">
                    Move lock until {formatDate(Date.parse(position.redelegationLockUntil), "short")}
                  </span>
                ) : null}
              </span>
            ) : null}
          </span>
        );
      },
    },
    {
      key: "staked",
      header: "Staked",
      align: "right",
      cell: (row) => {
        const amount = row.kind === "chain" ? row.chain.staked : row.position.amount;
        const value = row.kind === "chain" ? row.chain.stakedValue : row.position.value;
        const whole = row.kind === "chain" ? row.chain.stakedWhole : row.position.whole;
        return (
          <span className="flex flex-col items-end leading-tight">
            <TokenAmount
              amount={amount}
              decimals={row.chain.decimals}
              symbol={row.chain.symbol}
              maxFraction={fractionFor(whole)}
              className={row.kind === "chain" ? "font-medium" : undefined}
            />
            <Money
              value={value}
              currency={currency}
              precision={precisionFor(value)}
              className="mt-0.5 text-[12px] text-fg-dim"
              reason={row.kind === "chain" && row.chain.staked === null ? "Positions could not be read" : noPrice}
            />
          </span>
        );
      },
    },
    {
      key: "rewards",
      header: "Rewards",
      align: "right",
      hideBelow: "md",
      cell: (row) => {
        const amount = row.kind === "chain" ? row.chain.rewards : row.position.rewards;
        const value = row.kind === "chain" ? row.chain.rewardsValue : row.position.rewardsValue;
        if (!positive(amount)) return <span className="text-fg-dim">{hideAmounts ? MASK : "0"}</span>;
        return (
          <span className="flex flex-col items-end leading-tight">
            <TokenAmount amount={amount} decimals={row.chain.decimals} symbol={row.chain.symbol} maxFraction={4} />
            <Money value={value} currency={currency} className="mt-0.5 text-[12px] text-fg-dim" reason={noPrice} />
          </span>
        );
      },
    },
    {
      key: "apr",
      header: "APR",
      align: "right",
      cell: (row) => {
        const apr = row.kind === "chain" ? row.chain.aprWeighted : row.position.apr;
        return (
          <Percent
            value={apr === null ? null : apr * 100}
            reason="APR unavailable for this chain"
            className={cn(row.kind === "position" && row.position.apr === 0 && "text-[var(--z-danger)]")}
          />
        );
      },
    },
    {
      key: "share",
      header: (
        <span className="inline-flex items-center gap-1">
          Share
          <InfoTip
            size={12}
            label="What the share is of"
            content={
              single
                ? "Each validator's share of your stake on this network."
                : "Network rows: share of your staked value across networks. Validator rows: share of your stake on that network."
            }
          />
        </span>
      ),
      align: "right",
      hideBelow: "lg",
      cell: (row) => {
        if (row.kind === "chain") return <ShareBar value={row.share} width={48} reason={noPrice} />;
        return <ShareBar value={row.position.share === null ? null : row.position.share * 100} width={48} />;
      },
    },
    {
      key: "actions",
      header: <span className="sr-only">Actions</span>,
      align: "right",
      width: 84,
      cell: (row) => {
        if (row.kind === "chain") {
          return positive(row.chain.rewards) ? (
            <Button
              size="sm"
              variant="ghost"
              iconLeft="download"
              onClick={() => flows.open({ kind: "claim", chainIds: [row.chain.chainId] })}
              className="h-7 px-2 text-[12.5px]"
            >
              Claim
            </Button>
          ) : null;
        }
        return (
          <Menu
            width={232}
            items={menuFor(row, flows.open)}
            trigger={<IconButton label={`Actions for ${row.position.validator.moniker}`} icon={MENU_ICON} size="sm" tooltip={false} />}
          />
        );
      },
    },
  ];

  const mobileCard = (row: Row) => {
    if (row.kind === "chain") {
      return (
        <span className="flex items-center gap-2.5 py-0.5">
          <ChainLogo chainId={row.chain.chainId} size={22} />
          <span className="min-w-0 flex-1">
            <span className="block truncate text-[14px] font-medium text-fg">{row.chain.chainName}</span>
            <span className="block text-[12px] text-fg-dim" title={row.chain.positions.length === 0 && row.chain.staked === null ? row.chain.error : undefined}>
              {row.chain.positions.length === 0 && row.chain.staked === null
                ? "positions unreadable"
                : `${row.chain.positions.length} validator${row.chain.positions.length === 1 ? "" : "s"}`}
              {row.chain.aprWeighted !== null ? ` · ${formatPercent(row.chain.aprWeighted * 100)} APR` : ""}
            </span>
          </span>
          <span className="flex flex-col items-end text-[13.5px] leading-tight">
            <Money
              value={row.chain.stakedValue}
              currency={currency}
              className="font-medium"
              reason={row.chain.staked === null ? "Positions could not be read" : noPrice}
            />
            <TokenAmount amount={row.chain.staked} decimals={row.chain.decimals} symbol={row.chain.symbol} compact className="text-[12px] text-fg-dim" />
          </span>
        </span>
      );
    }
    const { position, chain } = row;
    return (
      <span className={cn("flex flex-col gap-2", !single && "pl-2")}>
        <span className="flex items-start gap-2">
          <ValidatorIdentity
            className="flex-1"
            moniker={position.validator.moniker}
            logoUrl={position.validator.logoUrl}
            href={validatorHref(chain.chainId, position.validator.operatorAddress)}
            sub={validatorLine(position)}
          />
          <span className="flex shrink-0 flex-col items-end text-[13.5px] leading-tight">
            <TokenAmount amount={position.amount} decimals={chain.decimals} symbol={chain.symbol} compact maxFraction={fractionFor(position.whole)} />
            <Money value={position.value} currency={currency} precision={precisionFor(position.value)} className="text-[12px] text-fg-dim" reason={noPrice} />
          </span>
        </span>
        {rowFlags(position).length > 0 ? <FlagBadges flags={rowFlags(position)} className="pl-[38px]" /> : null}
        <span className="flex items-center gap-3 pl-[38px] text-[12.5px] text-fg-dim">
          <span className="min-w-0 flex-1 truncate">
            Rewards <TokenAmount amount={position.rewards} decimals={chain.decimals} symbol={chain.symbol} maxFraction={4} className="text-fg-muted" />
            {" · "}APR <Percent value={position.apr === null ? null : position.apr * 100} className="text-fg-muted" />
          </span>
          <Menu
            width={232}
            items={menuFor(row, flows.open)}
            trigger={<IconButton label={`Actions for ${position.validator.moniker}`} icon={MENU_ICON} size="sm" tooltip={false} />}
          />
        </span>
      </span>
    );
  };

  const subtitle = loading
    ? "Reading your positions…"
    : positionsCount > 0
      ? `${positionsCount} validator${positionsCount === 1 ? "" : "s"}${single ? "" : ` on ${chainCount} network${chainCount === 1 ? "" : "s"}`} · largest first`
      : undefined;

  return (
    <Card pending={pending && !loading} as="section" aria-label="Positions">
      <CardHeader
        title="Positions"
        subtitle={subtitle}
        actions={
          <>
            {partial.length > 0 ? <PartialDataBadge errors={partial} /> : null}
            <Button size="sm" variant="primary" iconLeft="plus" onClick={() => flows.open({ kind: "delegate", chainId: single ? chains?.[0]?.chainId : undefined })}>
              Stake
            </Button>
          </>
        }
      />
      <CardBody flush>
        {error ? (
          <div className="px-[var(--d-pad)] pb-[var(--d-pad)]">
            <InlineError title="Couldn't read your staking positions" message={error.message} onRetry={onRetry} />
          </div>
        ) : rows.length === 0 && unreachableNotice ? (
          // Nothing answered: the error alone, never "You're not staking yet".
          <div className="px-[var(--d-pad)] pb-[var(--d-pad)]">{unreachableNotice}</div>
        ) : (
          <>
            {unreachableNotice ? <div className="px-[var(--d-pad)] pb-3">{unreachableNotice}</div> : null}
            <DataTable
              ariaLabel="Staking positions"
              columns={columns}
              rows={rows}
              getRowKey={(row) => row.key}
              loading={loading}
              skeletonRows={3}
              rowClassName={(row) =>
                row.kind === "chain"
                  ? "[&>td]:bg-[var(--d-card-2)] [&>td]:h-11"
                  : undefined
              }
              mobileCard={mobileCard}
              empty={
                <EmptyState
                  icon="staking"
                  title="You're not staking yet"
                  body="Stake to earn rewards from the network. Your tokens stay in your account, and you can unstake later."
                  action={
                    <Button variant="primary" size="sm" iconLeft="plus" onClick={() => flows.open({ kind: "delegate" })}>
                      Stake
                    </Button>
                  }
                />
              }
              footer={
                skipped.length > 0 ? (
                  <span>
                    Not shown: your wallet has not shared an address on {skipped.length === 1 ? skipped[0] : `${skipped.length} networks`}.
                  </span>
                ) : undefined
              }
            />
          </>
        )}
      </CardBody>
    </Card>
  );
}
