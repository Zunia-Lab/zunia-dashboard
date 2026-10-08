"use client";

/**
 * The one sheet every staking transaction goes through:
 *
 *   form (when the flow has one) → review card → wallet → progress.
 *
 * The review card is what the user checks before their wallet opens: the
 * flow's own rows (network, validator, amount…) plus the network fee, which
 * this sheet measures by simulating the exact transaction (`useTxPreview`,
 * no wallet prompt), and the memo it signs (Zunia's default: these flows
 * have no memo field). Progress then follows `useSignAndBroadcast`'s stages
 * (prepare → approve in wallet → broadcast → confirm), explains a failure in
 * plain words, and announces the outcome with a toast — so closing the sheet
 * while the wallet is open loses nothing: the toast still says how it went.
 *
 * Signing never starts on its own: only the Confirm button calls it.
 */

import { Fragment, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { txMemoItem } from "@/components/TxMemoItem";
import {
  Button,
  Callout,
  Disclosure,
  KeyValueList,
  Money,
  Sheet,
  Skeleton,
  Spinner,
  Stepper,
  TokenAmount,
  toast,
  type KeyValueItem,
  type Step,
} from "@/components/ui";
import { Icon } from "@/components/icons";
import { cn } from "@/lib/cn";
import { useWallet, walletKindLabel } from "@/lib/connect/context";
import { useTxPreview } from "@/lib/data/wallet";
import { shortenHash } from "@/lib/format";
import { explainError, TxError, type ExplainedTxError, type TxErrorKind } from "@/lib/tx/errors";
import { describeTxMemo } from "@/lib/tx/memo";
import type { SignRequest, SignStage } from "@/lib/tx/types";
import { useSignAndBroadcast } from "@/lib/tx/useSignAndBroadcast";
import { usePrefs } from "@/providers/PrefsProvider";
import { txHref, wholeText } from "../model";

export interface FeeValuation {
  /** Denom the fee is valued in (the staking token); other denoms show no value. */
  denom: string | null;
  price: number | null;
  currency: string;
}

export interface TxSheetProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  description?: ReactNode;
  chainId: string | null;
  /** The edit step. Without it the sheet opens on the review. */
  form?: ReactNode;
  /** The transaction once the form is complete; null while it is not. */
  request: SignRequest | null;
  /** Why the form cannot continue yet, in plain words. */
  blocker?: string | null;
  /** Review rows above the fee. */
  reviewItems: KeyValueItem[];
  /** Rules and risks the user should read before signing. */
  notices?: ReactNode;
  fee: FeeValuation;
  /** "Stake 120 SAF". */
  confirmLabel: string;
  /** Toast and final line on success, e.g. "Staked 120 SAF with Winnode" (mask amounts first). */
  successText: string;
  /** Extra content in the review step, under the card (e.g. the restake switch). */
  reviewExtra?: ReactNode;
  /**
   * What the transaction pays out, to warn when the fee would eat it (a claim
   * of 0.001 OSMO for a 0.03 OSMO fee). Compared only in the same denom.
   */
  payout?: { denom: string; whole: number; what: string; symbol: string };
  /** Called when the user confirms (before the wallet opens). */
  onSubmit?: () => void;
}

type FlowStep = "edit" | "review" | "progress";

const BUSY: readonly SignStage[] = ["preparing", "awaiting-signature", "broadcasting", "confirming"];

/**
 * Above this share of the payout, the review says what the fee takes (a
 * softer note than "the fee is more than it pays"): rewards keep accruing,
 * and the same fee buys more later.
 */
const FEE_SHARE_NOTICE = 0.2;

/** Failures that only the wallet produces: they belong to the "Approve" step whatever was rendered last. */
const WALLET_FAILURES: ReadonlySet<TxErrorKind> = new Set(["user-rejected", "wallet-timeout", "wallet-disconnected"]);

/**
 * The step a failure is drawn on. The stage seen last while rendering is
 * not enough: a wallet that refuses at once moves the stage from
 * "awaiting-signature" to "failed" in one batch, so "awaiting-signature" is
 * never rendered and the failure would be pinned on "Prepare". The cause
 * says more: a wallet's refusal is the approve step's, and a transaction the
 * chain already has (a hash) failed in its block.
 */
function failedStage(lastBusy: SignStage, failure: ExplainedTxError | null, txHash: string | null): SignStage {
  if (failure && WALLET_FAILURES.has(failure.kind)) return "awaiting-signature";
  if (txHash) return "confirming";
  return lastBusy;
}

