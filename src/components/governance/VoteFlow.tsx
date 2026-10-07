"use client";

/**
 * Casting a vote: choose → review → sign, in one panel.
 *
 * - Choose: the four options with what each one does on this chain (the
 *   veto line quotes the chain's own veto threshold), the voter's power and
 *   current vote (or the vote their validators cast for them).
 * - Review (./VoteSteps): what will be signed — proposal, option, voting
 *   power, signer, the network fee measured by simulation (`useTxPreview`,
 *   no wallet prompt), and the exact message type (gov v1 or v1beta1).
 * - Sign: `useSignAndBroadcast` with a staged progress (./VoteSteps: approve
 *   in wallet → broadcast → confirm), an explained failure with Retry, a
 *   toast, and the shared reads refreshed (the hook revalidates `/api/` and
 *   the broadcast route drops the server's cached votes for this voter).
 *
 * Nothing is signed without the wallet's own prompt; the dashboard never
 * holds a key.
 */

import Link from "next/link";
import { useEffect, useMemo, useRef, useState, type KeyboardEvent, type ReactNode } from "react";
import { useConnectModal } from "@/components/connect/ConnectModal";
import { Icon } from "@/components/icons";
import { Button, Callout, chainById, InfoTip, TokenAmount, toast, useNow } from "@/components/ui";
import { cn } from "@/lib/cn";
import type { InheritedVote, ProposalRow, VoteChoice, VoteOptionName } from "@/lib/chain/types";
import { useTxPreview } from "@/lib/data/wallet";
import { explainError, TxError, type ExplainedTxError } from "@/lib/tx/errors";
import { buildVote } from "@/lib/tx/messages";
import { useSignAndBroadcast } from "@/lib/tx/useSignAndBroadcast";
import { useWallet } from "@/providers/WalletProvider";
import { dateText, FORM_ORDER, inheritedSummary, powerState, VOTE_LABEL, VOTE_SHORT, voteChoiceText, type InheritedPart } from "./model";
import { pct, votingEnded } from "./rules";
import { VoteSwatch } from "./TallyBar";
import { Progress, ReviewCard } from "./VoteSteps";

export interface VoteFlowProps {
  proposal: ProposalRow;
  /** `card` on the proposal page; `sheet` in the list's side sheet. */
  variant?: "card" | "sheet";
  /** Called when the user is finished (Done after a vote, or Cancel in a sheet). */
  onDone?: () => void;
  /** A signature or broadcast is in flight (the sheet stays open meanwhile). */
  onBusyChange?: (busy: boolean) => void;
  className?: string;
}

type Phase = "choose" | "review" | "progress";

/** The staking token of a chain, for voting power. */
export function stakeTokenOf(chainId: string): { symbol: string; decimals: number | null } {
  const chain = chainById(chainId);
  return { symbol: chain?.coinDenom ?? "", decimals: chain?.coinDecimals ?? null };
}

