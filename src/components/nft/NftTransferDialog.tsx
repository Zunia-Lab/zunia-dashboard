"use client";

/**
 * Move one NFT: to another address on the same chain, or over ICS721.
 *
 * The two are genuinely different transactions and the form says so rather than
 * hiding the difference behind a destination picker. A same-chain transfer is a
 * CW721 `transfer_nft` and the recipient ends up owning this token. A
 * cross-chain transfer is a `send_nft` handing the token to a bridge contract,
 * which escrows it here and has a *voucher* minted over there — a different
 * token, in a different contract, that a marketplace on the destination may not
 * recognise. That sentence is on screen before the review dialog opens, not
 * only inside it.
 *
 * Cross-chain is offered only when this deployment configured both halves: a
 * cw-ics721 bridge on this chain and a channel to the destination. Neither can
 * be discovered — ICS721 does not use the `transfer` port, so the engine's
 * channel discovery cannot see it, and a guessed bridge address is a contract
 * the token is handed to and never comes back from. Missing either one leaves
 * the control disabled with the key that would fix it.
 */

import { useMemo, useState } from "react";
import {
  Button,
  Callout,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
  SectionLabel,
  Segmented,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
} from "@zunialab/ui";
import { checkAddress, type ChainInfoLike, type NftTransferRequest } from "@zunialab/interchain";
import { NftApproval } from "@/components/nft/NftApproval";
import { RecipientAddressField } from "@/components/RecipientAddressField";
import { reencodeAddress } from "@/lib/address";
import { findChain, type ChainEntry } from "@/lib/chains";
import { formatToken } from "@/lib/interchain/amounts";
import { describeNftTransfer, type NftAction } from "@/lib/nft/describe";
import type { NftConfigWire } from "@/lib/nft/wire";
import { msgExecuteContract } from "@/lib/tx/amino-tx";
import { resolveSignAmino } from "@/lib/tx/resolve-sign";
import { feeForChain, signAminoAndBroadcast } from "@/lib/tx/sign-broadcast";
import { useWallet } from "@/providers/WalletProvider";

/**
 * Gas limits.
 *
 * Fixed, not simulated: this app has no simulate path wired, and the swap
 * screen makes the same trade. A CW721 `transfer_nft` is a couple of storage
 * writes; a `send_nft` to cw-ics721 additionally builds and sends an IBC
 * packet, which is why the second number is larger.
 */
const TRANSFER_GAS_LIMIT = 300_000;
const ICS721_GAS_LIMIT = 550_000;

type Mode = "same" | "cross";

export interface NftTransferTarget {
  readonly tokenId: string;
  readonly collectionAddress: string;
  readonly collectionName: string | null;
  readonly tokenName: string | null;
}

export interface NftSignedTransfer {
  readonly txHash: string;
  readonly chainId: string;
  readonly tokenId: string;
  readonly collectionAddress: string;
  readonly destChainId: string | null;
  readonly bridgeContract: string | null;
  readonly recipient: string;
}

export interface NftTransferDialogProps {
  readonly open: boolean;
  readonly onOpenChange: (open: boolean) => void;
  readonly chain: ChainEntry;
  readonly config: NftConfigWire;
  readonly token: NftTransferTarget;
  /** The connected account's address on `chain`. */
  readonly owner: string;
  /** Whether the chain still says this account owns it. */
  readonly ownerMismatch?: string | null;
  readonly onSigned: (transfer: NftSignedTransfer) => void;
}

