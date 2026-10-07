"use client";

/**
 * The compared entities as removable chips, each wearing its chart colour,
 * plus a searchable picker (chains from the catalog, assets from the markets
 * feed) that adds one. Four at most: the picker says so instead of failing.
 */

import { useMemo } from "react";
import { Icon } from "@/components/icons";
import { AssetLogo, Button, ChainLogo, Chip, Combobox } from "@/components/ui";
import { CHAINS } from "@/lib/chains";
import type { MarketAsset } from "@/lib/token/wire";
import { formatFiat } from "@/lib/format";
import { nativeAssetKey } from "@/components/chains/model";
import type { Entity } from "./entities";
import { MAX_ENTITIES, type EntityRef } from "./model";

interface PickItem {
  ref: EntityRef;
  key: string;
  label: string;
  sub: string;
  logo?: string;
  chainId?: string;
  group: "Chains" | "Assets";
  haystack: string;
}

interface EntityPickerProps {
  entities: readonly Entity[];
  colors: ReadonlyMap<string, string>;
  markets: readonly MarketAsset[];
  marketCurrency: string | null;
  onAdd: (ref: EntityRef) => void;
  onRemove: (ref: EntityRef) => void;
}

export function EntityPicker({ entities, colors, markets, marketCurrency, onAdd, onRemove }: EntityPickerProps) {
  const selected = useMemo(() => new Set(entities.map((e) => e.id)), [entities]);
  const full = entities.length >= MAX_ENTITIES;

  const items = useMemo<PickItem[]>(() => {
    const capByKey = new Map(markets.map((asset) => [asset.key, asset.marketCap ?? asset.liquidity ?? 0]));
    // Chains with a market first (largest first), then the rest by name.
    const chains = CHAINS.filter((chain) => chain.network === "mainnet")
      .map((chain) => ({ chain, weight: capByKey.get(nativeAssetKey(chain)) ?? -1 }))
      .sort((a, b) => b.weight - a.weight || a.chain.chainName.localeCompare(b.chain.chainName))
      .map(({ chain }) => ({
        ref: { kind: "chain" as const, id: chain.chainId },
        key: `chain:${chain.chainId}`,
        label: chain.chainName,
        sub: `${chain.chainId} · ${chain.coinDenom}`,
        logo: chain.iconUrl,
        chainId: chain.chainId,
        group: "Chains" as const,
        haystack: `${chain.chainName} ${chain.chainId} ${chain.coinDenom}`.toLowerCase(),
      }));
    const assets = markets.map((asset) => ({
      ref: { kind: "asset" as const, id: asset.key },
      key: `asset:${asset.key}`,
      label: asset.symbol,
      sub: `${asset.name} · ${formatFiat(asset.price, marketCurrency ?? "usd")}`,
      logo: asset.logoUrl,
      group: "Assets" as const,
      haystack: `${asset.symbol} ${asset.name} ${asset.key}`.toLowerCase(),
    }));
    return [...chains, ...assets];
  }, [markets, marketCurrency]);

  return (
    <div className="flex flex-wrap items-center gap-2">
      {entities.map((entity) => (
        <Chip
          key={entity.id}
          size="md"
          onRemove={() => onRemove(entity.ref)}
          removeLabel={`Remove ${entity.name} from the comparison`}
          // A removable chip is the kit's "active filter" (accent tint); these
          // are series, already wearing their chart colour: a neutral token.
          className="border-[var(--d-hairline-strong)] bg-[var(--d-card-2)]"
          leading={
            <span className="flex items-center gap-1.5">
              <span aria-hidden className="size-2 rounded-full" style={{ background: colors.get(entity.id) }} />
              {entity.ref.kind === "chain" ? (
                <ChainLogo chainId={entity.ref.id} size={18} />
              ) : (
                <AssetLogo src={entity.logo} symbol={entity.ticker} size={18} />
              )}
            </span>
          }
        >
          <span className="max-w-[16ch] truncate">{entity.name}</span>
        </Chip>
      ))}
      <Combobox<PickItem>
        items={items}
        getKey={(item) => item.key}
        title="Add to the comparison"
        placeholder="Search chains and assets"
        groupBy={(item) => item.group}
        filter={(item, q) => item.haystack.includes(q)}
        isDisabled={(item) => selected.has(item.key) || full}
        onSelect={(item) => onAdd(item.ref)}
        emptyText="No chain or asset matches"
        footer={full ? <p className="px-1 text-[12px] text-fg-dim">Four at most: remove one to add another.</p> : undefined}
        renderItem={(item) => (
          <span className="flex min-w-0 items-center gap-2.5">
            {item.chainId ? <ChainLogo chainId={item.chainId} size={22} /> : <AssetLogo src={item.logo} symbol={item.label} size={22} />}
            <span className="min-w-0">
              <span className="block truncate text-[13.5px] text-fg">{item.label}</span>
              <span className="block truncate text-[11.5px] text-fg-dim">{item.sub}</span>
            </span>
            {selected.has(item.key) ? <span className="ml-auto text-[11.5px] text-fg-dim">Added</span> : null}
          </span>
        )}
        trigger={
          <Button size="sm" variant={entities.length === 0 ? "primary" : "secondary"} iconLeft={<Icon name="plus" size={14} />} disabled={full} title={full ? "Four at most" : undefined}>
            {entities.length === 0 ? "Add a chain or asset" : "Add"}
          </Button>
        }
      />
      {full ? <span className="text-[12.5px] text-fg-dim">Four at most</span> : null}
    </div>
  );
}

