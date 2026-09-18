"use client";

/**
 * The approval step for an NFT transfer.
 *
 * A CW721 transfer reaches the chain as a `MsgExecuteContract`: a contract
 * address and a base64 blob. Rendering that as "Execute contract" is not
 * informed consent — it does not distinguish moving token #42 from moving the
 * whole collection's approval rights, and the user has no way to tell.
 *
 * So every sentence here comes from `describeNftTransfer`, which decodes the
 * payload back out of the message that is about to be signed. This component
 * only renders that decode and enforces its verdict: `risk === "danger"`
 * disables the confirm button, always, including when the reason is simply that
 * the payload could not be fully accounted for. An unreadable execute body is
 * not "probably fine" — the contract acts on it before anyone sees the result.
 *
 * The decoded JSON is always available, verbatim, behind a disclosure, and for
 * a cross-chain transfer the base64 `IbcOutgoingMsg` inside it is shown decoded
 * too. Nesting base64 inside base64 is exactly where a payload hides.
 */

import { useState } from "react";
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
import type { NftAction, NftStatementTone } from "@/lib/nft/describe";

const TONE_CLASS: Record<NftStatementTone, string> = {
  neutral: "text-fg",
  info: "text-fg",
  warning: "text-[var(--z-warning)]",
  danger: "text-[var(--z-danger)]",
};

const TONE_MARK: Record<NftStatementTone, string> = {
  neutral: "·",
  info: "·",
  warning: "!",
  danger: "!",
};

export interface NftApprovalProps {
  readonly open: boolean;
  readonly onOpenChange: (open: boolean) => void;
  readonly title: string;
  readonly description: string;
  /** Fee, gas, chain — the facts that are not in the payload. */
  readonly rows: readonly { readonly label: string; readonly value: string }[];
  /**
   * The decoded action.
   *
   * `null` means the message could not be built at all; `buildError` then says
   * why and there is nothing to approve.
   */
  readonly action: NftAction | null;
  readonly buildError?: string | null;
  readonly busy?: boolean;
  readonly error?: string | null;
  readonly onConfirm: () => void;
  readonly confirmLabel?: string;
}

export function NftApproval({
  open,
  onOpenChange,
  title,
  description,
  rows,
  action,
  buildError,
  busy = false,
  error,
  onConfirm,
  confirmLabel = "Sign in wallet",
}: NftApprovalProps) {
  const [rawOpen, setRawOpen] = useState(false);

  const blocked = action === null || action.risk === "danger";
  const blockedReason =
    action === null
      ? (buildError ??
        "This transfer could not be built, so there is nothing to sign.")
      : action.risk === "danger"
        ? "This message cannot be signed from here. The line marked above says why."
        : null;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[calc(100vh-48px)] w-[min(460px,calc(100%-32px))] overflow-y-auto">
        <DialogTitle>{title}</DialogTitle>
        <DialogDescription>{description}</DialogDescription>

        <div className="mt-4 flex flex-col gap-4">
          <FeeSummary rows={rows.map((row) => ({ ...row }))} />

          <div className="flex flex-col gap-2">
            <SectionLabel>What this transaction does</SectionLabel>
            {action ? (
              <ul className="flex flex-col gap-2">
                {action.statements.map((statement) => (
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
                    <span className={`min-w-0 break-words ${TONE_CLASS[statement.tone]}`}>
                      {statement.text}
                    </span>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-[length:var(--z-type-meta)] leading-relaxed text-[var(--z-danger)]">
                {buildError ?? "The transfer message could not be built."}
              </p>
            )}
            {action && action.warnings.length > 0 ? (
              <ul className="mt-1 flex flex-col gap-1">
                {action.warnings.map((warning) => (
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

          {action ? (
            <div className="flex flex-col gap-2">
              <Button
                variant="ghost"
                size="sm"
                className="self-start"
                aria-expanded={rawOpen}
                aria-controls="nft-approval-raw"
                onClick={() => setRawOpen((value) => !value)}
              >
                {rawOpen ? "Hide" : "Show"} the contract call itself
              </Button>
              {rawOpen ? (
                <div id="nft-approval-raw" className="flex flex-col gap-2">
                  <pre className="max-h-40 overflow-auto rounded-[12px] bg-[var(--z-glass)] p-3 font-mono text-[length:var(--z-type-micro)] leading-relaxed whitespace-pre-wrap break-all text-fg-muted">
                    {action.rawJson || "(empty)"}
                  </pre>
                  {action.innerJson ? (
                    <>
                      <p className="font-mono text-[length:var(--z-type-micro)] uppercase tracking-wider text-fg-muted">
                        Decoded from the base64 msg above
                      </p>
                      <pre className="max-h-40 overflow-auto rounded-[12px] bg-[var(--z-glass)] p-3 font-mono text-[length:var(--z-type-micro)] leading-relaxed whitespace-pre-wrap break-all text-fg-muted">
                        {action.innerJson}
                      </pre>
                    </>
                  ) : null}
                </div>
              ) : null}
            </div>
          ) : null}

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
              {...(blocked ? { "aria-describedby": "nft-approval-blocked" } : {})}
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
            <p id="nft-approval-blocked" className="sr-only">
              {blockedReason}
            </p>
          ) : null}
        </div>
      </DialogContent>
    </Dialog>
  );
}
