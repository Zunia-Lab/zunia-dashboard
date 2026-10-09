/**
 * Every place the dashboard can take you, in the order the sidebar shows it.
 *
 * One list feeds the sidebar, the phone navigation sheet, the bottom tab bar,
 * the command palette and the fallback page title, so a route added here is
 * reachable everywhere at once and none of those surfaces can drift.
 *
 * `access: "public"` routes render without a wallet (markets, chains,
 * governance…): they are useful before connecting and they are what search
 * engines can index. `"wallet"` routes show a connect panel in place of the
 * page until a wallet is linked.
 *
 * Zunia Mobile has no entry: it is a way to connect a wallet, reached from the
 * connect modal (`useConnectModal().open("mobile")`), not a page.
 */

export type NavIcon =
  | "overview"
  | "assets"
  | "activity"
  | "swap"
  | "bridge"
  | "send"
  | "receive"
  | "staking"
  | "validators"
  | "governance"
  | "insights"
  | "compare"
  | "markets"
  | "chains"
  | "nfts"
  | "missions"
  | "apps"
  | "notifications"
  | "settings"
  | "networks";

export interface NavItem {
  href: string;
  label: string;
  icon: NavIcon;
  access: "public" | "wallet";
  /** Short line for the command palette and the page subtitle fallback. */
  description: string;
  badge?: "soon" | "new";
  /** Extra words the command palette matches on. */
  keywords?: string[];
  /**
   * Analysis pages the Lite view leaves out of the menus. They stay reachable
   * by address, from search (⌘K) and from links on other pages.
   */
  pro?: true;
}

export interface NavGroup {
  id: string;
  /** Null for the unlabelled first group. */
  label: string | null;
  items: NavItem[];
}

export const NAV_GROUPS: NavGroup[] = [
  {
    id: "home",
    label: null,
    items: [
      {
        href: "/overview",
        label: "Overview",
        icon: "overview",
        access: "wallet",
        description: "Net worth, allocation and what needs your attention",
        keywords: ["portfolio", "home", "dashboard", "net worth"],
      },
      {
        href: "/assets",
        label: "Assets",
        icon: "assets",
        access: "wallet",
        description: "Every token you hold, on every chain",
        keywords: ["tokens", "balances", "holdings"],
      },
      {
        href: "/activity",
        label: "Activity",
        icon: "activity",
        access: "wallet",
        description: "History, flows and fees",
        keywords: ["history", "transactions", "txs"],
      },
    ],
  },
  {
    id: "trade",
    label: "Trade",
    items: [
      {
        href: "/swap",
        label: "Swap",
        icon: "swap",
        access: "wallet",
        description: "Swap any pair Osmosis trades",
        keywords: ["exchange", "trade", "osmosis"],
      },
      {
        href: "/bridge",
        label: "Bridge",
        icon: "bridge",
        access: "wallet",
        description: "Move assets between chains over IBC",
        keywords: ["ibc", "transfer", "cross-chain"],
      },
      {
        href: "/send",
        label: "Send",
        icon: "send",
        access: "wallet",
        description: "Send tokens to any address",
        keywords: ["pay", "transfer"],
      },
      {
        href: "/receive",
        label: "Receive",
        icon: "receive",
        access: "wallet",
        description: "Your addresses and QR codes",
        keywords: ["address", "deposit", "qr"],
      },
    ],
  },
  {
    id: "earn",
    label: "Earn",
    items: [
      {
        href: "/staking",
        label: "Staking",
        icon: "staking",
        access: "wallet",
        description: "Positions, rewards and unbonding",
        keywords: ["stake", "delegate", "rewards", "apr"],
      },
      {
        href: "/validators",
        pro: true,
        label: "Validators",
        icon: "validators",
        access: "public",
        description: "Compare validators: commission, power, uptime",
        keywords: ["validator", "commission", "uptime", "nakamoto"],
      },
      {
        href: "/governance",
        label: "Governance",
        icon: "governance",
        access: "public",
        description: "Proposals across your chains",
        keywords: ["vote", "proposal", "dao"],
      },
    ],
  },
  {
    id: "analyze",
    label: "Analyze",
    items: [
      {
        href: "/insights",
        label: "Insights",
        icon: "insights",
        access: "wallet",
        description: "Opportunities, risks and things to do",
        keywords: ["advice", "risk", "opportunities", "alerts"],
      },
      {
        href: "/compare",
        pro: true,
        label: "Compare",
        icon: "compare",
        access: "public",
        description: "Chains and assets side by side",
        keywords: ["versus", "vs", "performance"],
      },
      {
        href: "/markets",
        label: "Markets",
        icon: "markets",
        access: "public",
        description: "Cosmos prices, volumes and movers",
        keywords: ["prices", "market cap", "gainers", "losers"],
      },
      {
        href: "/chains",
        pro: true,
        label: "Chains",
        icon: "chains",
        access: "public",
        description: "Staking economics and validator sets by chain",
        keywords: ["networks", "apr", "inflation"],
      },
    ],
  },
  {
    id: "more",
    label: "More",
    items: [
      {
        href: "/nfts",
        label: "NFTs",
        icon: "nfts",
        access: "wallet",
        description: "Collections you hold",
        keywords: ["collectibles", "cw721", "ics721"],
      },
      {
        href: "/missions",
        label: "Missions",
        icon: "missions",
        access: "public",
        description: "Quests across the interchain",
        badge: "soon",
        keywords: ["quests", "xp", "rewards"],
      },
      {
        href: "/apps",
        label: "Apps",
        icon: "apps",
        access: "public",
        description: "Cosmos apps that open with Zunia",
        badge: "soon",
        keywords: ["dapps", "directory"],
      },
    ],
  },
];

/** Routes reachable but not listed in the sidebar body. */
export const SECONDARY_NAV: NavItem[] = [
  {
    href: "/notifications",
    label: "Notifications",
    icon: "notifications",
    access: "wallet",
    description: "Alerts and notification settings",
    keywords: ["alerts", "push"],
  },
  {
    href: "/settings",
    label: "Settings",
    icon: "settings",
    access: "public",
    description: "Currency, theme, networks and connections",
    keywords: ["preferences", "theme", "currency"],
  },
  {
    href: "/networks",
    label: "Manage networks",
    icon: "networks",
    access: "public",
    description: "Choose which chains the dashboard follows",
    keywords: ["follow", "chains", "add network"],
  },
];

/** Bottom tab bar on phones. "More" opens the full navigation sheet. */
export const MOBILE_TABS: Array<Pick<NavItem, "href" | "label" | "icon">> = [
  { href: "/overview", label: "Overview", icon: "overview" },
  { href: "/assets", label: "Assets", icon: "assets" },
  { href: "/swap", label: "Swap", icon: "swap" },
  { href: "/activity", label: "Activity", icon: "activity" },
];

export const ALL_NAV_ITEMS: NavItem[] = [
  ...NAV_GROUPS.flatMap((group) => group.items),
  ...SECONDARY_NAV,
];

export function isNavActive(pathname: string, href: string): boolean {
  if (href === "/") return pathname === "/";
  return pathname === href || pathname.startsWith(`${href}/`);
}

/** The nav entry a pathname belongs to (longest matching prefix). */
export function navItemFor(pathname: string): NavItem | undefined {
  let best: NavItem | undefined;
  for (const item of ALL_NAV_ITEMS) {
    if (isNavActive(pathname, item.href) && (!best || item.href.length > best.href.length)) {
      best = item;
    }
  }
  return best;
}
