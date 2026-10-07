"use client";

/**
 * The token pickers of the swap card: what the wallet can sell, and what a
 * swap can deliver where.
 *
 * Both lists come from the engine (src/lib/swap/assets.ts) and are only
 * grouped and ordered here:
 * - pay: by the chain the balance sits on, in the order of each chain's most
 *   valuable holding; tokens with nothing on Osmosis last, tagged, still
 *   pickable (the form then says why they cannot be swapped);
 * - receive: your assets, then Osmosis's tokens by pool liquidity, then the
 *   same tokens delivered to their home chain, then the rows the current From
 *   cannot buy, each with the engine's reason. Those are disabled, never hidden:
 *   "why can't I get SAF?" is answered in the list itself.
 *
 * A popover on desktop, a bottom sheet on phones (the kit's Combobox).
 */

import { memo, useMemo } from "react";
import { Icon } from "@/components/icons";
import { AssetLogo, Badge, Combobox, Money, TokenAmount, chainById } from "@/components/ui";
import { SWAP_VENUE_CHAIN_ID } from "@/config/interchain";
import { cn } from "@/lib/cn";
import type { AssetOption } from "@/lib/swap/assets";
import { liquidityText, sellStanding } from "./swap-view";
import { tokenSearchRank } from "./token-search";

const VENUE = SWAP_VENUE_CHAIN_ID;

export interface TokenPickerProps {
  side: "pay" | "receive";
  options: readonly AssetOption[];
  value: AssetOption | undefined;
  onSelect: (option: AssetOption) => void;
  /** Osmosis denoms the venue lists (pay side tags); `null` while loading. */
  listed: ReadonlySet<string> | null;
  /** Value of a held row in `currency` (pay side), when priced. */
  worth?: (option: AssetOption) => number | null;
  currency: string;
  loading?: boolean;
  disabled?: boolean;
  className?: string;
}

/**
 * A search's rank for one row (./token-search.ts): the ticker first, then
 * families and aliases, names, chains (the row's own included) and denoms;
 * `null` when it does not match. Module-level, so the Combobox's filter memo
 * holds still while the page redraws every second.
 */
const rankOption = (option: AssetOption, query: string) => tokenSearchRank(option.identity, query, option.chainName);

/**
 * Keeps the rows a search matches, by {@link rankOption}. The kit's Combobox
 * filters without reordering: rows keep this list's grouped order, so the
 * best match leads only within its group. Ordering by rank across groups
 * (OSMO first for "osmo", and Enter on it) needs the Combobox to take a rank.
 * What the filter alone ends is a row matching by accident: "osmo" inside
 * "Cosmos Hub" brought every Hub token ahead of OSMO.
 */
const matchesOption = (option: AssetOption, query: string) => rankOption(option, query) !== null;