export function VoteFlow({ proposal, variant = "card", onDone, onBusyChange, className }: VoteFlowProps) {
  const wallet = useWallet();
  const connect = useConnectModal();
  const tx = useSignAndBroadcast();
  const now = useNow();
  const chain = chainById(proposal.chainId);
  const chainName = chain?.chainName ?? proposal.chainId;
  const token = stakeTokenOf(proposal.chainId);

  const [phase, setPhase] = useState<Phase>("choose");
  const [choice, setChoice] = useState<VoteOptionName | null>(null);
  const [opening, setOpening] = useState(false);
  const [preflight, setPreflight] = useState<ExplainedTxError | null>(null);
  const [justVoted, setJustVoted] = useState<VoteChoice | null>(null);

  const busy = opening || tx.busy;
  const busyRef = useRef(onBusyChange);
  useEffect(() => {
    busyRef.current = onBusyChange;
  }, [onBusyChange]);
  useEffect(() => {
    busyRef.current?.(busy);
  }, [busy]);

  const voter = wallet.account ? wallet.addressFor(proposal.chainId) : null;
  const request = useMemo(() => {
    if (phase !== "review" || !choice || !voter) return null;
    try {
      return {
        chainId: proposal.chainId,
        messages: [buildVote({ proposalId: proposal.id, voter, option: choice, govVersion: proposal.api })],
      };
    } catch {
      return null;
    }
  }, [phase, choice, voter, proposal.chainId, proposal.id, proposal.api]);
  const preview = useTxPreview(request);

  const current: VoteChoice | null = justVoted ?? proposal.myVote;
  const power = powerState(proposal.myVotingPower);
  const ended = votingEnded(proposal, now);
  // Server-rendered on the proposal page: UTC until hydrated (see dateText).
  const endAt = proposal.votingEndTime ? Date.parse(proposal.votingEndTime) : Number.NaN;
  const endText = Number.isFinite(endAt) ? dateText(endAt, "datetime", now) : null;

  /* ------------------------------------------------------------ gates */

  // Gates apply before signing starts; a vote in flight keeps its panel even
  // if the proposal's state changes underneath (voting closing mid-signature).
  // The proposal's own state comes first: connecting would not make a
  // proposal in its deposit period, or a closed one, votable.
  if (phase !== "progress") {
    if (proposal.status === "deposit") {
      return (
        <Gate className={className} icon="hourglass" title="Voting has not started">
          <p>Voting opens once deposits reach the minimum. Until then the proposal can only receive deposits.</p>
        </Gate>
      );
    }
    if (proposal.status !== "voting" || ended) {
      return (
        <Gate className={className} icon="clock" title={ended ? "Voting has ended" : "Voting is closed"}>
          <p>
            {ended
              ? "The chain is tallying the result; it shows here within a minute."
              : `Voting closed${endText ? ` on ${endText}` : ""}. Chains delete individual votes after the tally, so no one can show how an account voted any more${wallet.account ? "; your vote transactions are in Activity" : ""}.`}
          </p>
          {!ended && wallet.account ? (
            <Button href="/activity" size="sm" iconRight="arrowRight" className="mt-3 self-start">
              Open activity
            </Button>
          ) : null}
        </Gate>
      );
    }
    if (!wallet.account) {
      return (
        <Gate className={className} icon="wallet" title="Connect to vote">
          <p>Your vote counts with the {token.symbol || "tokens"} you stake on {chainName}. Signing happens in your wallet; Zunia never holds your keys.</p>
          <Button variant="primary" iconLeft="wallet" onClick={() => connect.open()} className="mt-3 self-start">
            Connect wallet
          </Button>
        </Gate>
      );
    }
    if (!wallet.canSignOn(proposal.chainId)) {
      return (
        <Gate className={className} icon="lock" title={`Your wallet can't sign on ${chainName}`}>
          <p>
            {wallet.walletKind === "zunia-mobile"
              ? `This phone session did not include ${chainName}. Pair again and approve ${chainName} to vote from here.`
              : `${chainName} is not available in this wallet. Add it in your wallet, then try again.`}
          </p>
        </Gate>
      );
    }
    if (!voter) {
      return (
        <Gate className={className} icon="lock" title={`No ${chainName} address yet`}>
          <p>Your wallet has not shared an address on {chainName}. Add the network to see your voting power and vote.</p>
          <Button
            size="sm"
            iconLeft="plus"
            className="mt-3 self-start"
            onClick={() => {
              wallet.ensureChain(proposal.chainId).catch((error: unknown) => {
                const explained = explainError(error);
                toast.error(explained.title, { description: explained.message });
              });
            }}
          >
            Add {chainName}
          </Button>
        </Gate>
      );
    }
  }

  /* ------------------------------------------------------------ actions */

  const sign = async () => {
    if (!choice) return;
    setPhase("progress");
    setPreflight(null);
    setOpening(true);
    let address: string;
    try {
      // Makes the chain signable (a wallet prompt the first time) and gives
      // the exact address the signature will come from.
      address = await wallet.ensureChain(proposal.chainId);
    } catch (error) {
      setOpening(false);
      const explained = explainError(error);
      setPreflight(explained);
      toast.error(explained.title, { description: explained.message });
      return;
    }
    setOpening(false);
    const option = choice;
    const label = `${VOTE_LABEL[option]} on ${chainName} #${proposal.id}`;
    try {
      const result = await tx.run({
        chainId: proposal.chainId,
        messages: [buildVote({ proposalId: proposal.id, voter: address, option, govVersion: proposal.api })],
      });
      setJustVoted({ option });
      const href = `/activity/${result.txHash}?chainId=${encodeURIComponent(proposal.chainId)}`;
      if (result.confirmed === false) {
        toast.info(`Vote submitted: ${label}`, {
          description: "Not in a block yet. It may still land; check Activity.",
          action: { label: "View", href },
        });
      } else {
        toast.success(`Voted ${label}`, { description: "Your vote is on chain.", action: { label: "View", href } });
      }
    } catch (error) {
      // The panel shows the explained failure (the hook keeps it); the
      // toast is for a user who looked away while the wallet was open.
      const explained = error instanceof TxError ? error.explained : explainError(error);
      if (explained.kind === "user-rejected") toast.info("Vote cancelled", { description: "Nothing was signed." });
      else toast.error(explained.title, { description: explained.message });
    }
  };

  return (
    <div className={cn("flex min-w-0 flex-col gap-4", className)}>
      <PowerLine proposal={proposal} current={current} token={token} power={power} />

      {phase === "choose" ? (
        <>
          {/* Before the options, not after: it changes what choosing means. */}
          {power === "none" ? (
            <Callout tone="warning" title={`No voting power on ${chainName}`}>
              Your vote would be recorded but carry no weight: only {token.symbol || "tokens"} staked with active validators vote.{" "}
              <Link href="/staking" className="font-medium text-fg underline underline-offset-[3px]">
                Stake {token.symbol}
              </Link>
            </Callout>
          ) : null}
          <OptionGrid value={choice} current={current} vetoThreshold={proposal.vetoThreshold} onChange={setChoice} />
          {choice && current && current.option === choice ? (
            <p className="text-[12.5px] text-fg-dim">That is already your vote. Pick another option to change it.</p>
          ) : null}
          <div className={cn("flex gap-2", variant === "sheet" ? "flex-col-reverse sm:flex-row sm:justify-end" : "flex-col")}>
            {variant === "sheet" && onDone ? (
              <Button variant="ghost" onClick={onDone}>
                Cancel
              </Button>
            ) : null}
            <Button
              variant="primary"
              size="lg"
              fullWidth={variant === "card"}
              disabled={!choice || (current !== null && current.option === choice)}
              iconRight="arrowRight"
              onClick={() => setPhase("review")}
            >
              Review vote
            </Button>
          </div>
        </>
      ) : null}

      {phase === "review" && choice ? (
        <>
          <ReviewCard
            proposal={proposal}
            chainName={chainName}
            option={choice}
            current={current}
            voter={voter}
            token={token}
            preview={preview}
            endText={endText}
          />
          <div className="flex flex-col-reverse gap-2 sm:flex-row">
            <Button variant="secondary" iconLeft="arrowLeft" onClick={() => setPhase("choose")} className="sm:flex-none">
              Back
            </Button>
            <Button variant="primary" size="lg" className="flex-1" iconLeft="governance" onClick={() => void sign()}>
              Sign and vote {VOTE_SHORT[choice]}
            </Button>
          </div>
        </>
      ) : null}

      {phase === "progress" && choice ? (
        <Progress
          stage={opening ? "opening" : tx.stage}
          option={choice}
          chainId={proposal.chainId}
          chainName={chainName}
          proposalId={proposal.id}
          txHash={tx.txHash}
          explained={preflight ?? tx.explained}
          onRetry={() => void sign()}
          onBack={() => {
            tx.reset();
            setPreflight(null);
            setPhase("review");
          }}
          onDone={() => {
            tx.reset();
            setChoice(null);
            setPhase("choose");
            onDone?.();
          }}
        />
      ) : null}
    </div>
  );
}

