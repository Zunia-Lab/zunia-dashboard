"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import {
  AppShell,
  Avatar,
  Button,
  Drawer,
  IconButton,
  Mark,
  SectionLabel,
  Segmented,
  TokenLogo,
  truncateAddress,
  useTheme,
  interactiveMotion,
  interactiveSurface,
} from "@zunialab/ui";
import { ConnectWallet } from "@/components/ConnectWallet";
import { LiveRail } from "@/components/LiveRail";
import { NotificationsDrawer } from "@/components/NotificationsDrawer";
import { usePrefs } from "@/providers/PrefsProvider";
import { useWallet } from "@/providers/WalletProvider";
import { cn } from "@/lib/cn";
import { findChain } from "@/lib/chains";
import { useChainScope } from "@/lib/useChainScope";
import { useNotifications } from "@/lib/useNotifications";

const PRIMARY_NAV = [
  { href: "/portfolio", label: "Portfolio", icon: PortfolioGlyph },
  { href: "/staking", label: "Staking", icon: StakeGlyph },
  { href: "/swap", label: "Swap", icon: SwapGlyph },
  { href: "/bridge", label: "Bridge", icon: BridgeGlyph },
  { href: "/governance", label: "Governance", icon: GovGlyph },
  { href: "/activity", label: "Activity", icon: ActivityGlyph },
  { href: "/networks", label: "Networks", icon: NetworksGlyph },
] as const;

const ECOSYSTEM_NAV = [
  { href: "/missions", label: "Missions" },
  { href: "/dapps", label: "dApps" },
] as const;

function isActive(pathname: string, href: string) {
  if (href === "/") return pathname === "/";
  return pathname === href || pathname.startsWith(`${href}/`);
}

