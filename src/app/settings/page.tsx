"use client";

import Link from "next/link";
import {
  Button,
  Card,
  Callout,
  SectionLabel,
  Segmented,
  Switch,
  truncateAddress,
  useTheme,
} from "@zunialab/ui";
import { ConnectWallet } from "@/components/ConnectWallet";
import { DashboardShell } from "@/components/DashboardShell";
import { DeviceBinding } from "@/components/DeviceBinding";
import { IosInstallPrompt } from "@/components/IosInstallPrompt";
import { PushSubscribe } from "@/components/PushSubscribe";
import {
  usePrefs,
  type FiatCurrency,
} from "@/providers/PrefsProvider";
import { useWallet } from "@/providers/WalletProvider";
import { useChainScope } from "@/lib/useChainScope";
import { useFollowedChains } from "@/lib/useFollowedChains";

function SettingsRow({
  title,
  description,
  control,
}: {
  title: string;
  description?: string;
  control: React.ReactNode;
}) {
  return (
    <div className="flex items-center justify-between gap-4 border-b border-[var(--z-line)] py-3.5 last:border-b-0">
      <div className="min-w-0 flex-1">
        <div className="text-[15px] font-medium text-fg">{title}</div>
        {description ? (
          <p className="mt-1 text-[13.5px] leading-relaxed text-fg-muted">
            {description}
          </p>
        ) : null}
      </div>
      <div className="shrink-0">{control}</div>
    </div>
  );
}

function SettingsSection({
  title,
  description,
  children,
}: {
  title: string;
  description?: string;
  children: React.ReactNode;
}) {
  return (
    <Card className="flex flex-col gap-1 overflow-hidden p-0">
      <div className="border-b border-[var(--z-line)] px-4 py-3.5">
        <SectionLabel className="px-0">{title}</SectionLabel>
        {description ? (
          <p className="mt-1.5 text-[14px] leading-relaxed text-fg-muted">
            {description}
          </p>
        ) : null}
      </div>
      <div className="px-4">{children}</div>
    </Card>
  );
}

