"use client";

import { useEffect, useState } from "react";
import {
  Button,
  Callout,
  Card,
  EmptyState,
  FeeSummary,
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
import { findChain } from "@/lib/chains";
import { useChainScope } from "@/lib/useChainScope";
import { usePrefs } from "@/providers/PrefsProvider";
import { useWallet } from "@/providers/WalletProvider";

type Rail = "ibc" | "evm" | "solana";

const RAIL_COPY: Record<Rail, string> = {
  ibc: "Native IBC transfer between Cosmos chains. No third party holds the funds.",
  evm: "Routed through an external bridge provider. Funds leave Cosmos custody rules in transit.",
  solana:
    "Routed through an external bridge provider. Funds leave Cosmos custody rules in transit.",
};

type ChannelOption = {
  channelId: string;
  counterpartyChannelId: string;
  counterpartyChainId: string | null;
};

export default function BridgePage() {
  const { account } = useWallet();
  const { selectedChainId, followedOnNetwork } = useChainScope();
  const { mask } = usePrefs();
  const [rail, setRail] = useState<Rail>("ibc");
  const fallbackId = followedOnNetwork[0] ?? "cosmoshub-4";
  const [fromChain, setFromChain] = useState(selectedChainId ?? fallbackId);
  const [toChain, setToChain] = useState(
    () =>
      followedOnNetwork.find((id) => id !== (selectedChainId ?? fallbackId)) ??
      "osmosis-1",
  );
  const [amount, setAmount] = useState("");
  const [channelId, setChannelId] = useState("");
  const [channels, setChannels] = useState<ChannelOption[]>([]);
  const [channelHint, setChannelHint] = useState<string | undefined>();

  useEffect(() => {
    if (selectedChainId) setFromChain(selectedChainId);
  }, [selectedChainId]);

  useEffect(() => {
    if (
      followedOnNetwork.length > 0 &&
      !followedOnNetwork.includes(fromChain)
    ) {
      setFromChain(followedOnNetwork[0]!);
    }
    if (
      followedOnNetwork.length > 0 &&
      !followedOnNetwork.includes(toChain)
    ) {
      const next =
        followedOnNetwork.find((id) => id !== fromChain) ??
        followedOnNetwork[0]!;
      setToChain(next);
    }
  }, [followedOnNetwork, fromChain, toChain]);

  useEffect(() => {
    if (rail !== "ibc" || !fromChain || !toChain || fromChain === toChain) {
      setChannels([]);
      return;
    }
    let cancelled = false;
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
      });
    return () => {
      cancelled = true;
    };
  }, [rail, fromChain, toChain]);

  useEffect(() => {
    if (rail !== "ibc" || !channelId.trim()) {
      setChannelHint(undefined);
      return;
    }
    const handle = window.setTimeout(() => {
      void fetch(
        `/api/ibc/channel?source=${encodeURIComponent(fromChain)}&channel=${encodeURIComponent(channelId)}&dest=${encodeURIComponent(toChain)}`,
      )
        .then((r) => r.json())
        .then((j: { message?: string }) => setChannelHint(j.message));
    }, 400);
    return () => window.clearTimeout(handle);
  }, [rail, channelId, fromChain, toChain]);

  const from = findChain(fromChain);
  const to = findChain(toChain);

  return (
    <DashboardShell
      title="Bridge"
      description="Move assets across chains. Signing always happens in your wallet."
      live={
        <div className="flex flex-col gap-3">
          <SectionLabel>In flight</SectionLabel>
          <EmptyState
            title="Nothing in transit"
            description="Transfers you start appear here with their relay progress."
          />
        </div>
      }
    >
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-[minmax(0,1fr)_320px]">
        <Card className="flex flex-col gap-5">
          <Segmented<Rail>
            value={rail}
            onChange={setRail}
            options={[
              { value: "ibc", label: "IBC" },
              { value: "evm", label: "EVM" },
              { value: "solana", label: "Solana" },
            ]}
          />

          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <div className="rounded-[14px] bg-[var(--z-glass)] p-4">
              <SectionLabel>From</SectionLabel>
              <div className="mt-3 flex items-center gap-2">
                <TokenLogo
                  src={from?.iconUrl}
                  symbol={from?.coinDenom ?? "?"}
                  size={36}
                />
                <ChainSelect
                  value={fromChain}
                  onValueChange={setFromChain}
                  ariaLabel="Bridge from chain"
                />
              </div>
              <div className="mt-3 font-mono text-[13px] text-fg-dim">
                balance {mask("—")}
              </div>
            </div>

            <div className="rounded-[14px] bg-[var(--z-glass)] p-4">
              <SectionLabel>To</SectionLabel>
              <div className="mt-3 flex items-center gap-2">
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
                  ariaLabel="Bridge to chain"
                />
              </div>
              <div className="mt-3 font-mono text-[13px] text-fg-dim">
                receives {mask("—")}
              </div>
            </div>
          </div>

          <Input
            value={amount}
            onChange={(event) => setAmount(event.target.value)}
            inputMode="decimal"
            placeholder="0.0"
            aria-label="Amount to bridge"
            label={`Amount in ${from?.coinDenom ?? ""}`.trim()}
          />

          {rail === "ibc" ? (
            <div className="flex flex-col gap-2">
              {channels.length > 1 ? (
                <Select value={channelId} onValueChange={setChannelId}>
                  <SelectTrigger aria-label="IBC channel" className="w-full">
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
                label="IBC channel"
                placeholder="channel-141"
                value={channelId}
                spellCheck={false}
                hint={channelHint}
                onChange={(e) => setChannelId(e.target.value)}
              />
            </div>
          ) : null}

          <Button disabled className="w-full">
            {account ? "Review transfer" : "Connect a wallet"}
          </Button>
        </Card>

        <div className="flex flex-col gap-4">
          <Card>
            <SectionLabel>Transfer</SectionLabel>
            <FeeSummary
              className="mt-3"
              rows={[
                { label: "Rail", value: rail.toUpperCase() },
                {
                  label: "Channel",
                  value: rail === "ibc" ? channelId || "—" : "—",
                },
                { label: "Relay fee", value: "—" },
                { label: "Estimated time", value: "—" },
              ]}
            />
          </Card>
          <Callout tone={rail === "ibc" ? "neutral" : "warning"} title="Custody">
            {RAIL_COPY[rail]}
          </Callout>
          {rail === "ibc" ? (
            <Callout tone="info" title="Prefer Send → Cross-send">
              For a simpler Cosmos-to-Cosmos flow with channel checks, use Send
              → Cross-send.
            </Callout>
          ) : null}
        </div>
      </div>
    </DashboardShell>
  );
}
