"use client";

/**
 * Receive: your address on any followed chain, as a QR code a phone can scan
 * and as text you can check group by group, plus every other chain's address
 * one click away.
 *
 * Each chain has its own address (its own bech32 prefix) even when the key
 * behind it is the same, and a token sent from another chain needs an IBC
 * transfer, not a plain send. The page says so next to the code, in the
 * chain's own words. A chain with no address explains why instead of showing
 * a re-encoded guess: a coin-type-60 chain derives a different key, and an
 * address nobody controls is the most expensive mistake a receive page can
 * make.
 *
 * The figures are deposits from other addresses: a move between two of your
 * own accounts arrives as an IBC receipt and a timed-out transfer comes back
 * as a credit, and neither is income. With one chain selected they keep to
 * that chain, and its deposits are broken down by token.
 */

import { useCallback, useMemo, useState, useSyncExternalStore } from "react";
import { BarList } from "@/components/charts";
import { QrCode } from "@/components/QrCode";
import { Icon } from "@/components/icons";
import { Page } from "@/components/shell/Page";
import { Button, Callout, Card, CardHeader, ChainLogo, CopyButton, EmptyState, HoverCard, InlineError, Money, PartialDataBadge, RelativeTime, toast } from "@/components/ui";
import { flowSummary } from "@/lib/activity/analytics";
import { findChain, sortChains, type ChainEntry } from "@/lib/chains";
import { cn } from "@/lib/cn";
import { MASK, formatFiat, formatTokenAmount, shortenAddress } from "@/lib/format";
import { maskAmounts } from "@/lib/notifications/text";
import { useActivity } from "@/lib/useActivity";
import { useChainScope } from "@/lib/useChainScope";
import { usePrefs } from "@/providers/PrefsProvider";
import { useWallet } from "@/providers/WalletProvider";
import { AddressChunks } from "./AddressChunks";
import { ChainPicker } from "./ChainPicker";
import { historySince, isOutgoing, isTransfer, newest, splitIncoming, topSenders, transferStats, withinLoaded } from "./logic";
import { chainName, sinceText } from "./names";
import { useOwnAccounts, useOwnAddressSet, type OwnAccount } from "./OwnAccountsCard";
import { RecentTransfers } from "./RecentTransfers";
import { Stat, StatStrip } from "./StatStrip";
import { TopSendersCard } from "./TopSendersCard";
import { useAddressBook } from "./useAddressBook";
import { useHistoryPrices } from "./useHistoryPrices";

export function ReceivePage({ chainId }: { chainId?: string }) {
  return (
    <Page
      title="Receive"
      subtitle="Your address on every chain you follow"
      access="wallet"
      connectTitle="Connect a wallet to receive"
      connectDescription="Show your address on any Cosmos chain as a QR code or text, with the checks that keep a deposit from going to the wrong network."
    >
      <ReceiveBody initialChainId={chainId} />
    </Page>
  );
}

const noopSubscribe = () => () => {};
const formatCount = (value: number) => `${value}`;
const canShare = () => typeof navigator !== "undefined" && typeof navigator.share === "function";

