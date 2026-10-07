"use client";

/**
 * The UI kit catalogue. Every component with its main variants and states,
 * in whichever theme is active (toggle at the top). All figures on this page
 * are SAMPLE DATA for the preview and say so; nothing here is read from a
 * chain or a market.
 */

import { useTheme } from "@zunialab/ui";
import { useState, type ReactNode } from "react";
import {
  AddressText,
  AmountInput,
  AnimatedNumber,
  AssetLogo,
  Badge,
  BigNumber,
  Button,
  Callout,
  Card,
  CardBody,
  CardFooter,
  CardHeader,
  ChainLogo,
  Checkbox,
  Chip,
  ChipGroup,
  Combobox,
  CopyButton,
  DataTable,
  Delta,
  Dialog,
  Disclosure,
  Divider,
  Dot,
  EmptyState,
  ExternalLink,
  FilterBar,
  IconButton,
  InfoTip,
  InlineError,
  Input,
  Kbd,
  KeyValueList,
  LogoStack,
  Menu,
  Money,
  PageSection,
  PartialDataBadge,
  Percent,
  Popover,
  ProgressBar,
  RelativeTime,
  SearchInput,
  SectionLabel,
  Segmented,
  Select,
  ShareBar,
  Sheet,
  Skeleton,
  SkeletonText,
  SoonBadge,
  SourceTag,
  Spinner,
  StatTile,
  StatusBadge,
  Stepper,
  Switch,
  TabPanel,
  Tabs,
  TokenAmount,
  Toaster,
  Tooltip,
  chainById,
  csvFileName,
  downloadCsv,
  toCsv,
  toast,
  type Column,
} from "@/components/ui";
import { CHAINS, sortChains, type ChainEntry } from "@/lib/chains";
import { Icon } from "@/components/icons";
import { cn } from "@/lib/cn";
import { formatFiat } from "@/lib/format";
import { usePrefs } from "@/providers/PrefsProvider";

/* ------------------------------------------------------------------ sample data */

