"use client";

import { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import { Card, Stat, Text, EmptyState } from "@zunialab/ui";
import { DashboardShell } from "@/components/DashboardShell";
import { findChain } from "@/lib/chains";
import { useWallet } from "@/providers/WalletProvider";

export default function ChainPage() {
  const params = useParams<{ chainId: string }>();
  const chainId = params.chainId;
  const chain = findChain(chainId);
  const { account } = useWallet();
  const [data, setData] = useState<Record<string, unknown> | null>(null);

  useEffect(() => {
    const q = account
      ? `?address=${encodeURIComponent(account.address)}`
      : "";
    void fetch(`/api/chains/${encodeURIComponent(chainId)}${q}`)
      .then((r) => r.json())
      .then(setData)
      .catch(() => setData({ stub: true }));
  }, [chainId, account]);

  return (
    <DashboardShell
      title={chain?.chainName ?? chainId}
      description={`${chainId}${chain?.coinDenom ? ` · ${chain.coinDenom}` : ""}`}
    >
      {!data ? (
        <EmptyState title="Loading chain" description="Fetching via /api proxy." />
      ) : (
        <div className="flex flex-col gap-4">
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <Card>
              <Stat
                label="Native balance"
                value={String((data as { balance?: string }).balance ?? "—")}
              />
            </Card>
            <Card>
              <Stat
                label="Txs indexed"
                value={String((data as { txCount?: number }).txCount ?? "—")}
              />
            </Card>
          </div>
          <Text variant="caption" as="p">
            Reads only — no browser RPC. {(data as { stub?: boolean }).stub ? "(stub)" : ""}
          </Text>
        </div>
      )}
    </DashboardShell>
  );
}