export function DashboardShell({
  title,
  description,
  actions,
  live,
  children,
}: {
  title: string;
  description?: string;
  actions?: React.ReactNode;
  live?: React.ReactNode;
  children: React.ReactNode;
}) {
  const pathname = usePathname();
  const { account, disconnect } = useWallet();
  const { resolved, setTheme } = useTheme();
  const { hideAmounts, toggleHideAmounts } = usePrefs();
  const { unreadCount } = useNotifications();
  const [notificationsOpen, setNotificationsOpen] = useState(false);
  const [navOpen, setNavOpen] = useState(false);
  const [liveOpen, setLiveOpen] = useState(false);
  /** Docked Live rail only on large screens; smaller viewports open it on demand. */
  const [liveDocked, setLiveDocked] = useState(false);
  const [copied, setCopied] = useState(false);
  const {
    network,
    setNetwork,
    selectedChainId,
    selectedChain,
    setSelectedChainId,
    followedOnNetwork,
  } = useChainScope();

  useEffect(() => {
    const match = pathname.match(/^\/chains\/([^/]+)/);
    if (!match) return;
    setSelectedChainId(decodeURIComponent(match[1]));
  }, [pathname, setSelectedChainId]);

  useEffect(() => {
    // Dock Live only on wide desktops. Tablets / small laptops use the header button.
    const mq = window.matchMedia("(min-width: 1440px)");
    const sync = () => {
      const docked = mq.matches;
      setLiveDocked(docked);
      if (docked) setLiveOpen(false);
    };
    sync();
    mq.addEventListener("change", sync);
    return () => mq.removeEventListener("change", sync);
  }, []);

  async function copyAddress() {
    if (!account) return;
    try {
      await navigator.clipboard.writeText(account.address);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1400);
    } catch {
      /* ignore */
    }
  }

  const rail = followedOnNetwork
    .map((chainId) => findChain(chainId))
    .filter((chain): chain is NonNullable<typeof chain> => Boolean(chain))
    .slice(0, 8);

  const allNetworks = !selectedChainId;
  const scopedDescription = selectedChain
    ? `${selectedChain.chainName} · ${selectedChain.chainId}`
    : description;

  const liveColumn = live ?? <LiveRail />;
  const walletName = account
    ? account.mode === "extension"
      ? account.name
      : account.peerName
    : null;
  const avatarSeed = account?.address ?? walletName ?? "zunia";

  const chainRail = (
    <>
      <Link
        href="/portfolio"
        title="All followed networks"
        onClick={() => setSelectedChainId(null)}
        className={cn(
          "flex size-11 items-center justify-center rounded-[13px] bg-accent text-[var(--z-accent-fg)]",
          allNetworks && "shadow-[0_0_0_2px_color-mix(in_srgb,var(--z-accent)_55%,transparent)]",
        )}
      >
        <Mark size={22} />
      </Link>
      {rail.map((chain) => {
        const active = selectedChainId === chain.chainId;
        const href = pathname.startsWith("/chains/")
          ? `/chains/${chain.chainId}`
          : pathname;
        return (
          <Link
            key={chain.chainId}
            href={href}
            title={`${chain.chainName} · ${chain.chainId}`}
            onClick={() => setSelectedChainId(chain.chainId)}
            className={cn(
              "flex size-11 items-center justify-center overflow-hidden rounded-full",
              active
                ? "shadow-[0_0_0_2px_color-mix(in_srgb,var(--z-accent)_70%,transparent)]"
                : "hover:bg-[var(--z-state-hover)]",
            )}
          >
            <TokenLogo
              src={chain.iconUrl}
              symbol={chain.coinDenom}
              size={40}
            />
          </Link>
        );
      })}
      <Link
        href="/networks"
        title="Add a network"
        className={cn(
          "mt-auto flex size-11 items-center justify-center rounded-[13px] bg-[var(--z-glass)] text-[20px] text-fg-dim hover:text-fg",
          interactiveSurface,
        )}
      >
        +
      </Link>
    </>
  );

  const navColumn = (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="mb-5 flex items-center gap-2.5 px-1">
        <span className="flex size-9 shrink-0 items-center justify-center rounded-[12px] bg-accent text-[var(--z-accent-fg)]">
          <Mark size={20} />
        </span>
        <span className="min-w-0">
          <span className="block truncate text-[16px] font-medium tracking-tight text-fg">
            Zunia
          </span>
          <span className="mt-0.5 block truncate font-mono text-[11.5px] text-fg-dim">
            {account
              ? truncateAddress(account.address, 6, 4)
              : "Watch-only desk"}
          </span>
        </span>
      </div>

      <nav className="flex min-h-0 flex-1 flex-col gap-0.5 overflow-y-auto pr-0.5">
        {PRIMARY_NAV.map((item) => {
          const active = isActive(pathname, item.href);
          const Icon = item.icon;
          return (
            <Link
              key={item.href}
              href={item.href}
              onClick={() => setNavOpen(false)}
              className={cn(
                "group relative flex items-center gap-3 rounded-[12px] px-3 py-2.5 text-[14.5px] tracking-tight",
                interactiveMotion,
                active
                  ? "bg-[var(--z-state-selected)] font-medium text-fg"
                  : "text-fg-muted hover:bg-[var(--z-state-hover)] hover:text-fg active:bg-[var(--z-state-press)]",
              )}
            >
              {active ? (
                <span
                  aria-hidden
                  className="absolute left-0 top-1/2 h-5 w-[3px] -translate-y-1/2 rounded-full bg-accent"
                />
              ) : null}
              <span
                className={cn(
                  "flex size-5 shrink-0 items-center justify-center",
                  active ? "text-accent" : "text-fg-dim group-hover:text-fg",
                )}
              >
                <Icon />
              </span>
              {item.label}
            </Link>
          );
        })}

        <div className="my-3 h-px bg-[var(--z-line)]" />

        <SectionLabel className="px-3 pb-2">Ecosystem</SectionLabel>
        {ECOSYSTEM_NAV.map((item) => (
          <Link
            key={item.href}
            href={item.href}
            onClick={() => setNavOpen(false)}
            className={cn(
              "rounded-[12px] px-3 py-2 text-[13.5px] tracking-tight",
              interactiveMotion,
              isActive(pathname, item.href)
                ? "bg-[var(--z-state-selected)] font-medium text-fg"
                : "text-fg-muted hover:bg-[var(--z-state-hover)] hover:text-fg active:bg-[var(--z-state-press)]",
            )}
          >
            {item.label}
          </Link>
        ))}
      </nav>

      <div className="mt-4 space-y-3 border-t border-[var(--z-line)] pt-4">
        <div>
          <SectionLabel className="mb-2 px-1">Network</SectionLabel>
          <Segmented<"mainnet" | "testnet">
            value={network}
            onChange={setNetwork}
            size="sm"
            className="w-full"
            options={[
              { value: "mainnet", label: "Main" },
              { value: "testnet", label: "Test" },
            ]}
          />
        </div>

        <div className="rounded-[14px] bg-[var(--z-glass)] px-3 py-2.5">
          <div className="flex items-center gap-2.5">
            <Avatar
              seed={avatarSeed}
              fallback={walletName ?? "Zunia"}
              size={32}
            />
            <span className="min-w-0 flex-1">
              <span className="block truncate text-[13.5px] font-medium text-fg">
                {walletName ?? "Guest"}
              </span>
              <span className="block truncate font-mono text-[11.5px] text-fg-dim">
                {account ? "Connected" : "Not connected"}
              </span>
            </span>
          </div>
        </div>

        <Link
          href="/settings"
          onClick={() => setNavOpen(false)}
          className={cn(
            "flex items-center gap-2.5 rounded-[12px] px-3 py-2.5 text-[13.5px]",
            interactiveMotion,
            isActive(pathname, "/settings")
              ? "bg-[var(--z-state-selected)] font-medium text-fg"
              : "text-fg-muted hover:bg-[var(--z-state-hover)] hover:text-fg active:bg-[var(--z-state-press)]",
          )}
        >
          <GearGlyph />
          Settings
        </Link>
      </div>
    </div>
  );

  return (
    <div className="zunia-root flex h-dvh min-h-0 flex-col overflow-hidden bg-bg text-fg">
      <AppShell
        className="min-h-0 flex-1"
        chainRail={chainRail}
        nav={navColumn}
        topBar={
          <>
            <IconButton
              label="Open navigation"
              title="Menu"
              variant="ghost"
              className="md:hidden"
              onClick={() => setNavOpen(true)}
            >
              <MenuGlyph />
            </IconButton>

            <div className="min-w-0 flex-1">
              <h1 className="truncate text-[18px] font-medium tracking-[-0.03em] text-fg md:text-[20px]">
                {title}
              </h1>
              {scopedDescription ? (
                <p
                  className="mt-0.5 hidden max-w-[42ch] truncate text-[12.5px] text-fg-dim xl:block"
                  title={scopedDescription}
                >
                  {scopedDescription}
                </p>
              ) : null}
            </div>

            {actions}

            {account ? (
              <div className="hidden items-center rounded-[12px] bg-[var(--z-glass)] p-1 lg:flex">
                <Button asChild size="sm" className="h-8 rounded-[10px] px-3.5 text-[13px] shadow-none">
                  <Link href="/send">Send</Link>
                </Button>
                <Button
                  asChild
                  variant="ghost"
                  size="sm"
                  className="h-8 rounded-[10px] px-3 text-[13px]"
                >
                  <Link href="/portfolio">Receive</Link>
                </Button>
                <Button
                  asChild
                  variant="ghost"
                  size="sm"
                  className="h-8 rounded-[10px] px-3 text-[13px]"
                >
                  <Link href="/staking">Stake</Link>
                </Button>
              </div>
            ) : null}

            <div className="flex items-center gap-0.5 rounded-[12px] bg-[var(--z-glass)] p-0.5">
              <IconButton
                label={hideAmounts ? "Show amounts" : "Hide amounts"}
                title={hideAmounts ? "Show amounts" : "Hide amounts"}
                variant="ghost"
                onClick={toggleHideAmounts}
              >
                {hideAmounts ? <EyeOffGlyph /> : <EyeGlyph />}
              </IconButton>
              <IconButton
                label={
                  resolved === "dark" ? "Switch to light theme" : "Switch to dark theme"
                }
                title={resolved === "dark" ? "Light" : "Dark"}
                variant="ghost"
                onClick={() => setTheme(resolved === "dark" ? "light" : "dark")}
              >
                {resolved === "dark" ? <SunGlyph /> : <MoonGlyph />}
              </IconButton>
              <span className="relative">
                <IconButton
                  label={
                    unreadCount > 0
                      ? `Notifications, ${unreadCount} unread`
                      : "Notifications"
                  }
                  title="Notifications"
                  variant="ghost"
                  onClick={() => setNotificationsOpen(true)}
                >
                  <BellGlyph />
                </IconButton>
                {unreadCount > 0 ? (
                  <span
                    aria-hidden
                    className="pointer-events-none absolute right-1.5 top-1.5 size-1.5 rounded-full bg-[var(--z-info)]"
                  />
                ) : null}
              </span>
              {!liveDocked ? (
                <IconButton
                  label="Open live column"
                  title="Live"
                  variant="ghost"
                  onClick={() => setLiveOpen(true)}
                >
                  <LiveGlyph />
                </IconButton>
              ) : null}
            </div>

            {account ? (
              <div className="hidden items-center gap-1 sm:flex">
                <button
                  type="button"
                  onClick={() => void copyAddress()}
                  title={copied ? "Copied" : "Copy address"}
                  className={cn(
                    "flex max-w-[200px] items-center gap-2 rounded-[12px] bg-[var(--z-glass)] py-1 pl-1 pr-2.5 text-left",
                    interactiveSurface,
                  )}
                >
                  <Avatar
                    seed={account.address}
                    fallback={walletName ?? "Wallet"}
                    size={28}
                  />
                  <span className="min-w-0">
                    <span className="block truncate text-[12.5px] font-medium leading-tight text-fg">
                      {walletName ?? "Wallet"}
                    </span>
                    <span className="mt-0.5 block truncate font-mono text-[11px] leading-tight text-fg-dim">
                      {copied
                        ? "Copied"
                        : truncateAddress(account.address, 6, 4)}
                    </span>
                  </span>
                </button>
                <IconButton
                  label="Disconnect wallet"
                  title="Disconnect"
                  variant="ghost"
                  onClick={disconnect}
                >
                  <DisconnectGlyph />
                </IconButton>
              </div>
            ) : (
              <ConnectWallet size="sm" />
            )}
          </>
        }
        live={liveDocked ? liveColumn : undefined}
      >
        {children}
      </AppShell>

      <Drawer open={navOpen} onClose={() => setNavOpen(false)} side="left">
        <div className="mb-3 flex items-center justify-between gap-2">
          <span className="text-[20px] font-medium tracking-tight">Zunia</span>
          <IconButton
            label="Close navigation"
            variant="ghost"
            onClick={() => setNavOpen(false)}
          >
            ×
          </IconButton>
        </div>
        <div className="mb-3 flex flex-wrap gap-2">{chainRail}</div>
        {navColumn}
      </Drawer>

      <Drawer open={liveOpen} onClose={() => setLiveOpen(false)}>
        <div className="mb-3 flex items-center justify-between gap-2">
          <SectionLabel>Live</SectionLabel>
          <IconButton
            label="Close live column"
            variant="ghost"
            onClick={() => setLiveOpen(false)}
          >
            ×
          </IconButton>
        </div>
        {liveColumn}
      </Drawer>

      <NotificationsDrawer
        open={notificationsOpen}
        onClose={() => setNotificationsOpen(false)}
      />
    </div>
  );
}

