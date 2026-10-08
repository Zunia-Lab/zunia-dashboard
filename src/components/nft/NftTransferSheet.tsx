"use client";

/**
 * Move one NFT: to another address on the same chain, or over ICS721.
 *
 *   form → review (decoded call, measured fee) → wallet → progress
 *
 * The two moves are different transactions and the form says so rather than
 * hiding the difference behind a destination picker. A same-chain move is a
 * CW721 `transfer_nft`: the recipient owns this token. A cross-chain move is a
 * `send_nft` to a cw-ics721 bridge, which escrows the token here and mints a
 * voucher there: a different token, in a different contract, that a
 * marketplace on the destination may not recognise. That sentence is on
 * screen before the review, not only in it.
 *
 * Cross-chain is offered only when this deployment configured both halves (a
 * bridge on this chain and a channel to the destination): ICS721 does not run
 * on the transfer port, so neither can be discovered, and a guessed bridge is
 * a contract the token is handed to and never comes back from.
 *
 * What is signed is what the review shows. `describeNftTransfer` decodes the
 * execute body back out of the built message; the review renders that decode
 * and the transaction is built from it (`buildExecuteContract`), and a
 * `danger` verdict (anything the decode cannot account for) blocks signing.
 * The fee is measured by simulating the exact call, which also catches a
 * transfer the contract would refuse before the wallet opens.
 */

import { useMemo, useState, type ReactNode } from "react";
import { checkAddress, type ChainInfoLike, type NftTransferRequest } from "@zunialab/interchain";
import { Icon } from "@/components/icons";
import { txMemoItem } from "@/components/TxMemoItem";
import {
  AddressText,
  Button,
  Callout,
  Disclosure,
  Input,
  KeyValueList,
  Segmented,
  Select,
  Sheet,
  Skeleton,
  Spinner,
  Stepper,
  TokenAmount,
  toast,
  type KeyValueItem,
  type Step,
} from "@/components/ui";
import { findChain, type ChainEntry } from "@/lib/chains";
import { cn } from "@/lib/cn";
import { useTxPreview } from "@/lib/data/wallet";
import { describeNftTransfer, type NftAction, type NftStatementTone } from "@/lib/nft/describe";
import type { NftConfigWire } from "@/lib/nft/wire";
import { explainError, TxError, type ExplainedTxError } from "@/lib/tx/errors";
import { describeTxMemo } from "@/lib/tx/memo";
import { buildExecuteContract } from "@/lib/tx/messages";
import type { SignRequest, SignStage } from "@/lib/tx/types";
import { useSignAndBroadcast } from "@/lib/tx/useSignAndBroadcast";
import { useWallet, walletKindLabel } from "@/providers/WalletProvider";

type Mode = "same" | "cross";
type FlowStep = "edit" | "review" | "progress";

export interface NftTransferTarget {
  tokenId: string;
  collectionAddress: string;
  collectionName: string | null;
  tokenName: string | null;
}

export interface NftSignedTransfer {
  txHash: string;
  chainId: string;
  tokenId: string;
  collectionAddress: string;
  destChainId: string | null;
  bridgeContract: string | null;
  recipient: string;
}

export interface NftTransferSheetProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  chain: ChainEntry;
  config: NftConfigWire;
  token: NftTransferTarget;
  /** The connected account's address on `chain`. */
  owner: string;
  /** Why this account may not move the token (the chain says someone else owns it), or null. */
  ownerMismatch: string | null;
  onSigned: (transfer: NftSignedTransfer) => void;
}

/**
 * Why a cross-chain move cannot be built here, in the reader's words. The
 * server's `ics721.reason` is written for the operator (it names the setting
 * to change and its syntax), so the sheet says it from the same facts: no
 * bridge, a bridge with no channel, or channels only to chains this build
 * cannot check a receiver on.
 */
