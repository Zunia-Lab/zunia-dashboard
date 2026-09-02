"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
  SearchField,
} from "@zunialab/ui";
import { findChain, searchChains } from "@/lib/chains";
import { useFollowedChains } from "@/lib/usePortfolio";

const ROUTES = [
  { href: "/portfolio", label: "Portfolio", hint: "Balances and allocation" },
  { href: "/send", label: "Send", hint: "Send and Cross-send" },
  { href: "/staking", label: "Staking", hint: "Delegations and rewards" },
  { href: "/swap", label: "Swap", hint: "Compare routes" },
  { href: "/bridge", label: "Bridge", hint: "IBC and external hops" },
  { href: "/governance", label: "Governance", hint: "Open proposals" },
  { href: "/activity", label: "Activity", hint: "Transfers and claims" },
  { href: "/networks", label: "Networks", hint: "Follow chains" },
  { href: "/missions", label: "Missions", hint: "Season checklist" },
  { href: "/dapps", label: "dApps", hint: "Connected sessions" },
  { href: "/notifications", label: "Notifications", hint: "Alerts" },
  { href: "/settings", label: "Settings", hint: "Theme and security" },
] as const;

export function CommandPalette({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const router = useRouter();
  const [query, setQuery] = useState("");
  const [followed] = useFollowedChains();

  function setOpen(next: boolean) {
    if (!next) setQuery("");
    onOpenChange(next);
  }

  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") {
        event.preventDefault();
        onOpenChange(!open);
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onOpenChange]);

  const pages = useMemo(() => {
    const needle = query.trim().toLowerCase();
    if (!needle) return ROUTES;
    return ROUTES.filter(
      (item) =>
        item.label.toLowerCase().includes(needle) ||
        item.hint.toLowerCase().includes(needle) ||
        item.href.includes(needle),
    );
  }, [query]);

  const chains = useMemo(() => {
    const matches = searchChains(query).slice(0, 6);
    const followedFirst = [
      ...followed
        .map((id) => findChain(id))
        .filter((chain): chain is NonNullable<typeof chain> => Boolean(chain)),
      ...matches,
    ];
    const seen = new Set<string>();
    return followedFirst.filter((chain) => {
      if (seen.has(chain.chainId)) return false;
      seen.add(chain.chainId);
      return true;
    }).slice(0, 6);
  }, [followed, query]);

  function go(href: string) {
    setOpen(false);
    router.push(href);
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogContent className="w-[min(520px,calc(100%-32px))] p-0">
        <div className="px-3 py-3">
          <DialogTitle className="sr-only">Search</DialogTitle>
          <DialogDescription className="sr-only">
            Jump to a page or a followed chain.
          </DialogDescription>
          <SearchField
            value={query}
            onValueChange={setQuery}
            placeholder="Search pages and chains"
            aria-label="Search pages and chains"
          />
        </div>
        <div className="max-h-[360px] overflow-y-auto p-2">
          {pages.length > 0 ? (
            <ul className="flex flex-col gap-0.5">
              {pages.map((item) => (
                <li key={item.href}>
                  <button
                    type="button"
                    onClick={() => go(item.href)}
                    className="flex w-full items-center gap-3 rounded-[11px] px-3 py-2.5 text-left hover:bg-[var(--z-state-hover)]"
                  >
                    <span className="min-w-0 flex-1 truncate text-[15px] text-fg">
                      {item.label}
                    </span>
                    <span className="truncate font-mono text-[13px] text-fg-dim">
                      {item.hint}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          ) : null}
          {chains.length > 0 ? (
            <>
              <div className="px-3 pb-1 pt-3 font-mono text-[12px] uppercase tracking-[0.12em] text-fg-dim">
                Chains
              </div>
              <ul className="flex flex-col gap-0.5">
                {chains.map((chain) => (
                  <li key={chain.chainId}>
                    <button
                      type="button"
                      onClick={() => go(`/chains/${chain.chainId}`)}
                      className="flex w-full items-center gap-3 rounded-[11px] px-3 py-2.5 text-left hover:bg-[var(--z-state-hover)]"
                    >
                      <span className="min-w-0 flex-1 truncate text-[15px] text-fg">
                        {chain.chainName}
                      </span>
                      <span className="font-mono text-[13px] text-fg-dim">
                        {chain.coinDenom}
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
            </>
          ) : null}
          {pages.length === 0 && chains.length === 0 ? (
            <p className="px-3 py-6 text-center text-[14px] text-fg-dim">
              Nothing matches that search.
            </p>
          ) : null}
        </div>
      </DialogContent>
    </Dialog>
  );
}
