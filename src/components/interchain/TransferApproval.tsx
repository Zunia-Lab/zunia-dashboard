"use client";

/**
 * The approval step, where the memo is explained in plain language.
 *
 * This dialog is a security control, not a summary card. The route — and with
 * it the memo — was planned by a route handler and arrived over the network, so
 * everything shown here is re-derived in the browser from the memo bytes with
 * the engine's own parser (`lib/interchain/memo-summary.ts`). Nothing the
 * planner said about its own memo is displayed.
 *
 * Three things follow from that:
 *
 * - A memo this build cannot fully account for disables the confirm button. An
 *   unreadable memo is not "probably fine": middleware acts on it before the
 *   funds reach anyone, so we cannot say where they end up.
 * - `on_failed_delivery: "do_nothing"` disables it too. That setting makes
 *   funds stranded by a failed payout unrecoverable, and no screen should let
 *   someone sign it by accident.
 * - The raw memo is always available, verbatim, for anyone who wants to read
 *   the JSON themselves.
 */

import { useMemo, useState } from "react";
import {
  Button,
  Callout,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
  FeeSummary,
  SectionLabel,
} from "@zunialab/ui";
import { explainMemo, type MemoTone } from "@/lib/interchain/memo-summary";

const TONE_CLASS: Record<MemoTone, string> = {
  neutral: "text-fg",
  info: "text-fg",
  warning: "text-[var(--z-warning)]",
  danger: "text-[var(--z-danger)]",
};

const TONE_MARK: Record<MemoTone, string> = {
  neutral: "·",
  info: "·",
  warning: "!",
  danger: "!",
};

export interface TransferApprovalProps {
  readonly open: boolean;
  readonly onOpenChange: (open: boolean) => void;
  readonly title: string;
  /** One-line description of the action, above the memo explanation. */
  readonly description: string;
  readonly rows: readonly { readonly label: string; readonly value: string }[];
  /** The memo exactly as it will be signed. */
  readonly memo: string;
  /** The ICS20 receiver of the transfer that carries the memo. */
  readonly receiver: string;
  readonly chainName?: (chainId: string) => string;
  readonly denomLabel?: (denom: string) => string;
  readonly venueChainId?: string;
  /**
   * A mismatch between the memo and what the form asked for, checked by the
   * caller with `memoMatchesIntent`. Blocks signing when present.
   */
  readonly intentMismatch?: string | null;
  readonly busy?: boolean;
  readonly error?: string | null;
  readonly onConfirm: () => void;
  readonly confirmLabel?: string;
}

export function TransferApproval({
  open,
  onOpenChange,
  title,
  description,
  rows,
  memo,
  receiver,
  chainName,
  denomLabel,
  venueChainId,
  intentMismatch,
  busy = false,
  error,
  onConfirm,
  confirmLabel = "Sign in wallet",
}: TransferApprovalProps) {
  const [rawOpen, setRawOpen] = useState(false);

  const explanation = useMemo(
    () =>
      explainMemo(memo, {
        receiver,
        ...(chainName ? { chainName } : {}),
        ...(denomLabel ? { denomLabel } : {}),
        ...(venueChainId ? { venueChainId } : {}),
      }),
    [memo, receiver, chainName, denomLabel, venueChainId],
  );

  const blocked = explanation.risk === "danger" || Boolean(intentMismatch);
  const blockedReason = intentMismatch
    ? intentMismatch
    : explanation.risk === "danger"
      ? "This memo cannot be signed from here. The line marked above says why."
      : null;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[calc(100vh-48px)] w-[min(460px,calc(100%-32px))] overflow-y-auto">
        <DialogTitle>{title}</DialogTitle>
        <DialogDescription>{description}</DialogDescription>

        <div className="mt-4 flex flex-col gap-4">
          <FeeSummary rows={rows.map((row) => ({ ...row }))} />

          <div className="flex flex-col gap-2">
            <SectionLabel>What the memo does</SectionLabel>
            <p className="text-[length:var(--z-type-meta)] font-medium text-fg">
              {explanation.headline}
            </p>
            <ul className="flex flex-col gap-2">
              {explanation.statements.map((statement) => (
                <li
                  key={statement.text}
                  className="flex gap-2 text-[length:var(--z-type-meta)] leading-relaxed"
                >
                  <span
                    aria-hidden
                    className={`shrink-0 font-mono ${TONE_CLASS[statement.tone]}`}
                  >
                    {TONE_MARK[statement.tone]}
                  </span>
                  <span className={TONE_CLASS[statement.tone]}>
                    {statement.text}
                  </span>
                </li>
              ))}
            </ul>
            {explanation.warnings.length > 0 ? (
              <ul className="mt-1 flex flex-col gap-1">
                {explanation.warnings.map((warning) => (
                  <li
                    key={warning}
                    className="font-mono text-[length:var(--z-type-micro)] leading-relaxed text-[var(--z-warning)]"
                  >
                    {warning}
                  </li>
                ))}
              </ul>
            ) : null}
          </div>

          <div className="flex flex-col gap-2">
            <Button
              variant="ghost"
              size="sm"
              className="self-start"
              aria-expanded={rawOpen}
              aria-controls="approval-raw-memo"
              onClick={() => setRawOpen((value) => !value)}
            >
              {rawOpen ? "Hide" : "Show"} the memo itself (
              {explanation.byteLength} bytes)
            </Button>
            {rawOpen ? (
              <pre
                id="approval-raw-memo"
                className="max-h-40 overflow-auto rounded-[12px] bg-[var(--z-glass)] p-3 font-mono text-[length:var(--z-type-micro)] leading-relaxed whitespace-pre-wrap break-all text-fg-muted"
              >
                {explanation.raw || "(no memo)"}
              </pre>
            ) : null}
          </div>

          {blockedReason ? (
            <Callout tone="danger" title="This cannot be signed">
              {blockedReason}
            </Callout>
          ) : null}

          {error ? (
            <Callout tone="danger" title="Could not send">
              {error}
            </Callout>
          ) : null}

          <div className="flex flex-col gap-2 sm:flex-row-reverse">
            <Button
              className="w-full sm:flex-1"
              onClick={onConfirm}
              disabled={busy || blocked}
              {...(blocked ? { "aria-describedby": "approval-blocked" } : {})}
            >
              {busy ? "Waiting for the wallet…" : confirmLabel}
            </Button>
            <Button
              variant="secondary"
              className="w-full sm:flex-1"
              onClick={() => onOpenChange(false)}
              disabled={busy}
            >
              Cancel
            </Button>
          </div>
          {blocked ? (
            <p id="approval-blocked" className="sr-only">
              {blockedReason}
            </p>
          ) : null}
        </div>
      </DialogContent>
    </Dialog>
  );
}