export function NftTransferDialog({
  open,
  onOpenChange,
  chain,
  config,
  token,
  owner,
  ownerMismatch,
  onSigned,
}: NftTransferDialogProps) {
  const { account, session } = useWallet();
  const [mode, setMode] = useState<Mode>("same");
  const [recipient, setRecipient] = useState("");
  // Seeded from the destinations that are actually usable — a configured
  // channel to a chain this build has no catalog row for cannot be addressed,
  // and defaulting to one would open the form already blocked.
  const [destChainId, setDestChainId] = useState<string>(
    () =>
      config.ics721.destinations.find((row) => row.inCatalog)?.chainId ?? "",
  );
  const [reviewOpen, setReviewOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Only destinations the catalog carries: a chain with no entry has no bech32
  // prefix to check the receiver against, and an unchecked receiver on an
  // ICS721 transfer is a voucher minted to an address nobody controls.
  const destinations = useMemo(
    () => config.ics721.destinations.filter((row) => row.inCatalog),
    [config.ics721.destinations],
  );
  const crossAvailable = destinations.length > 0;
  const cross = mode === "cross" && crossAvailable;

  const destChain = cross ? findChain(destChainId) : undefined;
  const link = useMemo(
    () =>
      cross
        ? (destinations.find((row) => row.chainId === destChainId) ?? null)
        : null,
    [cross, destinations, destChainId],
  );
  const targetChain: ChainEntry | undefined = cross ? destChain : chain;

  const trimmed = recipient.trim();
  const addressCheck = useMemo(() => {
    if (!trimmed || !targetChain) return null;
    return checkAddress(trimmed, targetChain as ChainInfoLike);
  }, [trimmed, targetChain]);

  const suggestion = useMemo(() => {
    if (!account || !targetChain) return null;
    const accountChain = findChain(account.chainId);
    if (!accountChain) return null;
    if (accountChain.chainId === targetChain.chainId) return account.address;
    return reencodeAddress(account.address, targetChain, accountChain);
  }, [account, targetChain]);

  const request = useMemo<NftTransferRequest | null>(() => {
    if (!trimmed || !targetChain) return null;
    if (addressCheck !== null && !addressCheck.ok) return null;
    if (cross && (!link || !config.ics721.bridgeContract)) return null;
    return {
      chainId: chain.chainId,
      collectionAddress: token.collectionAddress,
      tokenId: token.tokenId,
      sender: owner,
      recipient: trimmed,
      ...(cross && link
        ? {
            destChainId: link.chainId,
            channelId: link.channelId,
            bridgeContract: config.ics721.bridgeContract ?? undefined,
          }
        : {}),
    };
  }, [
    trimmed,
    targetChain,
    addressCheck,
    cross,
    link,
    config.ics721.bridgeContract,
    chain.chainId,
    token.collectionAddress,
    token.tokenId,
    owner,
  ]);

  /**
   * Build and decode once.
   *
   * The dialog renders this and `onConfirm` signs `action.executeMsg`, so the
   * bytes the user approved are the bytes that reach the wallet. Recomputing in
   * the confirm handler would open a gap between the two.
   */
  const decoded = useMemo(() => {
    if (!request) return null;
    return describeNftTransfer(chain as ChainInfoLike, request, {
      ...(destChain ? { destChain: destChain as ChainInfoLike } : {}),
      bridgeContract: config.ics721.bridgeContract,
      chainName: (id) => findChain(id)?.chainName ?? id,
      collectionName: token.collectionName,
      // Only ever true when the server confirmed the chain answers wasm
      // queries. See `DescribeOptions.allowUnknownFeatures`.
      allowUnknownFeatures: config.basis === "chain-probe",
    });
  }, [
    request,
    chain,
    destChain,
    config.ics721.bridgeContract,
    config.basis,
    token.collectionName,
  ]);

  const action: NftAction | null = decoded?.ok ? decoded.action : null;
  const buildError = decoded && !decoded.ok ? decoded.message : null;

  const gasLimit = cross ? ICS721_GAS_LIMIT : TRANSFER_GAS_LIMIT;
  const fee = feeForChain(chain.chainId, gasLimit);
  const feeCoin = fee.amount[0];
  const feeLabel = feeCoin
    ? formatToken(feeCoin.amount, chain.feeDecimals, chain.feeDenom, 6)
    : null;

  /** Everything that must hold before the wallet is asked to do anything. */
  const blockers = useMemo(() => {
    const list: string[] = [];
    if (!account) list.push("Connect a wallet to move this token.");
    if (ownerMismatch) list.push(ownerMismatch);
    if (mode === "cross" && !crossAvailable) {
      list.push(
        config.ics721.reason ??
          "Cross-chain NFT transfer is not configured for this deployment.",
      );
    }
    if (cross && !destChainId) list.push("Choose a destination network.");
    if (cross && destChainId && !destChain) {
      list.push(
        `${destChainId} is not in this build's chain catalog, so a receiver address on it cannot be checked.`,
      );
    }
    if (!trimmed) {
      list.push(
        cross
          ? `Enter the address that should receive the voucher on ${destChain?.chainName ?? "the destination"}.`
          : "Enter the address that should receive this token.",
      );
    } else if (addressCheck && !addressCheck.ok) {
      list.push(addressProblem(addressCheck, targetChain?.chainName ?? ""));
    }
    if (trimmed && !cross && trimmed === owner) {
      list.push("That is this account's own address; the token is already there.");
    }
    if (buildError) list.push(buildError);
    return list;
  }, [
    account,
    ownerMismatch,
    mode,
    crossAvailable,
    config.ics721.reason,
    cross,
    destChainId,
    destChain,
    trimmed,
    addressCheck,
    targetChain,
    owner,
    buildError,
  ]);

  async function onConfirm() {
    if (!account || !action) return;
    // The verdict is re-read here, not trusted from the render that opened the
    // dialog: a danger decode must not become signable because state moved.
    if (action.risk === "danger") return;
    setBusy(true);
    setError(null);
    try {
      const signAmino = await resolveSignAmino({
        account,
        session,
        signingChainId: chain.chainId,
      });
      const result = await signAminoAndBroadcast({
        chainId: chain.chainId,
        signer: owner,
        gasLimit,
        signAmino,
        msgs: [
          msgExecuteContract({
            sender: action.sender,
            contract: action.contract,
            // The decoded body, so the signature covers the JSON the approval
            // dialog rendered.
            msg: action.executeMsg,
          }),
        ],
      });
      setReviewOpen(false);
      onOpenChange(false);
      onSigned({
        txHash: result.txhash,
        chainId: chain.chainId,
        tokenId: token.tokenId,
        collectionAddress: token.collectionAddress,
        destChainId: cross ? destChainId : null,
        bridgeContract: cross ? config.ics721.bridgeContract : null,
        recipient: trimmed,
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  const tokenLabel = token.tokenName?.trim() || `#${token.tokenId}`;

  return (
    <>
      {/*
        One dialog at a time. Stacking the approval on top of the form leaves
        two focus traps and two Escape handlers competing, and the question the
        approval asks deserves the whole screen. Cancelling it comes back here.
      */}
      <Dialog open={open && !reviewOpen} onOpenChange={onOpenChange}>
        <DialogContent className="max-h-[calc(100vh-48px)] w-[min(460px,calc(100%-32px))] overflow-y-auto">
          <DialogTitle>Move {tokenLabel}</DialogTitle>
          <DialogDescription>
            {token.collectionName?.trim() || token.collectionAddress} on{" "}
            {chain.chainName}. Signing happens in your wallet.
          </DialogDescription>

          <div className="mt-4 flex flex-col gap-4">
            <Segmented<Mode>
              size="sm"
              className="w-full"
              value={mode}
              onChange={setMode}
              // "To another chain" stays selectable even when it is off. A
              // disabled tab cannot be clicked, so it cannot explain itself,
              // and the reason is the useful part: selecting it shows the
              // callout naming the missing configuration key.
              options={[
                { value: "same", label: `On ${chain.chainName}` },
                { value: "cross", label: "To another chain" },
              ]}
            />

            {mode === "cross" && !crossAvailable ? (
              <Callout tone="warning" title="Cross-chain transfer is unavailable">
                {config.ics721.reason ??
                  "No cw-ics721 bridge and channel are configured for this chain."}
              </Callout>
            ) : null}

            {cross ? (
              <>
                <Callout tone="warning" title="The destination gets a voucher">
                  {destChain?.chainName ?? "The destination chain"} does not
                  receive this token. The bridge locks it on {chain.chainName}{" "}
                  and mints a voucher NFT backed by it. The voucher is a
                  different token in a different contract; sending it back burns
                  it and releases the original.
                </Callout>
                <div className="flex flex-col gap-2">
                  <SectionLabel>Destination network</SectionLabel>
                  <Select value={destChainId} onValueChange={setDestChainId}>
                    <SelectTrigger
                      aria-label="Destination network"
                      className="w-full"
                    >
                      <span className="min-w-0 truncate">
                        {destChain?.chainName ??
                          destChainId ??
                          "Choose a network"}
                      </span>
                    </SelectTrigger>
                    <SelectContent>
                      {destinations.map((row) => (
                        <SelectItem key={row.chainId} value={row.chainId}>
                          {row.chainName} · {row.channelId}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <p className="font-mono text-[length:var(--z-type-micro)] leading-relaxed text-fg-dim">
                    Only networks this deployment has configured an ICS721
                    channel to are listed. ICS721 does not run on the transfer
                    port, so Zunia cannot discover these — they are set with{" "}
                    <code>{config.configKeys.channels}</code>.
                  </p>
                </div>
              </>
            ) : null}

            <div className="flex flex-col gap-2">
              <SectionLabel>
                {cross ? "Receives the voucher" : "New owner"}
              </SectionLabel>
              <RecipientAddressField
                value={recipient}
                onChange={setRecipient}
                {...(targetChain ? { expectedPrefix: targetChain.bech32Prefix } : {})}
                state={
                  !trimmed
                    ? "default"
                    : addressCheck?.ok
                      ? "valid"
                      : "error"
                }
                {...(trimmed && addressCheck && !addressCheck.ok
                  ? { hint: addressProblem(addressCheck, targetChain?.chainName ?? "") }
                  : {})}
              />
              {suggestion && suggestion !== trimmed ? (
                <Button
                  variant="ghost"
                  size="sm"
                  className="self-start"
                  onClick={() => setRecipient(suggestion)}
                >
                  Use my own address on {targetChain?.chainName ?? "this network"}
                </Button>
              ) : null}
            </div>

            <div className="flex flex-col gap-2">
              <Button
                className="w-full"
                disabled={blockers.length > 0}
                onClick={() => {
                  setError(null);
                  setReviewOpen(true);
                }}
                {...(blockers.length > 0
                  ? { "aria-describedby": "nft-transfer-blocked" }
                  : {})}
              >
                Review transfer
              </Button>
              {blockers.length > 0 ? (
                <ul id="nft-transfer-blocked" className="flex flex-col gap-1">
                  {blockers.map((blocker) => (
                    <li
                      key={blocker}
                      className="font-mono text-[length:var(--z-type-micro)] leading-relaxed text-fg-dim"
                    >
                      {blocker}
                    </li>
                  ))}
                </ul>
              ) : null}
            </div>
          </div>
        </DialogContent>
      </Dialog>

      <NftApproval
        open={reviewOpen}
        onOpenChange={setReviewOpen}
        title={cross ? "Approve this cross-chain transfer" : "Approve this transfer"}
        description={`One contract call on ${chain.chainName}. Everything below was decoded back out of the message that will be signed.`}
        rows={[
          { label: "Token", value: `${tokenLabel} · id ${token.tokenId}` },
          {
            label: "Collection",
            value: token.collectionName?.trim() || token.collectionAddress,
          },
          { label: "From", value: owner },
          {
            label: cross ? "Voucher goes to" : "New owner",
            value: trimmed || "—",
          },
          {
            label: "On",
            value: cross
              ? `${chain.chainName} → ${destChain?.chainName ?? destChainId}`
              : chain.chainName,
          },
          { label: "Network fee", value: feeLabel ?? "—" },
          { label: "Gas", value: fee.gas },
        ]}
        action={action}
        buildError={buildError}
        busy={busy}
        error={error}
        onConfirm={() => void onConfirm()}
      />
    </>
  );
}

/** One sentence per way an address can be wrong, naming the chain it is wrong for. */
function addressProblem(
  check: ReturnType<typeof checkAddress>,
  chainName: string,
): string {
  switch (check.problem) {
    case "empty":
      return "Enter an address.";
    case "malformed":
      return "That is not a bech32 address.";
    case "bad-checksum":
      return "That address fails its own checksum, so a character is wrong. It is not accepted.";
    case "wrong-prefix":
      return `That is a "${check.prefix}" address; ${chainName || "this network"} uses "${check.expectedPrefix}". A token sent to a valid address on the wrong chain cannot be recovered.`;
    default:
      return "That address cannot be used.";
  }
}
