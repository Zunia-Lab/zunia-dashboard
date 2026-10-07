"use client";

/**
 * Cells and small blocks the Assets table and the asset page share: the
 * asset name block, the price-or-reason cell, the per-holding actions (a
 * row of icons or a menu), the labelled figure of the detail cards and the
 * four-bucket breakdown of a position.
 */

import type { MouseEvent, ReactNode } from "react";
import { AssetLogo, Badge, IconButton, InfoTip, LogoStack, Menu, Money, Skeleton, TokenAmount, Tooltip, chainById, type MenuEntry } from "@/components/ui";
import { cn } from "@/lib/cn";
import { tokenText } from "@/lib/token/text";
import type { TokenIdentity } from "@/lib/token/types";
import { UNPRICED_TEXT, type PortfolioAsset, type UnpricedReason } from "@/lib/token/wire";
import { baseAmountDigits, isUnlisted, isUnverifiedRoute } from "./holdings";
import { bridgeHref, sendHref, stakeHref, swapFromHref } from "./links";

/** The chain's logo URL from the client catalog (no endpoints in it). */
export function chainIcon(chainId: string): string | null {
  return chainById(chainId)?.iconUrl ?? null;
}

export function chainName(chainId: string): string {
  return chainById(chainId)?.chainName ?? chainId;
}

/* ------------------------------------------------------------------ name block */

export interface AssetNameProps {
  identity: TokenIdentity;
  /** Chains the position sits on; more than one shows a logo stack instead of the badge. */
  chainIds: readonly string[];
  size?: number;
  /** Second line override (default: the identity's row text, or "on N chains"). */
  line?: ReactNode;
  className?: string;
}

/**
 * Logo (with the holding chain's badge), ticker, the trust flags, and the
 * identity line ("Native on Celestia", "Noble USDC · on Osmosis",
 * "Unknown origin · on Cosmos Hub · ibc/27BC…").
 */
export function AssetName({ identity, chainIds, size = 32, line, className }: AssetNameProps) {
  const multi = chainIds.length > 1;
  const holding = chainIds[0] ?? identity.chainId;
  const text = line ?? (multi ? `${identity.name} · on ${chainIds.length} chains` : tokenText(identity, "row"));
  return (
    <span className={cn("flex min-w-0 items-center gap-3", className)}>
      <AssetLogo
        src={identity.logoUrl}
        symbol={identity.ticker}
        size={size}
        badgeSrc={multi ? undefined : chainIcon(holding)}
        badgeLabel={multi ? undefined : chainName(holding)}
      />
      <span className="flex min-w-0 flex-col gap-0.5">
        <span className="flex min-w-0 items-center gap-1.5">
          <span className="truncate font-medium tracking-[-0.01em] text-fg">{identity.ticker}</span>
          <TrustBadge identity={identity} />
        </span>
        <span className="flex min-w-0 items-center gap-1.5 text-[12.5px] leading-tight text-fg-dim">
          {multi ? (
            <LogoStack
              size={14}
              max={4}
              items={chainIds.map((id) => ({ src: chainIcon(id), label: chainName(id) }))}
              label={`On ${chainIds.map(chainName).join(", ")}`}
            />
          ) : null}
          <span className="truncate" title={typeof text === "string" ? text : undefined}>
            {text}
          </span>
        </span>
      </span>
    </span>
  );
}

/** "Unlisted" / "Unverified route": a holding to look at twice before acting on it. */
export function TrustBadge({ identity, className }: { identity: TokenIdentity; className?: string }) {
  if (isUnlisted(identity)) {
    return (
      <Badge tone="neutral" variant="outline" className={cn("h-[18px] px-1 text-[10.5px]", className)} title="No registry lists this token: often airdropped spam">
        Unlisted
      </Badge>
    );
  }
  if (isUnverifiedRoute(identity)) {
    return (
      <Badge
        tone="warning"
        variant="outline"
        className={cn("h-[18px] px-1 text-[10.5px]", className)}
        title="It arrived over a route that is not the asset's canonical one, so it is not priced as the asset it names"
      >
        Unverified
      </Badge>
    );
  }
  return null;
}

/* ------------------------------------------------------------------ price */

/** The badge and its reason for assistive tech. */
function NoPriceLabel({ reason }: { reason: string }) {
  return (
    <>
      <Badge tone="neutral" size="sm">
        No price
      </Badge>
      <span className="sr-only">: {reason}</span>
    </>
  );
}

/**
 * "No price" with the reason on hover. Not focusable: phone cards are
 * links, and a link holds no other stop.
 */
export function NoPriceBadge({ reason, className }: { reason?: UnpricedReason; className?: string }) {
  const text = UNPRICED_TEXT[reason ?? "no-market"];
  return (
    <span className={cn("inline-flex", className)} title={text}>
      <NoPriceLabel reason={text} />
    </span>
  );
}

