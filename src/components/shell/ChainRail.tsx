"use client";

/**
 * The chain rail (≥ 768 px): the scope control as a column of logos.
 *
 * The Zunia mark is "All chains" (every followed chain of the MAIN/TEST
 * slice, added together); a logo is that chain alone. The selected one wears
 * the brand ring. Followed chains of the other slice sit under a divider,
 * dimmed; picking one switches the slice. An amber dot marks a chain where
 * something waits for you (rewards worth claiming, a vote you have not cast),
 * and the hover card says what, with your value there, its share of your net
 * worth, its 24 h move and the chain's actual staking APR.
 *
 * Keyboard: Tab reaches each logo (each is a toggle button with its state);
 * '0', '[' and ']' work anywhere (see AppFrame).
 */

import Link from "next/link";
import { Mark } from "@zunialab/ui";
import { Icon } from "@/components/icons";
import { ChainLogo, Delta, Money, Percent, RelativeTime, ShareBar, Skeleton, TokenAmount } from "@/components/ui";
import { cn } from "@/lib/cn";
import { findChain, type ChainEntry } from "@/lib/chains";
import { useChainStats } from "@/lib/data/chains";
import { formatDate } from "@/lib/format";
import { useChainScope } from "@/lib/useChainScope";
import { useWallet } from "@/providers/WalletProvider";
import { useShellData } from "./ShellData";
import { ShellTip } from "./ShellTip";
import styles from "./shell.module.css";
import { useScrollFade } from "./scroll-fade";

/* ------------------------------------------------------------------ hover cards */

function CardRow({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-3 py-[3px]">
      <span className="text-fg-dim">{label}</span>
      <span className="min-w-0 truncate text-right font-medium tabular-nums text-fg">{children}</span>
    </div>
  );
}

function ChainCard({ chain, offSlice }: { chain: ChainEntry; offSlice: boolean }) {
  const { account } = useWallet();
  const { followedOnNetwork } = useChainScope();
  const { portfolioData, portfolioPending, positions, attention } = useShellData();
  // Mounted only while the card is open: one stats read for the slice, the
  // same URL the Chains and Overview pages use.
  const stats = useChainStats(offSlice ? [chain.chainId] : followedOnNetwork);
  const chainStats = stats.statsFor(chain.chainId);
  const position = positions.get(chain.chainId);
  const signals = attention.get(chain.chainId);
  const currency = portfolioData?.currency;
  const apr = chainStats?.apr.actual ?? null;
  const aprReason = chainStats?.reasons?.apr ?? chainStats?.apr.note;

  return (
    <div className="flex flex-col">
      <div className="flex items-center gap-2.5 px-3 pb-2.5 pt-3">
        <ChainLogo chainId={chain.chainId} size={26} />
        <div className="min-w-0 flex-1">
          <p className="truncate text-[13.5px] font-semibold leading-tight text-fg">{chain.chainName}</p>
          <p className="truncate font-mono text-[11px] text-fg-dim">{chain.chainId}</p>
        </div>
        {chain.network === "testnet" ? (
          <span className="rounded-full bg-[var(--z-warning-fill)] px-1.5 py-px font-mono text-[9.5px] uppercase tracking-[0.06em] text-[var(--z-warning)]">
            Testnet
          </span>
        ) : null}
      </div>
      <div className="border-t border-[var(--d-hairline)] px-3 py-2">
        {account && !offSlice ? (
          portfolioPending ? (
            <div className="flex flex-col gap-2 py-1">
              <Skeleton height={10} width="80%" />
              <Skeleton height={10} width="60%" />
            </div>
          ) : (
            <>
              <CardRow label="Your value">
                <Money value={position?.value} currency={currency} reason={position?.failed ? "This network could not be read" : "Nothing priced here"} />
              </CardRow>
              <CardRow label="Share of net worth">
                <ShareBar value={position?.share} width={44} className="gap-1.5" />
              </CardRow>
              <CardRow label="24h">
                <Delta value={position?.change24hPct ?? null} />
              </CardRow>
            </>
          )
        ) : null}
        <CardRow label="Staking APR">
          {stats.loading ? (
            <Skeleton height={10} width={44} />
          ) : (
            <span className="inline-flex items-baseline gap-1">
              <Percent value={apr === null ? null : apr * 100} reason={aprReason ?? "Not computable for this chain"} />
              {apr !== null ? (
                <span className="text-[11px] font-normal text-fg-dim">
                  {chainStats?.apr.source === "cosmos.directory" ? "via cosmos.directory" : "actual"}
                </span>
              ) : null}
            </span>
          )}
        </CardRow>
      </div>
      {signals && (signals.rewards?.worthClaiming || signals.votes.length > 0) ? (
        <ul className="flex flex-col gap-1 border-t border-[var(--d-hairline)] px-3 py-2">
          {signals.rewards?.worthClaiming ? (
            <li className="flex items-start gap-2 text-fg-muted">
              <span aria-hidden className="mt-[6px] size-1.5 shrink-0 rounded-full bg-[var(--z-brand-amber)]" />
              <span>
                <TokenAmount amount={signals.rewards.whole} symbol={signals.rewards.symbol} maxFraction={4} className="font-medium text-fg" /> rewards
                to claim
              </span>
            </li>
          ) : null}
          {signals.votes.slice(0, 2).map((vote) => (
            <li key={`${vote.chainId}-${vote.id}`} className="flex items-start gap-2 text-fg-muted">
              <span aria-hidden className="mt-[6px] size-1.5 shrink-0 rounded-full bg-[var(--z-brand-amber)]" />
              <span className="min-w-0">
                Vote waiting on <span className="font-medium text-fg">#{vote.id}</span>
                {vote.votingEndTime ? (
                  <span className="text-fg-dim">
                    {" "}
                    · <RelativeTime at={Date.parse(vote.votingEndTime)} prefix="ends" upcoming />
                  </span>
                ) : null}
              </span>
            </li>
          ))}
        </ul>
      ) : null}
      {!account ? (
        <p className="border-t border-[var(--d-hairline)] px-3 py-2 text-fg-dim">Connect a wallet to see your position here.</p>
      ) : offSlice ? (
        <p className="border-t border-[var(--d-hairline)] px-3 py-2 text-fg-dim">
          On {chain.network === "testnet" ? "Testnet" : "Mainnet"}. Selecting it switches the view there.
        </p>
      ) : null}
    </div>
  );
}

