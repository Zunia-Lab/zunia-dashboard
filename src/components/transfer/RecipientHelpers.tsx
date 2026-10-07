"use client";

/**
 * What sits under the Send page's recipient field:
 *
 * - `RecipientInsight`: one line on the address typed: which chain it is on,
 *   whether it is a saved contact or one of your own accounts, how often the
 *   chain history shows you sending there, and a way to save it.
 * - `QuickRecipients`: one-tap chips while the field is empty (favourites,
 *   your own accounts on other chains).
 */

import { Icon } from "@/components/icons";
import { Badge, ChainLogo, Chip, RelativeTime, Segmented } from "@/components/ui";
import type { ChainEntry } from "@/lib/chains";
import { chainName } from "./names";
import type { AddressBook } from "./useAddressBook";

export function RecipientInsight({
  stateValid,
  destChainId,
  sourceChainId,
  options,
  onChoose,
  contactLabel,
  isOwn,
  history,
  onSave,
}: {
  stateValid: boolean;
  destChainId: string | null;
  sourceChainId: string | null;
  options: { chainId: string; chainName: string }[];
  onChoose: (chainId: string) => void;
  contactLabel: string | null;
  isOwn: boolean;
  history: { count: number; lastAt: number | null };
  onSave: () => void;
}) {
  if (!stateValid || !destChainId) return null;
  const crossChain = sourceChainId !== null && destChainId !== sourceChainId;
  return (
    <div className="flex flex-col gap-2">
      {options.length > 1 ? (
        <div className="flex flex-wrap items-center gap-2 text-[12.5px] text-fg-muted">
          <span>This prefix is used by {options.length} networks:</span>
          <Segmented
            ariaLabel="Recipient network"
            size="sm"
            value={destChainId}
            onChange={onChoose}
            options={options.map((option) => ({ value: option.chainId, label: option.chainName }))}
          />
        </div>
      ) : null}
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1.5 text-[12.5px] text-fg-muted">
        <span className="inline-flex items-center gap-1.5">
          <Icon name="check" size={13} className="text-[var(--d-pos)]" />
          {chainName(destChainId)} address
        </span>
        {crossChain ? (
          <Badge tone="info" size="sm">
            Becomes an IBC transfer
          </Badge>
        ) : null}
        {isOwn ? (
          <Badge tone="accent" size="sm">
            Your own account
          </Badge>
        ) : null}
        {contactLabel ? (
          <Badge tone="neutral" size="sm" icon="star">
            {contactLabel}
          </Badge>
        ) : null}
        {history.count > 0 ? (
          <span className="text-fg-dim">
            Sent {history.count}× · last {history.lastAt ? <RelativeTime at={history.lastAt} /> : "—"}
          </span>
        ) : !isOwn ? (
          <span className="text-fg-dim">No sends to it in the loaded history</span>
        ) : null}
        {!contactLabel && !isOwn ? (
          <button
            type="button"
            onClick={onSave}
            className="d-hit text-[12.5px] font-medium text-[var(--d-accent-text)] underline-offset-[3px] hover:underline"
          >
            Save
          </button>
        ) : null}
      </div>
    </div>
  );
}

export function QuickRecipients({
  book,
  ownAccounts,
  onPick,
}: {
  book: AddressBook;
  ownAccounts: { chain: ChainEntry; address: string | null }[];
  onPick: (address: string, chainId?: string | null) => void;
}) {
  const favourites = book.contacts.filter((entry) => entry.favorite).slice(0, 3);
  const mine = ownAccounts.filter((row): row is { chain: ChainEntry; address: string } => Boolean(row.address));
  if (favourites.length === 0 && mine.length === 0) return null;
  return (
    <div className="flex flex-wrap items-center gap-1.5">
      {favourites.map((entry) => (
        <Chip key={entry.id} size="sm" icon="star" onClick={() => onPick(entry.address, entry.chainId ?? null)}>
          {entry.label}
        </Chip>
      ))}
      {mine.map((row) => (
        <Chip key={row.chain.chainId} size="sm" leading={<ChainLogo chainId={row.chain.chainId} size={14} />} onClick={() => onPick(row.address, row.chain.chainId)}>
          Me on {row.chain.chainName}
        </Chip>
      ))}
    </div>
  );
}