/** Deterministic pseudo-random numbers (mulberry32), so renders agree. */
function seeded(seed: number) {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

interface SampleAsset {
  key: string;
  symbol: string;
  name: string;
  /** Chain the token is native to (logo). */
  originChainId: string;
  /** Chain it is held on (badge). */
  chainId: string;
  kind: "Native" | "IBC" | "Factory";
  price: number | null;
  change24h: number | null;
  decimals: number | null;
  balance: string;
  trend: number[];
}

const BASE = [
  { symbol: "ATOM", name: "Cosmos Hub", chainId: "cosmoshub-4", price: 1.79, decimals: 6 },
  { symbol: "OSMO", name: "Osmosis", chainId: "osmosis-1", price: 0.0287, decimals: 6 },
  { symbol: "TIA", name: "Celestia", chainId: "celestia", price: 0.94, decimals: 6 },
  { symbol: "SAF", name: "Safrochain", chainId: "safrochain-1", price: 0.00028, decimals: 6 },
  { symbol: "AKT", name: "Akash", chainId: "akashnet-2", price: 0.88, decimals: 6 },
  { symbol: "INJ", name: "Injective", chainId: "injective-1", price: 7.12, decimals: 18 },
  { symbol: "JUNO", name: "Juno", chainId: "juno-1", price: 0.061, decimals: 6 },
  { symbol: "AXL", name: "Axelar", chainId: "axelar-dojo-1", price: 0.21, decimals: 6 },
  { symbol: "DYDX", name: "dYdX", chainId: "dydx-mainnet-1", price: 0.41, decimals: 18 },
  { symbol: "DYMA", name: "Dyma (factory)", chainId: "safrochain-1", price: null, decimals: 6 },
] as const;

const HELD_ON = ["osmosis-1", "cosmoshub-4", "safrochain-1"];

function buildSample(): SampleAsset[] {
  const random = seeded(7);
  const rows: SampleAsset[] = [];
  for (let i = 0; i < 30; i += 1) {
    const base = BASE[i % BASE.length];
    const round = Math.floor(i / BASE.length);
    const chainId = round === 0 ? base.chainId : (HELD_ON[(i + round) % HELD_ON.length] ?? base.chainId);
    const ibc = chainId !== base.chainId;
    const unknownDecimals = i === 23;
    const decimals = unknownDecimals ? null : base.decimals;
    const whole = Math.floor(random() ** 2 * 40_000) + 1;
    const fraction = Math.floor(random() * 1_000_000);
    const exponent = decimals ?? 6;
    const units = BigInt(whole) * BigInt(10) ** BigInt(exponent) + BigInt(fraction) * BigInt(10) ** BigInt(Math.max(0, exponent - 6));
    const trend: number[] = [];
    let level = 100;
    for (let d = 0; d < 14; d += 1) {
      level *= 1 + (random() - 0.48) * 0.08;
      trend.push(level);
    }
    rows.push({
      key: `${base.symbol}-${chainId}-${i}`,
      symbol: ibc ? `${base.symbol}` : base.symbol,
      name: base.name,
      originChainId: base.chainId,
      chainId,
      kind: base.symbol === "DYMA" ? "Factory" : ibc ? "IBC" : "Native",
      price: base.price,
      change24h: base.price === null ? null : Math.round((random() - 0.45) * 1200) / 100,
      decimals,
      balance: units.toString(),
      trend,
    });
  }
  return rows;
}

/** Built once: deterministic, so the server and client renders agree. */
const SAMPLE = buildSample();

function displayAmount(row: SampleAsset): number | null {
  if (row.decimals === null) return null;
  return Number(row.balance) / 10 ** row.decimals;
}

function valueOf(row: SampleAsset): number | null {
  const amount = displayAmount(row);
  return amount === null || row.price === null ? null : amount * row.price;
}

/** Sample timestamps relative to when the page loaded ("2 min ago"). */
const LOADED_AT = Date.now();
const minutesAgo = (minutes: number) => LOADED_AT - minutes * 60_000;

const chainIcon = (chainId: string) => chainById(chainId)?.iconUrl ?? null;
const chainName = (chainId: string) => chainById(chainId)?.chainName ?? chainId;

/* ------------------------------------------------------------------ page */

export function UiKitDemo() {
  const { resolved, setTheme } = useTheme();
  const { hideAmounts, toggleHideAmounts } = usePrefs();

  return (
    // --d-sticky-top: table headers stick under this page's own sticky header
    // (one 70px row from 1024px; phones get card lists instead of tables).
    <div data-kit-scroller="" className="d-scroll min-h-0 flex-1 overflow-y-auto bg-bg text-fg lg:[--d-sticky-top:70px]">
      <Toaster />
      <header data-kit-header="" className="sticky top-0 z-30 border-b border-[var(--d-hairline)] bg-[color-mix(in_srgb,var(--z-bg)_82%,transparent)] backdrop-blur-[14px]">
        <div className="mx-auto flex max-w-[1400px] flex-wrap items-center gap-x-4 gap-y-2 px-4 py-3 sm:px-6">
          <div className="min-w-[14rem] flex-1">
            <h1 className="text-[18px] font-semibold tracking-[-0.02em]">UI kit</h1>
            <p className="text-[12.5px] text-fg-dim">src/components/ui · every component, both themes · sample data only</p>
          </div>
          <Segmented
            ariaLabel="Theme"
            value={resolved}
            onChange={(next) => setTheme(next)}
            options={[
              { value: "dark", label: "Dark", icon: "moon" },
              { value: "light", label: "Light", icon: "sun" },
            ]}
          />
          <Switch checked={hideAmounts} onCheckedChange={toggleHideAmounts} label="Hide amounts" className="items-center" />
        </div>
      </header>

      <main className="mx-auto flex max-w-[1400px] flex-col gap-10 px-4 pb-24 pt-6 sm:px-6">
        <FoundationsSection />
        <ButtonsSection />
        <CardsSection />
        <KpiSection />
        <NumbersSection />
        <BadgesSection />
        <ChoiceSection />
        <FormsSection />
        <FeedbackSection />
        <OverlaySection />
        <TableSection />
      </main>
    </div>
  );
}

function KitSection({ id, title, subtitle, children }: { id: string; title: string; subtitle?: string; children: ReactNode }) {
  return (
    <div data-kit-section={id} className="scroll-mt-20">
      <PageSection title={title} subtitle={subtitle}>
        {children}
      </PageSection>
    </div>
  );
}

function Row({ label, children, className }: { label?: string; children: ReactNode; className?: string }) {
  return (
    <div className={cn("flex flex-col gap-2", className)}>
      {label ? <SectionLabel>{label}</SectionLabel> : null}
      <div className="flex flex-wrap items-center gap-3">{children}</div>
    </div>
  );
}

/* ------------------------------------------------------------------ foundations */

const SWATCHES = [
  ["--z-bg", "Page"],
  ["--d-card", "Card"],
  ["--d-card-2", "Card 2"],
  ["--d-glass-2", "Glass"],
  ["--d-hairline-strong", "Hairline"],
  ["--z-fg", "Text"],
  ["--z-fg-muted", "Muted"],
  ["--z-fg-dim", "Dim"],
  ["--d-accent-text", "Accent text"],
  ["--z-success", "Positive"],
  ["--z-danger", "Negative"],
  ["--z-warning", "Warning"],
  ["--z-info", "Info"],
] as const;

function FoundationsSection() {
  return (
    <KitSection id="foundations" title="Foundations" subtitle="Tokens from globals.css (--d-*) over @zunialab/tokens (--z-*)">
      <div className="grid gap-[var(--d-gap)] lg:grid-cols-[1.2fr_1fr]">
        <Card>
          <CardHeader title="Type scale" subtitle="Space Grotesk for UI and figures, JetBrains Mono for labels and addresses" />
          <CardBody className="flex flex-col gap-3">
            <div className="flex items-baseline gap-4">
              <span className="w-24 shrink-0 text-[12px] text-fg-dim">Hero 44</span>
              <BigNumber value="$48,213.07" />
            </div>
            <div className="flex items-baseline gap-4">
              <span className="w-24 shrink-0 text-[12px] text-fg-dim">KPI 24</span>
              <BigNumber size="md" value="12.4%" />
            </div>
            <div className="flex items-baseline gap-4">
              <span className="w-24 shrink-0 text-[12px] text-fg-dim">Title 18</span>
              <span className="text-[18px] font-semibold tracking-[-0.02em]">Overview</span>
            </div>
            <div className="flex items-baseline gap-4">
              <span className="w-24 shrink-0 text-[12px] text-fg-dim">Card 15</span>
              <span className="text-[15px] font-medium tracking-[-0.015em]">Allocation by chain</span>
            </div>
            <div className="flex items-baseline gap-4">
              <span className="w-24 shrink-0 text-[12px] text-fg-dim">Body 14</span>
              <span>Balances, staking, governance and IBC across every network you follow.</span>
            </div>
            <div className="flex items-baseline gap-4">
              <span className="w-24 shrink-0 text-[12px] text-fg-dim">Meta 12.5</span>
              <span className="text-[12.5px] text-fg-dim">Value of today&apos;s holdings over time</span>
            </div>
            <div className="flex items-baseline gap-4">
              <span className="w-24 shrink-0 text-[12px] text-fg-dim">Label 11</span>
              <SectionLabel>Earn · Staking</SectionLabel>
            </div>
            <div className="flex items-baseline gap-4">
              <span className="w-24 shrink-0 text-[12px] text-fg-dim">Gradient</span>
              <span className="text-brand-gradient text-[28px] font-bold tracking-[-0.04em]">zunia</span>
            </div>
          </CardBody>
        </Card>
        <Card>
          <CardHeader title="Colour roles" subtitle="Status colours mean good / bad; never categorical" />
          <CardBody>
            <div className="grid grid-cols-3 gap-2 sm:grid-cols-4">
              {SWATCHES.map(([token, name]) => (
                <div key={token} className="flex flex-col gap-1.5">
                  <span className="h-10 rounded-[8px] border border-[var(--d-hairline)]" style={{ background: `var(${token})` }} />
                  <span className="text-[12px] leading-tight text-fg-muted">{name}</span>
                  <span className="font-mono text-[10.5px] leading-tight text-fg-dim">{token}</span>
                </div>
              ))}
            </div>
            <div className="mt-4 flex flex-wrap items-center gap-2 text-[12px] text-fg-muted">
              <span className="rounded-inner border border-hairline bg-card-2 px-2.5 py-1.5">bg-card-2 · border-hairline · rounded-inner</span>
              <span className="rounded-ctl bg-card px-2.5 py-1.5 shadow-pop">bg-card · rounded-ctl · shadow-pop</span>
              <span className="text-pos">text-pos</span>
              <span className="text-neg">text-neg</span>
              <span className="text-accent-text">text-accent-text</span>
            </div>
          </CardBody>
        </Card>
      </div>
    </KitSection>
  );
}

/* ------------------------------------------------------------------ buttons */

function ButtonsSection() {
  const [busy, setBusy] = useState(false);
  const [starred, setStarred] = useState(true);
  return (
    <KitSection id="buttons" title="Buttons" subtitle="32 / 36 / 40px, 10px radius; primary is the crimson button gradient">
      <Card>
        <CardBody className="flex flex-col gap-5">
          <Row label="Variants">
            <Button variant="primary" iconLeft="send">
              Send
            </Button>
            <Button variant="secondary" iconLeft="receive">
              Receive
            </Button>
            <Button variant="outline" iconLeft="swap">
              Swap
            </Button>
            <Button variant="ghost" iconRight="arrowRight">
              All assets
            </Button>
            <Button variant="danger" iconLeft="disconnect">
              Disconnect
            </Button>
          </Row>
          <Row label="Sizes">
            <Button variant="primary" size="sm">
              Claim all
            </Button>
            <Button variant="primary" size="md">
              Claim all
            </Button>
            <Button variant="primary" size="lg">
              Claim all
            </Button>
            <Button variant="secondary" size="sm">
              Small
            </Button>
            <Button variant="secondary" size="lg">
              Large
            </Button>
          </Row>
          <Row label="States">
            <Button
              variant="primary"
              loading={busy}
              onClick={() => {
                setBusy(true);
                setTimeout(() => setBusy(false), 1600);
              }}
            >
              {busy ? "Signing…" : "Sign and send"}
            </Button>
            <Button variant="secondary" disabled>
              Disabled
            </Button>
            <Button variant="outline" href="/markets" iconRight="arrowUpRight">
              Link (next/link)
            </Button>
            <Button variant="ghost" href="https://zunialab.com" iconRight="external">
              External
            </Button>
          </Row>
          <Row label="Icon buttons (tooltips)">
            <IconButton label="Search" icon="search" />
            <IconButton label="Hide amounts" icon="eye" variant="secondary" />
            <IconButton label="Watchlist" icon="star" pressed={starred} onClick={() => setStarred((v) => !v)} variant="outline" />
            <IconButton label="Notifications" icon="notifications" size="sm" />
            <IconButton label="Refresh" icon="refresh" size="lg" variant="secondary" />
            <IconButton label="Remove" icon="close" variant="danger" size="sm" />
          </Row>
        </CardBody>
      </Card>
    </KitSection>
  );
}

/* ------------------------------------------------------------------ cards */

function CardsSection() {
  const [range, setRange] = useState("7d");
  const [netWorth, setNetWorth] = useState(48213.07);
  const [pending, setPending] = useState(false);
  return (
    <KitSection id="cards" title="Cards" subtitle="default · hero (bloom + grain) · inset · interactive · pending refetch">
      <div className="grid items-start gap-[var(--d-gap)] lg:grid-cols-12">
        <Card variant="hero" className="lg:col-span-8" pending={pending}>
          <CardHeader
            title="Net worth"
            subtitle="All chains · 6 networks"
            info="Value of today's holdings at current prices. Unpriced assets are counted, not valued."
            actions={
              <Segmented
                ariaLabel="Range"
                mono
                value={range}
                onChange={setRange}
                options={[
                  { value: "24h", label: "24H" },
                  { value: "7d", label: "7D" },
                  { value: "30d", label: "30D" },
                  { value: "90d", label: "90D" },
                  { value: "1y", label: "1Y" },
                ]}
              />
            }
          />
          <CardBody className="flex flex-col gap-3">
            <BigNumber value={<Money value={netWorth} animate />} />
            <div className="flex flex-wrap items-center gap-3">
              <Delta value={2.31} variant="pill" size="md" period="24h" />
              <Delta value={-412.5} kind="abs" period="24h" />
              <Delta value={6.8} period="7d" />
              <SourceTag source="Numia" at={minutesAgo(2)} />
            </div>
            <div className="flex flex-wrap gap-2 pt-1">
              <Button size="sm" variant="secondary" onClick={() => setNetWorth((v) => Math.round((v * (0.94 + ((v * 7) % 13) / 100)) * 100) / 100)}>
                Tween the figure
              </Button>
              <Button size="sm" variant="ghost" onClick={() => setPending((v) => !v)}>
                {pending ? "Stop refetch" : "Simulate refetch"}
              </Button>
            </div>
          </CardBody>
        </Card>
        <Card className="lg:col-span-4">
          <CardHeader title="Allocation" subtitle="By chain" icon="layers" actions={<IconButton label="More" icon="dots" size="sm" />} />
          <CardBody className="flex flex-col gap-2">
            {[
              ["cosmoshub-4", 41.2],
              ["osmosis-1", 27.5],
              ["celestia", 18.1],
              ["safrochain-1", 13.2],
            ].map(([id, share]) => (
              <div key={id as string} className="flex items-center gap-2.5">
                <ChainLogo chainId={id as string} size={20} />
                <span className="flex-1 truncate text-[13.5px]">{chainName(id as string)}</span>
                <span className="w-24">
                  <ProgressBar value={share as number} label={`${chainName(id as string)} share`} />
                </span>
                <Percent value={share as number} digits={1} className="w-12 text-right text-[13px] tabular-nums text-fg-muted" />
              </div>
            ))}
          </CardBody>
          <CardFooter>
            <Dot tone="warning" /> 3 assets without a price are not counted
          </CardFooter>
        </Card>
        <Card className="lg:col-span-4">
          <CardHeader title="Inset blocks" subtitle="Nested surfaces use card-2 and a 12px radius" />
          <div className="grid grid-cols-2 gap-2">
            <Card variant="inset">
              <SectionLabel>Liquid</SectionLabel>
              <Money value={18402.11} className="text-[16px] font-semibold" />
            </Card>
            <Card variant="inset">
              <SectionLabel>Staked</SectionLabel>
              <Money value={27110.4} className="text-[16px] font-semibold" />
            </Card>
          </div>
        </Card>
        <Card variant="interactive" href="/markets" className="lg:col-span-4">
          <CardHeader title="Interactive card" subtitle="The whole card is a link" icon="markets" actions={<Badge tone="accent">New</Badge>} />
          <p className="text-[13px] text-fg-muted">Hover lifts the edge; focus shows the ring.</p>
        </Card>
        <Card className="lg:col-span-4">
          <CardHeader title="Empty card" subtitle="Compact, never tall" />
          <EmptyState icon="inbox" title="No rewards yet" body="Stake on a followed chain to start earning." action={<Button size="sm" variant="primary">Stake</Button>} />
        </Card>
      </div>
    </KitSection>
  );
}

/* ------------------------------------------------------------------ KPI */

function KpiSection() {
  return (
    <KitSection id="kpis" title="Stat tiles" subtitle="KPI strip: label, figure, delta, trend, info, action, loading">
      <div className="grid grid-cols-1 gap-[var(--d-gap)] sm:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-6">
        <StatTile
          label="Est. yearly yield"
          value={<Money value={2148.33} />}
          sub="12.4% weighted APR"
          info="Staked value × each chain's actual APR (after community tax). An estimate."
          trend={[10, 12, 11, 13, 14, 13.5, 15, 16]}
        />
        <StatTile
          label="Claimable rewards"
          tone="accent"
          value={<Money value={84.17} />}
          delta={{ value: 12.5, kind: "abs", period: "since yesterday" }}
          href="/staking"
          info="Rewards accrued on every followed chain, claimable now. The tile opens Staking; the button claims."
          action={
            <Button size="sm" variant="primary" onClick={() => toast.info("Sample: this would open the claim review.")}>
              Claim all
            </Button>
          }
        />
        <StatTile label="Staked ratio" value={<Percent value={58.2} digits={1} />} sub="of liquid + staked" delta={{ value: -1.2, kind: "pct", period: "7d" }} />
        <StatTile label="Networks" value="6 of 7" sub={<span className="inline-flex items-center gap-1.5"><Dot tone="warning" />1 unreachable</span>} icon="networks" href="/chains" />
        <StatTile label="Assets" value="23" sub="3 without a price" trend={[3, 4, 4, 5, 7, 6, 8]} tone="positive" />
        <StatTile label="Open votes" value="—" loading delta={{ value: null, kind: "pct" }} />
      </div>
    </KitSection>
  );
}

/* ------------------------------------------------------------------ numbers */

function NumbersSection() {
  const [value, setValue] = useState(1234.56);
  return (
    <KitSection id="numbers" title="Figures" subtitle="Money · TokenAmount · Percent · Delta · AnimatedNumber (privacy-aware)">
      <div className="grid gap-[var(--d-gap)] lg:grid-cols-2">
        <Card>
          <CardHeader title="Money" subtitle="Smart precision for small prices; compact with the exact figure on hover" />
          <CardBody>
            <dl className="grid grid-cols-[1fr_auto] gap-x-6 gap-y-2 text-[14px] tabular-nums">
              <dt className="text-fg-dim">OSMO price</dt>
              <dd className="text-right">
                <Money value={0.028734} masked={false} />
              </dd>
              <dt className="text-fg-dim">SAF price</dt>
              <dd className="text-right">
                <Money value={0.000012} masked={false} />
              </dd>
              <dt className="text-fg-dim">Value (compact)</dt>
              <dd className="text-right">
                <Money value={12431.8} compact />
              </dd>
              <dt className="text-fg-dim">Change (signed)</dt>
              <dd className="text-right">
                <Money value={-412.5} signed />
              </dd>
              <dt className="text-fg-dim">EUR</dt>
              <dd className="text-right">
                <Money value={1520.4} currency="eur" />
              </dd>
              <dt className="text-fg-dim">Unpriced</dt>
              <dd className="text-right">
                <Money value={null} reason="No market price for DYMA" />
              </dd>
            </dl>
          </CardBody>
        </Card>
        <Card>
          <CardHeader title="Token amounts" subtitle="Base units → display, cut never rounded up" />
          <CardBody>
            <dl className="grid grid-cols-[1fr_auto] gap-x-6 gap-y-2 text-[14px] tabular-nums">
              <dt className="text-fg-dim">12345678 uatom</dt>
              <dd className="text-right">
                <TokenAmount amount="12345678" decimals={6} symbol="ATOM" />
              </dd>
              <dt className="text-fg-dim">0.9999999 (display)</dt>
              <dd className="text-right">
                <TokenAmount amount={0.9999999} symbol="OSMO" />
              </dd>
              <dt className="text-fg-dim">Compact</dt>
              <dd className="text-right">
                <TokenAmount amount="1234567890000" decimals={6} compact symbol="SAF" />
              </dd>
              <dt className="text-fg-dim">18 decimals</dt>
              <dd className="text-right">
                <TokenAmount amount="1234567890123456789" decimals={18} symbol="INJ" />
              </dd>
              <dt className="text-fg-dim">Dust</dt>
              <dd className="text-right">
                <TokenAmount amount="3" decimals={6} maxFraction={4} symbol="TIA" />
              </dd>
              <dt className="text-fg-dim">Unknown decimals</dt>
              <dd className="text-right">
                <TokenAmount amount="12340000" decimals={null} symbol="IBC/27…" />
              </dd>
            </dl>
          </CardBody>
        </Card>
        <Card>
          <CardHeader title="Deltas and percentages" subtitle="Arrow + sign + colour; neutral when unknown or zero" />
          <CardBody className="flex flex-col gap-4">
            <Row label="Text">
              <Delta value={2.31} period="24h" />
              <Delta value={-4.07} period="24h" />
              <Delta value={0} />
              <Delta value={null} reason="No price history" />
              <Delta value={1.5} goodWhen="down" period="commission" />
              <Delta value={1250} kind="abs" />
            </Row>
            <Row label="Pill">
              <Delta value={12.4} variant="pill" />
              <Delta value={-0.82} variant="pill" />
              <Delta value={0} variant="pill" />
              <Delta value={3.1} variant="pill" size="md" period="7d" />
            </Row>
            <Row label="Percent">
              <Percent value={12.3} digits={1} />
              <Percent value={-0.5} signed />
              <Percent value={0.004} />
              <Percent value={null} reason="APR not computable on this chain" />
            </Row>
          </CardBody>
        </Card>
        <Card>
          <CardHeader title="AnimatedNumber" subtitle="450 ms tween; instant with reduced motion; never counts up from zero" />
          <CardBody className="flex flex-col gap-3">
            <BigNumber size="lg" value={<AnimatedNumber value={value} format={(n) => formatFiat(n, "usd")} />} />
            <div className="flex gap-2">
              <Button size="sm" variant="secondary" onClick={() => setValue((v) => Math.round(v * 1.37 * 100) / 100)}>
                Up 37%
              </Button>
              <Button size="sm" variant="secondary" onClick={() => setValue((v) => Math.round(v * 0.61 * 100) / 100)}>
                Down 39%
              </Button>
            </div>
          </CardBody>
        </Card>
      </div>
    </KitSection>
  );
}

/* ------------------------------------------------------------------ badges & logos */

function BadgesSection() {
  return (
    <KitSection id="badges" title="Badges, logos, text" subtitle="Tags, statuses, key caps, logos with fallbacks, addresses, provenance">
      <div className="grid gap-[var(--d-gap)] lg:grid-cols-2">
        <Card>
          <CardBody className="flex flex-col gap-4">
            <Row label="Badge">
              <Badge>Native</Badge>
              <Badge tone="info">IBC</Badge>
              <Badge tone="success" icon="check">
                Verified
              </Badge>
              <Badge tone="warning">Unpriced</Badge>
              <Badge tone="danger">Jailed</Badge>
              <Badge tone="accent">New</Badge>
              <Badge tone="info" variant="outline" size="md">
                Outline md
              </Badge>
            </Row>
            <Row label="StatusBadge">
              <StatusBadge tone="success">Active</StatusBadge>
              <StatusBadge tone="warning">Inactive</StatusBadge>
              <StatusBadge tone="danger">Jailed</StatusBadge>
              <StatusBadge tone="info" pulse>
                Voting
              </StatusBadge>
              <StatusBadge tone="neutral">Ended</StatusBadge>
            </Row>
            <Row label="Soon · Kbd · Partial data">
              <SoonBadge />
              <Kbd>⌘K</Kbd>
              <Kbd>Esc</Kbd>
              <Kbd>/</Kbd>
              <PartialDataBadge
                errors={[
                  { chainId: "juno-1", scope: "balances", message: "The node did not answer within 6 s." },
                  { chainId: "akashnet-2", scope: "staking", message: "Rate limited by the public endpoint." },
                ]}
              />
            </Row>
          </CardBody>
        </Card>
        <Card>
          <CardBody className="flex flex-col gap-4">
            <Row label="AssetLogo (chain badge, monogram fallback)">
              <AssetLogo src={chainIcon("cosmoshub-4")} symbol="ATOM" size={32} badgeSrc={chainIcon("osmosis-1")} badgeLabel="Osmosis" />
              <AssetLogo src={chainIcon("celestia")} symbol="TIA" size={32} />
              <AssetLogo src="https://example.invalid/broken.png" symbol="USDC.n" size={32} badgeSrc={chainIcon("osmosis-1")} />
              <AssetLogo symbol="DYMA" size={32} />
              <AssetLogo src={chainIcon("safrochain-1")} symbol="SAF" size={24} />
            </Row>
            <Row label="ChainLogo · ring · LogoStack">
              <ChainLogo chainId="safrochain-1" size={32} ring labelled />
              <ChainLogo chainId="osmosis-1" size={32} labelled />
              <ChainLogo chainId="does-not-exist" size={32} labelled />
              <LogoStack
                items={["cosmoshub-4", "osmosis-1", "celestia", "akashnet-2", "juno-1", "injective-1"].map((id) => ({ src: chainIcon(id), label: chainName(id) }))}
                size={24}
              />
            </Row>
            <Row label="Address · hash · links · source">
              <AddressText address="addr_safro1gv86dp8wmnmmatdckgr5xkevnpmy4662qudn7e" />
              <AddressText address="cosmos1gv86dp8wmnmmatdckgr5xkevnpmy4662csvy4f" href="https://www.mintscan.io" copy={false} />
              <span className="inline-flex items-center gap-1 font-mono text-[12.5px] text-fg-muted">
                A1B2C3…9F0E <CopyButton value="A1B2C3D4E5F60718293A4B5C6D7E8F9012345678" label="transaction hash" />
              </span>
              <ExternalLink href="https://docs.zunialab.com">Docs</ExternalLink>
              <SourceTag source="Coinstore SAF/USDT" at={minutesAgo(14)} />
              <SourceTag source="Chain LCD" estimate />
              <RelativeTime at={LOADED_AT + 2 * 86_400_000 + 3_600_000} prefix="Ends" className="text-[13px] text-fg-muted" />
            </Row>
          </CardBody>
        </Card>
      </div>
    </KitSection>
  );
}

/* ------------------------------------------------------------------ choice */

function ChoiceSection() {
  const [type, setType] = useState("all");
  const [kinds, setKinds] = useState<string[]>(["transfers", "ibc"]);
  const [view, setView] = useState("chain");
  const [range, setRange] = useState("30d");
  const [tab, setTab] = useState("voting");
  const [chips, setChips] = useState(["Osmosis", "Hide < $1"]);
  return (
    <KitSection id="choice" title="Chips, segmented, tabs" subtitle="Roving focus: one tab stop, arrows move, Home/End jump">
      <div className="grid gap-[var(--d-gap)] lg:grid-cols-2">
        <Card>
          <CardBody className="flex flex-col gap-4">
            <Row label="ChipGroup single (radiogroup)">
              <ChipGroup
                type="single"
                ariaLabel="Asset type"
                value={type}
                onChange={setType}
                items={[
                  { value: "all", label: "All", count: 23 },
                  { value: "native", label: "Native", count: 9 },
                  { value: "ibc", label: "IBC", count: 12 },
                  { value: "staked", label: "Staked", count: 4 },
                ]}
              />
            </Row>
            <Row label="ChipGroup multi (toggles)">
              <ChipGroup
                type="multi"
                ariaLabel="Transaction types"
                value={kinds}
                onChange={setKinds}
                items={[
                  { value: "transfers", label: "Transfers", icon: "send" },
                  { value: "ibc", label: "IBC", icon: "bridge" },
                  { value: "swaps", label: "Swaps", icon: "swap" },
                  { value: "staking", label: "Staking", icon: "staking" },
                  { value: "failed", label: "Failed", icon: "danger" },
                ]}
              />
            </Row>
            <Row label="Removable chips">
              {chips.map((label) => (
                <Chip key={label} onRemove={() => setChips((list) => list.filter((c) => c !== label))} leading={label === "Osmosis" ? <ChainLogo chainId="osmosis-1" size={16} /> : undefined}>
                  {label}
                </Chip>
              ))}
              {chips.length === 0 ? (
                <Button size="sm" variant="ghost" onClick={() => setChips(["Osmosis", "Hide < $1"])}>
                  Reset
                </Button>
              ) : null}
            </Row>
          </CardBody>
        </Card>
        <Card>
          <CardBody className="flex flex-col gap-4">
            <Row label="Segmented sm · md · mono">
              <Segmented
                ariaLabel="Group by"
                value={view}
                onChange={setView}
                options={[
                  { value: "chain", label: "By chain" },
                  { value: "asset", label: "By asset" },
                  { value: "type", label: "By type" },
                ]}
              />
              <Segmented
                ariaLabel="Layout"
                size="md"
                value={view === "asset" ? "list" : "grid"}
                onChange={(next) => setView(next === "list" ? "asset" : "chain")}
                options={[
                  { value: "grid", label: "Grid", icon: "grid" },
                  { value: "list", label: "List", icon: "list" },
                ]}
              />
              <Segmented
                ariaLabel="Range"
                mono
                value={range}
                onChange={setRange}
                options={[
                  { value: "7d", label: "7D" },
                  { value: "30d", label: "30D" },
                  { value: "90d", label: "90D" },
                  { value: "all", label: "All" },
                ]}
              />
            </Row>
            <div className="flex flex-col gap-3">
              <SectionLabel>Tabs</SectionLabel>
              <Tabs
                id="kit-gov"
                ariaLabel="Proposals"
                value={tab}
                onChange={setTab}
                items={[
                  { value: "voting", label: "Voting now", count: 3 },
                  { value: "deposit", label: "Deposit", count: 1 },
                  { value: "passed", label: "Passed" },
                  { value: "rejected", label: "Rejected / Failed" },
                ]}
              />
              {["voting", "deposit", "passed", "rejected"].map((value) => (
                <TabPanel key={value} tabsId="kit-gov" value={value} active={tab === value} className="text-[13px] text-fg-muted">
                  Panel for “{value}”.
                </TabPanel>
              ))}
            </div>
          </CardBody>
        </Card>
      </div>
    </KitSection>
  );
}

/* ------------------------------------------------------------------ forms */

const PICKER_CHAINS: ChainEntry[] = sortChains(CHAINS.filter((chain) => chain.network === "mainnet"));
const FOLLOWED = new Set(["safrochain-1", "cosmoshub-4", "osmosis-1", "celestia"]);

function FormsSection() {
  const [query, setQuery] = useState("");
  const [memo, setMemo] = useState("");
  const [amount, setAmount] = useState("12.5");
  const [dust, setDust] = useState("");
  const [fee, setFee] = useState("average");
  const [notify, setNotify] = useState(true);
  const [digest, setDigest] = useState(false);
  const [terms, setTerms] = useState(true);
  const [chainId, setChainId] = useState<string | null>("osmosis-1");
  const chain = chainId ? chainById(chainId) : undefined;
  const amountNumber = Number(amount);
  return (
    <KitSection id="forms" title="Forms" subtitle="Inputs, search, amount (cut, never rounded), select, switch, checkbox, combobox">
      <div className="grid gap-[var(--d-gap)] lg:grid-cols-2">
        <Card>
          <CardBody className="flex flex-col gap-4">
            <SearchInput value={query} onChange={setQuery} placeholder="Search assets, chains, actions" shortcutHint="⌘K" />
            <Input label="Recipient" placeholder="cosmos1…" mono hint="The prefix picks the destination chain." leading={<span className="text-[12px]">To</span>} />
            <Input
              label="Memo"
              value={memo}
              onChange={(event) => setMemo(event.target.value)}
              placeholder="Optional"
              error={memo.length > 20 ? "Memos over 20 characters are rejected by this exchange." : undefined}
              trailing={<span className="font-mono text-[11px]">{memo.length}/256</span>}
            />
            <Select
              label="Network fee"
              value={fee}
              onChange={setFee}
              options={[
                { value: "low", label: "Low · 0.0025 ATOM" },
                { value: "average", label: "Average · 0.005 ATOM" },
                { value: "high", label: "High · 0.0075 ATOM" },
              ]}
            />
            <div className="flex flex-col gap-1.5">
              <span className="text-[12.5px] font-medium text-fg-muted">Combobox</span>
              <Combobox
                title="Choose a chain"
                items={PICKER_CHAINS}
                getKey={(item) => item.chainId}
                value={chainId}
                onSelect={(item) => setChainId(item.chainId)}
                placeholder="Search 220 networks"
                groupBy={(item) => (FOLLOWED.has(item.chainId) ? "Followed" : "All mainnets")}
                filter={(item, q) => item.chainName.toLowerCase().includes(q) || item.chainId.includes(q) || item.coinDenom.toLowerCase().includes(q)}
                renderItem={(item) => (
                  <span className="flex items-center gap-2.5">
                    <ChainLogo chainId={item.chainId} size={22} />
                    <span className="min-w-0">
                      <span className="block truncate">{item.chainName}</span>
                      <span className="block truncate font-mono text-[11px] text-fg-dim">{item.chainId}</span>
                    </span>
                  </span>
                )}
                trigger={
                  <Button data-kit="chain-picker" variant="secondary" className="justify-start" fullWidth iconRight={<Icon name="chevronsUpDown" size={14} className="ml-auto text-fg-dim" />}>
                    {chain ? <ChainLogo chainId={chain.chainId} size={18} /> : null}
                    <span className="truncate">{chain?.chainName ?? "Choose a chain"}</span>
                  </Button>
                }
              />
            </div>
          </CardBody>
        </Card>
        <Card>
          <CardBody className="flex flex-col gap-4">
            <AmountInput
              label="You send"
              value={amount}
              onChange={setAmount}
              symbol="ATOM"
              decimals={6}
              max="1520.384217"
              fiatValue={Number.isFinite(amountNumber) && amount !== "" ? amountNumber * 1.79 : undefined}
              error={amountNumber > 1520.384217 ? "More than your available balance." : undefined}
            />
            <AmountInput label="Unknown decimals" value={dust} onChange={setDust} symbol="IBC/27…" decimals={null} max="12340000" fiatValue={null} />
            <Divider />
            <Switch checked={notify} onCheckedChange={setNotify} label="Incoming transfers" description="Notify when tokens arrive on a followed chain." />
            <Switch checked={digest} onCheckedChange={setDigest} label="Daily digest" description="One summary at 9:00 instead of instant alerts." />
            <div className="flex flex-wrap gap-5">
              <Checkbox checked={terms} onCheckedChange={setTerms} label="I understand this swap moves funds first" />
              <Checkbox checked="indeterminate" onCheckedChange={() => undefined} label="Some chains" />
              <Checkbox checked={false} onCheckedChange={() => undefined} label="Disabled" disabled />
            </div>
          </CardBody>
        </Card>
      </div>
    </KitSection>
  );
}

/* ------------------------------------------------------------------ feedback */

function FeedbackSection() {
  return (
    <KitSection id="feedback" title="States and progress" subtitle="Skeleton on first load · compact empty · inline error · callouts · steps">
      <div className="grid gap-[var(--d-gap)] lg:grid-cols-3">
        <Card>
          <CardHeader title="Loading" refreshing />
          <CardBody className="flex flex-col gap-4">
            <div className="flex items-center gap-3">
              <Skeleton circle width={32} />
              <SkeletonText lines={2} className="flex-1" />
            </div>
            <Skeleton className="h-24 w-full rounded-[10px]" />
            <div className="flex items-center gap-3 text-[13px] text-fg-dim">
              <Spinner size={14} /> Spinner
              <Spinner size={20} className="text-[var(--d-accent-text)]" />
            </div>
          </CardBody>
        </Card>
        <Card>
          <CardHeader title="Error and empty" />
          <CardBody className="flex flex-col gap-3">
            <InlineError message="Osmosis LCD did not answer within 6 seconds." onRetry={() => toast.info("Retrying…")} />
            <EmptyState inline icon="search" title="No matches" body="Try another ticker or chain." />
            <Disclosure summary="Why is APR “—” on this chain?">
              The chain does not expose annual provisions, so the actual APR cannot be computed. Nothing is guessed.
            </Disclosure>
          </CardBody>
        </Card>
        <Card>
          <CardHeader title="Progress" />
          <CardBody className="flex flex-col gap-4">
            <ProgressBar value={62} label="Quorum" showValue />
            <ProgressBar value={33.4} tone="warning" size="md" label="Top validators" showValue />
            <Stepper
              steps={[
                { label: "Move to Osmosis", state: "done" },
                { label: "Swap", state: "current" },
                { label: "Deliver", state: "todo" },
              ]}
            />
          </CardBody>
        </Card>
        <Card className="lg:col-span-2">
          <CardHeader title="Callouts" />
          <CardBody className="grid gap-2 sm:grid-cols-2">
            <Callout tone="info" title="Two steps">
              This swap moves your SAF to Osmosis first, then swaps.
            </Callout>
            <Callout tone="warning" title="Exchange address" action={<Button size="sm">Add memo</Button>}>
              Exchanges usually need a memo.
            </Callout>
            <Callout tone="success" title="Confirmed">
              Included in block 4,182,019.
            </Callout>
            <Callout tone="danger" title="Insufficient fee balance">
              You need 0.005 ATOM on Cosmos Hub to pay the fee.
            </Callout>
            <Callout tone="neutral" icon="lock">
              Your keys stay in your wallet. This page never asks for a recovery phrase.
            </Callout>
            <Callout tone="accent" title="Zunia fee">
              0.5% of the amount sold, shown before you sign.
            </Callout>
          </CardBody>
        </Card>
        <Card>
          <CardHeader title="Vertical stepper" />
          <Stepper
            orientation="vertical"
            steps={[
              { label: "Submitted", state: "done", description: "Oct 7, 2:31 PM" },
              { label: "Relayed", state: "done", description: "channel-141 → channel-0" },
              { label: "Acknowledged", state: "error", description: "Timeout: refund pending" },
              { label: "Refunded", state: "todo" },
            ]}
          />
        </Card>
      </div>
    </KitSection>
  );
}

/* ------------------------------------------------------------------ overlays */

function OverlaySection() {
  const [dialog, setDialog] = useState(false);
  const [sheet, setSheet] = useState(false);
  return (
    <KitSection id="overlays" title="Overlays and toasts" subtitle="Tooltip · InfoTip (hover, tap, keyboard) · Popover · Menu · Dialog · Sheet · Toaster">
      <Card>
        <CardBody className="flex flex-col gap-5">
          <Row label="Floating">
            <Tooltip content="Copies your Osmosis address">
              <Button variant="secondary" size="sm">
                Hover me
              </Button>
            </Tooltip>
            <span className="inline-flex items-center gap-1.5 text-[13.5px]">
              Actual APR <InfoTip content="Annual provisions × observed blocks per year ÷ bonded tokens, after community tax." />
            </span>
            <Popover
              trigger={
                <Button variant="secondary" size="sm" iconRight="chevronDown">
                  Popover
                </Button>
              }
              ariaLabel="Scope"
            >
              <p className="text-[13.5px] font-medium">All chains</p>
              <p className="mt-1 text-[12.5px] text-fg-dim">6 networks · mainnet</p>
              <Divider className="my-3" />
              <Button size="sm" variant="ghost" fullWidth className="justify-start" iconLeft="networks">
                Manage networks
              </Button>
            </Popover>
            <Menu
              trigger={<IconButton label="Row actions" icon="dots" variant="secondary" />}
              items={[
                { type: "label", label: "ATOM on Osmosis" },
                { label: "Send", icon: "send", shortcut: "S" },
                { label: "Swap", icon: "swap", shortcut: "W" },
                { label: "Bridge", icon: "bridge", description: "IBC to Cosmos Hub" },
                { type: "separator" },
                { label: "View on Mintscan", icon: "external", href: "https://www.mintscan.io", external: true },
                { label: "Hide asset", icon: "eyeOff", tone: "danger" },
                { label: "Stake", icon: "staking", disabled: true },
              ]}
            />
          </Row>
          <Row label="Modal">
            <Button variant="primary" onClick={() => setDialog(true)}>
              Open dialog
            </Button>
            <Button variant="secondary" onClick={() => setSheet(true)}>
              Open sheet
            </Button>
          </Row>
          <Row label="Toasts">
            <Button size="sm" variant="secondary" onClick={() => toast.success("Sent 12.5 ATOM", { description: "Included in block 4,182,019.", action: { label: "View", href: "/activity" } })}>
              Success
            </Button>
            <Button size="sm" variant="secondary" onClick={() => toast.error("Transaction failed", { description: "out of gas in location: WritePerByte; gasWanted: 200000" })}>
              Error
            </Button>
            <Button
              size="sm"
              variant="secondary"
              onClick={() => {
                const id = toast.loading("Waiting for confirmation…");
                setTimeout(() => toast.success("Confirmed", { id, description: "Swap of 10 OSMO → 0.16 ATOM." }), 1800);
              }}
            >
              Loading → success
            </Button>
            <Button size="sm" variant="ghost" onClick={() => toast.info("Push is not available on this deployment.")}>
              Info
            </Button>
          </Row>
        </CardBody>
      </Card>
      <Dialog
        open={dialog}
        onOpenChange={setDialog}
        title="Confirm swap"
        description="Review the amounts. The swap fails rather than fills below the minimum."
        footer={
          <>
            <Button variant="ghost" onClick={() => setDialog(false)}>
              Cancel
            </Button>
            <Button variant="primary" onClick={() => setDialog(false)}>
              Sign in wallet
            </Button>
          </>
        }
      >
        <div className="flex flex-col gap-3">
          <KeyValueList
            divided
            items={[
              { key: "pay", label: "You pay", value: "10 OSMO", emphasis: true },
              { key: "get", label: "You receive (est.)", value: "0.1603 ATOM", sub: "Sample figures", emphasis: true },
              { key: "min", label: "Minimum received", value: "0.1587 ATOM", info: "The swap fails rather than fills below this amount (1% slippage)." },
              { key: "fee", label: "Zunia fee (0.5%)", value: "0.05 OSMO" },
              { key: "gas", label: "Network fee", value: "0.0031 OSMO" },
            ]}
          />
          <Disclosure summary="Transaction details" variant="inset">
            <pre className="d-scroll overflow-x-auto font-mono text-[11.5px] leading-[1.5] text-fg-muted">{`/osmosis.poolmanager.v1beta1.MsgSwapExactAmountIn
  sender: osmo1gv86…l5rm
  routes: [{ pool_id: 1, token_out_denom: "ibc/27…" }]
  token_in: 10000000uosmo`}</pre>
          </Disclosure>
        </div>
      </Dialog>
      <Sheet open={sheet} onOpenChange={setSheet} title="Notifications" description="3 unread" footer={<Button variant="ghost" size="sm">Open notification center</Button>}>
        <div className="flex flex-col divide-y divide-[var(--d-hairline)]">
          {["Received 25 OSMO on Osmosis", "Rewards ready on Cosmos Hub", "Proposal #942 ends in 6 h"].map((line) => (
            <div key={line} className="flex items-start gap-3 py-3">
              <Dot tone="accent" className="mt-2" />
              <div>
                <p className="text-[13.5px]">{line}</p>
                <p className="text-[12px] text-fg-dim">2 min ago</p>
              </div>
            </div>
          ))}
        </div>
      </Sheet>
    </KitSection>
  );
}

/* ------------------------------------------------------------------ table */

function TableSection() {
  const all = SAMPLE;
  const [query, setQuery] = useState("");
  const [kind, setKind] = useState("all");
  const [density, setDensity] = useState<"comfortable" | "compact">("comfortable");
  const [hideSmall, setHideSmall] = useState(false);
  const [loading, setLoading] = useState(false);
  const [selected, setSelected] = useState<string | null>(null);

  // Priced rows only: an unpriced position is counted (footer), never valued at 0.
  const total = all.reduce((sum, row) => sum + (valueOf(row) ?? 0), 0);
  const unpriced = all.filter((row) => valueOf(row) === null).length;
  const rows = all.filter((row) => {
    if (kind !== "all" && row.kind.toLowerCase() !== kind) return false;
    if (hideSmall && (valueOf(row) ?? 0) < 1) return false;
    const q = query.trim().toLowerCase();
    return !q || row.symbol.toLowerCase().includes(q) || row.name.toLowerCase().includes(q) || chainName(row.chainId).toLowerCase().includes(q);
  });

  const columns: Column<SampleAsset>[] = [
    {
      key: "asset",
      header: "Asset",
      sortable: true,
      sortValue: (row) => row.symbol,
      sticky: true,
      minWidth: 200,
      cell: (row) => (
        <span className="flex min-w-0 items-center gap-2.5">
          <AssetLogo src={chainIcon(row.originChainId)} symbol={row.symbol} size={28} badgeSrc={row.kind === "IBC" ? chainIcon(row.chainId) : undefined} badgeLabel={chainName(row.chainId)} />
          <span className="min-w-0">
            <span className="flex items-center gap-1.5">
              <span className="truncate font-medium">{row.symbol}</span>
              {row.kind !== "Native" ? <Badge>{row.kind}</Badge> : null}
            </span>
            <span className="block truncate text-[12.5px] text-fg-dim">
              {row.name} · {chainName(row.chainId)}
            </span>
          </span>
        </span>
      ),
    },
    {
      key: "price",
      header: "Price",
      align: "right",
      sortable: true,
      sortValue: (row) => row.price,
      cell: (row) => <Money value={row.price} masked={false} reason="No market price" />,
    },
    {
      key: "change",
      header: "24h",
      align: "right",
      sortable: true,
      hideBelow: "md",
      sortValue: (row) => row.change24h,
      cell: (row) => <Delta value={row.change24h} reason="No price history" />,
    },
    {
      key: "balance",
      header: "Balance",
      align: "right",
      sortable: true,
      hideBelow: "lg",
      sortValue: (row) => displayAmount(row),
      cell: (row) => <TokenAmount amount={row.balance} decimals={row.decimals} maxFraction={4} symbol={row.symbol} />,
    },
    {
      key: "value",
      header: "Value",
      align: "right",
      sortable: true,
      sortValue: valueOf,
      cell: (row) => <Money value={valueOf(row)} reason={row.decimals === null ? "Decimals unknown" : "No market price"} className="font-medium" />,
    },
    {
      key: "share",
      header: "Share",
      align: "right",
      hideBelow: "xl",
      width: 140,
      cell: (row) => {
        const value = valueOf(row);
        const share = value === null || total === 0 ? null : (value / total) * 100;
        return <ShareBar value={share} reason={row.decimals === null ? "Decimals unknown" : "No market price"} />;
      },
    },
    {
      key: "actions",
      header: <span className="sr-only">Actions</span>,
      align: "right",
      width: 48,
      cell: (row) => (
        <Menu
          trigger={<IconButton label={`Actions for ${row.symbol}`} icon="dots" size="sm" tooltip={false} />}
          items={[
            { label: "Send", icon: "send" },
            { label: "Swap", icon: "swap" },
            { label: "Bridge", icon: "bridge" },
            { type: "separator" },
            { label: "Select row", icon: "check", onSelect: () => setSelected(row.key) },
          ]}
        />
      ),
    },
  ];

  return (
    <KitSection id="table" title="DataTable" subtitle="30 sample rows · sortable · sticky header · expandable · cards under 640px">
      <FilterBar
        end={
          <>
            <Switch checked={hideSmall} onCheckedChange={setHideSmall} label="Hide < $1" className="items-center gap-2" />
            <Segmented
              ariaLabel="Density"
              value={density}
              onChange={setDensity}
              options={[
                { value: "comfortable", label: "Comfortable" },
                { value: "compact", label: "Compact" },
              ]}
            />
          </>
        }
      >
        <SearchInput value={query} onChange={setQuery} placeholder="Filter assets" className="w-full sm:w-64" shortcutHint="/" />
        <ChipGroup
          type="single"
          ariaLabel="Asset type"
          value={kind}
          onChange={setKind}
          scroll
          items={[
            { value: "all", label: "All" },
            { value: "native", label: "Native" },
            { value: "ibc", label: "IBC" },
            { value: "factory", label: "Factory" },
          ]}
        />
      </FilterBar>
      <Card pending={loading && rows.length > 0}>
        <CardHeader
          title="Holdings"
          subtitle="Sample data · 30 positions across 3 chains"
          actions={
            <>
              <PartialDataBadge errors={[{ chainId: "juno-1", scope: "balances", message: "Timed out after 6 s." }]} />
              <Button
                size="sm"
                variant="ghost"
                iconLeft="download"
                onClick={() =>
                  downloadCsv(
                    csvFileName("zunia-kit-sample-holdings"),
                    toCsv(rows, [
                      { header: "Asset", value: (row) => row.symbol },
                      { header: "Chain", value: (row) => row.chainId },
                      { header: "Balance (base units)", value: (row) => BigInt(row.balance) },
                      { header: "Decimals", value: (row) => row.decimals },
                      { header: "Price (USD)", value: (row) => row.price },
                      { header: "Value (USD)", value: valueOf },
                    ]),
                  )
                }
              >
                CSV
              </Button>
              <Button
                size="sm"
                variant="secondary"
                iconLeft="refresh"
                onClick={() => {
                  setLoading(true);
                  setTimeout(() => setLoading(false), 1500);
                }}
              >
                Refetch
              </Button>
            </>
          }
        />
        <CardBody flush>
          <DataTable
            ariaLabel="Sample holdings"
            columns={columns}
            rows={rows}
            getRowKey={(row) => row.key}
            density={density}
            initialSort={{ key: "value", dir: "desc" }}
            selectedRowKey={selected}
            onRowClick={(row) => setSelected(row.key)}
            renderExpanded={(row) => (
              <div className="flex flex-wrap items-center gap-x-6 gap-y-2 text-[13px] text-fg-muted">
                <span>
                  Origin: <span className="text-fg">{chainName(row.originChainId)}</span>
                </span>
                <span>
                  Held on: <span className="text-fg">{chainName(row.chainId)}</span>
                </span>
                <span>
                  Base units: <span className="font-mono text-[12px] text-fg">{row.balance}</span>
                </span>
                <SourceTag source="Numia" at={minutesAgo(3)} />
              </div>
            )}
            empty={<EmptyState icon="search" title="No assets match" body="Clear the search or pick another type." action={<Button size="sm" variant="secondary" onClick={() => { setQuery(""); setKind("all"); }}>Clear filters</Button>} />}
            mobileCard={(row) => (
              <span className="flex items-center gap-3">
                <AssetLogo src={chainIcon(row.originChainId)} symbol={row.symbol} size={32} badgeSrc={row.kind === "IBC" ? chainIcon(row.chainId) : undefined} />
                <span className="min-w-0 flex-1">
                  <span className="block truncate font-medium">{row.symbol}</span>
                  <span className="block truncate text-[12.5px] text-fg-dim">{chainName(row.chainId)}</span>
                </span>
                <span className="text-right">
                  <Money value={valueOf(row)} className="block font-medium" reason="No price" />
                  <TokenAmount amount={row.balance} decimals={row.decimals} maxFraction={2} compact className="block text-[12.5px] text-fg-dim" />
                </span>
              </span>
            )}
            footer={
              <span className="flex items-center justify-between gap-3">
                <span>
                  {rows.length} of {all.length} positions · {unpriced} without a value
                </span>
                <span className="tabular-nums">
                  Priced total <Money value={total} className="font-medium text-fg" />
                </span>
              </span>
            }
          />
        </CardBody>
      </Card>
      <Card>
        <CardHeader title="Loading and empty" subtitle="First load renders skeleton rows shaped like the columns" />
        <CardBody flush>
          <DataTable ariaLabel="Loading example" columns={columns.slice(0, 5)} rows={[]} getRowKey={(row) => row.key} loading skeletonRows={4} />
        </CardBody>
      </Card>
    </KitSection>
  );
}
