import assert from "node:assert/strict";
import { test } from "node:test";
import {
  addContact,
  contactAddressProblem,
  contactsFor,
  findContact,
  MAX_LABEL_LENGTH,
  migrateAddressBook,
  recentContacts,
  removeContact,
  searchContacts,
  sortContacts,
  suggestedContacts,
  toggleContactFavorite,
  touchContact,
  updateContact,
  type AddressBookEntry,
} from "../address-book";

const HUB = "cosmos1gv86dp8wmnmmatdckgr5xkevnpmy4662csvy4f";
const OSMO = "osmo1gv86dp8wmnmmatdckgr5xkevnpmy4662stl5rm";
const SAFRO = "addr_safro1gv86dp8wmnmmatdckgr5xkevnpmy4662qudn7e";
const PREFIXES: Record<string, string> = { "cosmoshub-4": "cosmos", "osmosis-1": "osmo", "safrochain-1": "addr_safro" };
const prefixFor = (chainId: string) => PREFIXES[chainId];

let counter = 0;
const makeId = () => `id-${(counter += 1)}`;

function book(): AddressBookEntry[] {
  let rows = addContact([], { label: "Mom", address: HUB }, { prefixFor, now: 1, id: "a" });
  rows = addContact(rows, { label: "Kraken deposit", address: OSMO, chainId: "osmosis-1", note: "memo 1234" }, { prefixFor, now: 2, id: "b" });
  return rows;
}

test("contactAddressProblem checks the checksum, the case and the network's prefix", () => {
  assert.equal(contactAddressProblem(HUB, undefined, prefixFor), null);
  assert.equal(contactAddressProblem(SAFRO, "safrochain-1", prefixFor), null);
  assert.equal(contactAddressProblem("", undefined, prefixFor), "Enter an address");
  assert.match(contactAddressProblem(HUB.slice(0, -1) + "x", undefined, prefixFor) ?? "", /typo/);
  assert.match(contactAddressProblem(HUB.toUpperCase().slice(0, 10) + HUB.slice(10), undefined, prefixFor) ?? "", /typo/);
  assert.equal(contactAddressProblem(HUB, "osmosis-1", prefixFor), "That network uses osmo1… addresses");
  // An unknown network cannot be checked, so the address alone decides.
  assert.equal(contactAddressProblem(HUB, "unknown-1", prefixFor), null);
});

test("migrateAddressBook upgrades the first dashboard rows and drops unusable ones", () => {
  const rows = migrateAddressBook(
    [
      { id: "x", label: "Old", address: ` ${HUB} ` },
      { id: "x", label: "Duplicate id", address: OSMO },
      { label: "No address" },
      "junk",
      { label: "", address: SAFRO, favorite: true, useCount: 3.7, lastUsedAt: 50, createdAt: 10 },
    ],
    100,
    makeId,
  );
  assert.equal(rows.length, 3);
  assert.deepEqual(rows[0], { id: "x", label: "Old", address: HUB, favorite: false, useCount: 0, createdAt: 100, updatedAt: 100 });
  assert.notEqual(rows[1]?.id, "x", "a repeated id is replaced");
  assert.equal(rows[2]?.label, SAFRO.slice(0, MAX_LABEL_LENGTH), "an empty label falls back to the address");
  assert.equal(rows[2]?.useCount, 3);
  assert.equal(rows[2]?.favorite, true);
  assert.deepEqual(migrateAddressBook({ not: "a list" }), []);
});

test("addContact validates, refuses duplicates and trims", () => {
  const rows = book();
  assert.equal(rows.length, 2);
  assert.equal(rows[1]?.note, "memo 1234");
  assert.throws(() => addContact(rows, { label: "Again", address: HUB }, { prefixFor }), /already saved as Mom/);
  assert.throws(() => addContact(rows, { label: "  ", address: SAFRO }, { prefixFor }), /name/);
  assert.throws(() => addContact(rows, { label: "Wrong net", address: SAFRO, chainId: "osmosis-1" }, { prefixFor }), /osmo1/);
});

test("updateContact edits fields, clears optional ones with null and keeps counters", () => {
  let rows = touchContact(book(), OSMO, 500);
  rows = updateContact(rows, "b", { label: "Kraken", note: null, chainId: null }, { prefixFor, now: 600 });
  const entry = rows.find((row) => row.id === "b");
  assert.equal(entry?.label, "Kraken");
  assert.equal(entry?.note, undefined);
  assert.equal(entry?.chainId, undefined);
  assert.equal(entry?.useCount, 1);
  assert.equal(entry?.lastUsedAt, 500);
  assert.equal(entry?.updatedAt, 600);
  assert.throws(() => updateContact(rows, "b", { address: HUB }, { prefixFor }), /already saved as Mom/);
  assert.throws(() => updateContact(rows, "nope", { label: "x" }, { prefixFor }), /no longer exists/);
});

test("favourites, removal, touch and the views", () => {
  let rows = book();
  rows = toggleContactFavorite(rows, "b", 7);
  assert.equal(rows.find((row) => row.id === "b")?.favorite, true);
  rows = touchContact(rows, HUB, 900);
  rows = touchContact(rows, HUB, 950);
  rows = touchContact(rows, "cosmos1unknown", 999);
  assert.equal(findContact(rows, HUB)?.useCount, 2);
  assert.equal(findContact(rows, ""), undefined);
  assert.deepEqual(
    recentContacts(rows).map((row) => row.id),
    ["a"],
  );
  assert.deepEqual(
    suggestedContacts(rows).map((row) => row.id),
    ["b", "a"],
    "favourites first, then recent",
  );
  assert.deepEqual(
    sortContacts(rows).map((row) => row.label),
    ["Kraken deposit", "Mom"],
  );
  assert.deepEqual(
    contactsFor(rows, { prefix: "osmo", chainId: "osmosis-1" }).map((row) => row.id),
    ["b"],
  );
  assert.deepEqual(contactsFor(rows, { prefix: "osmo", chainId: "osmo-test-5" }), [], "a pinned contact stays on its network");
  assert.deepEqual(
    searchContacts(rows, "kra").map((row) => row.id),
    ["b"],
  );
  assert.deepEqual(
    searchContacts(rows, "1234").map((row) => row.id),
    ["b"],
    "the note is searched",
  );
  assert.equal(searchContacts(rows, " ").length, 2);
  assert.deepEqual(
    removeContact(rows, "a").map((row) => row.id),
    ["b"],
  );
});
