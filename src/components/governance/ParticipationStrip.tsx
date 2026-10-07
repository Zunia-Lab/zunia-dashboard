"use client";

/**
 * The governance KPI strip: what is open on the networks in scope and how
 * much of it would pass now, how many of those you voted on, how many still
 * wait for you, and what closes within 48 hours.
 *
 * The two personal tiles only appear when they can say something. Without a
 * wallet they become one "Your votes" tile that says what connecting adds
 * (spec §6: public pages show where a wallet adds data). With a wallet that
 * has no voting power where votes are open, or nothing open at all, one
 * sentence replaces two zeros that would read as "you voted on nothing".
 *
 * A failed read is not an empty calendar: with nothing read, every figure is
 * "—" with the reason on hover (the list's Retry callout sits right below);
 * with some networks unreadable, the counts cover the rest and no tile says
 * "none" or "up to date" about networks it could not see.
 */

import type { ReactNode } from "react";
import { useConnectModal } from "@/components/connect/ConnectModal";
import { Icon } from "@/components/icons";
import { Button, chainById, StatTile } from "@/components/ui";
import { cn } from "@/lib/cn";
import { formatDuration } from "@/lib/format";
import type { Participation } from "./model";

export interface ParticipationStripProps {
  p: Participation;
  connected: boolean;
  loading: boolean;
  now: number | null;
  /** Networks in scope (for "on 5 networks"). */
  scopeCount: number;
  /** The proposals read failed with nothing to show: every figure is unknown. */
  failed?: boolean;
  /** Networks in scope whose proposals could not be read (a partial answer). */
  unreadable?: number;
}

const nameOf = (chainId: string) => chainById(chainId)?.chainName ?? chainId;

const READ_FAILED = "Proposals couldn't be read";

/** A count, or "—" with the reason (hover, screen readers) when the read failed. */
function Count({ n, failed }: { n: number; failed: boolean }) {
  if (failed) {
    return (
      <span className="text-fg-dim" title={READ_FAILED}>
        <span aria-hidden>—</span>
        <span className="sr-only">Unavailable: {READ_FAILED}</span>
      </span>
    );
  }
  return <span className="tabular-nums">{n}</span>;
}

/** "Osmosis", "Osmosis and Cosmos Hub", "the 3 networks voting now". */
function networksText(chainIds: readonly string[]): string {
  if (chainIds.length === 1) return nameOf(chainIds[0] ?? "");
  if (chainIds.length === 2) return `${nameOf(chainIds[0] ?? "")} and ${nameOf(chainIds[1] ?? "")}`;
  return `the ${chainIds.length} networks voting now`;
}

