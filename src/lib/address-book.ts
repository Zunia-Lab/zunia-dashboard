/**
 * The address book: saved recipients, their favourite flag, how often and
 * how recently they are sent to, and a note.
 *
 * Ported from zunia-extension lib/address-book.ts @ e71d7b7 (pure functions
 * only). Two changes for the dashboard:
 *
 * - Storage is the browser's localStorage under `ADDRESS_BOOK_KEY` (the key
 *   the first dashboard address book already used, so its `{id, label,
 *   address}` rows migrate in place), read through a hook in
 *   `components/transfer/useAddressBook.ts`. Nothing here touches storage.
 * - The chain catalog is not imported: every function that checks a prefix
 *   takes a `prefixFor` lookup. The extension defaulted it to its catalog,
 *   which is how a caller that forgot it would silently skip the prefix
 *   check; here it is required, and the module stays testable without the
 *   catalog JSON.
 *
 * Every rule lives in these functions so validation, migration and the usage
 * counters are tested without storage.
 */

import { bech32PrefixOf, isValidBech32Address } from "@zunialab/interchain";

export interface AddressBookEntry {
  id: string;
  label: string;
  address: string;
  /** Set when the address belongs to one network, e.g. an exchange deposit. */
  chainId?: string;
  note?: string;
  favorite: boolean;
  lastUsedAt?: number;
  useCount: number;
  createdAt: number;
  updatedAt: number;
}

export interface ContactDraft {
  label: string;
  address: string;
  chainId?: string;
  note?: string;
  favorite?: boolean;
}

/** Fields an edit may change. `null` clears an optional field. */
export interface ContactPatch {
  label?: string;
  address?: string;
  chainId?: string | null;
  note?: string | null;
}

/** localStorage key (shared with the first dashboard address book). */
export const ADDRESS_BOOK_KEY = "zunia.dashboard.addressBook";

export const MAX_LABEL_LENGTH = 40;
export const MAX_NOTE_LENGTH = 140;
export const MAX_CONTACTS = 500;
export const RECENT_CONTACTS = 5;

/** The bech32 prefix a chain's addresses carry, when the chain is known. */
export type PrefixLookup = (chainId: string) => string | undefined;

/**
 * Why an address cannot be saved, or `null` when it can. Checks the checksum,
 * not only the shape, and when a network is chosen, that the prefix is the
 * one that network uses: `startsWith` would let `cosmosvaloper1...` pass for
 * the Hub, and a transfer to an operator address is lost.
 */
export function contactAddressProblem(
  address: string,
  chainId: string | undefined,
  prefixFor: PrefixLookup,
): string | null {
  const value = address.trim();
  if (!value) return "Enter an address";
  if (value !== value.toLowerCase() || !isValidBech32Address(value)) {
    return "Not a valid address. Check it for a typo.";
  }
  if (!chainId) return null;
  const expected = prefixFor(chainId);
  if (!expected) return null;
  if (bech32PrefixOf(value) !== expected) {
    return `That network uses ${expected}1… addresses`;
  }
  return null;
}

function cleanLabel(label: string): string {
  return label.trim().slice(0, MAX_LABEL_LENGTH);
}

function cleanNote(note: string | null | undefined): string | undefined {
  const value = (note ?? "").trim().slice(0, MAX_NOTE_LENGTH);
  return value || undefined;
}

function cleanChainId(chainId: string | null | undefined): string | undefined {
  const value = (chainId ?? "").trim();
  return value || undefined;
}

function byLabel(a: AddressBookEntry, b: AddressBookEntry): number {
  return a.label.localeCompare(b.label, undefined, { sensitivity: "base" }) || a.createdAt - b.createdAt;
}

/* -------------------------------------------------------------------------- *
 * Migration
 * -------------------------------------------------------------------------- */

function finiteNumber(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) && value >= 0 ? value : undefined;
}

