"use client";

/**
 * The command palette (⌘K / Ctrl K): jump to any page, scope to a chain,
 * open an asset, or act (claim, privacy, theme, connect, notification
 * settings) without leaving the keyboard.
 *
 * - Actions are what a page entry cannot do: Send, Swap and the other pages
 *   are listed once, under Pages. Zunia Mobile is a way to connect: without a
 *   wallet, "Connect with Zunia Mobile" opens the connect modal on its QR
 *   code; while a phone session is live, its entry opens the session in
 *   Settings.
 * - Groups: Recent (what you picked last, stored on this device), Actions,
 *   Pages, Chains, Assets. With a query, groups are ordered by their best
 *   match and items by score (`palette-search`: prefix > word start >
 *   substring > letters in order), each group cut short so a strong match in
 *   a later group still shows without scrolling.
 * - Keyboard: ↑ ↓ move, ↵ runs, ⌘↵ / Ctrl ↵ runs the secondary action (open a
 *   chain's page instead of scoping to it; the footer names it when the
 *   highlighted row has one), Esc clears the query, then closes. The input is
 *   an ARIA combobox driving a listbox through aria-activedescendant.
 * - Rows are one line from 640 px (name, then its detail dimmed), two on
 *   phones, where the palette sits under the top edge so the field and the
 *   first results stay above the on-screen keyboard.
 * - Assets come from the public markets read, fetched when the palette opens
 *   (the body only mounts while it is open). An asset matches on its ticker
 *   first; its market name ("Osmosis ION") only as a detail, so "osmo" brings
 *   OSMO and the Osmosis chain, not every token launched there.
 */

import { useRouter } from "next/navigation";
import { useEffect, useId, useRef, useState, type KeyboardEvent, type ReactNode } from "react";
import { useTheme } from "@zunialab/ui";
import { useConnectModal } from "@/components/connect/ConnectModal";
import { Icon, type IconName } from "@/components/icons";
import { matchScore, rankMatches } from "@/components/shell/palette-search";
import { AllChainsMark } from "@/components/shell/ScopeControl";
import { useModifierLabel } from "@/components/shell/shortcut";
import { AssetLogo, ChainLogo, Delta, Dialog, Kbd, SoonBadge, Spinner, toast } from "@/components/ui";
import { cn } from "@/lib/cn";
import { findChain, searchChains, type ChainEntry } from "@/lib/chains";
import { useMarkets } from "@/lib/data/markets";
import { formatFiat } from "@/lib/format";
import { ALL_NAV_ITEMS } from "@/lib/nav";
import { useChainScope } from "@/lib/useChainScope";
import { useStoredValue } from "@/lib/useStoredValue";
import { usePrefs } from "@/providers/PrefsProvider";
import { useWallet } from "@/providers/WalletProvider";

type GroupId = "recent" | "actions" | "pages" | "chains" | "assets";

const GROUP_LABEL: Record<GroupId, string> = {
  recent: "Recent",
  actions: "Actions",
  pages: "Pages",
  chains: "Chains",
  assets: "Assets",
};

/** Rows per group while searching: enough to choose from, short enough that the next group shows. */
const GROUP_LIMIT: Record<Exclude<GroupId, "recent">, number> = { actions: 4, pages: 5, chains: 6, assets: 6 };

interface PaletteItem {
  /** Stable across sessions: "page:/swap", "chain:osmosis-1", "asset:<key>", "action:send". */
  id: string;
  label: string;
  detail?: string;
  keywords?: string[];
  icon?: IconName;
  leading?: ReactNode;
  hint?: ReactNode;
  run: () => void;
  /** ⌘↵: an alternative (a chain's page rather than scoping to it). */
  secondary?: { label: string; run: () => void };
}

interface Group {
  id: GroupId;
  items: PaletteItem[];
}

const RECENT_KEY = "zunia.dashboard.palette.recent";
const RECENT_MAX = 6;
const CATALOG_LIMIT = 8;

const searchable = (item: PaletteItem) => ({ label: item.label, keywords: item.keywords, detail: item.detail });

/* ------------------------------------------------------------------ items */

