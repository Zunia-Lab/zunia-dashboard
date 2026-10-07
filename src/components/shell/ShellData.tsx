"use client";

/**
 * The reads the frame itself needs, made once and shared by its parts: the
 * chain rail (value, share, 24 h, amber dots), the scope picker, the Live
 * popover and the notification feed's driver.
 *
 * Coverage differs on purpose:
 * - values and shares come from the portfolio of the current MAIN/TEST slice
 *   (`scope: "followed"`): the rail and the scope list compare chains of the
 *   net worth on screen, whatever chain is selected;
 * - staking, votes and activity cover every followed chain, both slices: a
 *   notification about a followed testnet is still news, and the feed must
 *   see the same chains whichever slice is showing, or switching slices would
 *   read as unbondings being cancelled.
 *
 * In the default setup (mainnets only, All chains selected) every one of
 * these URLs is the same as the page's own read, so the frame adds no
 * request; `useApi` dedupes them.
 */

import { createContext, useContext, useMemo, type ReactNode } from "react";
import { findChain } from "@/lib/chains";
import { useProposals, type ProposalRow, type ProposalsState } from "@/lib/data/governance";
import { usePortfolio, type PortfolioResponse, type PortfolioState } from "@/lib/data/portfolio";
import { useStakingPositions, type StakingPositionsState } from "@/lib/data/staking";
import { useActivity, type UseActivityResult } from "@/lib/useActivity";
import { useChainScope } from "@/lib/useChainScope";
import { useWallet } from "@/providers/WalletProvider";
import { chainAttention, positionsByChain, type ChainAttention, type ChainPosition } from "./signals";

export interface ShellData {
  /** Portfolio of every followed chain of the current slice. */
  portfolio: PortfolioState;
  /** `portfolio.data` when it belongs to the connected wallet (else null): what to display. */
  portfolioData: PortfolioResponse | null;
  /** The portfolio has no answer for this wallet yet (first load, or a wallet switch). */
  portfolioPending: boolean;
  /** Value, share and 24 h per chain, from `portfolio`. */
  positions: ReadonlyMap<string, ChainPosition>;
  /** Staking positions on every followed chain. */
  staking: StakingPositionsState;
  /** Voting-period proposals on every followed chain, with the wallet's vote. */
  proposals: ProposalsState;
  /** Recent activity on every followed chain. */
  activity: UseActivityResult;
  /** Rewards worth claiming and votes waiting, per followed chain. */
  attention: ReadonlyMap<string, ChainAttention>;
}

const ShellDataContext = createContext<ShellData | null>(null);

const NO_VOTES: ProposalRow[] = [];
const NO_CHAINS: string[] = [];

export function ShellDataProvider({ children }: { children: ReactNode }) {
  const { followedAll } = useChainScope();
  const { account } = useWallet();
  const portfolio = usePortfolio({ scope: "followed" });
  const staking = useStakingPositions({ chainIds: followedAll });
  // Only a voter needs the frame's proposals (the rail's "vote waiting" dot,
  // the notice feed): without a wallet the list would be read, a fan-out to
  // every followed chain's node refreshed every two minutes, for nothing.
  // An empty chain list leaves the read idle.
  const proposals = useProposals({ status: "voting", chains: account ? followedAll : NO_CHAINS });
  const activity = useActivity({ chains: followedAll });

  // An answer kept from a previous key (keepPreviousData) is fine to show
  // dimmed while the currency or the chain list changes, but never when it
  // belongs to another wallet: values, dots and votes would describe someone
  // else for a moment.
  const portfolioData = portfolio.data;
  const portfolioAccounts = portfolio.accounts.accounts;
  const ownPortfolio = useMemo(() => {
    if (!portfolioData) return null;
    const current = new Set(portfolioAccounts.map((entry) => `${entry.chainId}:${entry.address}`));
    return portfolioData.chains.every((chain) => current.has(`${chain.chainId}:${chain.address}`)) ? portfolioData : null;
  }, [portfolioData, portfolioAccounts]);
  const positions = useMemo(() => positionsByChain(ownPortfolio), [ownPortfolio]);
  const portfolioPending = portfolio.status === "loading" && ownPortfolio === null;
  const { chainFor } = staking;
  const stakingStale = staking.stale;
  const awaitingVote = proposals.stale ? NO_VOTES : proposals.awaitingVote;
  const attention = useMemo(() => {
    const out = new Map<string, ChainAttention>();
    for (const chainId of followedAll) {
      out.set(
        chainId,
        chainAttention(chainId, {
          staking: stakingStale ? null : chainFor(chainId),
          chain: findChain(chainId),
          position: positions.get(chainId),
          awaitingVote,
        }),
      );
    }
    return out;
  }, [followedAll, chainFor, stakingStale, positions, awaitingVote]);

  const value = useMemo<ShellData>(
    () => ({ portfolio, portfolioData: ownPortfolio, portfolioPending, positions, staking, proposals, activity, attention }),
    [portfolio, ownPortfolio, portfolioPending, positions, staking, proposals, activity, attention],
  );
  return <ShellDataContext.Provider value={value}>{children}</ShellDataContext.Provider>;
}

export function useShellData(): ShellData {
  const value = useContext(ShellDataContext);
  if (!value) throw new Error("useShellData must be used inside the app frame");
  return value;
}
