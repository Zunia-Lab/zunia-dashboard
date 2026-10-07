"use client";

/**
 * The three moments after "Review": what is about to be signed, where the
 * signature is, and what happened. Shared by Send and Bridge so a transfer
 * reads the same wherever it starts.
 *
 * - `ReviewPanel`: the amount large, every fact the wallet will be asked to
 *   sign as label / value rows, what the memo does (derived from its bytes),
 *   and the problems that block signing. Problems are never folded away.
 * - `SignProgress`: the signing stages as a stepper, with the failure
 *   explained in plain words and a way back.
 * - `ResultHeader`: the outcome, the hash, where to follow it.
 */

import type { ReactNode } from "react";
import Link from "next/link";
import { Icon } from "@/components/icons";
import {
  Button,
  Callout,
  CopyButton,
  Disclosure,
  ExternalLink,
  KeyValueList,
  Money,
  Stepper,
  TokenAmount,
  type KeyValueItem,
  type Step,
} from "@/components/ui";
import { explorerTxUrl } from "@/config/interchain";
import { cn } from "@/lib/cn";
import { shortenHash } from "@/lib/format";
import type { MemoExplanation, MemoTone } from "@/lib/interchain/memo-summary";
import type { ExplainedTxError } from "@/lib/tx/errors";
import type { SignStage } from "@/lib/tx/types";

export interface ReviewAmount {
  base: string;
  decimals: number | null;
  symbol: string;
  value: number | null;
  currency: string;
}

const MEMO_TONE: Record<MemoTone, string> = {
  neutral: "text-fg-muted",
  info: "text-fg-muted",
  warning: "text-[var(--z-warning)]",
  danger: "text-[var(--z-danger)]",
};

export function ReviewPanel({
  heading,
  amount,
  rows,
  memo,
  problems,
  notice,
  confirmLabel,
  onBack,
  onConfirm,
}: {
  heading: string;
  amount: ReviewAmount;
  rows: KeyValueItem[];
  /** The packet memo explained from its bytes (IBC routes that carry one). */
  memo?: MemoExplanation | null;
  /** Anything that blocks signing; each one is shown. */
  problems: string[];
  /** A note under the rows (what happens on timeout, an exchange warning…). */
  notice?: ReactNode;
  confirmLabel: string;
  onBack: () => void;
  onConfirm: () => void;
}) {
  const blocked = problems.length > 0;
  return (
    <div className="d-fade-in flex flex-col gap-4">
      <div className="flex flex-col items-center gap-1 rounded-[var(--d-radius-inner)] bg-[var(--d-card-2)] px-4 py-5 text-center">
        <span className="d-label">{heading}</span>
        <span className="mt-1 text-[32px] font-semibold leading-tight tracking-[-0.035em] text-fg [font-variant-numeric:proportional-nums]">
          {/* Never masked: this is what the wallet is about to sign, and the
              user typed it (the amount field is not masked either). */}
          <TokenAmount amount={amount.base} decimals={amount.decimals} symbol={amount.symbol} masked={false} symbolClassName="text-[20px] font-medium" />
        </span>
        <Money value={amount.value} currency={amount.currency} masked={false} reason="No price for this token" className="text-[13.5px] tabular-nums text-fg-dim" />
      </div>

      <KeyValueList divided items={rows} />

      {memo && memo.kind !== "empty" ? (
        <div className="flex flex-col gap-2 rounded-[var(--d-radius-inner)] border border-[var(--d-hairline)] px-3.5 py-3">
          <p className="flex items-center gap-1.5 text-[13px] font-medium text-fg">
            <Icon name="shield" size={15} className="text-fg-dim" />
            What the memo does: {memo.headline.toLowerCase()}
          </p>
          <ul className="flex flex-col gap-1.5">
            {memo.statements.map((statement) => (
              <li key={statement.text} className={cn("flex gap-2 text-[12.5px] leading-snug", MEMO_TONE[statement.tone])}>
                <span aria-hidden className="mt-[7px] size-1 shrink-0 rounded-full bg-current" />
                {statement.text}
              </li>
            ))}
          </ul>
          <Disclosure summary={`The memo itself (${memo.byteLength} bytes)`}>
            <pre className="d-scroll max-h-40 overflow-auto whitespace-pre-wrap break-all rounded-[8px] bg-[var(--d-glass)] p-2.5 font-mono text-[11px] leading-relaxed text-fg-muted">
              {memo.raw}
            </pre>
          </Disclosure>
        </div>
      ) : null}

      {notice}

      {problems.map((problem) => (
        <Callout key={problem} tone="danger" title="This cannot be signed">
          {problem}
        </Callout>
      ))}

      <div className="flex flex-col-reverse gap-2 sm:flex-row">
        <Button size="lg" variant="secondary" onClick={onBack} className="sm:flex-1" iconLeft="arrowLeft">
          Edit
        </Button>
        <Button size="lg" variant="primary" onClick={onConfirm} disabled={blocked} className="sm:flex-[2]">
          {confirmLabel}
        </Button>
      </div>
      <p className="flex items-center justify-center gap-1.5 text-center text-[12px] text-fg-dim">
        <Icon name="lock" size={13} />
        Your wallet shows the same transaction before anything is signed.
      </p>
    </div>
  );
}

type FailedAt = "sign" | "broadcast" | "confirm";