function useItems(close: () => void) {
  const router = useRouter();
  const { account, walletKind, disconnect } = useWallet();
  const modal = useConnectModal();
  const { resolved, setTheme } = useTheme();
  const { hideAmounts, toggleHideAmounts } = usePrefs();
  const { followedAll, selectedChainId, selectChain } = useChainScope();
  const markets = useMarkets();

  const go = (href: string) => () => {
    close();
    router.push(href);
  };

  const actions: PaletteItem[] = [
    {
      id: "action:claim",
      label: "Claim all rewards",
      detail: "Staking, with every claimable reward ready to sign",
      icon: "sparkle",
      keywords: ["rewards", "staking", "withdraw"],
      run: go("/staking?action=claim"),
    },
    {
      id: "action:privacy",
      label: hideAmounts ? "Show amounts" : "Hide amounts",
      detail: "Privacy mode masks every balance on screen",
      icon: hideAmounts ? "eye" : "eyeOff",
      keywords: ["privacy", "mask", "hide"],
      run: () => {
        close();
        toggleHideAmounts();
      },
    },
    {
      id: "action:theme",
      label: resolved === "dark" ? "Switch to light theme" : "Switch to dark theme",
      icon: resolved === "dark" ? "sun" : "moon",
      keywords: ["theme", "dark", "light", "appearance"],
      run: () => {
        close();
        setTheme(resolved === "dark" ? "light" : "dark");
      },
    },
    account
      ? {
          id: "action:disconnect",
          label: "Disconnect wallet",
          detail: "Ends this session; your wallet is untouched",
          icon: "disconnect",
          keywords: ["logout", "sign out"],
          run: () => {
            close();
            void disconnect();
          },
        }
      : {
          id: "action:connect",
          label: "Connect wallet",
          detail: "Zunia extension, Keplr, Leap, Cosmostation or Zunia Mobile",
          icon: "wallet",
          keywords: ["login", "sign in", "keplr", "leap", "cosmostation"],
          run: () => {
            close();
            modal.open();
          },
        },
    {
      id: "action:notification-settings",
      label: "Notification settings",
      detail: "What to tell you about, browser alerts, push and quiet hours",
      icon: "notifications",
      keywords: ["notifications", "alerts", "push", "preferences", "quiet hours"],
      run: go("/settings#notifications"),
    },
  ];
  // Zunia Mobile: a way to connect while no wallet is, the session once it
  // signs for this page; nothing while another wallet is connected.
  if (!account) {
    actions.push({
      id: "action:connect-mobile",
      label: "Connect with Zunia Mobile",
      detail: "Scan a QR code, approve on your phone",
      icon: "mobile",
      keywords: ["phone", "qr", "mobile", "scan"],
      run: () => {
        close();
        modal.open("mobile");
      },
    });
  } else if (walletKind === "zunia-mobile") {
    actions.push({
      id: "action:mobile-session",
      label: "Zunia Mobile session",
      detail: "Connected phone, time left, disconnect",
      icon: "mobile",
      keywords: ["phone", "mobile", "session", "disconnect"],
      run: go("/settings#connections"),
    });
  }
  if (account) {
    actions.push({
      id: "action:copy",
      label: "Copy my address",
      detail: account.address,
      icon: "copy",
      keywords: ["address", "clipboard"],
      run: () => {
        close();
        navigator.clipboard.writeText(account.address).then(
          () => toast.success("Address copied"),
          () => toast.error("Could not copy the address"),
        );
      },
    });
  }

  const pages: PaletteItem[] = ALL_NAV_ITEMS.map((item) => ({
    id: `page:${item.href}`,
    label: item.label,
    detail: item.description,
    keywords: item.keywords,
    icon: item.icon,
    hint: item.badge === "soon" ? <SoonBadge /> : undefined,
    run: go(item.href),
  }));

  const chainItem = (chain: ChainEntry, followed: boolean): PaletteItem => ({
    id: `chain:${chain.chainId}`,
    label: chain.chainName,
    detail: `${chain.chainId} · ${chain.coinDenom}${chain.network === "testnet" ? " · testnet" : ""}`,
    keywords: [chain.chainId, chain.coinDenom, chain.registrySlug ?? ""],
    leading: <ChainLogo chainId={chain.chainId} size={22} />,
    hint: followed ? (
      selectedChainId === chain.chainId ? (
        <span className="text-[11.5px] font-medium text-[var(--d-accent-text)]">In scope</span>
      ) : (
        <span className="text-[11.5px] text-fg-dim">Scope to it</span>
      )
    ) : (
      <span className="text-[11.5px] text-fg-dim">Chain page</span>
    ),
    run: followed
      ? () => {
          close();
          selectChain(chain.chainId);
        }
      : go(`/chains/${encodeURIComponent(chain.chainId)}`),
    secondary: followed ? { label: "Open chain page", run: go(`/chains/${encodeURIComponent(chain.chainId)}`) } : undefined,
  });

  const followedChains = followedAll.map((chainId) => findChain(chainId)).filter((chain): chain is ChainEntry => Boolean(chain));
  const chains: PaletteItem[] = [
    {
      id: "chain:all",
      label: "All chains",
      detail: "Every followed network, added together",
      keywords: ["scope", "everything", "aggregate"],
      leading: <AllChainsMark size={22} active={selectedChainId === null} />,
      hint:
        selectedChainId === null ? <span className="text-[11.5px] font-medium text-[var(--d-accent-text)]">In scope</span> : undefined,
      run: () => {
        close();
        selectChain(null);
      },
    },
    ...followedChains.map((chain) => chainItem(chain, true)),
  ];

  const currency = markets.data?.currency;
  const assets: PaletteItem[] = (markets.data?.assets ?? []).map((asset) => ({
    id: `asset:${asset.key}`,
    label: asset.symbol,
    detail: asset.name,
    keywords: asset.coinGeckoId ? [asset.coinGeckoId] : undefined,
    leading: <AssetLogo src={asset.logoUrl} symbol={asset.symbol} size={22} />,
    hint: (
      <span className="flex items-center gap-2 tabular-nums">
        <span className="text-[12.5px] text-fg-muted">{formatFiat(asset.price, currency)}</span>
        <Delta value={asset.change24h} />
      </span>
    ),
    run: go(`/assets/${encodeURIComponent(asset.key)}`),
  }));

  return { actions, pages, chains, assets, catalogItem: (chain: ChainEntry) => chainItem(chain, false), followedChains, marketsLoading: markets.loading };
}

