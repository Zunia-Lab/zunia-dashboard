"use client";

/**
 * The address book beside the Send form: favourites, recent recipients and
 * everyone saved, one click from the recipient field.
 *
 * Counters (how many times, how recently) are this browser's own record of
 * sends made from the dashboard; the recipient line under the field reads the
 * chain's history instead.
 */

import { useMemo, useState } from "react";
import { bech32PrefixOf } from "@zunialab/interchain";
import { Icon } from "@/components/icons";
import {
  Button,
  Card,
  CardHeader,
  ChainLogo,
  EmptyState,
  IconButton,
  Menu,
  RelativeTime,
  SearchInput,
  Segmented,
  toast,
} from "@/components/ui";
import { recentContacts, searchContacts, type AddressBookEntry } from "@/lib/address-book";
import { findChainsByPrefix } from "@/lib/chains";
import { cn } from "@/lib/cn";
import { shortenAddress } from "@/lib/format";
import { ContactDialog } from "./ContactDialog";
import type { AddressBook } from "./useAddressBook";

type View = "favorites" | "recent" | "all";

/** The chain an entry belongs to: pinned, else the first chain using its prefix. */
export function contactChainId(entry: Pick<AddressBookEntry, "address" | "chainId">): string | null {
  if (entry.chainId) return entry.chainId;
  const prefix = bech32PrefixOf(entry.address);
  return prefix ? (findChainsByPrefix(prefix)[0]?.chainId ?? null) : null;
}

/** Initials for a saved contact; a person glyph for an address nobody named. */
export function ContactAvatar({ entry, size = 32 }: { entry: Pick<AddressBookEntry, "label" | "address" | "chainId">; size?: number }) {
  const chainId = contactChainId(entry);
  // One initial per word, two at most ("Kraken deposit" → "KD", "Mom" → "M"):
  // a second letter of the same word reads as noise beside the chain badge.
  const letters = entry.label
    .split(/\s+/)
    .map((word) => word.replace(/[^\p{L}\p{N}]/gu, "").slice(0, 1))
    .join("")
    .slice(0, 2)
    .toUpperCase();
  return (
    <span className="relative inline-flex shrink-0" style={{ width: size, height: size }}>
      <span
        aria-hidden
        className="flex size-full items-center justify-center rounded-full bg-[var(--d-glass-2)] font-semibold tracking-[-0.02em] text-fg-muted shadow-[inset_0_0_0_1px_var(--d-hairline)]"
        style={{ fontSize: Math.round(size * 0.36) }}
      >
        {letters || <Icon name="user" size={Math.round(size * 0.5)} />}
      </span>
      {chainId ? (
        <span className="absolute -bottom-[2px] -right-[3px] rounded-full shadow-[0_0_0_2px_var(--d-card)]">
          <ChainLogo chainId={chainId} size={Math.max(12, Math.round(size * 0.44))} />
        </span>
      ) : null}
    </span>
  );
}

export interface AddressBookCardProps {
  book: AddressBook;
  onPick: (entry: AddressBookEntry) => void;
  /** The recipient now in the field (its row shows as selected). */
  activeAddress?: string;
  className?: string;
}