/* ------------------------------------------------------------------ pieces */

/** A state where voting is not possible (yet): what and why, and the one action that helps. */
function Gate({ icon, title, children, className }: { icon: "wallet" | "hourglass" | "clock" | "lock"; title: string; children: ReactNode; className?: string }) {
  return (
    <div className={cn("flex min-w-0 flex-col rounded-[var(--d-radius-inner)] bg-[var(--d-card-2)] px-3.5 py-3 text-[13px] leading-[1.5] text-fg-muted", className)}>
      <p className="mb-1 flex items-center gap-2 text-[14px] font-medium leading-snug text-fg">
        <Icon name={icon} size={16} className="shrink-0 text-fg-dim" />
        {title}
      </p>
      {children}
    </div>
  );
}

/** Voting power, and the vote that currently counts for it. */
function PowerLine({
  proposal,
  current,
  token,
  power,
}: {
  proposal: ProposalRow;
  current: VoteChoice | null;
  token: { symbol: string; decimals: number | null };
  power: ReturnType<typeof powerState>;
}) {
  const inherited = current ? null : inheritedSummary(proposal.inheritedVote);
  return (
    <div className="flex min-w-0 flex-col gap-2 rounded-[var(--d-radius-inner)] bg-[var(--d-card-2)] px-3.5 py-3">
      <div className="flex items-baseline justify-between gap-3 text-[13px]">
        <span className="inline-flex items-center gap-1 text-fg-dim">
          Your voting power
          <InfoTip
            size={13}
            content="Stake delegated to validators in the active set. Unbonding stake and stake on inactive or jailed validators does not vote."
          />
        </span>
        <span className="font-medium tabular-nums text-fg">
          {power === "unknown" ? (
            <span className="text-fg-dim" title="Your delegations could not be read">
              —
            </span>
          ) : (
            <TokenAmount amount={proposal.myVotingPower ?? "0"} decimals={token.decimals} symbol={token.symbol} compact />
          )}
        </span>
      </div>
      <div className="flex items-baseline justify-between gap-3 text-[13px]">
        <span className="text-fg-dim">Your vote</span>
        <span className="min-w-0 text-right font-medium text-fg">
          {current ? (
            <span className="inline-flex items-center gap-1.5">
              <VoteSwatch option={current.option === "weighted" ? "weighted" : current.option} />
              {voteChoiceText(current)}
            </span>
          ) : proposal.myVoteStatus !== "not-voted" ? (
            // Unread (null: only a public read is on screen) or unreadable:
            // never "Not voted", which is a claim about your own vote.
            <span className="font-normal text-fg-dim">Couldn&apos;t be read</span>
          ) : (
            <span className={cn("font-normal", power === "some" ? "text-[var(--z-warning)]" : "text-fg-dim")}>Not voted</span>
          )}
        </span>
      </div>
      {inherited ? <InheritedNote list={proposal.inheritedVote ?? []} parts={inherited.parts} /> : null}
    </div>
  );
}