function failedAt(explained: ExplainedTxError | null, txHash: string | null): FailedAt {
  if (!explained) return "sign";
  if (explained.kind === "user-rejected" || explained.kind === "wallet-timeout" || explained.kind === "wallet-disconnected") return "sign";
  return txHash ? "confirm" : "broadcast";
}

/** The stepper for a signing attempt. */
export function signSteps(stage: SignStage, chainName: string, explained: ExplainedTxError | null, txHash: string | null): Step[] {
  const order = ["sign", "broadcast", "confirm"] as const;
  const at: Record<SignStage, number> = {
    idle: 0,
    preparing: 0,
    "awaiting-signature": 0,
    broadcasting: 1,
    confirming: 2,
    success: 3,
    submitted: 2,
    failed: order.indexOf(failedAt(explained, txHash)),
  };
  const current = at[stage];
  const labels = ["Sign in your wallet", "Broadcast", `Confirm on ${chainName}`];
  const descriptions: Record<number, string | undefined> = {
    0: stage === "preparing" ? "Measuring gas and reading your account…" : stage === "awaiting-signature" ? "Approve the request in your wallet" : undefined,
    1: stage === "broadcasting" ? "Handing the signed transaction to the network" : undefined,
    2: stage === "confirming" ? "Waiting for a block" : stage === "submitted" ? "Not in a block yet. It may still land: check Activity." : undefined,
  };
  return [
    { label: "Review", state: "done" },
    ...labels.map((label, index): Step => {
      const state: Step["state"] =
        stage === "failed" && index === current
          ? "error"
          : index < current || stage === "success"
            ? "done"
            : index === current
              ? "current"
              : "todo";
      return { label, state, description: stage === "failed" && index === current ? explained?.title : descriptions[index] };
    }),
  ];
}

export function SignProgress({
  stage,
  chainName,
  explained,
  txHash,
  onRetry,
  onBack,
}: {
  stage: SignStage;
  chainName: string;
  explained: ExplainedTxError | null;
  txHash: string | null;
  onRetry: () => void;
  onBack: () => void;
}) {
  const steps = signSteps(stage, chainName, explained, txHash);
  return (
    <div className="d-fade-in flex flex-col gap-5">
      <Stepper steps={steps} orientation="vertical" />
      {stage === "awaiting-signature" ? (
        <Callout tone="info" icon="wallet" title="Waiting for your wallet">
          Check the wallet window (or your phone) and approve the transaction there. Nothing is sent until you do.
        </Callout>
      ) : null}
      {stage === "failed" && explained ? (
        <>
          <Callout tone="danger" title={explained.title}>
            {explained.message}
            {explained.detail ? (
              <Disclosure summary="Details" className="mt-2">
                <span className="block break-words font-mono text-[11.5px] leading-relaxed">{explained.detail}</span>
              </Disclosure>
            ) : null}
          </Callout>
          <div className="flex flex-col-reverse gap-2 sm:flex-row">
            <Button size="lg" variant="secondary" onClick={onBack} className="sm:flex-1" iconLeft="arrowLeft">
              Edit
            </Button>
            {explained.retryable ? (
              <Button size="lg" variant="primary" onClick={onRetry} className="sm:flex-[2]" iconLeft="refresh">
                Try again
              </Button>
            ) : null}
          </div>
        </>
      ) : null}
    </div>
  );
}

export function TxHashLine({ chainId, hash }: { chainId: string; hash: string }) {
  const url = explorerTxUrl(chainId, hash);
  return (
    <div className="flex flex-wrap items-center justify-center gap-x-3 gap-y-1 text-[12.5px] text-fg-dim">
      <span className="inline-flex items-center gap-1">
        <span className="font-mono text-fg-muted" title={hash}>
          {shortenHash(hash, 8, 6)}
        </span>
        <CopyButton value={hash} label="transaction hash" />
      </span>
      {url ? <ExternalLink href={url}>Explorer</ExternalLink> : null}
      <Link href={`/activity/${hash}?chainId=${encodeURIComponent(chainId)}`} className="text-[var(--d-accent-text)] underline-offset-[3px] hover:underline">
        Details
      </Link>
    </div>
  );
}

/** The outcome headline: a mark, a sentence, the hash. */
export function ResultHeader({
  tone,
  title,
  detail,
  chainId,
  hash,
}: {
  tone: "success" | "pending";
  title: ReactNode;
  detail?: ReactNode;
  chainId: string;
  hash: string;
}) {
  return (
    <div className="d-fade-in flex flex-col items-center gap-2 py-2 text-center">
      <span
        aria-hidden
        className={cn(
          "flex size-12 items-center justify-center rounded-full",
          tone === "success"
            ? "bg-[image:var(--z-button-gradient)] text-white shadow-[0_8px_28px_-8px_rgba(255,27,12,0.55)]"
            : "border border-[var(--d-hairline-strong)] bg-[var(--d-glass)] text-fg-muted",
        )}
      >
        <Icon name={tone === "success" ? "check" : "clock"} size={22} strokeWidth={2} />
      </span>
      <p className="text-[18px] font-semibold tracking-[-0.02em] text-fg">{title}</p>
      {detail ? <p className="max-w-[46ch] text-[13.5px] leading-snug text-fg-muted">{detail}</p> : null}
      <TxHashLine chainId={chainId} hash={hash} />
    </div>
  );
}
