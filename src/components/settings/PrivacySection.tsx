"use client";

/**
 * Data & privacy: where the dashboard's data lives, the one switch that sends
 * a request from this device to a third party (NFT artwork), and a clean
 * slate for this browser.
 *
 * The statements here are about how the dashboard is built and are kept
 * true by it: the browser talks only to this site's own /api (plus the
 * wallet and the Zunia Connect relay), push is opt-in, and no analytics
 * script is loaded.
 */

import { useState, useSyncExternalStore, type ReactNode } from "react";
import { NFT_MEDIA_PRIVACY_NOTE } from "@zunialab/ui";
import { Icon, type IconName } from "@/components/icons";
import { Button, Dialog, Switch } from "@/components/ui";
import { clearApiCache } from "@/lib/useApi";
import { usePrefs } from "@/providers/PrefsProvider";
import { useWallet } from "@/providers/WalletProvider";
import { SettingRow, SettingsSection } from "./SettingsBlocks";
import { bytesText, clearDashboardData, footprint } from "./storage";

const noopSubscribe = () => () => {};

/** "count|bytes", a primitive so the snapshot is stable between renders. */
function readFootprint(): string {
  try {
    const { count, bytes } = footprint(window.localStorage);
    return `${count}|${bytes}`;
  } catch {
    return "0|0";
  }
}

const WHERE: ReadonlyArray<{ icon: IconName; title: string; body: string }> = [
  {
    icon: "lock",
    title: "On this browser",
    body: "Followed networks, preferences, notification history, address book, watchlist, and copies of recent reads so pages open at once (ignored after 10 minutes).",
  },
  {
    icon: "shield",
    title: "Through Zunia's server",
    body: "Balances, prices and chain data. Nodes and price sources see the server, not your device.",
  },
  {
    icon: "notifications",
    title: "On Zunia's server",
    body: "Nothing, unless you turn on push: then this browser's push address and the addresses it watches.",
  },
];

export function PrivacySection() {
  const { nftMedia, setNftMedia, nftMediaBlockedReason } = usePrefs();
  const { account, disconnect } = useWallet();
  const [confirming, setConfirming] = useState(false);
  const [clearing, setClearing] = useState(false);
  const raw = useSyncExternalStore(noopSubscribe, readFootprint, () => null);
  const [count, bytes] = raw ? raw.split("|").map(Number) : [null, null];

  const clear = async () => {
    setClearing(true);
    // A connected wallet is disconnected first, so a phone session ends on
    // the relay too instead of lingering without its hint.
    if (account) {
      try {
        await disconnect();
      } catch {
        /* the reload below starts from nothing either way */
      }
    }
    try {
      clearDashboardData([window.localStorage, window.sessionStorage]);
    } catch {
      /* storage blocked: nothing was stored either */
    }
    clearApiCache();
    // A full reload, not a client navigation: the in-memory stores (reads,
    // the notification feed, the wallet session) must start over too.
    window.location.reload();
  };

  return (
    <SettingsSection id="privacy" title="Data & privacy" subtitle="What is kept where, and how to clear it" icon="lock">
      <ul className="grid grid-cols-1 gap-[var(--d-gap)] pb-3.5 pt-1 @min-[760px]:grid-cols-3">
        {WHERE.map((item) => (
          <li key={item.title} className="rounded-[var(--d-radius-inner)] bg-[var(--d-card-2)] px-3.5 py-3">
            <p className="flex items-center gap-2 text-[13px] font-medium text-fg">
              <Icon name={item.icon} size={15} className="shrink-0 text-fg-dim" />
              {item.title}
            </p>
            <p className="mt-1.5 text-[12.5px] leading-[1.5] text-fg-dim">{item.body}</p>
          </li>
        ))}
      </ul>
      <p className="-mt-1 pb-3.5 text-[12.5px] text-fg-dim">No analytics or tracking scripts run on this dashboard.</p>

      <SettingRow
        title="Show NFT artwork"
        inline
        controlId="setting-nft-media"
        description={
          <>
            {NFT_MEDIA_PRIVACY_NOTE} Metadata is read by Zunia&apos;s server; only the image is loaded by this browser.
            {nftMediaBlockedReason ? <span className="mt-1 block text-[var(--z-warning)]">{nftMediaBlockedReason}</span> : null}
          </>
        }
        control={
          <Switch
            id="setting-nft-media"
            checked={nftMedia && !nftMediaBlockedReason}
            onCheckedChange={(next) => setNftMedia(next)}
            disabled={nftMediaBlockedReason !== null}
          />
        }
      />

      <SettingRow
        title="Clear local data"
        description={
          count === null
            ? "Removes what the dashboard stored on this browser. Your theme stays."
            : count === 0
              ? "Nothing stored on this browser yet."
              : `${count} ${count === 1 ? "item" : "items"} (${bytesText(bytes ?? 0)}) stored by the dashboard on this browser. Your theme stays.`
        }
        control={
          <Button size="sm" variant="danger" onClick={() => setConfirming(true)} disabled={count === 0}>
            Clear local data…
          </Button>
        }
      />

      <Dialog
        open={confirming}
        onOpenChange={(open) => {
          if (!clearing) setConfirming(open);
        }}
        title="Clear local data?"
        description={
          count ? `Removes the ${count} ${count === 1 ? "item" : "items"} (${bytesText(bytes ?? 0)}) the dashboard stored on this browser, then reloads.` : undefined
        }
        size="sm"
        footer={
          <>
            <Button variant="ghost" onClick={() => setConfirming(false)} disabled={clearing}>
              Cancel
            </Button>
            <Button variant="danger" onClick={() => void clear()} loading={clearing}>
              Clear and reload
            </Button>
          </>
        }
      >
        <div className="flex flex-col gap-3 text-[13px] leading-[1.5] text-fg-muted">
          <Listed title="Goes">
            Followed networks and their order · currency, privacy and artwork choices · notification history and read state · address book and
            watchlist · cached reads and tracked transfers{account ? " · this wallet connection (you connect again after)" : ""}.
          </Listed>
          <Listed title="Stays">
            Your theme. Your wallet and its keys, which never lived here. Push for this browser stays registered on the server until you turn it off
            on Notifications.
          </Listed>
        </div>
      </Dialog>
    </SettingsSection>
  );
}

function Listed({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div>
      <p className="d-label mb-1">{title}</p>
      <p>{children}</p>
    </div>
  );
}
