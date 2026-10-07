"use client";

/**
 * The small pictures on the "What you get" tiles, drawn with the same kit
 * and chart components the dashboard pages use, so the landing page shows
 * what the product looks like rather than a marketing mock-up.
 *
 * They are illustrations, and the section says so under the grid: neutral
 * shapes, no money figures, no invented prices, hidden from assistive tech
 * and inert (no focus, no hover tooltips), because a number here would read
 * as data. Real chain logos and the real fee rate are the only facts shown.
 *
 * Loaded lazily by FeatureVisual (the d3 helpers behind the sparklines stay
 * out of the first bundle).
 */

import type { ReactNode } from "react";
import { Meter } from "@/components/charts/Meter";
import { Sparkline } from "@/components/charts/Sparkline";
import { VOTE_FILL } from "@/components/governance/TallyBar";
import { AssetLogo, Badge, ChainLogo, Segmented, StatusBadge, Stepper } from "@/components/ui";
import { cn } from "@/lib/cn";
import type { FeaturedChain } from "./content";
import { ZuniaMark } from "./ZuniaMark";
import styles from "./landing.module.css";

export type FeatureKind = "scope" | "analytics" | "swap" | "ibc" | "staking" | "governance";

export interface FeatureVisualProps {
  kind: FeatureKind;
  /** Logos for the pictures, home chain first. */
  chains: FeaturedChain[];
  /** The compiled swap commission, e.g. "0.5%". */
  feeRate: string;
}

export default function FeatureVisuals({ kind, chains, feeRate }: FeatureVisualProps) {
  const byId = new Map(chains.map((chain) => [chain.chainId, chain]));
  const pick = (id: string) => byId.get(id) ?? null;
  return (
    <div aria-hidden inert className="pointer-events-none absolute inset-0 select-none p-4 d-fade-in">
      {kind === "scope" ? <ScopeVisual chains={chains.slice(0, 5)} /> : null}
      {kind === "analytics" ? <AnalyticsVisual /> : null}
      {kind === "swap" ? <SwapVisual from={pick("osmosis-1")} to={pick("cosmoshub-4")} feeRate={feeRate} /> : null}
      {kind === "ibc" ? <IbcVisual from={pick("osmosis-1")} to={pick("cosmoshub-4")} /> : null}
      {kind === "staking" ? <StakingVisual /> : null}
      {kind === "governance" ? <GovernanceVisual chains={[pick("osmosis-1"), pick("cosmoshub-4")]} /> : null}
    </div>
  );
}

/** A quiet stand-in for a figure: the shape of a number, not a number. */
function Bar({ width, className }: { width: number | string; className?: string }) {
  return <span className={cn("inline-block h-2 rounded-full bg-[var(--d-glass-2)]", className)} style={{ width }} />;
}

/* ------------------------------------------------------------------ scope */