function ReceiveBody({ initialChainId }: { initialChainId?: string }) {
  const { primaryChainId } = useWallet();
  const { selectedChainId, followedOnNetwork } = useChainScope();
  const prefs = usePrefs();
  const book = useAddressBook();
  const activity = useActivity({ chains: followedOnNetwork });
  const shareable = useSyncExternalStore(noopSubscribe, canShare, () => false);

  const chains = useMemo(
    () => sortChains(followedOnNetwork.map((id) => findChain(id)).filter((chain): chain is ChainEntry => Boolean(chain))),
    [followedOnNetwork],
  );
  const accounts = useOwnAccounts(chains);
  const ownAddresses = useOwnAddressSet(accounts);
  const [choice, setChoice] = useState<string | null>(initialChainId ?? null);
  const withAddress = accounts.filter((row) => row.address);
  const chainId =
    [choice, selectedChainId, primaryChainId].find((id) => id && withAddress.some((row) => row.chain.chainId === id)) ??
    withAddress[0]?.chain.chainId ??
    null;
  const current = accounts.find((row) => row.chain.chainId === chainId) ?? null;
  const chain = current?.chain ?? null;
  const address = current?.address ?? null;

  /* ------------------------------------------------------------- history (scope) */
  // Figures count the window their "since" caption names (see `withinLoaded`).
  const scopedItems = useMemo(() => {
    const covered = withinLoaded(activity.items, activity.loadedUntil);
    return selectedChainId ? covered.filter((item) => item.chainId === selectedChainId) : covered;
  }, [activity.items, activity.loadedUntil, selectedChainId]);
  const incoming = useMemo(() => scopedItems.filter((item) => isTransfer(item) && !isOutgoing(item)), [scopedItems]);
  const split = useMemo(() => splitIncoming(scopedItems, ownAddresses), [scopedItems, ownAddresses]);
  const deposits = split.fromOthers;
  const lastDeposit = useMemo(() => newest(deposits), [deposits]);
  const senders = useMemo(() => topSenders(deposits, 5), [deposits]);
  const historyPrices = useHistoryPrices(deposits);
  const inflow = useMemo(() => flowSummary(deposits, { prices: historyPrices.prices }), [deposits, historyPrices.prices]);
  const valueCurrency = historyPrices.currency ?? prefs.currency;
  const since = sinceText(historySince(activity.loadedUntil, transferStats(scopedItems).since));
  const scopeName = selectedChainId ? chainName(selectedChainId) : null;
  const ownMoves = split.fromOwn.length;

  const moneyFormat = useCallback(
    (value: number) => (prefs.hideAmounts ? MASK : formatFiat(value, valueCurrency, { compact: true })),
    [prefs.hideAmounts, valueCurrency],
  );
  // All chains: where deposits land. One chain: what lands there, by token.
  const depositBars = useMemo(() => {
    if (selectedChainId) {
      return inflow.byToken
        .filter((row) => row.inValue !== null && row.inValue > 0)
        .map((row) => ({
          id: row.key,
          label: row.symbol,
          value: row.inValue ?? 0,
          detail: prefs.hideAmounts ? `${MASK} ${row.symbol} in` : `${formatTokenAmount(row.in, row.decimals, { maxFraction: 4 })} ${row.symbol} in`,
        }));
    }
    return inflow.byChain
      .filter((row) => row.inCount > 0)
      .map((row) => ({
        id: row.chainId,
        label: chainName(row.chainId),
        value: row.inCount,
        icon: <ChainLogo chainId={row.chainId} size={18} />,
        detail: row.inValue === null ? "Not priced" : `${moneyFormat(row.inValue)} at today's prices${row.unpriced > 0 ? `, ${row.unpriced} unpriced` : ""}`,
      }));
  }, [inflow, selectedChainId, moneyFormat, prefs.hideAmounts]);
  const unpricedTokens = selectedChainId ? inflow.byToken.filter((row) => row.inValue === null).length : 0;
  const keyTypes = new Set(withAddress.map((row) => row.chain.coinType)).size;
  const sameKeyCount = chain ? withAddress.filter((row) => row.chain.coinType === chain.coinType).length : 0;
  const loadingHistory = activity.loading && activity.items.length === 0;
  // A failed read is not an empty history: no "0" or "None" stands in for it.
  const historyFailed = activity.status === "error" && activity.items.length === 0;
  // The chains answered (rows or not): an empty answer is a real zero.
  const historyRead = !historyFailed && activity.status !== "idle";
  const excluded = [ownMoves > 0 ? `${ownMoves} own move${ownMoves === 1 ? "" : "s"}` : null, split.refunds.length > 0 ? `${split.refunds.length} refund${split.refunds.length === 1 ? "" : "s"}` : null]
    .filter(Boolean)
    .join(" and ");

  const share = async () => {
    if (!address || !chain) return;
    try {
      await navigator.share({ title: `My ${chain.chainName} address`, text: address });
    } catch {
      // Dismissed, or the share sheet refused: nothing to report.
    }
  };

  const copy = async () => {
    if (!address || !chain) return;
    try {
      await navigator.clipboard.writeText(address);
      toast.success(`${chain.chainName} address copied`, { description: shortenAddress(address, 12, 6) });
    } catch {
      toast.error("Could not copy", { description: "Select the address and copy it by hand." });
    }
  };

  // Lite moves the list up beside the receive card, where the deposit
  // breakdowns sit in Pro, so that column never ends in empty space.
  const recentlyReceived = (className: string) => (
    <RecentTransfers
      className={className}
      title="Recently received"
      items={incoming.slice(0, 8)}
      loading={loadingHistory}
      refreshing={activity.refreshing}
      error={activity.error?.message ?? null}
      onRetry={activity.refetch}
      subtitle={`${scopeName ? `On ${scopeName}` : "All followed chains"}${since ? ` ${since}` : ""} · your own moves included`}
      nameFor={(entry) => book.byAddress(entry)?.label ?? (ownAddresses.has(entry) ? "your account" : null)}
      empty={<EmptyState inline icon="receive" title="Nothing received in the loaded history" body="Incoming transfers show here once the chains report them." />}
      actions={
        <>
          <PartialDataBadge errors={activity.errors} />
          <Button size="sm" variant="ghost" href="/activity" iconRight="arrowRight">
            All activity
          </Button>
        </>
      }
    />
  );

  return (
    <div className="grid grid-cols-12 items-start gap-[var(--d-gap)]">
      <StatStrip pending={activity.refreshing} className="order-2 col-span-12 lg:order-1">
        <Stat
          label="Networks"
          value={
            <span>
              {withAddress.length}
              <span className="text-[15px] font-medium text-fg-dim"> / {accounts.length}</span>
            </span>
          }
          sub={`${keyTypes} key type${keyTypes === 1 ? "" : "s"}`}
          info="Followed networks on this slice where your wallet has an address. Chains on the same key type share one account under different prefixes."
        />
        {/* Pro only: analysis, not needed to act */}
        {prefs.lite ? null : (
          <Stat
            label="Received"
            value={historyFailed ? <Money value={null} reason="History could not be read" /> : `${deposits.length}`}
            sub={historyFailed ? "History unreadable" : (since ?? (activity.loading ? "Reading history…" : "No history loaded"))}
            loading={loadingHistory}
            info={`Deposits from other addresses (plain sends and IBC)${scopeName ? ` on ${scopeName}` : ""}, from the history public nodes keep. Transfers between your own accounts and refunds of your own transfers are not counted${excluded ? ` (${excluded} here)` : ""}.`}
          />
        )}
        <Stat
          label="Last received"
          value={
            historyFailed ? (
              <Money value={null} reason="History could not be read" />
            ) : lastDeposit ? (
              <RelativeTime at={Date.parse(lastDeposit.time)} />
            ) : (
              <span className="text-fg-dim">None</span>
            )
          }
          sub={
            historyFailed
              ? "History unreadable"
              : lastDeposit
                ? prefs.hideAmounts
                  ? maskAmounts(lastDeposit.summary, "transfer")
                  : lastDeposit.summary
                : since
                  ? `Nothing ${since}`
                  : undefined
          }
          loading={loadingHistory}
          info="The newest deposit from another address in the loaded history."
        />
        {prefs.lite ? null : (
          <Stat
            label="Received value"
            value={
              <Money
                // No deposit in a history that was read is a known zero, not an unknown.
                value={historyFailed ? null : deposits.length === 0 && historyRead ? 0 : inflow.inValue}
                currency={valueCurrency}
                compact
                reason={historyFailed ? "History could not be read" : deposits.length > 0 ? "None of what came in has a price" : "No history read yet"}
              />
            }
            sub={
              historyFailed
                ? "History unreadable"
                : `${deposits.length} deposit${deposits.length === 1 ? "" : "s"}${deposits.length > 0 ? " · est." : ""}${inflow.unpricedIn > 0 ? ` · ${inflow.unpricedIn} unpriced` : ""}`
            }
            loading={loadingHistory || (deposits.length > 0 && historyPrices.loading)}
            info={inflow.method}
          />
        )}
      </StatStrip>

      <Card variant="hero" className="order-1 col-span-12 gap-4 lg:order-2 lg:col-span-5">
        <CardHeader title="Receive" subtitle={chain ? `${chain.chainName} · ${chain.chainId}` : "Choose a network"} />
        {chains.length === 0 ? (
          <EmptyState icon="networks" title="No followed network" body="Follow a network to see your address on it." action={<Button href="/networks">Manage networks</Button>} />
        ) : (
          <>
            <ChainPicker
              label="Network"
              value={chainId}
              onChange={setChoice}
              chains={chains}
              isDisabled={(entry) => !withAddress.some((row) => row.chain.chainId === entry.chainId)}
              meta={(entry) => (accounts.find((row) => row.chain.chainId === entry.chainId)?.address ? null : "No address")}
            />
            {chain && address ? (
              <>
                <div className="flex justify-center pt-1">
                  {/* The code carries its own four-module quiet zone; the frame only rounds it. */}
                  <div className="relative rounded-[20px] bg-white p-2 shadow-[0_18px_44px_-18px_rgba(0,0,0,0.55),0_0_0_1px_rgba(17,17,17,0.06)]">
                    <QrCode value={address} size={232} label={`QR code of your ${chain.chainName} address`} className="block" />
                    <span className="absolute left-1/2 top-0 -translate-x-1/2 -translate-y-1/2 rounded-full bg-white p-1 shadow-[0_2px_8px_rgba(0,0,0,0.18)]">
                      <ChainLogo chainId={chain.chainId} size={26} />
                    </span>
                  </div>
                </div>
                <p className="select-all text-balance text-center text-[14.5px] leading-[1.7] tracking-[0.01em] sm:text-[15px]">
                  <AddressChunks address={address} />
                </p>
                <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                  <Button size="lg" variant="primary" iconLeft="copy" onClick={() => void copy()} className={shareable ? undefined : "sm:col-span-2"}>
                    Copy address
                  </Button>
                  {shareable ? (
                    <Button size="lg" variant="secondary" iconLeft={<Icon name="share" size={16} />} onClick={() => void share()}>
                      Share
                    </Button>
                  ) : null}
                </div>
                <Callout tone="warning" title={`Only for ${chain.chainName}`}>
                  Send only {chain.coinDenom} and tokens held on {chain.chainName} to this address. From another chain, use an IBC
                  transfer to it; from an exchange, withdraw on the {chain.chainName} network.
                </Callout>
                {sameKeyCount > 1 ? (
                  <p className="flex gap-2 text-[12.5px] leading-snug text-fg-dim">
                    <Icon name="key" size={15} className="mt-px shrink-0" />
                    The same key receives on {sameKeyCount - 1} other followed network{sameKeyCount - 1 === 1 ? "" : "s"}, each under its own
                    prefix. Use the address of the chain the tokens are on.
                  </p>
                ) : null}
              </>
            ) : (
              <Callout tone="neutral" title="No address on this network">
                {current?.reason ?? "Your wallet has not shared an address here yet."}
              </Callout>
            )}
          </>
        )}
      </Card>

      <div className="order-3 col-span-12 flex min-w-0 flex-col gap-[var(--d-gap)] lg:col-span-7">
        <Card>
          <CardHeader
            title="Your addresses"
            subtitle={`${withAddress.length} of ${accounts.length} followed networks${keyTypes > 0 ? ` · ${keyTypes} key type${keyTypes === 1 ? "" : "s"}` : ""}`}
            actions={
              <Button size="sm" variant="ghost" href="/networks" iconRight="arrowRight">
                Networks
              </Button>
            }
          />
          <ul className="grid grid-cols-1 gap-2 sm:grid-cols-2">
            {accounts.map((row) => (
              <AddressTile key={row.chain.chainId} account={row} selected={row.chain.chainId === chainId} onSelect={() => setChoice(row.chain.chainId)} />
            ))}
          </ul>
        </Card>
        {/* Pro only: deposit breakdowns are analysis; Lite keeps your addresses and what came in. */}
        {prefs.lite ? null : (
          <>
            <Card pending={activity.refreshing || historyPrices.loading}>
              <CardHeader
                title={scopeName ? `Deposits on ${scopeName}` : "Deposits by network"}
                subtitle={`${scopeName ? "By token, at today's prices (est.)" : "From other addresses"}${since ? ` ${since}` : ""}${excluded ? ` · ${excluded} not counted` : ""}`}
              />
              {loadingHistory ? (
                <BarList items={[]} loading ariaLabel="Deposits" limit={2} />
              ) : historyFailed ? (
                <InlineError message={activity.error?.message ?? "History could not be read."} onRetry={activity.refetch} />
              ) : depositBars.length === 0 ? (
                <EmptyState
                  inline
                  icon="receive"
                  title={deposits.length > 0 ? "Nothing priced came in" : "No deposits in the loaded history"}
                  body={deposits.length > 0 ? `${deposits.length} deposit${deposits.length === 1 ? "" : "s"}, none with a price to compare.` : "Where deposits from other addresses land shows here."}
                />
              ) : (
                <>
                  <BarList
                    items={depositBars}
                    valueFormatter={scopeName ? moneyFormat : formatCount}
                    ariaLabel={scopeName ? `Deposits on ${scopeName} by token, estimated value` : "Deposits by network, count"}
                    limit={6}
                  />
                  {unpricedTokens > 0 ? (
                    <p className="mt-2 text-[12px] text-fg-dim">
                      {unpricedTokens} token{unpricedTokens === 1 ? "" : "s"} without a price not shown.
                    </p>
                  ) : null}
                </>
              )}
            </Card>
            {senders.length > 0 ? (
              <TopSendersCard
                rows={senders}
                contactName={(entry) => book.byAddress(entry)?.label ?? null}
                subtitle={`By number of deposits${scopeName ? ` on ${scopeName}` : ""}${since ? `, ${since}` : ""}`}
              />
            ) : null}
          </>
        )}
        {prefs.lite ? recentlyReceived("") : null}
      </div>

      {prefs.lite ? null : recentlyReceived("order-4 col-span-12")}
    </div>
  );
}

