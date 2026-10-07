"use client";

/**
 * The validators table of /validators (research V1): rank, identity, voting
 * power with its place in the cumulative distribution (the ⅓ line marked),
 * commission now → the most it can reach in 30 days, uptime over the
 * signing window, delegator APR, status (when inactive ones are listed) and
 * your stake (when you have some here).
 *
 * Filters a delegator uses: search, outside the Nakamoto set, a commission
 * ceiling, active only. The table sorts here rather than inside DataTable so
 * it can show the first 50 rows of the *whole* sorted list ("Show all" for
 * the rest) once a set is long enough for that to help.
 */

import { useMemo, useState } from "react";
import {
  Badge,
  Button,
  Card,
  CardBody,
  CardHeader,
  Chip,
  DataTable,
  Dot,
  EmptyState,
  InlineError,
  PartialDataBadge,
  Percent,
  SearchInput,
  Select,
  SourceTag,
  StatusBadge,
  Switch,
  TokenAmount,
  type Column,
  type SortState,
} from "@/components/ui";
import { sortRows } from "@/components/ui/table-sort";
import type { PartError } from "@/lib/chain/types";
import { cn } from "@/lib/cn";
import type { ValidatorRow, ValidatorsResponse } from "@/lib/data/validators";
import { percentOf, steepCommissionRise, validatorHref } from "@/components/staking/model";
import { ValidatorIdentity } from "@/components/staking/ValidatorBits";

/** Rows shown before "Show all", once a list is long enough to need it. */
const PAGE_ROWS = 50;
/** Paging only pays off past this: hiding nine rows of 59 just adds a click. */
const PAGE_FROM = 75;

const COMMISSION_FILTERS = [
  { value: "any", label: "Any commission" },
  { value: "0.05", label: "Commission ≤ 5%" },
  { value: "0.1", label: "Commission ≤ 10%" },
  { value: "0.2", label: "Commission ≤ 20%" },
];

/** "10%", "8.9%": one decimal only when it says something (compact rows). */
function shortPct(fraction: number): string {
  const value = Math.round(fraction * 1000) / 10;
  return `${Number.isInteger(value) ? value.toFixed(0) : value.toFixed(1)}%`;
}

/** "100%" for a perfect window, else two decimals ("99.53%"). */
function uptimeText(uptime: number): string {
  return uptime >= 1 - 1e-12 ? "100%" : percentOf(uptime, 2);
}

/** What each sortable column sorts on. */
function sortValueOf(key: string, row: ValidatorRow, mine: ReadonlyMap<string, string>): number | string | null {
  switch (key) {
    case "validator":
      return row.rank;
    case "power":
      return row.status === "bonded" ? row.votingPower : null;
    case "commission":
      return row.commission.rate;
    case "uptime":
      return row.uptime;
    case "apr":
      return row.apr;
    case "yours":
      return mine.has(row.operatorAddress) ? Number(mine.get(row.operatorAddress)) : null;
    default:
      return null;
  }
}

function statusCell(row: ValidatorRow) {
  if (row.tombstoned) return <StatusBadge tone="danger">Tombstoned</StatusBadge>;
  if (row.jailed) return <StatusBadge tone="danger">Jailed</StatusBadge>;
  if (row.status !== "bonded") return <StatusBadge tone="warning">Inactive</StatusBadge>;
  // The usual case stays quiet, so the rare ones stand out.
  return (
    <span className="inline-flex items-center gap-1.5 text-[12.5px] text-fg-dim">
      <Dot tone="success" />
      Active
    </span>
  );
}