export default function SettingsPage() {
  const { account, disconnect } = useWallet();
  const { resolved, setTheme } = useTheme();
  const { hideAmounts, toggleHideAmounts, currency, setCurrency } = usePrefs();
  const { network, setNetwork } = useChainScope();
  const [followed] = useFollowedChains();

  const walletName = account
    ? account.mode === "extension"
      ? `${account.name}${account.wallet === "keplr" ? " · Keplr" : ""}`
      : account.peerName
    : null;

  return (
    <DashboardShell
      title="Settings"
      description="Display, privacy, notifications and connection. Keys never live here."
    >
      <IosInstallPrompt />

      <div className="flex flex-col gap-4 lg:grid lg:grid-cols-[minmax(0,1.15fr)_minmax(0,0.85fr)] lg:items-start">
        <div className="flex flex-col gap-4">
          <SettingsSection
            title="Wallet"
            description="This dashboard is watch-only. Signing stays in the extension or mobile app."
          >
            {account ? (
              <div className="flex flex-col gap-3 py-3.5">
                <div className="flex items-center gap-3 rounded-[14px] bg-[image:var(--z-surface-raised-gradient)] px-3.5 py-3">
                  <span className="flex size-10 shrink-0 items-center justify-center rounded-full bg-[image:var(--z-accent-gradient)] font-mono text-[14px] text-[var(--z-accent-fg)]">
                    {(walletName ?? "?").slice(0, 1).toUpperCase()}
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-[15px] font-medium text-fg">
                      {walletName}
                    </span>
                    <span className="mt-0.5 block truncate font-mono text-[12.5px] text-fg-dim">
                      {truncateAddress(account.address, 10, 6)}
                    </span>
                  </span>
                  <span className="shrink-0 rounded-full bg-[var(--z-success-fill)] px-2 py-1 font-mono text-[12px] uppercase tracking-[0.1em] text-[var(--z-success)]">
                    Active
                  </span>
                </div>
                <div className="grid grid-cols-2 gap-2">
                  <div className="rounded-[12px] bg-[var(--z-glass)] px-3 py-2.5">
                    <div className="font-mono text-[12px] uppercase tracking-[0.12em] text-fg-dim">
                      Mode
                    </div>
                    <div className="mt-1 truncate text-[13px] text-fg">
                      {account.mode}
                      {account.mode === "extension" && account.wallet
                        ? ` · ${account.wallet}`
                        : ""}
                    </div>
                  </div>
                  <div className="rounded-[12px] bg-[var(--z-glass)] px-3 py-2.5">
                    <div className="font-mono text-[12px] uppercase tracking-[0.12em] text-fg-dim">
                      Chain
                    </div>
                    <div className="mt-1 truncate font-mono text-[13px] text-fg">
                      {account.chainId}
                    </div>
                  </div>
                </div>
                <div className="flex flex-wrap gap-2">
                  <Button asChild variant="secondary" size="sm">
                    <Link href="/networks">Manage networks</Link>
                  </Button>
                  <Button asChild variant="secondary" size="sm">
                    <Link href="/portfolio">Open portfolio</Link>
                  </Button>
                </div>
              </div>
            ) : (
              <div className="flex flex-col gap-3 py-3.5">
                <p className="text-[14px] leading-relaxed text-fg-muted">
                  Connect Zunia, Keplr, or pair your phone to load portfolio,
                  activity and staking.
                </p>
                <ConnectWallet />
              </div>
            )}
          </SettingsSection>

          <SettingsSection
            title="Appearance"
            description="Theme and privacy for amounts shown across the dashboard."
          >
            <SettingsRow
              title="Theme"
              description="Applies to this browser profile."
              control={
                <Segmented<"light" | "dark">
                  size="sm"
                  value={resolved}
                  onChange={setTheme}
                  options={[
                    { value: "dark", label: "Dark" },
                    { value: "light", label: "Light" },
                  ]}
                />
              }
            />
            <SettingsRow
              title="Hide amounts"
              description="Mask balances and fiat totals until you reveal them."
              control={
                <Switch
                  checked={hideAmounts}
                  onCheckedChange={() => toggleHideAmounts()}
                />
              }
            />
            <SettingsRow
              title="Currency"
              description="Fiat display for portfolio and staking."
              control={
                <Segmented<FiatCurrency>
                  size="sm"
                  value={currency}
                  onChange={setCurrency}
                  options={[
                    { value: "usd", label: "USD" },
                    { value: "eur", label: "EUR" },
                    { value: "gbp", label: "GBP" },
                  ]}
                />
              }
            />
          </SettingsSection>

          <SettingsSection
            title="Networks"
            description="Main/test rail and which chains this dashboard follows."
          >
            <SettingsRow
              title="Network rail"
              description="Filters the left rail and portfolio scope."
              control={
                <Segmented<"mainnet" | "testnet">
                  size="sm"
                  value={network}
                  onChange={setNetwork}
                  options={[
                    { value: "mainnet", label: "Main" },
                    { value: "testnet", label: "Test" },
                  ]}
                />
              }
            />
            <SettingsRow
              title="Followed chains"
              description={`${(followed ?? []).length} chain${(followed ?? []).length === 1 ? "" : "s"} in your watch list.`}
              control={
                <Button asChild variant="secondary" size="sm">
                  <Link href="/networks">Edit</Link>
                </Button>
              }
            />
          </SettingsSection>
        </div>

        <div className="flex flex-col gap-4">
          <SettingsSection
            title="Notifications"
            description="Browser push for rewards and session alerts. Optional."
          >
            <div className="py-3.5">
              <PushSubscribe />
            </div>
          </SettingsSection>

          <SettingsSection
            title="Device & security"
            description="Dashboard sessions are read-only. Bind a device to prove ownership without exposing keys."
          >
            <div className="flex flex-col gap-3 py-3.5">
              <Callout tone="neutral" title="Keys stay in the wallet">
                Auto-lock, recovery phrase and per-signature password live in
                the extension or mobile app only.
              </Callout>
              <DeviceBinding />
            </div>
          </SettingsSection>

          <SettingsSection title="About">
            <SettingsRow
              title="Version"
              description="Dashboard package for this deploy."
              control={
                <span className="font-mono text-[13px] text-fg-muted">
                  0.1.0
                </span>
              }
            />
            <SettingsRow
              title="License"
              control={
                <span className="font-mono text-[13px] text-fg-muted">
                  Apache 2.0
                </span>
              }
            />
            <SettingsRow
              title="Docs & status"
              description="Product surface is watch-only by design."
              control={
                <Button asChild variant="ghost" size="sm">
                  <Link href="/activity">Activity</Link>
                </Button>
              }
            />
          </SettingsSection>

          {account ? (
            <Card className="flex flex-col gap-3 p-4">
              <SectionLabel>Session</SectionLabel>
              <p className="text-[14px] leading-relaxed text-fg-muted">
                Disconnect clears this browser session. Your wallet and
                followed networks stay intact.
              </p>
              <Button variant="danger" onClick={disconnect}>
                Disconnect this session
              </Button>
            </Card>
          ) : null}
        </div>
      </div>
    </DashboardShell>
  );
}