/** A price, or "No price" with the reason in a tooltip (never $0). */
export function PriceCell({
  price,
  unpriced,
  currency,
  className,
}: {
  price: number | null | undefined;
  unpriced?: UnpricedReason;
  currency: string;
  className?: string;
}) {
  if (price !== null && price !== undefined) return <Money masked={false} value={price} currency={currency} className={className} />;
  const reason = UNPRICED_TEXT[unpriced ?? "no-market"];
  return (
    <Tooltip content={reason}>
      <span tabIndex={0} className={cn("inline-flex rounded-[6px] outline-offset-2", className)}>
        <NoPriceLabel reason={reason} />
      </span>
    </Tooltip>
  );
}

/* ------------------------------------------------------------------ actions */

function hasUnits(text: string): boolean {
  return /^\d+$/.test(text) && BigInt(text) > BigInt(0);
}

export interface HoldingActionsProps {
  row: PortfolioAsset;
  /** The chain's own staking coin on that chain (see `isStakingCoin`): offers "Stake". */
  stakeable: boolean;
  /** False when a market says the asset is not swappable (with the reason). */
  swappable?: { ok: boolean; reason?: string };
  className?: string;
}

interface ActionSpec {
  key: "send" | "swap" | "bridge" | "stake";
  icon: "send" | "swap" | "bridge" | "staking";
  /** Short label (menus) and the full one (icon buttons, screen readers). */
  label: string;
  full: string;
  /** Where it goes with the holding prefilled; null when it cannot run here. */
  href: string | null;
  /** Why it cannot run, or what it does (menus show it under the label). */
  note: string;
}

/**
 * Send / Swap / Bridge / Stake for one holding, each with its prefilled
 * link, or the reason it cannot run here (nothing liquid, not traded, not
 * the chain's staking coin). One list for the icon row and the menu.
 */
function actionSpecs({ row, stakeable, swappable }: Omit<HoldingActionsProps, "className">): ActionSpec[] {
  const { identity, chainId } = row;
  const ticker = identity.ticker;
  const where = identity.chainName ?? chainName(chainId);
  const liquid = hasUnits(row.amounts.liquid);
  const noLiquid = `Nothing liquid: all your ${ticker} on ${where} is staked or unbonding`;
  const swapReason = !liquid
    ? noLiquid
    : isUnlisted(identity)
      ? "Unlisted token: no verified market to swap it on"
      : swappable && !swappable.ok
        ? (swappable.reason ?? `${ticker} is not traded on Osmosis`)
        : null;
  const specs: ActionSpec[] = [
    {
      key: "send",
      icon: "send",
      label: "Send",
      full: `Send ${ticker} from ${where}`,
      href: liquid ? sendHref(chainId, identity.denom) : null,
      note: liquid ? `From ${where}` : noLiquid,
    },
    {
      key: "swap",
      icon: "swap",
      label: "Swap",
      full: `Swap ${ticker}`,
      href: swapReason ? null : swapFromHref(chainId, identity.denom),
      note: swapReason ?? "On Osmosis, signed in your wallet",
    },
    {
      key: "bridge",
      icon: "bridge",
      label: "Bridge",
      full: `Bridge ${ticker} from ${where}`,
      href: liquid ? bridgeHref(chainId, identity.denom) : null,
      note: liquid ? "To another chain over IBC" : noLiquid,
    },
  ];
  if (stakeable) {
    specs.push({ key: "stake", icon: "staking", label: "Stake", full: `Stake ${ticker} on ${where}`, href: stakeHref(chainId), note: `Delegate on ${where}` });
  }
  return specs;
}

/**
 * An action that cannot run here. A disabled button gets no pointer events,
 * so its tooltip would never open: the reason sits on a focusable wrapper,
 * and the button inside keeps it as its accessible name.
 */
function UnavailableAction({ icon, reason }: { icon: ActionSpec["icon"]; reason: string }) {
  return (
    <Tooltip content={reason}>
      <span role="button" aria-disabled="true" tabIndex={0} aria-label={reason} className="inline-flex cursor-not-allowed rounded-[var(--d-radius-control)]">
        <IconButton size="sm" icon={icon} label={reason} tooltip={false} disabled tabIndex={-1} aria-hidden />
      </span>
    </Tooltip>
  );
}

/** The holding's actions as a row of icon buttons (wide tables, detail rows). */
export function HoldingActions({ row, stakeable, swappable, className }: HoldingActionsProps) {
  const specs = actionSpecs({ row, stakeable, swappable });
  return (
    <div data-row-action="" className={cn("flex items-center justify-end gap-0.5", className)}>
      {specs.map((spec) =>
        spec.href ? (
          <IconButton key={spec.key} size="sm" icon={spec.icon} label={spec.full} href={spec.href} />
        ) : (
          <UnavailableAction key={spec.key} icon={spec.icon} reason={spec.note} />
        ),
      )}
      {/* Keeps the columns of icons aligned row to row. */}
      {stakeable ? null : <span aria-hidden className="inline-block size-[var(--d-ctl-sm)] shrink-0" />}
    </div>
  );
}

