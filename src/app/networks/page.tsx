"use client";

import { useMemo, useState } from "react";
import {
  Button,
  Callout,
  Card,
  EmptyState,
  NetworkOptionCard,
  SearchField,
  SectionLabel,
  Segmented,
} from "@zunialab/ui";
import { DashboardShell } from "@/components/DashboardShell";
import { searchChains } from "@/lib/chains";
import { useFollowedChains } from "@/lib/usePortfolio";

const PAGE_SIZE = 36;

type NetworkFilter = "mainnet" | "testnet";

export default function NetworksPage() {
  const [filter, setFilter] = useState<NetworkFilter>("mainnet");
  const [query, setQuery] = useState("");
  const [visible, setVisible] = useState(PAGE_SIZE);
  const [followed, setFollowed] = useFollowedChains();

  // Collapse back to the first page whenever the result set changes.
  const resultKey = `${filter}|${query}`;
  const [lastResultKey, setLastResultKey] = useState(resultKey);
  if (resultKey !== lastResultKey) {
    setLastResultKey(resultKey);
    setVisible(PAGE_SIZE);
  }

  const results = useMemo(() => searchChains(query, filter), [query, filter]);
  const shown = results.slice(0, visible);

  const toggle = (chainId: string) => {
    if (followed.includes(chainId)) {
      if (followed.length <= 1) return;
      setFollowed(followed.filter((id) => id !== chainId));
      return;
    }
    setFollowed([...followed, chainId]);
  };

  return (
    <DashboardShell
      title="Networks"
      description="Pick the chains the dashboard reads. Following a chain never touches a key."
      actions={
        <span className="hidden font-mono text-[12px] uppercase tracking-[0.12em] text-fg-dim lg:inline">
          {followed.length} followed · registry verified
        </span>
      }
    >
      <div className="flex flex-col gap-4">
        <Card className="flex flex-col gap-3">
          <div className="flex flex-wrap items-center gap-3">
            <Segmented<NetworkFilter>
              value={filter}
              onChange={setFilter}
              options={[
                { value: "mainnet", label: "Mainnet" },
                { value: "testnet", label: "Testnet" },
              ]}
            />
            <SearchField
              value={query}
              onValueChange={setQuery}
              placeholder="Search chain, id or ticker"
              className="min-w-[200px] flex-1"
            />
          </div>
          <div className="font-mono text-[12px] uppercase tracking-[0.12em] text-fg-dim">
            {results.length} chains in registry
          </div>
        </Card>

        {results.length === 0 ? (
          <EmptyState
            title="No chain matches"
            description="Try the chain id, the display name or the ticker."
          />
        ) : (
          <>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-3">
              {shown.map((chain) => (
                <NetworkOptionCard
                  key={chain.chainId}
                  name={chain.chainName}
                  chainId={chain.chainId}
                  symbol={chain.coinDenom}
                  iconUrl={chain.iconUrl}
                  testnet={chain.network === "testnet"}
                  selected={followed.includes(chain.chainId)}
                  onToggle={() => toggle(chain.chainId)}
                  control="switch"
                  className="px-4 py-3.5"
                />
              ))}
            </div>
            {visible < results.length ? (
              <Button
                variant="secondary"
                onClick={() => setVisible((n) => n + PAGE_SIZE)}
              >
                Show {Math.min(PAGE_SIZE, results.length - visible)} more
              </Button>
            ) : null}
          </>
        )}

        <Card className="flex flex-col gap-2">
          <SectionLabel>Custom chains</SectionLabel>
          <Callout tone="neutral" title="Add a chain by RPC in the wallet">
            Custom endpoints are stored by the extension or the mobile app so
            signing stays where the key is. The dashboard picks them up on the
            next read.
          </Callout>
        </Card>
      </div>
    </DashboardShell>
  );
}