function ScopeVisual({ chains }: { chains: FeaturedChain[] }) {
  // Relative bar lengths for the picture (no total, no currency), the way
  // the per-chain breakdown ranks chains in the all-chains scope.
  const shares = [100, 64, 38];
  return (
    <div className="flex h-full flex-col justify-between">
      <div className="flex items-center gap-1.5 self-start rounded-full border border-[var(--d-hairline)] bg-[var(--d-card)] p-1 pr-3">
        <span className="flex size-7 items-center justify-center rounded-full bg-[image:var(--z-accent-gradient)] p-[2px]">
          <span className="flex size-full items-center justify-center rounded-full bg-[var(--d-card)]">
            <ZuniaMark id="fv-scope" size={11} />
          </span>
        </span>
        {chains.map((chain, index) => (
          <span key={chain.chainId} className="relative">
            <ChainLogo chain={chain} size={22} />
            {index === 2 ? <span className="absolute -right-0.5 -top-0.5 size-2 rounded-full border-2 border-[var(--d-card)] bg-[var(--z-warning)]" /> : null}
          </span>
        ))}
        <span className="ml-1 font-mono text-[10.5px] uppercase tracking-[0.06em] text-fg-muted">All chains</span>
      </div>
      <div className="flex flex-col gap-2">
        {chains.slice(0, 3).map((chain, index) => (
          <div key={chain.chainId} className="grid grid-cols-[18px_88px_minmax(0,1fr)] items-center gap-2 text-[11.5px] text-fg-muted">
            <ChainLogo chain={chain} size={16} />
            <span className="truncate">{chain.chainName}</span>
            <span className="h-1.5 overflow-hidden rounded-full bg-[var(--d-glass-2)]">
              <span className="block h-full rounded-full" style={{ width: `${shares[index]}%`, background: `var(--viz-${index + 1})` }} />
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ analytics */

/** Three illustrative walks, all starting level (an indexed comparison). */
const WALKS: number[][] = (() => {
  let seed = 7;
  const random = () => {
    // mulberry32: deterministic, so the picture is the same on every visit.
    seed |= 0;
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  const drifts = [0.55, 0.1, -0.35];
  return drifts.map((drift) => {
    const out = [100];
    for (let i = 1; i < 48; i += 1) out.push(out[i - 1] + drift + (random() - 0.5) * 2.4);
    return out;
  });
})();

function AnalyticsVisual() {
  return (
    <div className="flex h-full flex-col gap-2">
      <span className="font-mono text-[10.5px] uppercase tracking-[0.06em] text-fg-dim">Indexed · 100 at start</span>
      <div className="relative min-h-0 flex-1">
        {WALKS.map((walk, index) => (
          <Sparkline
            key={index}
            data={walk}
            height={60}
            color={`var(--viz-${index + 1})`}
            wash={index === 0}
            className="absolute inset-x-0 top-0"
          />
        ))}
      </div>
      <Segmented
        ariaLabel="Range"
        value="30D"
        onChange={() => undefined}
        options={[
          { value: "7D", label: "7D" },
          { value: "30D", label: "30D" },
          { value: "90D", label: "90D" },
          { value: "1Y", label: "1Y" },
        ]}
        mono
      />
    </div>
  );
}

/* ------------------------------------------------------------------ swap */

function SwapVisual({ from, to, feeRate }: { from: FeaturedChain | null; to: FeaturedChain | null; feeRate: string }) {
  return (
    <div className="flex h-full flex-col justify-between">
      <div className="flex items-center gap-2">
        <AssetLogo src={from?.iconUrl} symbol={from?.coinDenom ?? "OSMO"} size={26} />
        <span className="h-px flex-1 bg-[var(--d-hairline-strong)]" />
        <span className="rounded-full border border-[var(--d-hairline-strong)] bg-[var(--d-card)] px-2 py-0.5 font-mono text-[10.5px] text-fg-muted">
          Osmosis pool
        </span>
        <span className="h-px flex-1 bg-[var(--d-hairline-strong)]" />
        <AssetLogo src={to?.iconUrl} symbol={to?.coinDenom ?? "ATOM"} size={26} />
      </div>
      <dl className="flex flex-col gap-2 text-[12px]">
        <Row label="You pay">
          <Bar width={64} /> <span className="text-fg-dim">{from?.coinDenom ?? "OSMO"}</span>
        </Row>
        <Row label="Zunia fee" strong>
          {feeRate} of the amount sold
        </Row>
        <Row label="You receive">
          <Bar width={52} /> <span className="text-fg-dim">{to?.coinDenom ?? "ATOM"}</span>
        </Row>
      </dl>
    </div>
  );
}

function Row({ label, strong, children }: { label: string; strong?: boolean; children: ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-3">
      <dt className="text-fg-dim">{label}</dt>
      <dd className={cn("flex items-center gap-1.5", strong ? "font-medium text-[var(--d-accent-text)]" : "text-fg")}>{children}</dd>
    </div>
  );
}

/* ------------------------------------------------------------------ IBC */

function IbcVisual({ from, to }: { from: FeaturedChain | null; to: FeaturedChain | null }) {
  return (
    <div className="flex h-full flex-col justify-between">
      <div className="grid grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-x-3 gap-y-1.5">
        <ChainLogo chain={from ?? undefined} size={26} className="justify-self-center" />
        <span className="relative h-px bg-[repeating-linear-gradient(90deg,var(--d-hairline-strong)_0_6px,transparent_6px_10px)]">
          <span className={styles.packet} />
        </span>
        <ChainLogo chain={to ?? undefined} size={26} className="justify-self-center" />
        <span className="font-mono text-[10.5px] text-fg-dim">{from?.chainName ?? "Osmosis"}</span>
        <span className="text-center font-mono text-[10.5px] text-fg-dim">channel-0</span>
        <span className="font-mono text-[10.5px] text-fg-dim">{to?.chainName ?? "Cosmos Hub"}</span>
      </div>
      <Stepper
        steps={[
          { label: "Sent", state: "done" },
          { label: "Received", state: "done" },
          { label: "Acknowledged", state: "current" },
        ]}
      />
    </div>
  );
}

/* ------------------------------------------------------------------ staking */

function StakingVisual() {
  // Status words only: the meters show where a validator sits, not a figure.
  return (
    <div className="flex h-full flex-col justify-center gap-2.5 pt-3">
      <Meter
        size="sm"
        label="Commission can rise to"
        value={0.24}
        valueLabel=""
        thresholds={{ warning: 0.1, danger: 0.2 }}
        statusLabels={{ danger: "Above 20%" }}
      />
      <Meter
        size="sm"
        label="Uptime, signing window"
        value={0.972}
        valueLabel=""
        thresholds={{ warning: 0.99, danger: 0.95, direction: "down" }}
        statusLabels={{ warning: "Below 99%" }}
      />
      <Meter
        size="sm"
        label="Voting power"
        value={0.38}
        valueLabel=""
        markers={[{ value: 1 / 3, label: "One third of the vote" }]}
        thresholds={{ warning: 1 / 3 }}
        statusLabels={{ warning: "Top third" }}
      />
    </div>
  );
}

/* ------------------------------------------------------------------ governance */

/**
 * The governance page's two instruments in miniature: the votes bar in its
 * own colours (Yes blue, No orange, veto hatched, abstain grey — never
 * green / red: a vote has no "good" side) with the caret at the pass line,
 * and the turnout meter with its quorum tick. Shapes only, no figures.
 */
const TALLY: ReadonlyArray<{ option: keyof typeof VOTE_FILL; left: number; share: number }> = [
  { option: "yes", left: 0, share: 0.58 },
  { option: "no", left: 0.58, share: 0.16 },
  { option: "veto", left: 0.74, share: 0.04 },
  { option: "abstain", left: 0.78, share: 0.22 },
];
/** Half of the decisive votes (Yes + No + veto), where the product draws its pass line. */
const PASS_LINE = 0.39;

function Tally() {
  return (
    <span className="relative block pt-[6px]">
      <span className="relative block h-2 overflow-hidden rounded-[4px] bg-[var(--d-glass-2)]">
        {TALLY.map(({ option, left, share }, index) => (
          <span
            key={option}
            className="absolute inset-y-0 box-border"
            style={{
              left: `${left * 100}%`,
              width: `${share * 100}%`,
              background: VOTE_FILL[option],
              borderLeft: index > 0 ? "2px solid var(--d-card)" : undefined,
            }}
          />
        ))}
      </span>
      <span className="absolute inset-y-0" style={{ left: `${PASS_LINE * 100}%` }}>
        <span className="absolute top-0 -translate-x-1/2 border-x-[4px] border-t-[5px] border-x-transparent border-t-fg" />
        <span className="absolute bottom-0 top-[5px] w-[1.5px] -translate-x-1/2 bg-fg shadow-[0_0_0_1px_var(--d-card)]" />
      </span>
    </span>
  );
}

function Turnout() {
  return (
    <span className="flex items-center gap-2 text-[10.5px] text-fg-dim">
      <span className="font-mono uppercase tracking-[0.06em]">Turnout</span>
      <span className="relative flex-1 py-[3px]">
        <span className="block h-1 overflow-hidden rounded-full bg-[var(--d-glass-2)]">
          <span className="block h-full w-[46%] rounded-full bg-[var(--viz-neutral)]" />
        </span>
        {/* The quorum tick. */}
        <span className="absolute inset-y-0 left-[33.4%] w-[2px] -translate-x-1/2 rounded-full bg-fg shadow-[0_0_0_1.5px_var(--d-card)]" />
      </span>
      <Bar width={30} />
    </span>
  );
}

function GovernanceVisual({ chains }: { chains: Array<FeaturedChain | null> }) {
  return (
    <div className="flex h-full flex-col justify-center gap-2">
      <div className="flex flex-col gap-2 rounded-[10px] border border-[var(--d-hairline)] bg-[var(--d-card)] px-3 py-2.5">
        <div className="flex items-center gap-2">
          <ChainLogo chain={chains[0] ?? undefined} size={16} />
          <Bar width="62%" className="max-w-[150px]" />
          <Badge dot className="ml-auto">
            Voted
          </Badge>
        </div>
        <Tally />
        <Turnout />
      </div>
      <div className="flex items-center gap-2 rounded-[10px] border border-[var(--d-hairline)] bg-[var(--d-card)] px-3 py-2">
        <ChainLogo chain={chains[1] ?? undefined} size={16} />
        <Bar width="48%" className="max-w-[120px]" />
        <StatusBadge tone="warning" className="ml-auto">
          Not voted
        </StatusBadge>
      </div>
    </div>
  );
}