function AllChainsCard() {
  const { account } = useWallet();
  const { followedOnNetwork, network } = useChainScope();
  const { portfolioData, portfolioPending } = useShellData();
  const totals = portfolioData?.totals;
  return (
    <div className="flex flex-col">
      <div className="px-3 pb-2.5 pt-3">
        <p className="text-[13.5px] font-semibold leading-tight text-fg">All chains</p>
        <p className="text-fg-dim">
          {followedOnNetwork.length} followed {followedOnNetwork.length === 1 ? "network" : "networks"} on {network === "testnet" ? "Testnet" : "Mainnet"}
        </p>
      </div>
      {account ? (
        <div className="border-t border-[var(--d-hairline)] px-3 py-2">
          {portfolioPending ? (
            <Skeleton height={10} width="70%" className="my-1" />
          ) : (
            <>
              <CardRow label="Net worth">
                <Money value={totals?.value} currency={portfolioData?.currency} reason="Nothing priced yet" />
              </CardRow>
              <CardRow label="24h">
                <Delta value={totals?.change24hPct ?? null} />
              </CardRow>
              {portfolioData ? (
                <p className="pt-1 text-[11px] text-fg-dim">As of {formatDate(portfolioData.updatedAt, "time")}</p>
              ) : null}
            </>
          )}
        </div>
      ) : null}
    </div>
  );
}

/* ------------------------------------------------------------------ rail items */

const RING = "flex items-center justify-center rounded-full p-[2px] transition-[background-color,opacity] duration-[160ms] ease-[var(--d-ease)]";

function ActivePill() {
  return (
    <span
      aria-hidden
      className="absolute -left-[10px] top-1/2 h-5 w-[3px] -translate-y-1/2 rounded-r-full bg-[image:var(--z-accent-gradient)]"
    />
  );
}

function RailChain({ chain, active, offSlice, onSelect }: { chain: ChainEntry; active: boolean; offSlice: boolean; onSelect: () => void }) {
  const { attention } = useShellData();
  const signals = attention.get(chain.chainId);
  const flagged = Boolean(signals?.attention) && !offSlice;
  return (
    <ShellTip card content={<ChainCard chain={chain} offSlice={offSlice} />}>
      <button
        type="button"
        aria-pressed={active}
        aria-label={`${chain.chainName}${flagged ? ", something to do here" : ""}${offSlice ? `, ${chain.network}` : ""}`}
        onClick={onSelect}
        className={cn("group relative flex size-11 shrink-0 items-center justify-center rounded-full", offSlice && !active && "opacity-45 hover:opacity-90")}
      >
        {active ? <ActivePill /> : null}
        <span className={cn(RING, "size-11", active ? "bg-[image:var(--z-accent-gradient)]" : "group-hover:bg-[var(--d-hairline-strong)]")}>
          <span className="flex size-10 items-center justify-center rounded-full bg-[var(--z-bg)] p-[2px]">
            <ChainLogo chainId={chain.chainId} size={36} />
          </span>
        </span>
        {flagged ? (
          <span aria-hidden className="absolute right-0 top-0 size-[11px] rounded-full border-2 border-[var(--z-bg)] bg-[var(--z-brand-amber)]" />
        ) : null}
      </button>
    </ShellTip>
  );
}