function MenuGlyph() {
  return (
    <svg viewBox="0 0 24 24" width="18" height="18" fill="none" aria-hidden>
      <path
        d="M4 7h16M4 12h16M4 17h10"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
      />
    </svg>
  );
}

function GearGlyph() {
  return (
    <svg viewBox="0 0 24 24" width="18" height="18" fill="none" aria-hidden>
      <circle cx="12" cy="12" r="3" stroke="currentColor" strokeWidth="1.5" />
      <path
        d="M12 4.5v1.5M12 18v1.5M4.5 12H6M18 12h1.5M6.8 6.8l1.1 1.1M16.1 16.1l1.1 1.1M17.2 6.8l-1.1 1.1M7.9 16.1l-1.1 1.1"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
      />
    </svg>
  );
}

function LiveGlyph() {
  return (
    <svg viewBox="0 0 24 24" width="18" height="18" fill="none" aria-hidden>
      <path
        d="M4 14v4M9 10v8M14 6v12M19 12v6"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinecap="round"
      />
    </svg>
  );
}

function DisconnectGlyph() {
  return (
    <svg viewBox="0 0 24 24" width="18" height="18" fill="none" aria-hidden>
      <path
        d="M10 7V5.8A1.8 1.8 0 0 1 11.8 4h6.4A1.8 1.8 0 0 1 20 5.8v12.4a1.8 1.8 0 0 1-1.8 1.8h-6.4A1.8 1.8 0 0 1 10 18.2V17"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinecap="round"
      />
      <path
        d="M14 12H4m0 0 2.5-2.5M4 12l2.5 2.5"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function PortfolioGlyph() {
  return (
    <svg viewBox="0 0 24 24" width="18" height="18" fill="none" aria-hidden>
      <path
        d="M3 5h18v14H3zM3 10h18M9 10v9"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function StakeGlyph() {
  return (
    <svg viewBox="0 0 24 24" width="18" height="18" fill="none" aria-hidden>
      <path
        d="M12 3l8 9-8 9-8-9z"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function SwapGlyph() {
  return (
    <svg viewBox="0 0 24 24" width="18" height="18" fill="none" aria-hidden>
      <path
        d="M4 8h13l-3-3M20 16H7l3 3"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
      />
    </svg>
  );
}

function BridgeGlyph() {
  return (
    <svg viewBox="0 0 24 24" width="18" height="18" fill="none" aria-hidden>
      <circle cx="12" cy="12" r="8" stroke="currentColor" strokeWidth="1.5" />
      <path d="M4 12h16" stroke="currentColor" strokeWidth="1.5" />
    </svg>
  );
}

function GovGlyph() {
  return (
    <svg viewBox="0 0 24 24" width="18" height="18" fill="none" aria-hidden>
      <path
        d="M4 6h16M4 12h16M4 18h10"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
      />
    </svg>
  );
}

function ActivityGlyph() {
  return (
    <svg viewBox="0 0 24 24" width="18" height="18" fill="none" aria-hidden>
      <circle cx="12" cy="12" r="8" stroke="currentColor" strokeWidth="1.5" />
      <path
        d="M12 8v4l3 2"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
      />
    </svg>
  );
}

function NetworksGlyph() {
  return (
    <svg viewBox="0 0 24 24" width="18" height="18" fill="none" aria-hidden>
      <path
        d="M4 7h16v10H4zM9 7v10"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function BellGlyph() {
  return (
    <svg viewBox="0 0 24 24" width="18" height="18" fill="none" aria-hidden>
      <path
        d="M18 8.5a6 6 0 1 0-12 0c0 5-2 6.5-2 6.5h16s-2-1.5-2-6.5Z"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinejoin="round"
      />
      <path
        d="M13.7 18.5a2 2 0 0 1-3.4 0"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
      />
    </svg>
  );
}

function EyeGlyph() {
  return (
    <svg viewBox="0 0 24 24" width="18" height="18" fill="none" aria-hidden>
      <path
        d="M2.5 12S6 5.5 12 5.5 21.5 12 21.5 12 18 18.5 12 18.5 2.5 12 2.5 12Z"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinejoin="round"
      />
      <circle cx="12" cy="12" r="2.75" stroke="currentColor" strokeWidth="1.5" />
    </svg>
  );
}

function EyeOffGlyph() {
  return (
    <svg viewBox="0 0 24 24" width="18" height="18" fill="none" aria-hidden>
      <path
        d="M4 4.5 20 19.5M9.6 6.1A9.6 9.6 0 0 1 12 5.5c6 0 9.5 6.5 9.5 6.5a17 17 0 0 1-3.2 3.9M6.3 8.2A17.5 17.5 0 0 0 2.5 12S6 18.5 12 18.5c1 0 1.9-.2 2.7-.5"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function SunGlyph() {
  return (
    <svg viewBox="0 0 24 24" width="18" height="18" fill="none" aria-hidden>
      <circle cx="12" cy="12" r="4" stroke="currentColor" strokeWidth="1.5" />
      <path
        d="M12 3v2.2M12 18.8V21M4.9 4.9l1.6 1.6M17.5 17.5l1.6 1.6M3 12h2.2M18.8 12H21M4.9 19.1l1.6-1.6M17.5 6.5l1.6-1.6"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
      />
    </svg>
  );
}

function MoonGlyph() {
  return (
    <svg viewBox="0 0 24 24" width="18" height="18" fill="none" aria-hidden>
      <path
        d="M19.5 14.2A7.5 7.5 0 1 1 9.8 4.5 6.2 6.2 0 0 0 19.5 14.2Z"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinejoin="round"
      />
    </svg>
  );
}