function crossUnavailable(chainName: string, config: NftConfigWire["ics721"]): string {
  if (!config.bridgeContract) {
    return `Cross-chain NFT transfer is off on this deployment: it has no cw-ics721 bridge on ${chainName}. Zunia will not guess one: a token sent to the wrong contract is held by nothing and cannot be recalled.`;
  }
  if (config.destinations.length === 0) {
    return `This deployment has a cw-ics721 bridge on ${chainName} but no ICS721 channel to another network. ICS721 does not run on the transfer port, so Zunia cannot discover one.`;
  }
  return `The networks this deployment has an ICS721 channel to are not in this build's chain catalog, so a receiver there cannot be checked.`;
}

const STATEMENT_TONE: Record<NftStatementTone, string> = {
  neutral: "text-fg-muted",
  info: "text-fg-muted",
  warning: "text-[var(--z-warning)]",
  danger: "text-[var(--z-danger)]",
};

const BUSY: readonly SignStage[] = ["preparing", "awaiting-signature", "broadcasting", "confirming"];

export function NftTransferSheet({ open, onOpenChange, chain, config, token, owner, ownerMismatch, onSigned }: NftTransferSheetProps) {
  const { account, addressFor, walletKind } = useWallet();
  const tx = useSignAndBroadcast();
  const [step, setStep] = useState<FlowStep>("edit");
  const [mode, setMode] = useState<Mode>("same");
  const [recipient, setRecipient] = useState("");
  // Destinations the catalog carries: a chain with no entry has no prefix to
  // check the receiver against, and an unchecked receiver of an ICS721
  // transfer is a voucher minted to an address nobody controls.
  const destinations = useMemo(() => config.ics721.destinations.filter((row) => row.inCatalog), [config.ics721.destinations]);
  const [destChainId, setDestChainId] = useState<string>(() => destinations[0]?.chainId ?? "");
  const [failure, setFailure] = useState<ExplainedTxError | null>(null);
  const [lastBusy, setLastBusy] = useState<SignStage>("preparing");
  if (BUSY.includes(tx.stage) && tx.stage !== lastBusy) setLastBusy(tx.stage);

  const crossAvailable = destinations.length > 0 && Boolean(config.ics721.bridgeContract);
  const cross = mode === "cross" && crossAvailable;
  const destChain = cross ? findChain(destChainId) : undefined;
  const link = cross ? (destinations.find((row) => row.chainId === destChainId) ?? null) : null;
  const target: ChainEntry | undefined = cross ? destChain : chain;
  const trimmed = recipient.trim();
  const addressCheck = trimmed && target ? checkAddress(trimmed, target as ChainInfoLike) : null;
  const suggestion = target ? addressFor(target.chainId) : null;

  const request = useMemo<NftTransferRequest | null>(() => {
    if (!trimmed || !target) return null;
    if (addressCheck && !addressCheck.ok) return null;
    if (cross && (!link || !config.ics721.bridgeContract)) return null;
    return {
      chainId: chain.chainId,
      collectionAddress: token.collectionAddress,
      tokenId: token.tokenId,
      sender: owner,
      recipient: trimmed,
      ...(cross && link ? { destChainId: link.chainId, channelId: link.channelId, bridgeContract: config.ics721.bridgeContract ?? undefined } : {}),
    };
  }, [trimmed, target, addressCheck, cross, link, config.ics721.bridgeContract, chain.chainId, token.collectionAddress, token.tokenId, owner]);

  // Built and decoded once: the review renders this decode and the message
  // is built from it, so the bytes approved are the bytes signed.
  const decoded = useMemo(() => {
    if (!request) return null;
    return describeNftTransfer(chain as ChainInfoLike, request, {
      ...(destChain ? { destChain: destChain as ChainInfoLike } : {}),
      bridgeContract: config.ics721.bridgeContract,
      chainName: (id) => findChain(id)?.chainName ?? id,
      collectionName: token.collectionName,
      // Only when the server confirmed the chain answers wasm queries.
      allowUnknownFeatures: config.basis === "chain-probe",
    });
  }, [request, chain, destChain, config.ics721.bridgeContract, config.basis, token.collectionName]);
  const action: NftAction | null = decoded?.ok ? decoded.action : null;
  const buildError = decoded && !decoded.ok ? decoded.message : null;

  const signRequest = useMemo<SignRequest | null>(() => {
    if (!action || action.risk === "danger") return null;
    return {
      chainId: chain.chainId,
      messages: [
        buildExecuteContract({
          sender: action.sender,
          contract: action.contract,
          msg: action.executeMsg,
          summary: cross ? `Send NFT #${token.tokenId} over ICS721` : `Transfer NFT #${token.tokenId}`,
        }),
      ],
    };
  }, [action, chain.chainId, cross, token.tokenId]);

  const preview = useTxPreview(step === "review" ? signRequest : null);
  // The memo the transfer signs: Zunia's default for it ("Send NFT 42").
  const memoView = useMemo(() => (signRequest ? describeTxMemo(signRequest) : null), [signRequest]);

  const blockers: string[] = [];
  if (!account) blockers.push("Connect a wallet to move this token.");
  if (ownerMismatch) blockers.push(ownerMismatch);
  if (mode === "cross" && !crossAvailable) blockers.push(crossUnavailable(chain.chainName, config.ics721));
  if (cross && !destChainId) blockers.push("Choose a destination network.");
  if (cross && destChainId && !destChain) blockers.push(`${destChainId} is not in this build's chain catalog, so a receiver there cannot be checked.`);
  if (!trimmed) {
    blockers.push(cross ? `Enter the address that receives the voucher on ${destChain?.chainName ?? "the destination"}.` : "Enter the address that should receive this token.");
  }
  if (trimmed && !cross && trimmed === owner) blockers.push("That is this account's own address: the token is already there.");
  if (buildError) blockers.push(buildError);
  if (action?.risk === "danger") blockers.push("This call cannot be signed from here: the review below says why.");
  const fieldError = trimmed && addressCheck && !addressCheck.ok ? addressProblem(addressCheck, target?.chainName ?? "") : null;
  const canReview = blockers.length === 0 && fieldError === null && signRequest !== null;

  const tokenLabel = token.tokenName?.trim() || `#${token.tokenId}`;
  const walletName = walletKind ? walletKindLabel(walletKind) : "your wallet";
  const feeQuote = preview.preview?.fee ?? null;
  const previewError = preview.error;
  const accountMissing = preview.preview !== null && !preview.preview.accountExists;
  const canConfirm = signRequest !== null && !tx.busy && !preview.loading && !accountMissing && (previewError === null || previewError.retryable);

  const confirm = async () => {
    if (!signRequest || !action || action.risk === "danger") return;
    setFailure(null);
    setStep("progress");
    try {
      const result = await tx.run(signRequest);
      const transfer: NftSignedTransfer = {
        txHash: result.txHash,
        chainId: chain.chainId,
        tokenId: token.tokenId,
        collectionAddress: token.collectionAddress,
        destChainId: cross ? destChainId : null,
        bridgeContract: cross ? config.ics721.bridgeContract : null,
        recipient: trimmed,
      };
      if (result.confirmed === false) toast.info("Sent, waiting for a block", { description: "The network accepted it; it may still land." });
      else toast.success(cross ? `${tokenLabel} is on its way` : `${tokenLabel} transferred`);
      onSigned(transfer);
      onOpenChange(false);
    } catch (error) {
      const explained = error instanceof TxError ? error.explained : explainError(error);
      setFailure(explained);
      if (explained.kind === "user-rejected") toast.info("Cancelled in your wallet");
      else toast.error(explained.title, { description: explained.message });
    }
  };

  const rows: KeyValueItem[] = [
    { key: "token", label: "Token", value: `${tokenLabel} · id ${token.tokenId}` },
    { key: "collection", label: "Collection", value: token.collectionName?.trim() || <AddressText address={token.collectionAddress} head={12} tail={6} /> },
    { key: "from", label: "From", value: <AddressText address={owner} head={12} tail={6} /> },
    { key: "to", label: cross ? "Voucher goes to" : "New owner", value: trimmed ? <AddressText address={trimmed} head={12} tail={6} /> : "—" },
    { key: "on", label: "Network", value: cross ? `${chain.chainName} → ${destChain?.chainName ?? destChainId}` : chain.chainName },
    {
      key: "fee",
      label: "Network fee",
      info: "Measured by simulating this exact contract call, at the average gas price. Your wallet may let you change it.",
      value: feeQuote ? (
        feeQuote.amount.length === 0 ? "None" : <TokenAmount amount={feeQuote.display} symbol={feeQuote.symbol ?? feeQuote.denom} masked={false} />
      ) : preview.loading ? (
        <Skeleton className="inline-block h-3 w-20 align-middle" />
      ) : (
        <span className="text-fg-dim">Not measured</span>
      ),
      sub: preview.preview?.gas.estimate ? "Estimate" : undefined,
    },
    ...(memoView ? [txMemoItem(memoView)] : []),
  ];

  const footer =
    step === "edit" ? (
      <>
        <Button variant="ghost" onClick={() => onOpenChange(false)}>
          Cancel
        </Button>
        <Button variant="primary" disabled={!canReview} onClick={() => setStep("review")} iconRight="arrowRight">
          Review transfer
        </Button>
      </>
    ) : step === "review" ? (
      <>
        <Button variant="ghost" onClick={() => setStep("edit")} iconLeft="arrowLeft">
          Edit
        </Button>
        <Button variant="primary" disabled={!canConfirm} loading={preview.loading && !preview.preview} onClick={() => void confirm()}>
          Sign in {walletKind === "zunia-mobile" ? "your phone" : "wallet"}
        </Button>
      </>
    ) : tx.busy ? (
      <Button variant="secondary" onClick={() => onOpenChange(false)}>
        Close
      </Button>
    ) : (
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
    );

  return (
    <Sheet
      open={open}
      onOpenChange={onOpenChange}
      title={step === "review" ? (cross ? "Approve this cross-chain transfer" : "Approve this transfer") : `Move ${tokenLabel}`}
      description={
        step === "review"
          ? `One contract call on ${chain.chainName}. Everything below was decoded back out of the message that will be signed.`
          : `${token.collectionName?.trim() || "This collection"} on ${chain.chainName}. Signing happens in your wallet.`
      }
      footer={footer}
      width={460}
    >
      {step === "edit" ? (
        <div className="flex flex-col gap-4 pt-1">
          <Segmented<Mode>
            ariaLabel="Where to"
            fullWidth
            size="md"
            value={mode}
            onChange={setMode}
            // "To another chain" stays selectable when it is off: a disabled
            // option cannot explain itself, and the reason is the useful part.
            options={[
              { value: "same", label: `On ${chain.chainName}` },
              { value: "cross", label: "To another chain" },
            ]}
          />
          {mode === "cross" && !crossAvailable ? (
            <Callout tone="warning" title="Cross-chain transfer is unavailable">
              {crossUnavailable(chain.chainName, config.ics721)}
            </Callout>
          ) : null}
          {cross ? (
            <>
              <Callout tone="warning" title="The destination gets a voucher">
                {destChain?.chainName ?? "The destination"} does not receive this token. The bridge locks it on {chain.chainName} and mints a voucher NFT
                backed by it: a different token in a different contract. Sending the voucher back burns it and releases the original.
              </Callout>
              <Select
                label="Destination network"
                value={destChainId}
                onChange={setDestChainId}
                options={destinations.map((row) => ({ value: row.chainId, label: `${row.chainName} · ${row.channelId}` }))}
                hint="Only networks this deployment has an ICS721 channel to: ICS721 does not run on the transfer port, so channels cannot be discovered."
              />
            </>
          ) : null}
          <div className="flex flex-col gap-2">
            <Input
              label={cross ? "Receives the voucher" : "New owner"}
              placeholder={target ? `${target.bech32Prefix}1…` : "Address"}
              value={recipient}
              mono
              spellCheck={false}
              autoComplete="off"
              onChange={(event) => setRecipient(event.target.value)}
              error={fieldError ?? undefined}
              hint={!fieldError && addressCheck?.ok ? "Valid address for this network." : undefined}
            />
            {suggestion && suggestion !== trimmed && (cross || suggestion !== owner) ? (
              <Button variant="ghost" size="sm" className="-ml-2 self-start" onClick={() => setRecipient(suggestion)}>
                Use my own address on {target?.chainName ?? "this network"}
              </Button>
            ) : null}
          </div>
          {blockers.length > 0 && (trimmed || ownerMismatch || buildError) ? (
            <ul className="flex flex-col gap-1.5">
              {blockers.map((blocker) => (
                <li key={blocker} className="flex items-start gap-1.5 text-[12.5px] leading-snug text-fg-dim">
                  <Icon name="info" size={14} className="mt-px shrink-0" />
                  {blocker}
                </li>
              ))}
            </ul>
          ) : null}
          {action && action.risk === "danger" ? <Statements action={action} /> : null}
        </div>
      ) : step === "review" ? (
        <div className="flex flex-col gap-4 pt-1">
          <div className="rounded-[var(--d-radius-inner)] border border-[var(--d-hairline)] bg-[var(--d-card-2)] px-3.5 py-3">
            <KeyValueList divided items={rows} />
          </div>
          {action ? <Statements action={action} /> : null}
          {action ? (
            <Disclosure summary="The contract call itself">
              <pre className="d-scroll max-h-44 overflow-auto whitespace-pre-wrap break-all rounded-[8px] bg-[var(--d-glass)] p-2.5 font-mono text-[11px] leading-relaxed text-fg-muted">
                {action.rawJson || "(empty)"}
              </pre>
              {action.innerJson ? (
                <>
                  <p className="d-label mb-1 mt-3">Decoded from the base64 msg above</p>
                  <pre className="d-scroll max-h-44 overflow-auto whitespace-pre-wrap break-all rounded-[8px] bg-[var(--d-glass)] p-2.5 font-mono text-[11px] leading-relaxed text-fg-muted">
                    {action.innerJson}
                  </pre>
                </>
              ) : null}
            </Disclosure>
          ) : null}
          {accountMissing ? (
            <Callout tone="danger" title="This address cannot pay a fee yet">
              The network has never seen it, so it holds nothing to pay the fee with.
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
          <p className="flex items-start gap-1.5 text-[12px] leading-snug text-fg-dim">
            <Icon name="lock" size={13} className="mt-px shrink-0" />
            Nothing is sent until you approve it in {walletName}. Zunia never holds your keys.
          </p>
        </div>
      ) : (
        <Progress stage={tx.stage} lastBusy={lastBusy} failure={failure ?? tx.explained} walletName={walletName} txHash={tx.txHash} />
      )}
    </Sheet>
  );
}

/** What the decoded call does, line by line, tones from the decoder; warnings after. */
function Statements({ action }: { action: NftAction }) {
  return (
    <div className="flex flex-col gap-2">
      <p className="d-label">What this transaction does</p>
      <ul className="flex flex-col gap-1.5">
        {action.statements.map((statement) => (
          <li key={statement.text} className={cn("flex gap-2 text-[13px] leading-snug", STATEMENT_TONE[statement.tone])}>
            <span aria-hidden className="mt-[7px] size-1 shrink-0 rounded-full bg-current" />
            <span className="min-w-0 break-words">{statement.text}</span>
          </li>
        ))}
      </ul>
      {action.warnings.length > 0 ? (
        <ul className="flex flex-col gap-1">
          {action.warnings.map((warning) => (
            <li key={warning} className="text-[12.5px] leading-snug text-[var(--z-warning)]">
              {warning}
            </li>
          ))}
        </ul>
      ) : null}
      {action.risk === "danger" ? (
        <Callout tone="danger" title="This cannot be signed">
          The line marked above says why. A call Zunia cannot fully account for is never signed from here.
        </Callout>
      ) : null}
    </div>
  );
}

const STEP_ORDER: readonly SignStage[] = ["preparing", "awaiting-signature", "broadcasting", "confirming"];

function Progress({
  stage,
  lastBusy,
  failure,
  walletName,
  txHash,
}: {
  stage: SignStage;
  lastBusy: SignStage;
  failure: ExplainedTxError | null;
  walletName: string;
  txHash: string | null;
}) {
  const failed = stage === "failed" || failure !== null;
  const current = failed ? lastBusy : stage;
  const index = Math.max(0, STEP_ORDER.indexOf(current));
  const labels = ["Prepare", `Approve in ${walletName}`, "Send to the network", "Confirm in a block"];
  const steps: Step[] = labels.map((label, i) => ({
    label,
    state: i < index ? "done" : i === index ? (failed ? "error" : "current") : "todo",
  }));
  const headline: ReactNode = failed
    ? (failure?.title ?? "Not sent")
    : stage === "awaiting-signature"
      ? `Approve in ${walletName}`
      : stage === "broadcasting"
        ? "Sending to the network"
        : stage === "confirming"
          ? "Waiting for a block"
          : "Preparing";
  return (
    <div className="flex flex-col gap-5 pt-1" aria-live="polite">
      <div className="flex items-start gap-3">
        <span
          className={cn(
            "flex size-10 shrink-0 items-center justify-center rounded-full",
            failed ? "bg-[var(--z-danger-fill)] text-[var(--z-danger)]" : "bg-[var(--d-accent-soft)] text-[var(--d-accent-text)]",
          )}
        >
          {failed ? <Icon name="danger" size={20} /> : <Spinner size={18} />}
        </span>
        <div className="min-w-0 pt-0.5">
          <p className="text-[15px] font-medium leading-snug tracking-[-0.01em] text-fg">{headline}</p>
          <p className="mt-1 text-[13px] leading-[1.5] text-fg-muted">
            {failed
              ? (failure?.message ?? "The transaction was not sent. The token is still yours.")
              : stage === "awaiting-signature"
                ? "Check the call in the wallet prompt before approving. The token moves only if you approve."
                : "This usually takes a few seconds."}
          </p>
        </div>
      </div>
      <Stepper orientation="vertical" steps={steps} />
      {failure?.detail ? (
        <Disclosure summary="Details from the network">
          <code className="block whitespace-pre-wrap break-words font-mono text-[11.5px] text-fg-dim">{failure.detail}</code>
        </Disclosure>
      ) : null}
      {txHash ? (
        <p className="text-[12.5px] text-fg-dim">
          Transaction <span className="font-mono text-fg-muted">{txHash.slice(0, 10)}…{txHash.slice(-6)}</span>
        </p>
      ) : null}
    </div>
  );
}

/** One sentence per way an address can be wrong, naming the chain it is wrong for. */
function addressProblem(check: ReturnType<typeof checkAddress>, chainName: string): string {
  switch (check.problem) {
    case "empty":
      return "Enter an address.";
    case "malformed":
      return "That is not a bech32 address.";
    case "bad-checksum":
      return "That address fails its own checksum: a character is wrong.";
    case "wrong-prefix":
      return `That is a “${check.prefix}” address; ${chainName || "this network"} uses “${check.expectedPrefix}”. A token sent to an address on the wrong chain cannot be recovered.`;
    default:
      return "That address cannot be used.";
  }
}