/**
 * As many characters as a tile's address line holds at its narrowest: 1280 px
 * with the sidebar open, the selected tile (its logo ring takes 4 px), 11.5 px
 * mono. Measured: 17 fit, 18 overflow by a pixel.
 */
const TILE_ADDRESS_CHARS = 17;

/**
 * An address in a tile, cut once: the prefix, a few data characters, "…",
 * the last four. A long prefix ("addr_safro1") keeps fewer data characters
 * so the line still fits; were it ever too narrow anyway, the head gives way
 * and the last four characters stay, instead of a middle cut followed by a
 * second one at the end of the line.
 */
function ShortAddress({ address, className }: { address: string; className?: string }) {
  const separator = address.lastIndexOf("1");
  const prefix = separator > 0 ? address.slice(0, separator + 1) : "";
  const data = address.slice(prefix.length);
  // Up to four data characters, at least one, then "…" and the last four.
  const keep = Math.max(1, Math.min(4, TILE_ADDRESS_CHARS - 5 - prefix.length));
  const whole = data.length <= keep + 4;
  return (
    <span className={cn("flex min-w-0 font-mono", className)} title={address}>
      {whole ? (
        <span className="truncate">{address}</span>
      ) : (
        <>
          <span className="truncate">{`${prefix}${data.slice(0, keep)}\u2026`}</span>
          <span className="shrink-0">{data.slice(-4)}</span>
        </>
      )}
    </span>
  );
}

