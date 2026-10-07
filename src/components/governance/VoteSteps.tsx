"use client";

/**
 * The last two steps of casting a vote (see ./VoteFlow): the review of what
 * will be signed — proposal, option, voting power, signer, the simulated
 * network fee and the exact message type — and the staged progress after
 * the click: approve in the wallet, broadcast, confirm, then the result or
 * an explained failure with Retry.
 */

import { Icon } from "@/components/icons";
import {
  AddressText,
  Button,
  ChainLogo,
  Disclosure,
  InlineError,
  KeyValueList,
  Skeleton,
  Spinner,
  Stepper,
  TokenAmount,
  type Step,
} from "@/components/ui";
import { cn } from "@/lib/cn";
import type { ProposalRow, VoteChoice, VoteOptionName } from "@/lib/chain/types";
import type { useTxPreview } from "@/lib/data/wallet";
import type { ExplainedTxError } from "@/lib/tx/errors";
import type { useSignAndBroadcast } from "@/lib/tx/useSignAndBroadcast";
import { VOTE_LABEL, voteChoiceText } from "./model";
import { VoteSwatch } from "./TallyBar";

/** The message the vote is signed as: gov v1 on chains that migrated, v1beta1 on the others. */
const MSG_TYPE: Record<ProposalRow["api"], string> = {
  v1: "/cosmos.gov.v1.MsgVote",
  v1beta1: "/cosmos.gov.v1beta1.MsgVote",
};

export function ReviewCard({
  proposal,
  chainName,
  option,
  current,
  voter,
  token,
  preview,
  endText,
}: {
  proposal: ProposalRow;
  chainName: string;
  option: VoteOptionName;
  current: VoteChoice | null;
  voter: string | null;
  token: { symbol: string; decimals: number | null };
  preview: ReturnType<typeof useTxPreview>;
  endText: string | null;
}) {
  const fee = preview.preview?.fee ?? null;
  return (
    <div className="flex min-w-0 flex-col gap-3 rounded-[var(--d-radius-inner)] border border-[var(--d-hairline)] bg-[var(--d-card-2)] p-3.5">
      <p className="d-label">Review</p>
      <KeyValueList
        divided
        items={[
          {
            key: "proposal",
            label: "Proposal",
            // The id is what the message carries; the title, on one line,
            // says which one it is.
            value: (
              <span className="inline-flex min-w-0 max-w-full items-baseline gap-1.5" title={proposal.title}>
                <span className="shrink-0 font-mono text-[12.5px] text-fg-dim">#{proposal.id}</span>
                <span className="min-w-0 truncate">{proposal.title}</span>
              </span>
            ),
          },
          {
            key: "network",
            label: "Network",
            value: (
              <span className="inline-flex items-center gap-1.5">
                <ChainLogo chainId={proposal.chainId} size={16} />
                {chainName}
              </span>
            ),
          },
          {
            key: "vote",
            label: "Your vote",
            emphasis: true,
            value: (
              <span className="inline-flex items-center gap-1.5">
                <VoteSwatch option={option} />
                {VOTE_LABEL[option]}
              </span>
            ),
            sub: current ? `Replaces your ${voteChoiceText(current)} vote` : undefined,
          },
          {
            key: "power",
            label: "Voting power",
            value: <TokenAmount amount={proposal.myVotingPower ?? null} decimals={token.decimals} symbol={token.symbol} compact reason="Your delegations could not be read" />,
          },
          {
            key: "from",
            label: "From",
            value: voter ? <AddressText address={voter} /> : <span className="text-fg-dim">—</span>,
          },
          {
            key: "fee",
            label: "Network fee",
            info: "Measured by simulating this exact vote on the chain, at the average gas price. Your wallet may adjust it.",
            value: fee ? (
              <span className={cn(preview.stale && "opacity-60")}>
                ≈ <TokenAmount amount={fee.display} symbol={fee.symbol} masked={false} />
              </span>
            ) : preview.loading ? (
              <Skeleton className="inline-block h-3.5 w-20 align-middle" />
            ) : (
              <span className="text-fg-dim" title={preview.error?.message}>
                —
              </span>
            ),
            sub: !fee && !preview.loading && preview.error ? preview.error.message : undefined,
          },
          {
            key: "message",
            label: "Message",
            value: <span className="font-mono text-[12px] text-fg-muted">{MSG_TYPE[proposal.api]}</span>,
          },
        ]}
      />
      <p className="text-[12px] leading-snug text-fg-dim">
        You can change your vote until voting closes{endText ? ` (${endText})` : ""}. Only the last vote counts.
      </p>
    </div>
  );
}