/**
 * Stored rows in the current shape, whatever version wrote them.
 *
 * The first versions kept `{ id, label, address, chainId?, createdAt }`
 * (the extension) and `{ id, label, address }` (the dashboard). Their rows
 * gain the new fields with neutral values. Rows without a string address are
 * dropped, since nothing can be sent to them; an address that fails the
 * checksum is kept, so the user sees it and fixes or deletes it rather than
 * losing it silently.
 *
 * `makeId` exists for the tests; a row without an id gets a random one.
 */
export function migrateAddressBook(
  raw: unknown,
  now = Date.now(),
  makeId: () => string = () => crypto.randomUUID(),
): AddressBookEntry[] {
  if (!Array.isArray(raw)) return [];
  const out: AddressBookEntry[] = [];
  const ids = new Set<string>();
  for (const value of raw) {
    if (!value || typeof value !== "object") continue;
    const row = value as Record<string, unknown>;
    const address = typeof row.address === "string" ? row.address.trim() : "";
    if (!address) continue;
    let id = typeof row.id === "string" && row.id ? row.id : "";
    if (!id || ids.has(id)) id = makeId();
    ids.add(id);
    const createdAt = finiteNumber(row.createdAt) ?? now;
    const label = typeof row.label === "string" ? cleanLabel(row.label) : "";
    const chainId = typeof row.chainId === "string" ? cleanChainId(row.chainId) : undefined;
    const note = typeof row.note === "string" ? cleanNote(row.note) : undefined;
    const lastUsedAt = finiteNumber(row.lastUsedAt);
    out.push({
      id,
      label: label || address.slice(0, MAX_LABEL_LENGTH),
      address,
      ...(chainId ? { chainId } : {}),
      ...(note ? { note } : {}),
      favorite: row.favorite === true,
      ...(lastUsedAt !== undefined ? { lastUsedAt } : {}),
      useCount: Math.floor(finiteNumber(row.useCount) ?? 0),
      createdAt,
      updatedAt: finiteNumber(row.updatedAt) ?? createdAt,
    });
    if (out.length >= MAX_CONTACTS) break;
  }
  return out;
}

/* -------------------------------------------------------------------------- *
 * Operations on the list
 * -------------------------------------------------------------------------- */

function requireEntry(rows: readonly AddressBookEntry[], id: string): AddressBookEntry {
  const found = rows.find((row) => row.id === id);
  if (!found) throw new Error("That contact no longer exists");
  return found;
}

export function addContact(
  rows: readonly AddressBookEntry[],
  draft: ContactDraft,
  options: { prefixFor: PrefixLookup; now?: number; id?: string },
): AddressBookEntry[] {
  const label = cleanLabel(draft.label);
  const address = draft.address.trim();
  const chainId = cleanChainId(draft.chainId);
  if (!label) throw new Error("Give this address a name");
  const problem = contactAddressProblem(address, chainId, options.prefixFor);
  if (problem) throw new Error(problem);
  const existing = rows.find((row) => row.address === address);
  if (existing) throw new Error(`That address is already saved as ${existing.label}`);
  if (rows.length >= MAX_CONTACTS) throw new Error("The address book is full");
  const now = options.now ?? Date.now();
  const note = cleanNote(draft.note);
  return [
    ...rows,
    {
      id: options.id ?? crypto.randomUUID(),
      label,
      address,
      ...(chainId ? { chainId } : {}),
      ...(note ? { note } : {}),
      favorite: draft.favorite === true,
      useCount: 0,
      createdAt: now,
      updatedAt: now,
    },
  ];
}