/* ------------------------------------------------------------------ rows */

function Row({
  item,
  selected,
  index,
  id,
  modifier,
  onHover,
  onRun,
}: {
  item: PaletteItem;
  selected: boolean;
  index: number;
  id: string;
  modifier: string;
  onHover: () => void;
  onRun: (secondary: boolean) => void;
}) {
  return (
    <div
      id={id}
      role="option"
      aria-selected={selected}
      data-index={index}
      onPointerMove={() => {
        if (!selected) onHover();
      }}
      onClick={() => onRun(false)}
      // The selected-row tint rather than glass: on glass the dimmed detail
      // and a red 24 h move fell under 4.5:1 in the dark theme.
      className={cn(
        "group flex min-h-10 cursor-pointer items-center gap-3 rounded-[10px] px-2.5 py-1.5 max-sm:min-h-12",
        selected && "bg-[var(--d-row-selected)]",
      )}
    >
      <span className="flex size-7 shrink-0 items-center justify-center">
        {item.leading ?? (
          <span
            className={cn(
              "flex size-7 items-center justify-center rounded-[8px] border border-[var(--d-hairline)]",
              selected ? "bg-[var(--d-card)] text-fg" : "bg-[var(--d-glass)] text-fg-dim",
            )}
          >
            {item.icon ? <Icon name={item.icon} size={15} /> : null}
          </span>
        )}
      </span>
      <span className="flex min-w-0 flex-1 flex-col sm:flex-row sm:items-baseline sm:gap-2.5">
        <span className="truncate text-[14px] font-medium leading-snug text-fg sm:max-w-[60%] sm:shrink-0">{item.label}</span>
        {item.detail ? <span className="min-w-0 truncate text-[12.5px] leading-snug text-fg-dim sm:text-[13px]">{item.detail}</span> : null}
      </span>
      {/* An option cannot hold a control (axe: nested-interactive, even an
          unfocusable aria-hidden one), so the secondary action's chip is a
          plain element that only takes the pointer's click; the option's own
          text names the keyboard way to it (⌘↵ / Ctrl ↵, handled by the
          field). */}
      {selected && item.secondary ? (
        <>
          <span className="sr-only">
            , {modifier === "⌘" ? "Command" : "Control"} Enter: {item.secondary.label.toLowerCase()}
          </span>
          <span
            aria-hidden
            onClick={(event) => {
              event.stopPropagation();
              onRun(true);
            }}
            className="hidden shrink-0 cursor-pointer items-center gap-1.5 rounded-[7px] border border-[var(--d-hairline-strong)] px-2 py-1 text-[11.5px] font-medium text-fg-muted hover:text-fg sm:flex"
          >
            {item.secondary.label}
            <Kbd className="h-4 min-w-4 text-[10px]">{modifier}↵</Kbd>
          </span>
        </>
      ) : item.hint ? (
        <span className="shrink-0">{item.hint}</span>
      ) : null}
      {selected ? <Icon name="arrowRight" size={14} className="shrink-0 text-fg-dim max-sm:hidden" /> : null}
    </div>
  );
}