export function ParticipationStrip({ p, connected, loading, now, scopeCount, failed = false, unreadable = 0 }: ParticipationStripProps) {
  const connect = useConnectModal();
  const next = p.next;
  const nextEnd = next?.votingEndTime ? Date.parse(next.votingEndTime) : null;
  const nextIn = nextEnd !== null && now !== null && nextEnd > now ? formatDuration((nextEnd - now) / 1000) : null;
  const nextName = next ? `${nameOf(next.chainId)} #${next.id}` : null;
  const awaitingEnd = p.nextAwaiting?.votingEndTime ? Date.parse(p.nextAwaiting.votingEndTime) : null;
  const nextAwaitingIn = awaitingEnd !== null && now !== null && awaitingEnd > now ? formatDuration((awaitingEnd - now) / 1000) : null;
  const scopeText = scopeCount === 1 ? "this network" : `these ${scopeCount} networks`;
  // Said instead of "none" / "up to date" when some networks went unread.
  const unreadText = unreadable > 0 ? `${unreadable} ${unreadable === 1 ? "network" : "networks"} unreadable` : null;
  // Every open proposal read answered for this wallet, and none is votable:
  // one sentence says so (a failed read, an unread vote or an unaddressed
  // chain keeps the tiles honest; unread networks are named in the sentence).
  const nothingToVote = connected && !loading && !failed && p.eligible === 0 && p.unknown === 0 && p.unaddressed === 0;

  return (
    <div className="grid grid-cols-2 gap-[var(--d-gap)] lg:grid-cols-4" role="group" aria-label="Participation">
      <StatTile
        label="Open for voting"
        icon="governance"
        loading={loading}
        value={<Count n={p.open} failed={failed} />}
        sub={failed ? "Couldn't be read" : p.open > 0 ? `${p.passing} passing · ${p.failing} failing` : (unreadText ?? `None on ${scopeText}`)}
        info="Proposals in their voting period on the networks in scope. Passing or failing applies each chain's quorum, threshold and veto rules to the live tally, as if voting closed now."
      />

      {!connected ? (
        <WideTile hero>
          <div className="min-w-0">
            <TileLabel>Your votes</TileLabel>
            <p className="mt-1.5 max-w-[46ch] text-[13.5px] leading-snug text-fg-muted">
              Connect to see your voting power, your votes, and how your validators vote for you.
            </p>
          </div>
          <Button variant="primary" iconLeft="wallet" onClick={() => connect.open()} className="relative shrink-0 self-start sm:self-auto">
            Connect wallet
          </Button>
        </WideTile>
      ) : nothingToVote ? (
        <WideTile>
          <div className="min-w-0">
            <TileLabel>Your votes</TileLabel>
            <p className="mt-1.5 max-w-[52ch] text-[13.5px] leading-snug text-fg-muted">
              {p.open > 0 ? (
                <>
                  <span className="font-medium text-fg">No voting power on {networksText(p.openChainIds)}.</span> Only tokens
                  staked with active validators can vote.
                </>
              ) : unreadable > 0 ? (
                <>
                  <span className="font-medium text-fg">Nothing is open for a vote</span> on the networks that answered;{" "}
                  {unreadable === 1 ? "one" : unreadable} couldn&apos;t be read.
                </>
              ) : (
                <>
                  <span className="font-medium text-fg">Nothing is open for a vote</span> on {scopeText}. New proposals show up here
                  with your vote.
                </>
              )}
            </p>
          </div>
          {p.open > 0 ? (
            <Button href="/staking" size="sm" iconRight="arrowRight" className="relative shrink-0 self-start sm:self-auto">
              Stake to vote
            </Button>
          ) : null}
        </WideTile>
      ) : (
        <>
          {/* After a failed read the dashes stand alone: the first tile and
              the Retry callout below say why, once. Under 1024 px the two
              personal tiles take the second row, where the connect tile sits
              without a wallet, so a wallet restoring moves no public tile. */}
          <StatTile
            label="Voted"
            className="order-last lg:order-none"
            loading={loading}
            tone={p.eligible > 0 && p.voted === p.eligible ? "positive" : "default"}
            value={<Count n={p.voted} failed={failed} />}
            sub={
              failed
                ? null
                : p.eligible > 0
                  ? `of ${p.eligible} you can vote on`
                  : p.unknown > 0
                    ? `${p.unknown} couldn't be read`
                    : p.unaddressed > 0
                      ? `${p.unaddressed} on networks not in your wallet`
                      : "Nothing to vote on"
            }
            info="Open proposals where your own vote is on chain. Votes are readable only while voting is open."
          />
          <StatTile
            label="Not voted"
            className="order-last lg:order-none"
            loading={loading}
            tone={p.notVoted > 0 ? "warning" : "default"}
            value={<Count n={p.notVoted} failed={failed} />}
            sub={
              failed
                ? null
                : p.notVoted > 0
                  ? nextAwaitingIn
                    ? `Next closes in ${nextAwaitingIn}`
                    : null
                  : p.unknown > 0
                    ? `${p.unknown} couldn't be read`
                    : (unreadText ?? "You're up to date")
            }
            info="Open proposals on networks where you have voting power and no vote yet. Until you vote, each validator you stake with votes for your stake; your own vote overrides theirs."
          />
        </>
      )}

      <StatTile
        label="Ending < 48 h"
        icon="clock"
        loading={loading}
        tone={p.endingSoonNotVoted > 0 ? "warning" : "default"}
        value={<Count n={p.endingSoon} failed={failed} />}
        sub={
          failed
            ? null
            : p.endingSoonNotVoted > 0
              ? `${p.endingSoonNotVoted} without your vote`
              : nextIn
                ? `Next in ${nextIn}`
                : (unreadText ?? "No deadline soon")
        }
        info={nextName && nextIn ? `Next to close: ${nextName}, in ${nextIn}.` : undefined}
      />
    </div>
  );
}

/**
 * A two-column tile holding a sentence instead of a figure. Last on phones
 * (the two figure tiles pair up above it), in place on wider screens.
 */
function WideTile({ hero = false, children }: { hero?: boolean; children: ReactNode }) {
  return (
    <div
      className={cn(
        "d-card relative order-last col-span-2 flex min-w-0 flex-col justify-between gap-3 p-[var(--d-pad)] [overflow:clip] sm:flex-row sm:items-center lg:order-none",
        hero && "d-card-hero",
      )}
    >
      {children}
    </div>
  );
}

function TileLabel({ children }: { children: ReactNode }) {
  return (
    <p className="flex items-center gap-1.5 text-[12.5px] font-medium text-fg-dim">
      <Icon name="wallet" size={15} />
      {children}
    </p>
  );
}