export function AddressBookCard({ book, onPick, activeAddress, className }: AddressBookCardProps) {
  const contacts = book.contacts;
  const favorites = useMemo(() => contacts.filter((entry) => entry.favorite), [contacts]);
  const recent = useMemo(() => recentContacts(contacts, 8), [contacts]);
  const [chosen, setChosen] = useState<View | null>(null);
  const view: View = chosen ?? (favorites.length > 0 ? "favorites" : recent.length > 0 ? "recent" : "all");
  const [query, setQuery] = useState("");
  const [editing, setEditing] = useState<AddressBookEntry | null>(null);
  const [adding, setAdding] = useState(false);

  const source = view === "favorites" ? favorites : view === "recent" ? recent : contacts;
  const rows = searchContacts(source, query);

  return (
    <Card className={className}>
      <CardHeader
        title="Address book"
        subtitle="Saved in this browser only"
        actions={
          <Button size="sm" variant="secondary" iconLeft="plus" onClick={() => setAdding(true)}>
            Add
          </Button>
        }
      />
      {contacts.length === 0 ? (
        <EmptyState
          inline
          icon="star"
          title="No saved addresses yet"
          body="Save the people and exchanges you send to. They stay in this browser."
        />
      ) : (
        <>
          <Segmented<View>
            ariaLabel="Which addresses"
            fullWidth
            value={view}
            onChange={setChosen}
            options={[
              { value: "favorites", label: `Favourites${favorites.length ? ` · ${favorites.length}` : ""}` },
              { value: "recent", label: "Recent" },
              { value: "all", label: `All · ${contacts.length}` },
            ]}
          />
          {contacts.length > 6 ? <SearchInput value={query} onChange={setQuery} size="sm" placeholder="Search names, addresses, notes" /> : null}
          {rows.length === 0 ? (
            <p className="py-3 text-center text-[13px] text-fg-dim">
              {query ? "Nobody matches." : view === "favorites" ? "Star an address to keep it here." : "No sends recorded from this browser yet."}
            </p>
          ) : (
            <ul className="-mx-2 flex max-h-[360px] flex-col overflow-y-auto d-scroll">
              {rows.map((entry) => {
                const active = entry.address === activeAddress;
                return (
                  <li key={entry.id} className="group relative flex items-center rounded-[10px] hover:bg-[var(--d-row-hover)]">
                    <button
                      type="button"
                      onClick={() => onPick(entry)}
                      aria-pressed={active}
                      className={cn(
                        "flex min-h-[52px] min-w-0 flex-1 items-center gap-3 rounded-[10px] px-2 py-2 text-left",
                        active && "bg-[var(--d-row-selected)]",
                      )}
                    >
                      <ContactAvatar entry={entry} />
                      <span className="min-w-0 flex-1">
                        <span className="flex items-center gap-1 text-[13.5px] font-medium text-fg">
                          <span className="truncate">{entry.label}</span>
                          {entry.favorite ? <Icon name="star" size={12} fill="currentColor" className="shrink-0 text-[var(--z-warning)]" /> : null}
                        </span>
                        <span className="block truncate font-mono text-[11.5px] text-fg-dim">{shortenAddress(entry.address, 10, 6)}</span>
                      </span>
                      <span className="shrink-0 pr-8 text-right text-[11.5px] leading-tight text-fg-dim">
                        {entry.useCount > 0 ? <span className="block tabular-nums">{entry.useCount}× sent</span> : null}
                        {entry.lastUsedAt ? <RelativeTime at={entry.lastUsedAt} className="block" /> : null}
                      </span>
                    </button>
                    <span className="absolute right-1">
                      <Menu
                        trigger={<IconButton label={`Actions for ${entry.label}`} icon="dots" size="sm" tooltip={false} />}
                        items={[
                          { label: "Edit", onSelect: () => setEditing(entry) },
                          {
                            label: entry.favorite ? "Remove from favourites" : "Add to favourites",
                            icon: "star",
                            onSelect: () => book.toggleFavorite(entry.id),
                          },
                          { type: "separator" },
                          {
                            label: "Delete",
                            tone: "danger",
                            onSelect: () => {
                              book.remove(entry.id);
                              toast.info(`${entry.label} removed from the address book`, {
                                action: { label: "Undo", onClick: () => book.restore(entry) },
                              });
                            },
                          },
                        ]}
                      />
                    </span>
                  </li>
                );
              })}
            </ul>
          )}
        </>
      )}
      <ContactDialog
        open={adding || editing !== null}
        onOpenChange={(open) => {
          if (!open) {
            setAdding(false);
            setEditing(null);
          }
        }}
        book={book}
        entry={editing}
        // A new contact may not belong to the view on screen (Favourites):
        // show everyone, so what was just saved is in sight.
        onSaved={() => {
          if (!editing) {
            setChosen("all");
            setQuery("");
          }
        }}
      />
    </Card>
  );
}
