"use client";

import { useEffect, useMemo, useState } from "react";
import {
  Button,
  Callout,
  Card,
  Input,
  SectionLabel,
  Segmented,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  TokenLogo,
} from "@zunialab/ui";
import { DashboardShell } from "@/components/DashboardShell";
import { ChainSelect } from "@/components/ChainSelect";
import { RecipientAddressField } from "@/components/RecipientAddressField";
import { findChain } from "@/lib/chains";
import { useChainScope } from "@/lib/useChainScope";
import { useWallet } from "@/providers/WalletProvider";

type Mode = "send" | "cross";

type ChannelOption = {
  channelId: string;
  counterpartyChannelId: string;
  counterpartyChainId: string | null;
};

type ChannelCheck = {
  ok: boolean;
  message: string;
  channelId: string;
};

export default function SendPage() {
  const { account } = useWallet();
  const { selectedChainId, followedOnNetwork } = useChainScope();
  const [mode, setMode] = useState<Mode>("send");
  const fallback = followedOnNetwork[0] ?? "safrochain-1";
  const [fromChain, setFromChain] = useState(selectedChainId ?? fallback);
  const [toChain, setToChain] = useState(
    () =>
      followedOnNetwork.find((id) => id !== (selectedChainId ?? fallback)) ??
      followedOnNetwork[1] ??
      "osmosis-1",
  );
  const [recipient, setRecipient] = useState("");
  const [amount, setAmount] = useState("");
  const [channelId, setChannelId] = useState("");
  const [channels, setChannels] = useState<ChannelOption[]>([]);
  const [loading, setLoading] = useState(false);
  const [check, setCheck] = useState<ChannelCheck | null>(null);

  const from = findChain(fromChain);
  const to = findChain(toChain);
  const cross = mode === "cross";

  useEffect(() => {
    if (selectedChainId) setFromChain(selectedChainId);
  }, [selectedChainId]);

  useEffect(() => {
    if (!cross || !fromChain || !toChain || fromChain === toChain) {
      setChannels([]);
      return;
    }
    let cancelled = false;
    setLoading(true);
    setCheck(null);
    void fetch(
      `/api/ibc/channels?source=${encodeURIComponent(fromChain)}&dest=${encodeURIComponent(toChain)}`,
    )
      .then((r) => r.json())
      .then((j: { channels?: ChannelOption[] }) => {
        if (cancelled) return;
        const rows = j.channels ?? [];
        setChannels(rows);
        if (rows.length === 1) setChannelId(rows[0]!.channelId);
      })
      .catch(() => {
        if (!cancelled) setChannels([]);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [cross, fromChain, toChain]);

  useEffect(() => {
    if (!cross || !channelId.trim()) {
      setCheck(null);
      return;
    }
    const known = channels.find((c) => c.channelId === channelId.trim().toLowerCase());
    if (known) {
      setCheck({
        ok: true,
        channelId: known.channelId,
        message: `Open · ${known.counterpartyChainId ?? toChain}`,
      });
      return;
    }
    const handle = window.setTimeout(() => {
      void fetch(
        `/api/ibc/channel?source=${encodeURIComponent(fromChain)}&channel=${encodeURIComponent(channelId)}&dest=${encodeURIComponent(toChain)}`,
      )
        .then((r) => r.json())
        .then((j: ChannelCheck) => setCheck(j));
    }, 400);
    return () => window.clearTimeout(handle);
  }, [cross, channelId, channels, fromChain, toChain]);

  const canReview = useMemo(() => {
    if (!amount || Number(amount) <= 0 || !recipient.trim()) return false;
    if (cross && !check?.ok) return false;
    return true;
  }, [amount, recipient, cross, check]);

  return (
    <DashboardShell
      title="Send"
      description={
        cross
          ? "Move tokens to another Cosmos chain over IBC."
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
                onValueChange={setFromChain}
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
                    setChannelId("");
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
            onChange={(e) => setAmount(e.target.value)}
          />

          {cross ? (
            <div className="flex flex-col gap-2">
              <div className="flex items-center justify-between">
                <SectionLabel>IBC channel</SectionLabel>
                <span className="font-mono text-[11px] text-fg-dim">
                  {loading
                    ? "Finding…"
                    : channels.length > 0
                      ? `${channels.length} open`
                      : "none found"}
                </span>
              </div>
              {channels.length > 1 ? (
                <Select value={channelId} onValueChange={setChannelId}>
                  <SelectTrigger aria-label="Choose IBC channel" className="w-full">
                    <span className="truncate font-mono text-[13px]">
                      {channelId || "Choose a channel"}
                    </span>
                  </SelectTrigger>
                  <SelectContent>
                    {channels.map((option) => (
                      <SelectItem key={option.channelId} value={option.channelId}>
                        {option.channelId}
                        {option.counterpartyChannelId
                          ? ` → ${option.counterpartyChannelId}`
                          : ""}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              ) : null}
              <Input
                label={channels.length > 0 ? "Or type a channel" : "Channel id"}
                placeholder="channel-141"
                value={channelId}
                spellCheck={false}
                state={
                  !channelId ? "default" : check?.ok ? "valid" : check ? "error" : "default"
                }
                hint={check?.message}
                onChange={(e) => setChannelId(e.target.value)}
              />
            </div>
          ) : null}

          <Button className="w-full" disabled={!account || !canReview}>
            {account ? "Review transfer" : "Connect a wallet"}
          </Button>
        </Card>

        <Callout tone="info" title={cross ? "Native IBC" : "Direct send"}>
          {cross
            ? "Open channels are read from the source chain LCD. Pick one if several exist, or enter a channel id to verify it."
            : "Same-chain MsgSend. Use Cross-send when the recipient lives on another network."}
        </Callout>
      </div>
    </DashboardShell>
  );
}