function AddressTile({ account, selected, onSelect }: { account: OwnAccount; selected: boolean; onSelect: () => void }) {
  const { chain, address, reason } = account;
  if (!address) {
    return (
      <li className="flex min-h-[64px] items-start gap-3 rounded-[var(--d-radius-inner)] border border-dashed border-[var(--d-hairline-strong)] px-3 py-2.5">
        <ChainLogo chainId={chain.chainId} size={28} className="opacity-60 grayscale" />
        <span className="min-w-0 flex-1">
          <span className="block truncate text-[13.5px] font-medium text-fg-muted">{chain.chainName}</span>
          <span className="block text-[12px] leading-snug text-fg-dim">{reason}</span>
        </span>
      </li>
    );
  }
  return (
    <li
      className={cn(
        "group relative flex min-h-[64px] items-center gap-1 rounded-[var(--d-radius-inner)] border bg-[var(--d-card-2)] pr-1.5 transition-[border-color,box-shadow] duration-[160ms]",
        selected
          ? "border-[var(--d-accent-line)] shadow-[0_0_0_1px_var(--d-accent-line)_inset]"
          : "border-transparent hover:border-[var(--d-hairline-strong)]",
      )}
    >
      {/* Named by what it shows (speech input says the visible words), then what a press does. */}
      <button
        type="button"
        onClick={onSelect}
        aria-pressed={selected}
        className="flex min-h-[62px] min-w-0 flex-1 items-center gap-3 rounded-[var(--d-radius-inner)] py-2 pl-3 text-left"
      >
        <ChainLogo chainId={chain.chainId} size={28} ring={selected} />
        <span className="min-w-0 flex-1">
          <span className="block truncate text-[13.5px] font-medium text-fg">{chain.chainName}</span>
          <ShortAddress address={address} className="text-[11.5px] text-fg-dim" />
        </span>
        <span className="sr-only">: show its QR code</span>
      </button>
      <HoverCard
        width={200}
        side="top"
        trigger={
          <button
            type="button"
            aria-label={`Quick QR code for ${chain.chainName}`}
            className="d-hit inline-flex size-7 shrink-0 items-center justify-center rounded-[6px] text-fg-dim transition-colors hover:bg-[var(--d-glass-2)] hover:text-fg"
          >
            <Icon name="qr" size={15} />
          </button>
        }
      >
        <span className="flex flex-col items-center gap-2 py-1">
          <span className="rounded-[10px] bg-white p-1">
            <QrCode value={address} size={156} label={`QR code of your ${chain.chainName} address`} />
          </span>
          <span className="font-mono text-[11px] text-fg-dim">{shortenAddress(address, 10, 6)}</span>
        </span>
      </HoverCard>
      <CopyButton value={address} label={`${chain.chainName} address`} size="sm" />
    </li>
  );
}