export function TxSheet({
  open,
  onOpenChange,
  title,
  description,
  chainId,
  form,
  request,
  blocker,
  reviewItems,
  notices,
  fee,
  confirmLabel,
  successText,
  reviewExtra,
  payout,
  onSubmit,
}: TxSheetProps) {
  const hasForm = form !== undefined;
  const [step, setStep] = useState<FlowStep>(hasForm ? "edit" : "review");
  const tx = useSignAndBroadcast();
  const preview = useTxPreview(step === "review" ? request : null);
  const { walletKind } = useWallet();
  const { mask } = usePrefs();
  const [failure, setFailure] = useState<ExplainedTxError | null>(null);

  // The last stage before a failure, to mark which step failed. Recorded
  // while rendering (React's "information from previous renders" pattern).
  const [lastBusy, setLastBusy] = useState<SignStage>("preparing");
  if (BUSY.includes(tx.stage) && tx.stage !== lastBusy) setLastBusy(tx.stage);

  // Whether the sheet is still open when the outcome arrives (read from the
  // async confirm handler, so a ref rather than the render's value).
  const openRef = useRef(open);
  useEffect(() => {
    openRef.current = open;
  }, [open]);

  const busy = tx.busy;
  const walletName = walletKind ? walletKindLabel(walletKind) : "your wallet";
  // What was signed, frozen at Confirm: the data behind the form refreshes
  // after the transaction (rewards drop to zero, a balance moves), and the
  // progress screen must keep describing the transaction that was sent.
  const [sent, setSent] = useState<{ chainId: string; successText: string } | null>(null);

  const confirm = async () => {
    if (!request || !chainId) return;
    const snapshot = { chainId, successText };
    setSent(snapshot);
    onSubmit?.();
    setFailure(null);
    setStep("progress");
    try {
      const result = await tx.run(request);
      if (result.confirmed === false) {
        toast.info("Sent, waiting for a block", {
          description: "The network accepted it but it was not in a block within a minute. It may still land.",
          action: { label: "Activity", href: txHref(snapshot.chainId, result.txHash) },
        });
      } else {
        toast.success(snapshot.successText, { action: { label: "View", href: txHref(snapshot.chainId, result.txHash) } });
      }
    } catch (error) {
      const explained = error instanceof TxError ? error.explained : explainError(error);
      setFailure(explained);
      // The open sheet already says what went wrong (and covers the corner
      // the toast would sit in); a toast is for a sheet closed while waiting.
      if (!openRef.current) {
        if (explained.kind === "user-rejected") toast.info("Cancelled in your wallet");
        else toast.error(explained.title, { description: explained.message });
      }
    }
  };

  const feeQuote = preview.preview?.fee ?? null;
  const feeWhole = feeQuote ? Number(feeQuote.display) : null;
  const feeValue =
    feeQuote && fee.price !== null && fee.denom === feeQuote.denom && feeWhole !== null && Number.isFinite(feeWhole)
      ? feeWhole * fee.price
      : null;
  const previewError = preview.error;
  const feeEatsPayout =
    payout !== undefined && feeQuote !== null && feeWhole !== null && feeQuote.denom === payout.denom && feeWhole >= payout.whole;
  // What share of the payout the fee takes (same denom only): a percentage
  // says nothing about the size of the position, so it is never masked.
  const feeShare =
    payout !== undefined && feeQuote !== null && feeWhole !== null && feeQuote.denom === payout.denom && payout.whole > 0 && Number.isFinite(feeWhole)
      ? feeWhole / payout.whole
      : null;
  const accountMissing = preview.preview !== null && !preview.preview.accountExists;
  // "≈ $0.13 · 45% of the rewards · est.": what the fee is worth, what it
  // takes of the payout (the warning below says it when it is all of it),
  // and whether the gas was measured.
  const estimated = Boolean(preview.preview?.gas.estimate);
  const feeSub: ReactNode[] = [
    ...(feeValue !== null ? [<>≈ <Money value={feeValue} currency={fee.currency} masked={false} /></>] : []),
    ...(feeShare !== null && payout && !feeEatsPayout ? [`${shareText(feeShare)} of the ${payout.what}`] : []),
  ];
  if (estimated) feeSub.push(feeSub.length > 0 ? "est." : "Estimate");
  const feeItem: KeyValueItem = {
    key: "fee",
    label: "Network fee",
    info:
      preview.preview?.gas.estimate && preview.preview.gas.note
        ? preview.preview.gas.note
        : "Measured by simulating this exact transaction on the network, at the average gas price. Your wallet may let you change it.",
    value:
      preview.preview && feeQuote ? (
        <span className={cn(preview.stale && "opacity-60")}>
          {feeQuote.amount.length === 0 ? (
            "None"
          ) : (
            <TokenAmount amount={feeQuote.display} symbol={feeQuote.symbol ?? feeQuote.denom} masked={false} />
          )}
        </span>
      ) : preview.loading ? (
        <Skeleton className="inline-block h-3 w-20 align-middle" />
      ) : (
        <span className="text-fg-dim">Not measured</span>
      ),
    sub:
      feeSub.length > 0
        ? feeSub.map((part, index) => (
            <Fragment key={index}>
              {index > 0 ? " · " : null}
              {part}
            </Fragment>
          ))
        : undefined,
  };

  // The memo the sign flow will write, from the same request it signs.
  const memoView = useMemo(() => (request ? describeTxMemo(request) : null), [request]);

  const canConfirm =
    Boolean(request && chainId) &&
    !busy &&
    !preview.loading &&
    !accountMissing &&
    (previewError === null || previewError.retryable);

  const footer =
    step === "edit" ? (
      <>
        <Button variant="ghost" onClick={() => onOpenChange(false)}>
          Cancel
        </Button>
        <Button variant="primary" disabled={!request} onClick={() => setStep("review")} iconRight="arrowRight">
          Review
        </Button>
      </>
    ) : step === "review" ? (
      <>
        {hasForm ? (
          <Button variant="ghost" onClick={() => setStep("edit")} iconLeft="arrowLeft">
            Edit
          </Button>
        ) : (
          <Button variant="ghost" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
        )}
        <Button variant="primary" disabled={!canConfirm} loading={preview.loading && !preview.preview} onClick={() => void confirm()}>
          {confirmLabel}
        </Button>
      </>
    ) : busy ? (
      <Button variant="secondary" onClick={() => onOpenChange(false)}>
        Close
      </Button>
    ) : tx.stage === "failed" || failure ? (
      <>
        <Button variant="ghost" onClick={() => onOpenChange(false)}>
          Close
        </Button>
        <Button
          variant="secondary"
          iconLeft="refresh"
          onClick={() => {
            tx.reset();
            setFailure(null);
            setStep("review");
          }}
        >
          Back to review
        </Button>
      </>
    ) : (
      <>
        {tx.txHash && sent ? (
          <Button variant="ghost" href={txHref(sent.chainId, tx.txHash)} iconRight="arrowUpRight">
            View transaction
          </Button>
        ) : null}
        <Button variant="primary" onClick={() => onOpenChange(false)}>
          Done
        </Button>
      </>
    );

  return (
    <Sheet open={open} onOpenChange={onOpenChange} title={title} description={description} footer={footer} width={440}>
      {step === "edit" ? (
        <div className="flex flex-col gap-4 pt-1">
          {form}
          {blocker ? (
            <p className="flex items-start gap-1.5 text-[12.5px] leading-snug text-fg-dim">
              <Icon name="info" size={14} className="mt-px shrink-0" />
              {blocker}
            </p>
          ) : null}
        </div>
      ) : step === "review" ? (
        <div className="flex flex-col gap-4 pt-1">
          <div className="rounded-[var(--d-radius-inner)] border border-[var(--d-hairline)] bg-[var(--d-card-2)] px-3.5 py-3">
            <KeyValueList divided items={[...reviewItems, feeItem, ...(memoView ? [txMemoItem(memoView)] : [])]} />
          </div>
          {reviewExtra}
          {feeEatsPayout && payout ? (
            <Callout tone="warning" title="The fee is more than it pays">
              The network fee ({feeQuote?.display} {payout.symbol}) is more than the {payout.what} (
              {mask(`${wholeText(payout.whole, { maxFraction: 6 })} ${payout.symbol}`)}). They keep accruing: claiming later costs the
              same fee for more.
            </Callout>
          ) : feeShare !== null && feeShare >= FEE_SHARE_NOTICE && payout ? (
            <Callout tone="neutral" title={`The fee takes ${shareText(feeShare)} of the ${payout.what}`}>
              They keep accruing, and claiming later costs the same fee for more.
            </Callout>
          ) : null}
          {accountMissing ? (
            <Callout tone="danger" title="This address cannot pay a fee yet">
              The network has never seen this address, so it holds nothing to pay the fee with. Receive some of the fee token first.
            </Callout>
          ) : null}
          {previewError ? (
            <Callout tone={previewError.retryable ? "warning" : "danger"} title={previewError.title}>
              {previewError.message}
              {previewError.detail ? (
                <Disclosure summary="Network's answer" className="mt-2">
                  <code className="block whitespace-pre-wrap break-words font-mono text-[11.5px] text-fg-dim">{previewError.detail}</code>
                </Disclosure>
              ) : null}
            </Callout>
          ) : null}
          {notices}
          <p className="flex items-start gap-1.5 text-[12px] leading-snug text-fg-dim">
            <Icon name="lock" size={13} className="mt-px shrink-0" />
            Nothing is sent until you approve it in {walletName}. Zunia never holds your keys.
          </p>
        </div>
      ) : (
        <Progress
          stage={tx.stage}
          lastBusy={failedStage(lastBusy, failure ?? tx.explained, tx.txHash)}
          failure={failure ?? tx.explained}
          walletName={walletName}
          walletKind={walletKind}
          successText={sent?.successText ?? successText}
          txHash={tx.txHash}
        />
      )}
    </Sheet>
  );
}

