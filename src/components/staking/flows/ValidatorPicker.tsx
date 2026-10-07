"use client";

/**
 * Picks a validator of one chain, ordered by the decentralisation-friendly
 * score (see `../score.ts`), with your own validators first. Each row shows
 * the four checks as dots, commission and the APR a delegator earns there,
 * so the order explains itself.
 *
 * Reads the chain's bonded set lazily: only once the sheet that holds the
 * picker is open.
 */

import { useMemo } from "react";
import { AssetLogo, Combobox, InfoTip, InlineError, Skeleton, FIELD_FRAME } from "@/components/ui";
import { Icon } from "@/components/icons";
import { cn } from "@/lib/cn";
import { useValidators, type ValidatorRow } from "@/lib/data/validators";
import { percentOf, toLite } from "../model";
import { cutoffRisk, decentralisationScore, rankByScore, SCORE_EXPLANATION } from "../score";
import { ScoreDots } from "../ValidatorBits";

export interface ValidatorPickerProps {
  chainId: string;
  /** Operator address of the chosen validator. */
  value: string | null;
  onChange: (validator: ValidatorRow) => void;
  /** Operators not offered (the source of a redelegation). */
  exclude?: readonly string[];
  /** Your validators on this chain, listed first. */
  mine?: ReadonlySet<string>;
  label?: string;
  id?: string;
}


export function ValidatorPicker({ chainId, value, onChange, exclude, mine, label = "Validator", id }: ValidatorPickerProps) {
  const set = useValidators(chainId);
  const rows = set.data?.chainId === chainId ? set.data.validators : null;

  const items = useMemo(() => {
    if (!rows) return [];
    const skip = new Set(exclude ?? []);
    const offered = rows.filter((row) => !skip.has(row.operatorAddress));
    const summary = set.data?.summary;
    const ranked = rankByScore(offered, toLite, { atRisk: (row) => cutoffRisk(row, summary) });
    if (!mine || mine.size === 0) return ranked;
    return [...ranked.filter((row) => mine.has(row.operatorAddress)), ...ranked.filter((row) => !mine.has(row.operatorAddress))];
  }, [rows, exclude, mine, set.data?.summary]);

  const selected = rows?.find((row) => row.operatorAddress === value) ?? null;
  const hasMine = Boolean(mine && items.some((row) => mine.has(row.operatorAddress)));

  if (set.status === "error" && !rows) {
    return <InlineError title="Validators unavailable" message={set.error?.message ?? "The validator list could not be read."} onRetry={set.refetch} />;
  }

  return (
    <div className="flex min-w-0 flex-col gap-1.5">
      <div className="flex items-center justify-between gap-3">
        <label htmlFor={id} className="text-[12.5px] font-medium text-fg-muted">
          {label}
        </label>
        <span className="flex items-center gap-1 text-[12px] text-fg-dim">
          Ordered by decentralisation score
          <InfoTip content={SCORE_EXPLANATION} label="How validators are ordered" size={13} />
        </span>
      </div>
      <Combobox
        items={items}
        getKey={(row) => row.operatorAddress}
        value={value}
        title={`Validators on ${set.data?.chainName ?? chainId}`}
        placeholder="Search by name or address"
        width={420}
        maxHeight={360}
        groupBy={hasMine ? (row) => (mine?.has(row.operatorAddress) ? "Your validators" : "All validators, by score") : undefined}
        filter={(row, query) => row.moniker.toLowerCase().includes(query) || row.operatorAddress.toLowerCase().includes(query)}
        onSelect={onChange}
        emptyText="No validator matches"
        renderItem={(row) => <PickerRow row={row} />}
        trigger={
          <button
            id={id}
            type="button"
            disabled={!rows}
            className={cn(
              FIELD_FRAME,
              "h-auto min-h-[52px] w-full cursor-pointer justify-between rounded-[var(--d-radius-inner)] py-2 text-left disabled:cursor-default",
            )}
          >
            {selected ? (
              <span className="flex min-w-0 flex-1 items-center gap-2.5">
                <AssetLogo src={selected.logoUrl ?? null} symbol={selected.moniker} size={28} />
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-[14px] font-medium text-fg">{selected.moniker}</span>
                  <span className="block truncate text-[12px] text-fg-dim">
                    Commission {percentOf(selected.commission.rate, 1)} · APR {percentOf(selected.apr, 2)}
                    {selected.rank ? ` · #${selected.rank}` : ""}
                  </span>
                </span>
              </span>
            ) : rows ? (
              <span className="flex items-center gap-2 text-[14px] text-fg-dim">
                <Icon name="validators" size={18} />
                Choose a validator
              </span>
            ) : (
              <span className="flex items-center gap-2.5">
                <Skeleton circle width={28} />
                <Skeleton className="h-3" width={140} />
              </span>
            )}
            <Icon name="chevronsUpDown" size={16} className="shrink-0 text-fg-dim" />
          </button>
        }
      />
    </div>
  );
}

function PickerRow({ row }: { row: ValidatorRow }) {
  const { checks } = decentralisationScore(toLite(row));
  return (
    <span className="flex min-w-0 items-center gap-2.5">
      <AssetLogo src={row.logoUrl ?? null} symbol={row.moniker} size={26} />
      <span className="min-w-0 flex-1">
        <span className="flex min-w-0 items-center gap-2">
          <span className="truncate font-medium">{row.moniker}</span>
          <ScoreDots checks={checks} />
        </span>
        <span className="block truncate text-[12px] text-fg-dim">
          {row.rank ? `#${row.rank} · ` : ""}
          {percentOf(row.votingPower, 2)} voting power
          {row.inNakamotoSet ? " · Nakamoto set" : ""}
        </span>
      </span>
      <span className="shrink-0 text-right text-[12px] leading-tight tabular-nums">
        <span className="block text-fg">{percentOf(row.apr, 2)}</span>
        <span className="block text-fg-dim">{percentOf(row.commission.rate, 1)} commission</span>
      </span>
    </span>
  );
}