/** Where this validator sits in the cumulative distribution, with the ⅓ line. */
function PowerBar({ row }: { row: ValidatorRow }) {
  const cumulative = row.cumulative;
  if (cumulative === null || row.status !== "bonded") return <span className="text-fg-dim">—</span>;
  const before = Math.max(0, cumulative - row.votingPower);
  return (
    <span className="flex items-center justify-end gap-2.5">
      <span className="tabular-nums">{percentOf(row.votingPower)}</span>
      <span
        aria-hidden
        className="relative h-2 w-[72px] shrink-0 overflow-hidden rounded-full bg-[var(--d-glass-2)] max-lg:hidden"
        title={`Top ${row.rank ?? "?"} together: ${percentOf(cumulative, 1)}`}
      >
        <span className="absolute inset-y-0 left-0 bg-[color-mix(in_srgb,var(--viz-accent)_24%,transparent)]" style={{ width: `${before * 100}%` }} />
        <span
          className={cn("absolute inset-y-0", row.inNakamotoSet ? "bg-[var(--viz-warn)]" : "bg-[var(--viz-accent)]")}
          style={{ left: `${before * 100}%`, width: `max(2px, ${row.votingPower * 100}%)` }}
        />
        <span className="absolute inset-y-[-2px] w-px bg-fg-muted" style={{ left: `${(100 / 3).toFixed(2)}%` }} />
      </span>
    </span>
  );
}

export interface ValidatorsTableProps {
  chainId: string;
  chainName: string;
  /** The answer for this chain (null while it loads). */
  data: ValidatorsResponse | null;
  /** The read failed with nothing to show. */
  error: string | null;
  onRetry: () => void;
  /** The answer on screen belongs to the previous chain or filter. */
  pending: boolean;
  activeOnly: boolean;
  onActiveOnlyChange: (activeOnly: boolean) => void;
  /** Your stake per operator on this chain (base units). */
  mine: ReadonlyMap<string, string>;
  symbol: string;
  decimals: number | null;
  /** Why the chain's APR is unknown, when it is. */
  aprNote?: string;
  partial: PartError[];
}