export function TokenPicker({
  side,
  options,
  value,
  onSelect,
  listed,
  worth,
  currency,
  loading,
  disabled,
  className,
}: TokenPickerProps) {
  const pay = side === "pay";

  // Grouped order, decided once per list (the Combobox groups by first sight).
  const { items, groupOf } = useMemo(() => {
    const group = new Map<string, string>();
    if (pay) {
      const tradable = options.filter((option) => sellStanding(option, listed) !== "not-traded");
      const rest = options.filter((option) => sellStanding(option, listed) === "not-traded");
      const chainOrder: string[] = [];
      for (const option of tradable) if (!chainOrder.includes(option.chainId)) chainOrder.push(option.chainId);
      const ordered = [...tradable].sort((a, b) => chainOrder.indexOf(a.chainId) - chainOrder.indexOf(b.chainId));
      for (const option of ordered) group.set(option.key, `On ${option.chainName}`);
      for (const option of rest) group.set(option.key, "Not traded on Osmosis");
      return { items: [...ordered, ...rest], groupOf: group };
    }
    const byLiquidity = (a: AssetOption, b: AssetOption) => (b.liquidity ?? -1) - (a.liquidity ?? -1);
    const yours = options.filter((option) => option.held && option.disabledReason === null);
    const venue = options.filter((option) => !option.held && option.disabledReason === null && option.chainId === VENUE).sort(byLiquidity);
    const home = options.filter((option) => !option.held && option.disabledReason === null && option.chainId !== VENUE).sort(byLiquidity);
    // Last, the rows this From cannot buy: your own tokens first (the likeliest
    // "why can't I?"), then by liquidity, so a long list cut at the picker's
    // row limit drops the least likely ones. A search reaches every row.
    const off = options
      .filter((option) => option.disabledReason !== null)
      .sort((a, b) => Number(b.held) - Number(a.held) || byLiquidity(a, b));
    for (const option of yours) group.set(option.key, "Your assets");
    for (const option of venue) group.set(option.key, "On Osmosis");
    for (const option of home) group.set(option.key, "Delivered to its home chain");
    // No ticker in the label: group labels are set in capitals, and "USDC.N" is not a ticker.
    for (const option of off) group.set(option.key, "Not available for this pair");
    return { items: [...yours, ...venue, ...home, ...off], groupOf: group };
  }, [options, listed, pay]);

  const chain = value ? chainById(value.chainId) : undefined;

  // Named by what it shows ("OSMO Osmosis", "Select token"), then what it is
  // for: a name that starts with the visible words is one speech input can
  // say (WCAG 2.5.3, label in name). The space between the two lines keeps
  // them two words for the checkers that read the visible text.
  const purpose = pay ? "token to pay with" : "token to receive";
  const name = value ? `${value.ticker} ${value.chainName}, ${purpose}` : loading ? `Loading…, ${purpose}` : `Select ${purpose}`;
  const trigger = (
    <button
      type="button"
      disabled={disabled}
      aria-label={name}
      className={cn(
        "group/pick inline-flex h-12 max-w-[11.5rem] shrink-0 items-center gap-2 rounded-full border border-[var(--d-hairline-strong)] bg-[var(--d-card)] py-1 pl-1.5 pr-3 text-left max-sm:max-w-[9.5rem] max-sm:pr-2.5",
        "shadow-[0_1px_0_rgba(255,255,255,0.03)_inset] transition-[border-color,background-color] duration-[160ms]",
        "hover:border-[var(--d-control-line)] hover:bg-[var(--d-card-hover)] disabled:pointer-events-none disabled:opacity-50",
        "data-[state=open]:border-[var(--d-accent-line)] max-sm:h-[52px]",
        !value && "pl-3.5",
        className,
      )}
    >
      {value ? (
        <AssetLogo src={value.iconUrl ?? null} symbol={value.ticker} size={34} badgeSrc={chain?.iconUrl ?? null} badgeLabel={value.chainName} />
      ) : null}
      <span className="min-w-0 flex-1">
        {value ? (
          <>
            <span className="block truncate text-[15px] font-semibold leading-tight tracking-[-0.015em] text-fg">{value.ticker}</span>{" "}
            <span className="block truncate text-[11.5px] leading-tight text-fg-dim">{value.chainName}</span>
          </>
        ) : (
          <span className="block whitespace-nowrap text-[14px] font-medium text-fg">{loading ? "Loading…" : "Select token"}</span>
        )}
      </span>
      <Icon name="chevronDown" size={16} className="shrink-0 text-fg-dim transition-transform duration-[160ms] group-data-[state=open]/pick:rotate-180" />
    </button>
  );

  return (
    <Combobox<AssetOption>
      items={items}
      getKey={(option) => option.key}
      value={value?.key ?? null}
      onSelect={onSelect}
      isDisabled={(option) => option.disabledReason !== null}
      groupBy={(option) => groupOf.get(option.key) ?? null}
      filter={matchesOption}
      title={pay ? "Pay with" : "Receive"}
      placeholder={pay ? "Search your tokens" : "Search tokens or chains"}
      emptyText={pay ? "No balance matches. Tokens you hold in this scope are listed." : "No token matches"}
      width={410}
      // The kit's default list height: with the search field and the footer
      // the popover then fits above or below a trigger mid-way down a laptop
      // screen (the kit's popover does not shrink to the space it has).
      align="end"
      trigger={trigger}
      footer={
        <p className="px-1 text-[11.5px] leading-snug text-fg-dim">
          {pay
            ? "Your liquid balances in this scope. Staked tokens must be unstaked first."
            : "Liquidity from the Osmosis router, in USD. Rows that can't be bought say why."}
        </p>
      }
      renderItem={(option, state) => (
        <TokenRow option={option} pay={pay} listed={listed} value={worth?.(option) ?? null} currency={currency} disabled={state.disabled} />
      )}
    />
  );
}

/**
 * Memoised: the page redraws every second (the price clock), and an open
 * list holds hundreds of rows whose props (rows of memoised lists) hold still.
 */
const TokenRow = memo(function TokenRow({
  option,
  pay,
  listed,
  value,
  currency,
  disabled,
}: {
  option: AssetOption;
  pay: boolean;
  listed: ReadonlySet<string> | null;
  value: number | null;
  currency: string;
  disabled: boolean;
}) {
  const chain = chainById(option.chainId);
  const standing = pay ? sellStanding(option, listed) : null;
  const sub = disabled && option.disabledReason ? option.disabledReason : `${option.identity.name} · on ${option.chainName}`;
  const liquidity = !pay && !option.held ? liquidityText(option.liquidity) : null;
  return (
    <div className="flex min-w-0 items-center gap-3">
      <AssetLogo src={option.iconUrl ?? null} symbol={option.ticker} size={30} badgeSrc={chain?.iconUrl ?? null} badgeLabel={option.chainName} />
      <div className="min-w-0 flex-1">
        <div className="flex min-w-0 items-center gap-1.5">
          <span className="truncate font-medium tracking-[-0.01em] text-fg">{option.ticker}</span>
          {standing === "not-traded" ? (
            <Badge tone="neutral" size="sm">
              Not on Osmosis
            </Badge>
          ) : standing === "unlisted" ? (
            <Badge tone="neutral" size="sm">
              Unlisted
            </Badge>
          ) : null}
          {!option.verified && !disabled ? (
            <Badge tone="warning" size="sm">
              Unverified
            </Badge>
          ) : null}
        </div>
        <p className={cn("text-[12px] leading-snug text-fg-dim", disabled ? "line-clamp-2" : "truncate")} title={sub}>
          {sub}
        </p>
      </div>
      {option.held ? (
        <div className="shrink-0 text-right">
          <span className="inline-flex items-center gap-1">
            {/* On the receive side a held amount is a balance, not what the swap gives: say so. */}
            {pay ? null : <Icon name="wallet" size={12} className="text-fg-faint" aria-hidden />}
            <span className="sr-only">{pay ? "Balance" : "You hold"}</span>
            <TokenAmount amount={option.amount} decimals={option.decimals} compact className="text-[13px] font-medium tabular-nums text-fg" />
          </span>
          {value !== null ? <Money value={value} currency={currency} compact className="block text-[11.5px] tabular-nums text-fg-dim" /> : null}
        </div>
      ) : liquidity ? (
        <span className="shrink-0 text-right text-[11.5px] tabular-nums text-fg-dim">{liquidity}</span>
      ) : null}
    </div>
  );
});
