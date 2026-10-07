"use client";

/**
 * Connections: which wallet signs for this dashboard, the networks it shared
 * (and the ones it did not, with the wallet's reason), the phone session when
 * there is one, and how to end it.
 *
 * Zunia Mobile is one of the wallets, not a separate pairing feature
 * (product decision, 2026-10-07): it is offered here as a way to connect,
 * through the same connect modal as the extensions, opened straight on its
 * QR view (`useConnectModal().open("mobile")`).
 *
 * The dashboard prepares transactions; the wallet shows each one and signs
 * it. Keys never reach this page, so disconnecting forgets the session here
 * and nothing else.
 */

import { Avatar } from "@zunialab/ui";
import { useConnectModal } from "@/components/connect/ConnectModal";
import { Icon } from "@/components/icons";
import { AddressText, Badge, Button, ChainLogo, Disclosure, StatusBadge, useNow } from "@/components/ui";
import { findChain } from "@/lib/chains";
import { formatDuration } from "@/lib/format";
import { accountLabel, useWallet, walletKindLabel } from "@/providers/WalletProvider";
import { SettingRow, SettingsSection } from "./SettingsBlocks";

export function ConnectionsSection() {
  const { account, walletKind, keys, skippedChains, primaryChainId, mobile, disconnect, restoring } = useWallet();
  const connect = useConnectModal();
  const now = useNow();
  const phone = walletKind === "zunia-mobile";
  const shared = Object.keys(keys).length;
  const chain = findChain(primaryChainId);

  return (
    <SettingsSection
      id="connections"
      title="Connections"
      subtitle="The wallet that signs for this dashboard"
      icon="wallet"
      actions={account && walletKind ? <StatusBadge tone="success">{walletKindLabel(walletKind)}</StatusBadge> : null}
    >
      {!account ? (
        <SettingRow
          title={restoring ? "Restoring your wallet…" : "No wallet connected"}
          description="Connect the Zunia extension or Keplr in this browser, or Zunia Mobile on your phone. The dashboard prepares transactions; your wallet shows each one and signs it. It never asks for a recovery phrase."
          control={
            <>
              <Button size="sm" variant="primary" iconLeft="wallet" onClick={() => connect.open()} disabled={restoring}>
                Connect wallet
              </Button>
              <Button size="sm" variant="secondary" iconLeft="mobile" onClick={() => connect.open("mobile")} disabled={restoring}>
                Connect Zunia Mobile
              </Button>
            </>
          }
        />
      ) : (
        <>
          <div className="flex flex-col gap-3 pb-3.5 pt-1 sm:flex-row sm:items-center">
            <div className="flex min-w-0 flex-1 items-center gap-3">
              <Avatar seed={account.address} fallback={accountLabel(account)} size={40} />
              <div className="min-w-0">
                <p className="truncate text-[15px] font-semibold tracking-[-0.015em] text-fg">{accountLabel(account)}</p>
                <div className="mt-0.5 flex min-w-0 items-center gap-1.5 text-[12.5px] text-fg-dim">
                  <ChainLogo chainId={primaryChainId} size={14} />
                  <AddressText address={account.address} head={14} tail={6} />
                </div>
              </div>
            </div>
            <div className="flex shrink-0 flex-wrap items-center gap-1.5 text-[12.5px] text-fg-dim sm:justify-end">
              <Badge tone="neutral" size="md" icon="networks">
                {shared} {shared === 1 ? "network" : "networks"} shared
              </Badge>
              {chain ? <span>Home: {chain.chainName}</span> : null}
            </div>
          </div>

          {skippedChains.length > 0 ? (
            <SettingRow
              title={`${skippedChains.length} ${skippedChains.length === 1 ? "network was" : "networks were"} not shared`}
              description="Your wallet left these out when it connected, so the dashboard reads nothing there. Add them in the wallet, then connect again."
            >
              <Disclosure summary="Which, and why" variant="inset">
                <ul className="flex flex-col gap-2">
                  {skippedChains.map((skipped) => (
                    <li key={skipped.chainId} className="flex items-start gap-2.5">
                      <ChainLogo chainId={skipped.chainId} size={18} />
                      <span className="min-w-0">
                        <span className="block text-[13px] font-medium text-fg">{findChain(skipped.chainId)?.chainName ?? skipped.chainId}</span>
                        <span className="block text-[12.5px] text-fg-dim">{skipped.reason}</span>
                      </span>
                    </li>
                  ))}
                </ul>
              </Disclosure>
            </SettingRow>
          ) : null}

          {phone ? (
            <SettingRow
              title={
                <span className="inline-flex items-center gap-2">
                  {mobile.peerName ?? "Zunia Mobile"}
                  <StatusBadge tone={mobile.status === "connected" ? "success" : "warning"} pulse={mobile.status === "connected"}>
                    {mobile.status === "connected" ? "Connected" : mobile.status === "reconnecting" ? "Reconnecting" : "Not connected"}
                  </StatusBadge>
                </span>
              }
              description={
                <>
                  Signs on your phone · {mobile.chains.length} {mobile.chains.length === 1 ? "network" : "networks"} approved
                  {mobile.expiresAt && now !== null && mobile.expiresAt > now
                    ? ` · session ends in ${formatDuration((mobile.expiresAt - now) / 1000)}`
                    : ""}
                  . A session lasts 24 hours; connect again after that. Disconnecting also turns push alerts for this browser off.
                </>
              }
              control={
                <Button size="sm" variant="danger" iconLeft="disconnect" onClick={() => void disconnect()}>
                  Disconnect phone
                </Button>
              }
            />
          ) : (
            <SettingRow
              title={
                <span className="inline-flex items-center gap-2">
                  Zunia Mobile
                  {/* Amber, as everywhere Zunia Mobile is offered: Beta is a caution, not the brand. */}
                  <Badge tone="warning">Beta</Badge>
                </span>
              }
              description={
                <>
                  Sign on your phone instead: scan a QR code with the Zunia app, then approve each transaction there. Connecting it replaces{" "}
                  {walletKind ? walletKindLabel(walletKind) : "this wallet"} on this dashboard. The app is in review on the App Store and Google
                  Play.
                </>
              }
              control={
                <Button size="sm" variant="secondary" iconLeft="mobile" onClick={() => connect.open("mobile")}>
                  Use Zunia Mobile instead
                </Button>
              }
            />
          )}

          {!phone ? (
            <SettingRow
              title="Disconnect"
              // Said because it is what Disconnect does (`WalletProvider`):
              // leaving is meant for a shared computer too, where the next
              // person must not get this wallet's alerts on the lock screen.
              description="Forgets this session on this browser. Push alerts for this browser are turned off. Your wallet, its keys and your followed networks stay as they are."
              control={
                <Button size="sm" variant="danger" iconLeft="disconnect" onClick={() => void disconnect()}>
                  Disconnect
                </Button>
              }
            />
          ) : null}

          <p className="flex items-start gap-2 border-t border-[var(--d-hairline)] pb-1 pt-3.5 text-[12.5px] leading-snug text-fg-dim">
            <Icon name="lock" size={14} className="mt-px shrink-0" />
            The dashboard prepares transactions; your wallet shows each one and signs it. Keys never reach this page, and it never asks for a
            recovery phrase.
          </p>
        </>
      )}
    </SettingsSection>
  );
}
