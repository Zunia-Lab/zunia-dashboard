"use client";

/**
 * Send on one chain, or across chains over IBC.
 *
 * Cross-send used to walk its own channel list and sign a single-hop
 * `MsgTransfer` on whatever channel id was in the box. It now plans through
 * `@zunialab/interchain`, which means three things it could not do before:
 *
 * - a wrapped token is sent back along its own trace rather than wrapped again,
 *   so it arrives as itself instead of as a double-wrapped hash no UI can name;
 * - chains with no direct channel are reachable, via a packet-forward memo;
 * - what actually happens to the funds is described from the memo bytes before
 *   the user signs, because a `forward` memo moves them somewhere the "To"
 *   field does not mention.
 *
 * The channel field is still here, and still takes anything the user types.
 * Discovery fails routinely on chains with slow or incomplete public endpoints,
 * and a wallet that cannot be told the channel is a wallet that cannot send.
 * What it does not do is accept the value quietly: a manual channel is checked
 * on both chains and marked unverified in the route.
 */

import { useMemo, useState } from "react";
import {
  Button,
  Callout,
  Card,
  Input,
  RoutePreview,
  SectionLabel,
  Segmented,
  TokenLogo,
} from "@zunialab/ui";
import { DashboardShell } from "@/components/DashboardShell";
import { ChainSelect } from "@/components/ChainSelect";
import { RecipientAddressField } from "@/components/RecipientAddressField";
import {
  ChannelOverrides,
  type ChannelLeg,
} from "@/components/interchain/ChannelOverrides";
import { TransferApproval } from "@/components/interchain/TransferApproval";
import { TransferProgress } from "@/components/interchain/TransferProgress";
import { findChain } from "@/lib/chains";
import {
  formatToken,
  isPositiveAmount,
  toBaseUnits,
} from "@/lib/interchain/amounts";
import type { HopOverrideInput } from "@/lib/interchain/client";
import { routePreviewHops } from "@/lib/interchain/route-view";
import { usePlan, useTxStatus } from "@/lib/interchain/hooks";
import type { RoutePlanWire } from "@/lib/interchain/wire";
import {
  defaultIbcTimeoutNs,
  msgIbcTransfer,
  msgSend,
} from "@/lib/tx/amino-tx";
import { feeForChain, signAminoAndBroadcast } from "@/lib/tx/sign-broadcast";
import { resolveSignAmino } from "@/lib/tx/resolve-sign";
import { useChainScope } from "@/lib/useChainScope";
import { useWallet } from "@/providers/WalletProvider";

type Mode = "send" | "cross";

interface SentTransfer {
  readonly txHash: string;
  readonly chainId: string;
  readonly amount: string;
  /** Null for a same-chain send, which has no packet to follow. */
  readonly plan: RoutePlanWire | null;
}