const stopRowClick = (event: MouseEvent) => event.stopPropagation();

/**
 * A control inside a linked table row whose panel opens in a portal (a
 * menu, a pinned info card). React bubbles a click in the panel up to the
 * row, and the table's "was it a control?" test looks at the row's DOM,
 * which a portal is not in: picking "Send" would also open the row's page.
 * The click stops here instead.
 */
export function RowControl({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <span data-row-action="" onClick={stopRowClick} onAuxClick={stopRowClick} className={className}>
      {children}
    </span>
  );
}

/** The same actions behind one "⋯" button, for tables without room for four icons. */
export function HoldingActionsMenu({ row, stakeable, swappable, className }: HoldingActionsProps) {
  const specs = actionSpecs({ row, stakeable, swappable });
  const items: MenuEntry[] = specs.map((spec) => ({
    label: spec.label,
    icon: spec.icon,
    description: spec.note,
    ...(spec.href ? { href: spec.href } : { disabled: true }),
  }));
  return (
    <RowControl className={cn("inline-flex justify-end", className)}>
      <Menu
        width={240}
        items={items}
        trigger={<IconButton size="sm" icon="dots" label={`Actions for ${row.identity.ticker} on ${row.identity.chainName ?? chainName(row.chainId)}`} />}
      />
    </RowControl>
  );
}

/* ------------------------------------------------------------------ figures */

/**
 * One labelled figure for a `<dl>`: mono caps label (with an optional
 * (i)), the value, a dim line under it. The building block of the price
 * chart's range statistics, the staking economics row and the provenance
 * grid.
 */
export function Figure({
  label,
  value,
  sub,
  info,
  loading,
  size = "md",
  children,
  className,
}: {
  label: string;
  value: ReactNode;
  sub?: ReactNode;
  info?: ReactNode;
  loading?: boolean;
  /** `md` 15px (statistics), `lg` 22px (the economics row), `text` 13.5px (facts). */
  size?: "md" | "lg" | "text";
  /** Under the value: a meter, a badge row. */
  children?: ReactNode;
  className?: string;
}) {
  return (
    <div className={cn("min-w-0", className)}>
      <dt className="flex items-center gap-1">
        <span className="d-label">{label}</span>
        {info ? <InfoTip content={info} size={12} /> : null}
      </dt>
      <dd className="mt-1 min-w-0">
        {loading ? (
          <Skeleton className={size === "lg" ? "mt-1 h-5" : "mt-0.5 h-4"} width="70%" />
        ) : (
          <div
            className={cn(
              "min-w-0 tabular-nums text-fg",
              // Figures truncate (a number cut in two lines reads wrong); facts wrap.
              size === "lg" && "truncate text-[22px] font-semibold leading-tight tracking-[-0.03em]",
              size === "md" && "truncate text-[15px] font-medium tracking-[-0.01em]",
              size === "text" && "break-words text-[13.5px] leading-snug",
            )}
          >
            {value}
          </div>
        )}
        {children && !loading ? <div className="mt-1.5">{children}</div> : null}
        {sub && !loading ? <div className="mt-0.5 text-[12px] leading-snug text-fg-dim">{sub}</div> : null}
      </dd>
    </div>
  );
}

/* ------------------------------------------------------------------ buckets */

const BUCKETS = [
  { key: "liquid", label: "Liquid" },
  { key: "staked", label: "Staked" },
  { key: "rewards", label: "Rewards" },
  { key: "unbonding", label: "Unbonding" },
] as const;

/** Liquid · Staked · Rewards · Unbonding of one holding, zero buckets dimmed. */
export function BucketAmounts({ row, className }: { row: PortfolioAsset; className?: string }) {
  const decimals = row.identity.decimals;
  return (
    <dl className={cn("grid min-w-0 grid-cols-2 gap-x-4 gap-y-1.5 sm:grid-cols-4", className)}>
      {BUCKETS.map((bucket) => {
        const amount = row.amounts[bucket.key];
        const zero = !hasUnits(amount);
        return (
          <div key={bucket.key} className="min-w-0">
            <dt className="d-label !text-[10px]">{bucket.label}</dt>
            <dd className={cn("mt-0.5 truncate text-[13px] tabular-nums", zero ? "text-fg-faint" : "text-fg")}>
              {zero ? "0" : <TokenAmount amount={amount} decimals={decimals} maxFraction={baseAmountDigits(amount, decimals, 4)} />}
            </dd>
          </div>
        );
      })}
    </dl>
  );
}
