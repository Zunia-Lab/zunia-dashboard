"use client";

import Link from "next/link";
import {
  ActivityRow,
  Button,
  SectionLabel,
  inferActivityKind,
} from "@zunialab/ui";
import { useActivity } from "@/lib/useActivity";
import { useWallet } from "@/providers/WalletProvider";

export function LiveRail() {
  const { account } = useWallet();
  const { items } = useActivity();
  const recent = items.slice(0, 4);

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center justify-between gap-2">
        <SectionLabel>Live</SectionLabel>
        <span className="font-mono text-[11.5px] uppercase tracking-[0.12em] text-fg-dim">
          auto
        </span>
      </div>

      <div className="rounded-[16px] bg-[image:var(--z-hero-soft-gradient)] px-4 py-3.5">
        <div className="font-mono text-[11.5px] uppercase tracking-[0.12em] text-fg-dim">
          In flight
        </div>
        <p className="mt-2 text-[14px] leading-relaxed text-fg-muted">
          Bridge and IBC transfers you start appear here with relay progress.
        </p>
      </div>

      <SectionLabel>Recent</SectionLabel>
      {recent.length === 0 ? (
        <p className="text-[14px] leading-relaxed text-fg-dim">
          No indexed transactions for this address yet.
        </p>
      ) : (
        <ul className="-mx-1 flex flex-col">
          {recent.map((item) => (
            <li key={item.hash}>
              <ActivityRow
                title={item.summary}
                subtitle={item.time || "—"}
                status={item.success ? "confirmed" : "failed"}
                kind={item.kind ?? inferActivityKind(item.summary)}
                className="rounded-[14px] px-3 py-3"
              />
            </li>
          ))}
        </ul>
      )}

      <Button asChild variant="secondary" className="w-full shadow-none">
        <Link href="/activity">Open activity</Link>
      </Button>

      <SectionLabel>Sessions</SectionLabel>
      {account ? (
        <div className="rounded-[16px] bg-[image:var(--z-surface-raised-gradient)] px-4 py-3.5">
          <div className="flex items-center gap-2.5">
            <span className="size-2 rounded-full bg-[var(--z-success)]" />
            <span className="truncate font-mono text-[13.5px] text-fg">
              {account.mode === "extension"
                ? account.wallet === "keplr"
                  ? "Keplr"
                  : "browser extension"
                : account.peerName}
            </span>
          </div>
          <p className="mt-2 text-[14px] leading-relaxed text-fg-dim">
            Signing stays in the wallet. This column only reads.
          </p>
        </div>
      ) : (
        <p className="text-[14px] leading-relaxed text-fg-dim">
          No connected session.
        </p>
      )}
    </div>
  );
}