const STEP_ORDER: readonly SignStage[] = ["preparing", "awaiting-signature", "broadcasting", "confirming"];

/** "45%", "8.5%", "<1%": a share for a line of text. */
function shareText(fraction: number): string {
  const value = fraction * 100;
  if (value > 0 && value < 1) return "<1%";
  return `${value >= 10 ? Math.round(value) : Math.round(value * 10) / 10}%`;
}

function stepsFor(stage: SignStage, lastBusy: SignStage, walletName: string): Step[] {
  const labels: Array<{ label: string; description?: string }> = [
    { label: "Prepare", description: "Measure gas and read the account" },
    { label: `Approve in ${walletName}` },
    { label: "Send to the network" },
    { label: "Confirm in a block" },
  ];
  const current = stage === "failed" ? lastBusy : stage === "success" ? "done" : stage === "submitted" ? "confirming" : stage;
  const index = current === "done" ? STEP_ORDER.length : Math.max(0, STEP_ORDER.indexOf(current as SignStage));
  return labels.map((entry, i) => ({
    ...entry,
    state:
      i < index
        ? "done"
        : i === index
          ? stage === "failed"
            ? "error"
            : "current"
          : "todo",
  }));
}

function Progress({
  stage,
  lastBusy,
  failure,
  walletName,
  walletKind,
  successText,
  txHash,
}: {
  stage: SignStage;
  lastBusy: SignStage;
  failure: ExplainedTxError | null;
  walletName: string;
  walletKind: string | null;
  successText: string;
  txHash: string | null;
}) {
  const failed = stage === "failed" || failure !== null;
  const done = stage === "success";
  const submitted = stage === "submitted";
  const headline = failed
    ? (failure?.title ?? "Not sent")
    : done
      ? "Done"
      : submitted
        ? "Sent, waiting for a block"
        : stage === "awaiting-signature"
          ? walletKind === "zunia-mobile"
            ? "Approve on your phone"
            : `Approve in ${walletName}`
          : stage === "broadcasting"
            ? "Sending to the network"
            : stage === "confirming"
              ? "Waiting for a block"
              : "Preparing";
  const body = failed
    ? (failure?.message ?? "The transaction was not sent.")
    : done
      ? successText
      : submitted
        ? "The network accepted it, but it was not in a block within a minute. It may still land; Activity will show it."
        : stage === "awaiting-signature"
          ? "Check the amounts in the wallet prompt before approving. You can close this panel; you'll get a notification either way."
          : "This usually takes a few seconds.";
  return (
    <div className="flex flex-col gap-5 pt-1" aria-live="polite">
      <div className="flex items-start gap-3">
        <span
          className={cn(
            "flex size-10 shrink-0 items-center justify-center rounded-full",
            failed
              ? "bg-[var(--z-danger-fill)] text-[var(--z-danger)]"
              : done
                ? "bg-[var(--z-success-fill)] text-[var(--z-success)]"
                : "bg-[var(--d-accent-soft)] text-[var(--d-accent-text)]",
          )}
        >
          {failed ? (
            <Icon name="danger" size={20} />
          ) : done ? (
            <Icon name="success" size={20} />
          ) : submitted ? (
            <Icon name="clock" size={20} />
          ) : (
            <Spinner size={18} />
          )}
        </span>
        <div className="min-w-0 pt-0.5">
          <p className="text-[15px] font-medium leading-snug tracking-[-0.01em] text-fg">{headline}</p>
          <p className="mt-1 text-[13px] leading-[1.5] text-fg-muted">{body}</p>
        </div>
      </div>
      <Stepper orientation="vertical" steps={stepsFor(stage, lastBusy, walletName)} />
      {failure?.detail ? (
        <Disclosure summary="Details from the network">
          <code className="block whitespace-pre-wrap break-words font-mono text-[11.5px] text-fg-dim">{failure.detail}</code>
        </Disclosure>
      ) : null}
      {txHash ? (
        <p className="text-[12.5px] text-fg-dim">
          Transaction <span className="font-mono text-fg-muted">{shortenHash(txHash, 10, 6)}</span>
        </p>
      ) : null}
    </div>
  );
}
