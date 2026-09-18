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
  cn,
  focusRing,
} from "@zunialab/ui";
import { DashboardShell } from "@/components/DashboardShell";
import { findChain, searchChains } from "@/lib/chains";
import { useChainScope } from "@/lib/useChainScope";
import { useFollowedChains } from "@/lib/usePortfolio";
import { useStoredValue } from "@/lib/useStoredValue";

const PAGE_SIZE = 36;
const FILTER_KEY = "zunia.dashboard.networksFilter";

type NetworkFilter = "mainnet" | "testnet" | "all";

function QuickAction({
  label,
  onClick,
}: {
  label: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "rounded-full border border-[var(--z-line)] px-2.5 py-1 font-mono text-[9.5px] uppercase tracking-[0.08em] text-fg-muted",
        "transition-colors duration-[var(--z-duration-base)] hover:border-[var(--z-line-strong)] hover:bg-[var(--z-state-hover)] hover:text-fg",
        focusRing,
      )}
    >
      {label}
    </button>
  );
}

export default function NetworksPage() {
  const [filter, setFilter] = useStoredValue<NetworkFilter>(FILTER_KEY, "all");
  const [query, setQuery] = useState("");
  const [visible, setVisible] = useState(PAGE_SIZE);
  const [followed, setFollowed] = useFollowedChains();
  const { setNetwork } = useChainScope();
  const [notice, setNotice] = useState<string | null>(null);

  // Collapse back to the first page whenever the result set changes.
  const resultKey = `${filter}|${query}`;
  const [lastResultKey, setLastResultKey] = useState(resultKey);
  if (resultKey !== lastResultKey) {
    setLastResultKey(resultKey);
    setVisible(PAGE_SIZE);
  }

  const results = useMemo(() => {
    const network = filter === "all" ? undefined : filter;
    const rows = searchChains(query, network);
    // Followed first so Main/Test/All never hides what is already on.
    return [...rows].sort((a, b) => {
      const aOn = followed.includes(a.chainId) ? 0 : 1;
      const bOn = followed.includes(b.chainId) ? 0 : 1;
      return aOn - bOn;
    });
  }, [query, filter, followed]);
  const shown = results.slice(0, visible);
  const followedInView = results.reduce(
    (n, c) => n + (followed.includes(c.chainId) ? 1 : 0),
    0,
  );

  const toggle = (chainId: string) => {
    setNotice(null);
    const entry = findChain(chainId);
    if (followed.includes(chainId)) {
      if (followed.length <= 1) {
        setNotice("Keep at least one network followed");
        return;
      }
      setFollowed((prev) => prev.filter((id) => id !== chainId));
      return;
    }
    if (entry) setNetwork(entry.network);
    setFollowed((prev) =>
      prev.includes(chainId) ? prev : [...prev, chainId],
    );
  };

  const selectMany = (ids: string[]) => {
    setNotice(null);
    setFollowed((prev) => [...new Set([...prev, ...ids])]);
  };

  const clearMany = (ids: string[]) => {
    setNotice(null);
    const drop = new Set(ids);
    const next = followed.filter((id) => !drop.has(id));
    if (next.length === 0) {
      setNotice("Keep at least one network followed");
      return;
    }
    setFollowed(next);
  };

  return (
    <DashboardShell
      title="Networks"
      description="Pick the chains the dashboard reads. Following a chain never touches a key."
      actions={
        <span className="hidden font-mono text-[12px] uppercase tracking-[0.12em] text-fg-dim lg:inline">
          {followed.length} followed · saved in this browser
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
                { value: "mainnet", label: "Main" },
                { value: "testnet", label: "Test" },
                { value: "all", label: "All" },
              ]}
            />
            <SearchField
              value={query}
              onValueChange={setQuery}
              placeholder="Search chain, id or ticker"
              className="min-w-[200px] flex-1"
            />
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <span className="min-w-0 flex-1 font-mono text-[12px] uppercase tracking-[0.12em] text-fg-dim">
              {followed.length} followed · {followedInView}/{results.length} in
              view
            </span>
            <QuickAction
              label="Select all"
              onClick={() => selectMany(results.map((c) => c.chainId))}
            />
            <QuickAction
              label="Clear"
              onClick={() => clearMany(results.map((c) => c.chainId))}
            />
          </div>
          {notice ? <Callout tone="danger">{notice}</Callout> : null}
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