export type FlowStage = ReturnType<typeof useSignAndBroadcast>["stage"] | "opening";

export function Progress({
  stage,
  option,
  chainId,
  chainName,
  proposalId,
  txHash,
  explained,
  onRetry,
  onBack,
  onDone,
}: {
  stage: FlowStage;
  option: VoteOptionName;
  chainId: string;
  chainName: string;
  proposalId: string;
  txHash: string | null;
  explained: ExplainedTxError | null;
  onRetry: () => void;
  onBack: () => void;
  onDone: () => void;
}) {
  const failed = stage === "failed" || (stage === "idle" && explained !== null);
  const href = txHash ? `/activity/${txHash}?chainId=${encodeURIComponent(chainId)}` : null;

  if (stage === "success" || stage === "submitted") {
    const landed = stage === "success";
    return (
      <div className="flex flex-col items-center gap-3 rounded-[var(--d-radius-inner)] border border-[var(--d-hairline)] bg-[var(--d-card-2)] px-4 py-5 text-center" role="status">
        <span
          className={cn(
            "flex size-11 items-center justify-center rounded-full",
            landed ? "bg-[var(--z-success-fill)] text-[var(--z-success)]" : "bg-[var(--z-info-fill)] text-[var(--z-info)]",
          )}
        >
          <Icon name={landed ? "check" : "clock"} size={22} strokeWidth={2} />
        </span>
        <div>
          <p className="text-[15px] font-medium text-fg">{landed ? "Vote recorded" : "Vote submitted"}</p>
          <p className="mt-1 text-[13px] leading-snug text-fg-dim">
            {landed
              ? `You voted ${VOTE_LABEL[option]} on ${chainName} #${proposalId}. The tally updates within two minutes.`
              : "Not seen in a block yet. It may still land: check Activity before voting again."}
          </p>
        </div>
        <div className="flex flex-wrap justify-center gap-2">
          {href ? (
            <Button href={href} size="sm" variant="secondary" iconRight="arrowUpRight">
              View transaction
            </Button>
          ) : null}
          <Button size="sm" variant="ghost" onClick={onDone}>
            Done
          </Button>
        </div>
      </div>
    );
  }

  if (failed && explained) {
    return (
      <div className="flex flex-col gap-3">
        <InlineError title={explained.title} message={explained.message} onRetry={onRetry} />
        {explained.detail ? (
          <Disclosure summary="Details from the chain" variant="inset">
            <pre className="whitespace-pre-wrap break-words font-mono text-[11.5px] leading-[1.55] text-fg-muted">{explained.detail}</pre>
          </Disclosure>
        ) : null}
        <div className="flex gap-2">
          <Button size="sm" variant="secondary" iconLeft="arrowLeft" onClick={onBack}>
            Back to review
          </Button>
          {href ? (
            <Button size="sm" variant="ghost" href={href} iconRight="arrowUpRight">
              Transaction
            </Button>
          ) : null}
        </div>
      </div>
    );
  }

  const steps: Step[] = progressSteps(stage);
  const live =
    stage === "opening" || stage === "preparing"
      ? "Opening your wallet…"
      : stage === "awaiting-signature"
        ? "Approve the vote in your wallet."
        : stage === "broadcasting"
          ? "Sending your vote to the network…"
          : "Waiting for the next block…";
  return (
    <div className="flex flex-col gap-4 rounded-[var(--d-radius-inner)] border border-[var(--d-hairline)] bg-[var(--d-card-2)] p-3.5">
      <p className="flex items-center gap-2 text-[13.5px] font-medium text-fg" role="status" aria-live="polite">
        <Spinner size={14} />
        {live}
      </p>
      <Stepper steps={steps} orientation="vertical" />
    </div>
  );
}

function progressSteps(stage: FlowStage): Step[] {
  const order = ["sign", "broadcast", "confirm"] as const;
  const at =
    stage === "opening" || stage === "preparing" || stage === "awaiting-signature" || stage === "idle"
      ? 0
      : stage === "broadcasting"
        ? 1
        : 2;
  const labels: Record<(typeof order)[number], { label: string; description: string }> = {
    sign: { label: "Approve in your wallet", description: "Check the proposal number and option before approving." },
    broadcast: { label: "Broadcast", description: "Sent to a public node of the chain." },
    confirm: { label: "Confirm", description: "Included in a block (a few seconds)." },
  };
  return order.map((key, index) => ({
    label: labels[key].label,
    description: index === at ? labels[key].description : undefined,
    state: index < at ? "done" : index === at ? "current" : "todo",
  }));
}