/**
 * Without a vote of your own, your validators' votes count for your stake:
 * say how they voted, or that they have not (your stake then counts for
 * nothing yet), naming them when there are few.
 */
function InheritedNote({ list, parts }: { list: readonly InheritedVote[]; parts: readonly InheritedPart[] }) {
  const names = list
    .slice(0, 3)
    .map((v) => v.moniker ?? "your validator")
    .join(", ");
  const more = list.length > 3 ? ` and ${list.length - 3} more` : "";
  const voted = parts.filter((part) => part.option !== "none");
  return (
    <p className="border-t border-[var(--d-hairline)] pt-2 text-[12.5px] leading-[1.5] text-fg-dim">
      {voted.length === 0 ? (
        <>
          <span className="text-fg-muted">
            {names}
            {more}
          </span>{" "}
          {list.length === 1 ? "hasn't" : "haven't"} voted either, so your stake does not count yet.
        </>
      ) : (
        <>
          Until you vote, your validators vote for your stake:{" "}
          <span className="text-fg-muted">
            {parts
              .map((part) => `${pct(part.weight, 0)} ${part.option === "none" ? "not yet" : part.option === "weighted" ? "split" : VOTE_SHORT[part.option]}`)
              .join(" · ")}
          </span>{" "}
          ({names}
          {more}).
        </>
      )}
    </p>
  );
}