export function ValidatorsTable({
  chainId,
  chainName,
  data,
  error,
  onRetry,
  pending,
  activeOnly,
  onActiveOnlyChange,
  mine,
  symbol,
  decimals,
  aprNote,
  partial,
}: ValidatorsTableProps) {
  const [outsideNakamoto, setOutsideNakamoto] = useState(false);
  const [maxCommission, setMaxCommission] = useState("any");
  const [query, setQuery] = useState("");
  const [sort, setSort] = useState<SortState>({ key: "validator", dir: "asc" });
  // "Show all" resets when the chain or a filter changes.
  const filterKey = `${chainId}|${activeOnly}|${outsideNakamoto}|${maxCommission}|${query}`;
  const [paging, setPaging] = useState({ key: filterKey, all: false });
  if (paging.key !== filterKey) setPaging({ key: filterKey, all: false });

  const rows = useMemo(() => {
    if (!data) return [];
    const q = query.trim().toLowerCase();
    const cap = maxCommission === "any" ? null : Number(maxCommission);
    const kept = data.validators.filter((row) => {
      if (outsideNakamoto && row.inNakamotoSet) return false;
      if (cap !== null && row.commission.rate > cap + 1e-9) return false;
      if (q && !row.moniker.toLowerCase().includes(q) && !row.operatorAddress.toLowerCase().includes(q)) return false;
      return true;
    });
    return sortRows(kept, (row) => sortValueOf(sort.key, row, mine), sort.dir);
  }, [data, query, maxCommission, outsideNakamoto, sort, mine]);
  const paged = rows.length > PAGE_FROM;
  const shown = paging.all || !paged ? rows : rows.slice(0, PAGE_ROWS);

  const columns: Column<ValidatorRow>[] = [
    {
      key: "validator",
      header: "Validator",
      sticky: true,
      minWidth: 200,
      sortable: true,
      sortValue: (row) => row.rank,
      sortDescFirst: false,
      cell: (row) => (
        <span className="flex min-w-0 items-center gap-2">
          <span className="w-6 shrink-0 text-right font-mono text-[11.5px] text-fg-dim">{row.rank ?? "–"}</span>
          <ValidatorIdentity
            className="max-w-[150px] lg:max-w-[240px] xl:max-w-[300px]"
            moniker={row.moniker}
            logoUrl={row.logoUrl}
            size={24}
            aside={mine.has(row.operatorAddress) ? <Badge tone="accent">Yours</Badge> : null}
            nameClassName="text-[13.5px]"
          />
        </span>
      ),
    },
    {
      key: "power",
      header: "Voting power",
      align: "right",
      sortable: true,
      sortValue: (row) => sortValueOf("power", row, mine),
      cell: (row) => <PowerBar row={row} />,
    },
    {
      key: "commission",
      header: "Commission",
      align: "right",
      sortable: true,
      sortValue: (row) => row.commission.rate,
      sortDescFirst: false,
      cell: (row) => {
        const rise = row.commission.reachable30d - row.commission.rate;
        return (
          <span
            className="inline-flex items-baseline justify-end gap-1.5 whitespace-nowrap tabular-nums"
            title={`Now ${percentOf(row.commission.rate)} · highest within 30 days ${percentOf(row.commission.reachable30d)} · hard cap ${percentOf(row.commission.maxRate)}`}
          >
            {percentOf(row.commission.rate, 1)}
            <span
              className={cn(
                "text-[11.5px]",
                steepCommissionRise(row.commission.rate, row.commission.reachable30d) ? "text-[var(--z-warning)]" : "text-fg-dim",
              )}
            >
              {rise > 1e-9 ? `→${percentOf(row.commission.reachable30d, 0)}` : "fixed"}
            </span>
          </span>
        );
      },
    },
    {
      key: "uptime",
      header: "Uptime",
      align: "right",
      hideBelow: "md",
      sortable: true,
      sortValue: (row) => row.uptime,
      cell: (row) =>
        row.uptime === null ? (
          <span className="text-fg-dim" title="Only measured for active validators">
            —
          </span>
        ) : (
          <span
            className={cn(
              "whitespace-nowrap tabular-nums",
              row.uptime < 0.95 ? "text-[var(--z-danger)]" : row.uptime < 0.99 ? "text-[var(--z-warning)]" : undefined,
            )}
            title={
              row.missedBlocks !== null && row.signedWindow
                ? `${row.missedBlocks.toLocaleString("en-US")} missed of the last ${row.signedWindow.toLocaleString("en-US")} blocks`
                : undefined
            }
          >
            {uptimeText(row.uptime)}
            {row.missedBlocks ? (
              <span className="ml-1.5 text-[11.5px] text-fg-dim max-xl:hidden">{row.missedBlocks.toLocaleString("en-US")} missed</span>
            ) : null}
          </span>
        ),
    },
    {
      key: "apr",
      header: "APR",
      align: "right",
      sortable: true,
      sortValue: (row) => row.apr,
      cell: (row) => <Percent value={row.apr === null ? null : row.apr * 100} reason={aprNote ?? "APR unavailable"} />,
    },
    // With "Active only" every row is active: the column would say so 180 times.
    ...(!activeOnly
      ? [
          {
            key: "status",
            header: "Status",
            hideBelow: "lg" as const,
            cell: (row: ValidatorRow) => statusCell(row),
          },
        ]
      : []),
    ...(mine.size > 0
      ? [
          {
            key: "yours",
            header: "Your stake",
            align: "right" as const,
            hideBelow: "xl" as const,
            sortable: true,
            sortValue: (row: ValidatorRow) => sortValueOf("yours", row, mine),
            cell: (row: ValidatorRow) =>
              mine.has(row.operatorAddress) ? (
                <TokenAmount amount={mine.get(row.operatorAddress) ?? "0"} decimals={decimals} symbol={symbol} compact />
              ) : (
                <span className="text-fg-dim">—</span>
              ),
          },
        ]
      : []),
  ];

  const clearFilters = () => {
    setQuery("");
    setOutsideNakamoto(false);
    setMaxCommission("any");
  };

  return (
    <Card as="section" aria-label={`Validators on ${chainName}`} pending={pending && Boolean(data)}>
      <CardHeader
        title="Validators"
        subtitle={
          data
            ? `${chainName} · ${rows.length === data.validators.length ? data.validators.length : `${rows.length} of ${data.validators.length}`} ${
                activeOnly ? "active" : "listed"
              } · ${sort.key === "validator" && sort.dir === "asc" ? "ranked by voting power" : "sorted"}`
            : error
              ? // The error below says why and offers Retry; "reading…" beside it would contradict it.
                chainName
              : `${chainName} · reading the validator set…`
        }
        actions={
          <span className="flex items-center gap-2">
            {partial.length > 0 ? <PartialDataBadge errors={partial} /> : null}
            {data ? <SourceTag source="Chain LCD" at={data.updatedAt} /> : null}
          </span>
        }
      />
      <CardBody flush>
        <div className="flex flex-col gap-2 px-[var(--d-pad)] pb-3 sm:flex-row sm:flex-wrap sm:items-center">
          <SearchInput value={query} onChange={setQuery} placeholder="Search validators" size="sm" className="w-full sm:w-56" />
          <div className="flex min-w-0 items-center gap-2">
            <Chip selected={outsideNakamoto} onClick={() => setOutsideNakamoto((value) => !value)} size="md">
              Outside Nakamoto<span className="max-sm:hidden"> set</span>
            </Chip>
            <Select
              value={maxCommission}
              onChange={setMaxCommission}
              options={COMMISSION_FILTERS}
              size="sm"
              aria-label="Commission ceiling"
              className="min-w-0 flex-1 sm:w-[184px] sm:flex-none"
            />
          </div>
          <Switch
            checked={activeOnly}
            onCheckedChange={onActiveOnlyChange}
            label="Active only"
            size="sm"
            className="gap-2 sm:ml-auto [&_label]:text-[13px]"
          />
        </div>
        {data?.truncated ? (
          <p className="px-[var(--d-pad)] pb-2 text-[12px] text-fg-dim">Inactive validators are listed up to 300 rows; the smallest are left out.</p>
        ) : null}
        {error && !data ? (
          <div className="px-[var(--d-pad)] pb-[var(--d-pad)]">
            <InlineError message={error} onRetry={onRetry} />
          </div>
        ) : (
          <DataTable
            ariaLabel={`Validators on ${chainName}`}
            columns={columns}
            rows={shown}
            getRowKey={(row) => row.operatorAddress}
            rowHref={(row) => validatorHref(chainId, row.operatorAddress)}
            density="compact"
            loading={!data}
            skeletonRows={10}
            sort={sort}
            onSortChange={setSort}
            manualSort
            rowClassName={(row) => (mine.has(row.operatorAddress) ? "[&>td:first-child]:shadow-[inset_2px_0_0_var(--viz-2)]" : undefined)}
            mobileCard={(row) => (
              <span className="flex items-center gap-3">
                <span className="w-6 shrink-0 text-right font-mono text-[11px] text-fg-dim">{row.rank ?? "–"}</span>
                <ValidatorIdentity
                  className="flex-1"
                  moniker={row.moniker}
                  logoUrl={row.logoUrl}
                  size={28}
                  aside={mine.has(row.operatorAddress) ? <Badge tone="accent">Yours</Badge> : row.jailed ? <Badge tone="danger">Jailed</Badge> : null}
                  // A perfect window is the norm: only an imperfect one earns the space.
                  sub={`${shortPct(row.commission.rate)} commission${row.uptime !== null && row.uptime < 1 - 1e-12 ? ` · ${uptimeText(row.uptime)} uptime` : ""}`}
                />
                <span className="flex shrink-0 flex-col items-end text-[13.5px] leading-tight">
                  <span className="tabular-nums">{row.status === "bonded" ? percentOf(row.votingPower) : "—"}</span>
                  <span className="text-[12px] text-fg-dim">APR {percentOf(row.apr)}</span>
                </span>
              </span>
            )}
            empty={
              <EmptyState
                icon="search"
                title="No validator matches"
                body="Loosen a filter or clear the search."
                action={
                  <Button size="sm" onClick={clearFilters}>
                    Clear filters
                  </Button>
                }
              />
            }
            footer={
              paged ? (
                <span className="flex flex-wrap items-center justify-between gap-2">
                  <span>{paging.all ? `All ${rows.length} shown` : `${PAGE_ROWS} of ${rows.length} shown`} · sorted on the full list</span>
                  <Button
                    size="sm"
                    variant="ghost"
                    iconRight={paging.all ? "chevronUp" : "chevronDown"}
                    onClick={() => setPaging({ key: filterKey, all: !paging.all })}
                  >
                    {paging.all ? "Show fewer" : `Show all ${rows.length}`}
                  </Button>
                </span>
              ) : undefined
            }
          />
        )}
      </CardBody>
    </Card>
  );
}