function AllChainsButton({ active, onSelect }: { active: boolean; onSelect: () => void }) {
  return (
    <ShellTip card content={<AllChainsCard />}>
      <button
        type="button"
        aria-pressed={active}
        aria-label="All chains"
        onClick={onSelect}
        className="group relative flex size-11 items-center justify-center rounded-[14px]"
      >
        {active ? <ActivePill /> : null}
        <span
          className={cn(
            "flex size-11 items-center justify-center rounded-[14px] p-[2px] transition-[background-color] duration-[160ms]",
            active ? "bg-[image:var(--z-accent-gradient)]" : "group-hover:bg-[var(--d-hairline-strong)]",
          )}
        >
          <span className="flex size-10 items-center justify-center rounded-[12px] bg-[var(--z-bg)] p-[2px]">
            <span
              className={cn(
                "flex size-9 items-center justify-center rounded-[10px] transition-colors duration-[160ms]",
                active
                  ? "bg-[image:var(--z-accent-gradient)] text-[var(--z-accent-fg)]"
                  : "bg-[var(--d-glass-2)] text-fg-muted group-hover:text-fg",
              )}
            >
              <Mark size={13} />
            </span>
          </span>
        </span>
      </button>
    </ShellTip>
  );
}

export function ChainRail() {
  const { network, selectedChainId, selectChain, followedAll } = useChainScope();
  const chains = followedAll.map((chainId) => findChain(chainId)).filter((chain): chain is ChainEntry => Boolean(chain));
  const onSlice = chains.filter((chain) => chain.network === network);
  const offSlice = chains.filter((chain) => chain.network !== network);
  const listRef = useScrollFade<HTMLDivElement>(followedAll.join(","));

  return (
    // The column runs the page's full height (its hairline with it, also in a
    // full-page capture); the panel inside sticks to the viewport.
    <aside aria-label="Chain scope" className="hidden w-16 shrink-0 border-r border-[var(--d-hairline)] md:block">
      <div className="sticky top-0 flex h-dvh flex-col pt-[env(safe-area-inset-top)]">
        <div className="flex h-[60px] shrink-0 items-center justify-center border-b border-[var(--d-hairline)]">
          <AllChainsButton active={selectedChainId === null} onSelect={() => selectChain(null)} />
        </div>

        <div
          ref={listRef}
          role="group"
          aria-label="Followed chains"
          className={cn(styles.fade, "d-no-scrollbar flex min-h-0 flex-1 flex-col items-center gap-2 overflow-y-auto py-3")}
        >
          {onSlice.map((chain) => (
            <RailChain
              key={chain.chainId}
              chain={chain}
              active={selectedChainId === chain.chainId}
              offSlice={false}
              onSelect={() => selectChain(chain.chainId)}
            />
          ))}
          {offSlice.length > 0 ? (
            <>
              <div className="my-1 flex w-full flex-col items-center gap-1" aria-hidden>
                <span className="h-px w-6 bg-[var(--d-hairline-strong)]" />
                <span className="font-mono text-[8.5px] uppercase tracking-[0.12em] text-fg-dim">{network === "mainnet" ? "Test" : "Main"}</span>
              </div>
              {offSlice.map((chain) => (
                <RailChain
                  key={chain.chainId}
                  chain={chain}
                  active={selectedChainId === chain.chainId}
                  offSlice
                  onSelect={() => selectChain(chain.chainId)}
                />
              ))}
            </>
          ) : null}
        </div>

        <div className="flex shrink-0 justify-center border-t border-[var(--d-hairline)] py-3">
          <ShellTip content="Manage networks">
            <Link
              href="/networks"
              aria-label="Manage networks"
              className="flex size-10 items-center justify-center rounded-full border border-dashed border-[var(--d-hairline-strong)] text-fg-dim transition-colors duration-[160ms] hover:border-[var(--d-control-line)] hover:bg-[var(--d-glass)] hover:text-fg"
            >
              <Icon name="plus" size={16} />
            </Link>
          </ShellTip>
        </div>
      </div>
    </aside>
  );
}