/* ------------------------------------------------------------------ body */

function PaletteBody({ close }: { close: () => void }) {
  const [query, setQuery] = useState("");
  const [active, setActive] = useState(0);
  const [recentIds, setRecentIds] = useStoredValue<string[]>(RECENT_KEY, []);
  const listRef = useRef<HTMLDivElement>(null);
  const baseId = useId();
  const modifier = useModifierLabel();
  const { actions, pages, chains, assets, catalogItem, followedChains, marketsLoading } = useItems(close);
  const trimmed = query.trim();

  // Esc with a query clears it and keeps the palette open. The dialog
  // dismisses on a capture-phase keydown on the document unless the event is
  // already default-prevented, so this listener sits one step earlier (the
  // window's capture phase) and claims the key while there is text.
  useEffect(() => {
    if (!query) return;
    const onKeyDown = (event: globalThis.KeyboardEvent) => {
      if (event.key !== "Escape") return;
      event.preventDefault();
      setQuery("");
      setActive(0);
    };
    window.addEventListener("keydown", onKeyDown, true);
    return () => window.removeEventListener("keydown", onKeyDown, true);
  }, [query]);

  function buildGroups(): Group[] {
    const byId = new Map<string, PaletteItem>();
    for (const item of [...actions, ...pages, ...chains, ...assets]) byId.set(item.id, item);
    if (!trimmed) {
      const recent = recentIds.map((id) => byId.get(id)).filter((item): item is PaletteItem => Boolean(item));
      const fresh = (items: PaletteItem[]) => items.filter((item) => !recentIds.includes(item.id));
      const list: Group[] = [
        { id: "recent", items: recent },
        { id: "actions", items: fresh(actions) },
        { id: "pages", items: fresh(pages) },
        { id: "chains", items: fresh(chains) },
      ];
      return list.filter((group) => group.items.length > 0);
    }
    const followedIds = new Set(followedChains.map((chain) => chain.chainId));
    const catalog = searchChains(trimmed)
      .filter((chain) => !followedIds.has(chain.chainId))
      .slice(0, CATALOG_LIMIT)
      .map(catalogItem);
    const ranked: Group[] = [
      { id: "actions", items: rankMatches(trimmed, actions, searchable, GROUP_LIMIT.actions) },
      { id: "pages", items: rankMatches(trimmed, pages, searchable, GROUP_LIMIT.pages) },
      { id: "chains", items: rankMatches(trimmed, [...chains, ...catalog], searchable, GROUP_LIMIT.chains) },
      { id: "assets", items: rankMatches(trimmed, assets, searchable, GROUP_LIMIT.assets) },
    ];
    const best = (group: Group) => (group.items[0] ? (matchScore(trimmed, searchable(group.items[0])) ?? 0) : -1);
    return ranked.filter((group) => group.items.length > 0).sort((a, b) => best(b) - best(a));
  }

  const groups = buildGroups();
  const flat = groups.flatMap((group) => group.items);
  const offsets = groups.map((_, at) => groups.slice(0, at).reduce((sum, group) => sum + group.items.length, 0));
  const current = Math.min(active, Math.max(0, flat.length - 1));
  const currentItem = flat[current];
  const optionId = (index: number) => `${baseId}-option-${index}`;

  // Keep the highlighted row in view while arrowing through a long list.
  useEffect(() => {
    listRef.current?.querySelector<HTMLElement>(`[data-index="${current}"]`)?.scrollIntoView({ block: "nearest" });
  }, [current]);

  const remember = (item: PaletteItem) => setRecentIds((prev) => [item.id, ...prev.filter((id) => id !== item.id)].slice(0, RECENT_MAX));
  const runItem = (item: PaletteItem | undefined, secondary = false) => {
    if (!item) return;
    remember(item);
    if (secondary && item.secondary) item.secondary.run();
    else item.run();
  };

  const onKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault();
      if (flat.length === 0) return;
      const step = event.key === "ArrowDown" ? 1 : -1;
      setActive((current + step + flat.length) % flat.length);
    } else if (event.key === "Enter") {
      event.preventDefault();
      runItem(currentItem, event.metaKey || event.ctrlKey);
    }
  };

  return (
    <div className="flex min-h-0 flex-col">
      <div className="flex items-center gap-3 border-b border-[var(--d-hairline)] pl-4 pr-3 sm:pr-4">
        <Icon name="search" size={18} className="shrink-0 text-fg-dim" />
        <input
          role="combobox"
          aria-expanded="true"
          aria-controls={`${baseId}-list`}
          aria-activedescendant={flat.length > 0 ? optionId(current) : undefined}
          aria-autocomplete="list"
          aria-label="Search pages, chains, assets and actions"
          autoComplete="off"
          spellCheck={false}
          enterKeyHint="go"
          value={query}
          onChange={(event) => {
            setQuery(event.target.value);
            setActive(0);
          }}
          onKeyDown={onKeyDown}
          placeholder="Search pages, chains, assets, actions…"
          className="h-14 min-w-0 flex-1 bg-transparent text-[15.5px] text-fg outline-none placeholder:text-fg-faint max-sm:text-[16px]"
        />
        {trimmed && marketsLoading ? <Spinner size={14} className="text-fg-dim" label="Loading assets" /> : null}
        <Kbd className="max-sm:hidden">Esc</Kbd>
        {/* Phones have no Esc key and no close button here: a plain Cancel,
            as in the system search fields. */}
        <button
          type="button"
          onClick={close}
          className="d-hit -mr-1 h-9 shrink-0 rounded-[8px] px-2 text-[14px] font-medium text-[var(--d-accent-text)] sm:hidden"
        >
          Cancel
        </button>
      </div>

      <div
        ref={listRef}
        id={`${baseId}-list`}
        role="listbox"
        aria-label="Results"
        className="d-scroll max-h-[min(440px,58dvh)] overflow-y-auto overscroll-contain p-2 max-sm:max-h-[46dvh]"
      >
        {groups.length === 0 ? (
          <div className="flex flex-col items-center gap-1 px-4 py-10 text-center">
            <p className="text-[14px] font-medium text-fg">No results for “{trimmed}”</p>
            <p className="text-[13px] text-fg-dim">Try a page (Staking), a chain (Osmosis), a token (ATOM) or an action (Send).</p>
          </div>
        ) : (
          groups.map((group, groupIndex) => (
            <div key={group.id} role="group" aria-labelledby={`${baseId}-${group.id}`} className="pb-1">
              <div id={`${baseId}-${group.id}`} className="d-label px-2.5 pb-1 pt-2 text-[10.5px]">
                {GROUP_LABEL[group.id]}
              </div>
              {group.items.map((item, itemIndex) => {
                const at = offsets[groupIndex] + itemIndex;
                return (
                  <Row
                    key={`${group.id}-${item.id}`}
                    item={item}
                    index={at}
                    id={optionId(at)}
                    selected={at === current}
                    modifier={modifier}
                    onHover={() => setActive(at)}
                    onRun={(secondary) => runItem(item, secondary)}
                  />
                );
              })}
            </div>
          ))
        )}
      </div>

      <div className="flex items-center gap-4 border-t border-[var(--d-hairline)] px-4 py-2.5 text-[11.5px] text-fg-dim max-sm:hidden">
        <span className="flex items-center gap-1.5">
          <Kbd>↑</Kbd>
          <Kbd>↓</Kbd>
          to move
        </span>
        <span className="flex items-center gap-1.5">
          <Kbd>↵</Kbd>
          to open
        </span>
        {currentItem?.secondary ? (
          <span className="flex min-w-0 items-center gap-1.5">
            <Kbd>{modifier}↵</Kbd>
            <span className="truncate">{currentItem.secondary.label.toLowerCase()}</span>
          </span>
        ) : null}
        <span className="flex-1" />
        <span className="flex items-center gap-1.5">
          <Kbd>Esc</Kbd>
          {trimmed ? "to clear" : "to close"}
        </span>
      </div>
    </div>
  );
}

export function CommandPalette({ open, onOpenChange }: { open: boolean; onOpenChange: (open: boolean) => void }) {
  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
      title="Command palette"
      hideClose
      className={cn(
        // The title stays for assistive tech; the search field is the header.
        "w-[min(640px,calc(100%-32px))] [&>div:first-child]:sr-only",
        "sm:top-[min(14vh,120px)] sm:translate-y-0",
        // Phones: a card under the top edge instead of the kit's bottom
        // sheet, so the on-screen keyboard does not cover the results.
        "max-sm:bottom-auto max-sm:left-2 max-sm:top-[calc(env(safe-area-inset-top)+8px)] max-sm:w-[calc(100%-16px)]",
        "max-sm:rounded-[16px] max-sm:border-x max-sm:border-b max-sm:pb-0",
      )}
      bodyClassName="p-0 overflow-hidden"
    >
      {open ? <PaletteBody close={() => onOpenChange(false)} /> : null}
    </Dialog>
  );
}
