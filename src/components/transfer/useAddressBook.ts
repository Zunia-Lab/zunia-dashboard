"use client";

/**
 * The address book as React state: rows from localStorage (migrated from any
 * older shape), and mutations that apply one of `@/lib/address-book`'s pure
 * functions to the stored rows and write them back.
 *
 * Mutations read the stored rows at the moment they run (the storage hook's
 * functional updater), so two quick edits cannot overwrite each other, and
 * another tab's write shows up here through the storage event. A validation
 * failure throws with the sentence to show; nothing is written then.
 */

import { useCallback, useMemo } from "react";
import {
  ADDRESS_BOOK_KEY,
  addContact,
  findContact,
  migrateAddressBook,
  removeContact,
  sortContacts,
  toggleContactFavorite,
  touchContact,
  updateContact,
  type AddressBookEntry,
  type ContactDraft,
  type ContactPatch,
} from "@/lib/address-book";
import { findChain } from "@/lib/chains";
import { useStoredValue } from "@/lib/useStoredValue";

const prefixFor = (chainId: string) => findChain(chainId)?.bech32Prefix;
const EMPTY: unknown = [];

export interface AddressBook {
  /** Sorted by name. */
  contacts: AddressBookEntry[];
  byAddress: (address: string) => AddressBookEntry | undefined;
  add: (draft: ContactDraft) => void;
  update: (id: string, patch: ContactPatch) => void;
  remove: (id: string) => void;
  toggleFavorite: (id: string) => void;
  /** Count a successful send (a no-op for addresses not in the book). */
  touch: (address: string) => void;
  /** Put back an entry just removed, counters and all ("Undo"). */
  restore: (entry: AddressBookEntry) => void;
}

export function useAddressBook(): AddressBook {
  const [raw, setRaw] = useStoredValue<unknown>(ADDRESS_BOOK_KEY, EMPTY);
  const contacts = useMemo(() => sortContacts(migrateAddressBook(raw)), [raw]);

  const apply = useCallback(
    (change: (rows: AddressBookEntry[]) => AddressBookEntry[]) => {
      let failure: unknown = null;
      setRaw((previous: unknown) => {
        try {
          return change(migrateAddressBook(previous));
        } catch (error) {
          failure = error;
          return previous;
        }
      });
      if (failure) throw failure instanceof Error ? failure : new Error(String(failure));
    },
    [setRaw],
  );

  const byAddress = useCallback((address: string) => findContact(contacts, address), [contacts]);
  const add = useCallback((draft: ContactDraft) => apply((rows) => addContact(rows, draft, { prefixFor })), [apply]);
  const update = useCallback(
    (id: string, patch: ContactPatch) => apply((rows) => updateContact(rows, id, patch, { prefixFor })),
    [apply],
  );
  const remove = useCallback((id: string) => apply((rows) => removeContact(rows, id)), [apply]);
  const toggleFavorite = useCallback((id: string) => apply((rows) => toggleContactFavorite(rows, id)), [apply]);
  const touch = useCallback((address: string) => apply((rows) => touchContact(rows, address)), [apply]);
  // Re-inserted as it was; skipped if the id (or the address, saved again in
  // the meantime) is already back, so a double click cannot duplicate it.
  const restore = useCallback(
    (entry: AddressBookEntry) =>
      apply((rows) => (rows.some((row) => row.id === entry.id || row.address === entry.address) ? rows : [...rows, entry])),
    [apply],
  );

  return { contacts, byAddress, add, update, remove, toggleFavorite, touch, restore };
}