export default function SendPage() {
  const { selectedChainId, scopedChainIds, followedAll } = useChainScope();
  const { account, session } = useWallet();
  const [mode, setMode] = useState<Mode>("send");
  const networkOptions =
    scopedChainIds.length > 0 ? scopedChainIds : followedAll;
  const fallback = networkOptions[0] ?? "safrochain-1";
  const [fromChain, setFromChain] = useState(selectedChainId ?? fallback);
  const [toChain, setToChain] = useState(
    () =>
      networkOptions.find((id) => id !== (selectedChainId ?? fallback)) ??
      networkOptions[1] ??
      "osmosis-1",
  );
  const [recipient, setRecipient] = useState("");
  const [amount, setAmount] = useState("");
  const [overrides, setOverrides] = useState<Record<string, HopOverrideInput>>({});
  const [reviewOpen, setReviewOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sent, setSent] = useState<SentTransfer | null>(null);

  const from = findChain(fromChain);
  const to = findChain(toChain);
  const cross = mode === "cross";

  const [lastScoped, setLastScoped] = useState(selectedChainId);
  if (selectedChainId !== lastScoped) {
    setLastScoped(selectedChainId);
    if (selectedChainId) setFromChain(selectedChainId);
  }

  const decimals = from?.coinDecimals ?? 6;
  const amountBase = toBaseUnits(amount, decimals);
  const trimmedRecipient = recipient.trim();

  const planInput = useMemo(() => {
    if (!cross || !account || !from || !amountBase) return null;
    if (!isPositiveAmount(amountBase) || !trimmedRecipient) return null;
    if (fromChain === toChain) return null;
    return {
      sourceChainId: fromChain,
      destChainId: toChain,
      inputDenom: from.coinMinimalDenom,
      amount: amountBase,
      sender: account.address,
      recipient: trimmedRecipient,
      // A plain transfer, never a swap: the swap path is its own screen with
      // its own quote, slippage and recovery address.
      allowSwap: false,
      overrides: Object.values(overrides),
    };
  }, [
    cross,
    account,
    from,
    amountBase,
    trimmedRecipient,
    fromChain,
    toChain,
    overrides,
  ]);

  const plan = usePlan(planInput);
  const candidate = plan.data?.candidates[0] ?? null;

  const gasLimit = cross ? (candidate?.plan.requiresPfm ? 300_000 : 250_000) : 200_000;
  const fee = feeForChain(fromChain, gasLimit);
  const feeCoin = fee.amount[0];
  const feeLabel = feeCoin
    ? formatToken(feeCoin.amount, from?.feeDecimals ?? 6, from?.feeDenom ?? "", 6)
    : null;

  const channelLegs = useMemo<ChannelLeg[]>(() => {
    if (!cross) return [];
    const legs = new Map<string, ChannelLeg>();
    for (const link of candidate?.links ?? []) {
      const key = `${link.sourceChainId}>${link.destChainId}`;
      legs.set(key, {
        key,
        fromChainId: link.sourceChainId,
        toChainId: link.destChainId,
        currentChannelId: link.channelId,
      });
    }
    for (const failure of plan.data?.discoveryFailures ?? []) {
      const key = `${failure.fromChainId}>${failure.toChainId}`;
      legs.set(key, {
        key,
        fromChainId: failure.fromChainId,
        toChainId: failure.toChainId,
        note: failure.message,
      });
    }
    if (legs.size === 0 && fromChain !== toChain) {
      // Nothing planned yet. Offer the direct leg so the user can type a
      // channel before the planner has anything to show.
      legs.set(`${fromChain}>${toChain}`, {
        key: `${fromChain}>${toChain}`,
        fromChainId: fromChain,
        toChainId: toChain,
      });
    }
    return [...legs.values()];
  }, [cross, candidate, plan.data?.discoveryFailures, fromChain, toChain]);

  const routeHops = useMemo(
    () =>
      candidate
        ? routePreviewHops(candidate.plan.hops, candidate.links)
        : [],
    [candidate],
  );

  /** One specific sentence for why the button cannot be pressed. */
  const blocked = useMemo(() => {
    if (!account) return "Connect a wallet to send.";
    if (!from) return `${fromChain} is not in this build's chain catalog.`;
    if (!amount.trim()) return "Enter an amount.";
    if (amountBase === null) {
      return `Enter an amount with at most ${decimals} decimal places.`;
    }
    if (!isPositiveAmount(amountBase)) return "Enter an amount greater than zero.";
    if (!trimmedRecipient) return "Enter a recipient address.";
    if (!cross) return null;
    if (fromChain === toChain) {
      return "Pick a different destination network, or switch to Send.";
    }
    if (plan.status === "error") {
      return plan.error?.message ?? "The route could not be planned.";
    }
    if (plan.loading) return "Planning the route…";
    if (!candidate) {
      return (
        plan.data?.warnings[0] ??
        `No open channel path from ${from.chainName} to ${to?.chainName ?? toChain} was found. Enter a channel id to continue.`
      );
    }
    return null;
  }, [
    account,
    from,
    fromChain,
    amount,
    amountBase,
    decimals,
    trimmedRecipient,
    cross,
    toChain,
    to,
    plan,
    candidate,
  ]);

  async function onConfirm() {
    if (!from || !account || !amountBase) return;
    setBusy(true);
    setError(null);
    try {
      const signAmino = await resolveSignAmino({ account, session });
      const coin = { denom: from.coinMinimalDenom, amount: amountBase };
      if (cross) {
        const hop = candidate?.plan.hops[0];
        if (!candidate || !hop) throw new Error("No route to sign.");
        const result = await signAminoAndBroadcast({
          chainId: fromChain,
          signer: account.address,
          gasLimit,
          signAmino,
          msgs: [
            msgIbcTransfer({
              sourcePort: hop.port,
              sourceChannel: hop.channelId,
              token: coin,
              sender: account.address,
              // From the plan: on a forwarded route this is the intermediate
              // chain's address, not the final recipient, and the approval
              // dialog says so from the memo itself.
              receiver: candidate.receiver,
              timeoutTimestamp: defaultIbcTimeoutNs(15),
              ...(candidate.plan.memo ? { memo: candidate.plan.memo } : {}),
            }),
          ],
        });
        setSent({
          txHash: result.txhash,
          chainId: fromChain,
          amount: amountBase,
          plan: candidate.plan,
        });
      } else {
        const result = await signAminoAndBroadcast({
          chainId: fromChain,
          signer: account.address,
          gasLimit,
          signAmino,
          msgs: [
            msgSend({
              fromAddress: account.address,
              toAddress: trimmedRecipient,
              amount: [coin],
            }),
          ],
        });
        setSent({
          txHash: result.txhash,
          chainId: fromChain,
          amount: amountBase,
          plan: null,
        });
      }
      setReviewOpen(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  if (sent) {
    return (
      <DashboardShell
        title={sent.plan ? "Transfer sent" : "Send broadcast"}
        description="Signed and broadcast. What follows is read from the chain."
      >
        <div className="mx-auto flex w-full max-w-xl flex-col gap-4">
          <Card>
            {sent.plan ? (
              <TransferProgress
                plan={sent.plan}
                sourceTxHash={sent.txHash}
                expectedAmount={sent.amount}
              />
            ) : (
              <SameChainStatus chainId={sent.chainId} hash={sent.txHash} />
            )}
          </Card>
          <Button
            variant="secondary"
            onClick={() => {
              setSent(null);
              setAmount("");
              setRecipient("");
            }}
          >
            Send something else
          </Button>
        </div>
      </DashboardShell>
    );
  }

  return (
    <DashboardShell
      title="Send"
      description={
        cross
          ? "Move tokens to another Cosmos chain over IBC. The route is planned, not guessed."
          : "Send on one network. Signing happens in your wallet."
      }
    >
      <div className="mx-auto flex w-full max-w-xl flex-col gap-4">
        <Card className="flex flex-col gap-5">
          <Segmented<Mode>
            size="sm"
            className="w-full"
            value={mode}
            onChange={setMode}
            options={[
              { value: "send", label: "Send" },
              { value: "cross", label: "Cross-send" },
            ]}
          />

          <div>
            <SectionLabel>{cross ? "From" : "Network"}</SectionLabel>
            <div className="mt-2 flex items-center gap-3">
              <TokenLogo
                src={from?.iconUrl}
                symbol={from?.coinDenom ?? "?"}
                size={36}
              />
              <ChainSelect
                value={fromChain}
                onValueChange={(id) => {
                  setFromChain(id);
                  setOverrides({});
                }}
                ariaLabel="From chain"
              />
            </div>
          </div>

          {cross ? (
            <div>
              <SectionLabel>To network</SectionLabel>
              <div className="mt-2 flex items-center gap-3">
                <TokenLogo
                  src={to?.iconUrl}
                  symbol={to?.coinDenom ?? "?"}
                  size={36}
                />
                <ChainSelect
                  value={toChain}
                  onValueChange={(id) => {
                    setToChain(id);
                    setOverrides({});
                  }}
                  ariaLabel="To chain"
                />
              </div>
            </div>
          ) : null}

          <RecipientAddressField
            value={recipient}
            onChange={setRecipient}
            expectedPrefix={(cross ? to : from)?.bech32Prefix}
          />

          <Input
            label={`Amount${from ? ` (${from.coinDenom})` : ""}`}
            inputMode="decimal"
            placeholder="0.00"
            value={amount}
            spellCheck={false}
            autoComplete="off"
            state={amount.trim() && amountBase === null ? "error" : "default"}
            hint={
              amount.trim() && amountBase === null
                ? `Use at most ${decimals} decimal places.`
                : undefined
            }
            onChange={(e) => setAmount(e.target.value)}
          />

          {cross ? (
            <ChannelOverrides
              legs={channelLegs}
              overrides={overrides}
              onOverridesChange={setOverrides}
              defaultOpen={(plan.data?.discoveryFailures.length ?? 0) > 0}
            />
          ) : null}

          {error ? (
            <Callout tone="danger" title="Could not send">
              {error}
            </Callout>
          ) : null}

          <div className="flex flex-col gap-2">
            <Button
              className="w-full"
              disabled={blocked !== null}
              onClick={() => {
                setError(null);
                setReviewOpen(true);
              }}
              {...(blocked ? { "aria-describedby": "send-blocked" } : {})}
            >
              Review transfer
            </Button>
            {blocked ? (
              <p
                id="send-blocked"
                className="text-center font-mono text-[length:var(--z-type-micro)] leading-relaxed text-fg-dim"
              >
                {blocked}
              </p>
            ) : null}
          </div>
        </Card>

        {cross ? (
          <Card>
            <RoutePreview
              hops={routeHops}
              estimatedDurationSeconds={
                candidate?.plan.estimatedDurationSeconds ?? null
              }
              warnings={candidate?.plan.warnings ?? plan.data?.warnings ?? []}
              requiresPfm={candidate?.plan.requiresPfm}
              requiresIbcHooks={candidate?.plan.requiresIbcHooks}
              gasChainName={from?.chainName}
              loading={plan.loading}
              error={
                plan.status === "error"
                  ? (plan.error?.message ?? "The route could not be planned.")
                  : null
              }
              onRetry={plan.reload}
              emptyDescription="Enter an amount and a recipient to plan a route."
            />
          </Card>
        ) : null}

        {plan.data?.denomStrategy &&
        plan.data.denomStrategy.strategy !== "direct" ? (
          <Callout tone="info" title="This token is going home first">
            {plan.data.denomStrategy.reason}
          </Callout>
        ) : null}

        <Callout tone="info" title={cross ? "Native IBC" : "Direct send"}>
          {cross
            ? "The chains hold the funds themselves: the source chain escrows the token and the destination mints a voucher against it. No third party is involved, and the dashboard never holds a key."
            : "Your wallet signs MsgSend; the dashboard broadcasts it and never holds a key."}
        </Callout>
      </div>

      <TransferApproval
        open={reviewOpen}
        onOpenChange={setReviewOpen}
        title={cross ? "Approve this transfer" : "Approve this send"}
        description={
          !cross
            ? `One send on ${from?.chainName ?? fromChain}.`
            : candidate?.plan.memo
              ? `One transfer on ${from?.chainName ?? fromChain}. The hops after the first are carried out by relayers, from the memo below.`
              : `One transfer on ${from?.chainName ?? fromChain}, straight to the destination chain.`
        }
        rows={[
          {
            label: "Sending",
            value:
              amountBase && from
                ? formatToken(amountBase, decimals, from.coinDenom, 6)
                : amount,
          },
          { label: "To", value: trimmedRecipient || "—" },
          {
            label: "On",
            value: (cross ? to : from)?.chainName ?? (cross ? toChain : fromChain),
          },
          { label: "Network fee", value: feeLabel ?? "—" },
          { label: "Gas", value: fee.gas },
        ]}
        memo={cross ? (candidate?.plan.memo ?? "") : ""}
        receiver={cross ? (candidate?.receiver ?? "") : trimmedRecipient}
        chainName={(chainId) => findChain(chainId)?.chainName ?? chainId}
        busy={busy}
        error={error}
        onConfirm={() => void onConfirm()}
      />
    </DashboardShell>
  );
}

/**
 * Inclusion status for a same-chain send.
 *
 * Read from the chain, once per five seconds until it settles. The previous
 * screen rendered a fixed three-step tracker with "Included" already marked as
 * the current step and nothing behind it, which said the transaction had been
 * accepted by a block before anyone had looked.
 */
function SameChainStatus({
  chainId,
  hash,
}: {
  readonly chainId: string;
  readonly hash: string;
}) {
  const status = useTxStatus({ chainId, hash });
  const state = status.data?.state ?? null;

  return (
    <div className="flex flex-col gap-3">
      <SectionLabel>Transaction</SectionLabel>
      <p className="font-mono text-[length:var(--z-type-meta)] break-all text-fg">
        {hash}
      </p>
      {status.status === "error" ? (
        <Callout tone="warning" title="Status unavailable">
          {status.error?.message} The transaction was broadcast; this is only the
          read that failed.{" "}
          <button
            type="button"
            onClick={status.reload}
            className="underline underline-offset-2"
          >
            Check again
          </button>
        </Callout>
      ) : state === "success" ? (
        <Callout tone="success" title="Included">
          In block {status.data?.height ?? "—"}.
        </Callout>
      ) : state === "failed" ? (
        <Callout tone="danger" title="Rejected by the chain">
          {status.data?.rawLog || `Result code ${status.data?.code ?? "unknown"}.`}
        </Callout>
      ) : (
        <Callout tone="neutral" title="Waiting for a block">
          Broadcast accepted. The node has not indexed it yet, which is normal
          for the first few seconds.
        </Callout>
      )}
    </div>
  );
}