const OPTION_HELP: Record<VoteOptionName, string> = {
  yes: "In favour.",
  no: "Against.",
  abstain: "Counts toward quorum, not the result.",
  veto: "Against, and flags it as spam or harmful.",
};

function OptionGrid({
  value,
  current,
  vetoThreshold,
  onChange,
}: {
  value: VoteOptionName | null;
  current: VoteChoice | null;
  vetoThreshold: number | null;
  onChange: (option: VoteOptionName) => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const focusIndex = Math.max(0, value ? FORM_ORDER.indexOf(value) : 0);
  const onKeyDown = (event: KeyboardEvent<HTMLButtonElement>, index: number) => {
    const delta =
      event.key === "ArrowRight" || event.key === "ArrowDown" ? 1 : event.key === "ArrowLeft" || event.key === "ArrowUp" ? -1 : 0;
    if (!delta) return;
    event.preventDefault();
    const next = (index + delta + FORM_ORDER.length) % FORM_ORDER.length;
    const option = FORM_ORDER[next];
    if (!option) return;
    onChange(option);
    ref.current?.querySelectorAll<HTMLButtonElement>("[role=radio]")[next]?.focus();
  };
  return (
    <div ref={ref} role="radiogroup" aria-label="Your vote" className="grid grid-cols-2 gap-2">
      {FORM_ORDER.map((option, index) => {
        const selected = value === option;
        const isCurrent = current?.option === option;
        return (
          <button
            key={option}
            type="button"
            role="radio"
            aria-checked={selected}
            tabIndex={index === focusIndex ? 0 : -1}
            onClick={() => onChange(option)}
            onKeyDown={(event) => onKeyDown(event, index)}
            className={cn(
              "d-hit relative flex min-h-[76px] min-w-0 flex-col items-start gap-1 rounded-[var(--d-radius-inner)] border px-3 py-2.5 text-left",
              "transition-[border-color,background-color,box-shadow] duration-[160ms] ease-[var(--d-ease)] focus-visible:outline-offset-1",
              selected
                ? "border-[var(--d-accent-line)] bg-[var(--d-accent-soft)] shadow-[0_0_0_1px_var(--d-accent-line)]"
                : "border-[var(--d-hairline-strong)] bg-[var(--d-glass)] hover:border-[var(--d-control-line)] hover:bg-[var(--d-glass-2)]",
            )}
          >
            <span className="flex w-full items-center gap-2">
              <VoteSwatch option={option} className="size-3" />
              <span className="text-[14px] font-medium text-fg">{VOTE_LABEL[option]}</span>
              {selected ? <Icon name="check" size={14} strokeWidth={2.2} className="ml-auto text-[var(--d-accent-text)]" /> : null}
            </span>
            <span className="text-[12px] leading-snug text-fg-dim">
              {option === "veto" && vetoThreshold !== null
                ? `Against; above ${pct(vetoThreshold)} veto rejects it and can burn the deposit.`
                : OPTION_HELP[option]}
            </span>
            {isCurrent && !selected ? (
              <span className="absolute right-2 top-2 rounded-full bg-[var(--d-glass-2)] px-1.5 font-mono text-[10px] uppercase leading-[16px] tracking-[0.06em] text-fg-dim">
                Current
              </span>
            ) : null}
          </button>
        );
      })}
    </div>
  );
}