export function updateContact(
  rows: readonly AddressBookEntry[],
  id: string,
  patch: ContactPatch,
  options: { prefixFor: PrefixLookup; now?: number },
): AddressBookEntry[] {
  const current = requireEntry(rows, id);
  const label = patch.label === undefined ? current.label : cleanLabel(patch.label);
  const address = patch.address === undefined ? current.address : patch.address.trim();
  const chainId = patch.chainId === undefined ? current.chainId : cleanChainId(patch.chainId);
  const note = patch.note === undefined ? current.note : cleanNote(patch.note);
  if (!label) throw new Error("Give this address a name");
  const problem = contactAddressProblem(address, chainId, options.prefixFor);
  if (problem) throw new Error(problem);
  const clash = rows.find((row) => row.id !== id && row.address === address);
  if (clash) throw new Error(`That address is already saved as ${clash.label}`);

  const next: AddressBookEntry = {
    id: current.id,
    label,
    address,
    ...(chainId ? { chainId } : {}),
    ...(note ? { note } : {}),
    favorite: current.favorite,
    ...(current.lastUsedAt !== undefined ? { lastUsedAt: current.lastUsedAt } : {}),
    useCount: current.useCount,
    createdAt: current.createdAt,
    updatedAt: options.now ?? Date.now(),
  };
  return rows.map((row) => (row.id === id ? next : row));
}

export function removeContact(rows: readonly AddressBookEntry[], id: string): AddressBookEntry[] {
  return rows.filter((row) => row.id !== id);
}

export function toggleContactFavorite(
  rows: readonly AddressBookEntry[],
  id: string,
  now = Date.now(),
): AddressBookEntry[] {
  const current = requireEntry(rows, id);
  return rows.map((row) => (row.id === id ? { ...current, favorite: !current.favorite, updatedAt: now } : row));
}

/**
 * Count a successful send to `address`. Unknown addresses are left alone: the
 * book only holds what the user chose to save.
 */
export function touchContact(
  rows: readonly AddressBookEntry[],
  address: string,
  now = Date.now(),
): AddressBookEntry[] {
  const value = address.trim();
  if (!rows.some((row) => row.address === value)) return [...rows];
  return rows.map((row) => (row.address === value ? { ...row, lastUsedAt: now, useCount: row.useCount + 1 } : row));
}

/* -------------------------------------------------------------------------- *
 * Views
 * -------------------------------------------------------------------------- */

/** Sorted by name, the order the book lists them in. */
export function sortContacts(rows: readonly AddressBookEntry[]): AddressBookEntry[] {
  return [...rows].sort(byLabel);
}

/** The saved entry for an address, if any (exact match: bech32 is lowercase). */
export function findContact(rows: readonly AddressBookEntry[], address: string): AddressBookEntry | undefined {
  const value = address.trim();
  return value ? rows.find((row) => row.address === value) : undefined;
}

/**
 * Contacts a transfer to this network can use: the exact prefix, and when the
 * contact is pinned to a network, that same network. A contact saved for
 * another chain is never offered.
 */
export function contactsFor(
  rows: readonly AddressBookEntry[],
  target: { prefix?: string; chainId?: string },
): AddressBookEntry[] {
  return rows.filter(
    (row) =>
      (!target.prefix || bech32PrefixOf(row.address) === target.prefix) &&
      (!row.chainId || !target.chainId || row.chainId === target.chainId),
  );
}

/** Most recently used first. */
export function recentContacts(rows: readonly AddressBookEntry[], limit = RECENT_CONTACTS): AddressBookEntry[] {
  return rows
    .filter((row) => row.lastUsedAt !== undefined)
    .sort((a, b) => (b.lastUsedAt ?? 0) - (a.lastUsedAt ?? 0))
    .slice(0, limit);
}

/** The few contacts worth a one-tap chip: favourites, then recent ones. */
export function suggestedContacts(rows: readonly AddressBookEntry[], limit = 4): AddressBookEntry[] {
  const favorites = sortContacts(rows.filter((row) => row.favorite));
  const recent = recentContacts(rows, rows.length).filter((row) => !row.favorite);
  return [...favorites, ...recent].slice(0, limit);
}

/**
 * Search over label, address and note (case-insensitive). An empty query keeps
 * every row.
 */
export function searchContacts(rows: readonly AddressBookEntry[], query: string): AddressBookEntry[] {
  const needle = query.trim().toLowerCase();
  if (!needle) return [...rows];
  return rows.filter(
    (row) =>
      row.label.toLowerCase().includes(needle) ||
      row.address.includes(needle) ||
      (row.note?.toLowerCase().includes(needle) ?? false),
  );
}
