/**
 * DataTable sorting: unknown values stay at the bottom whichever way the
 * column is sorted, ties keep their order, and text sorts the way people
 * count.
 */

import assert from "node:assert/strict";
import { test } from "node:test";

import { nextSort, sortRows } from "../table-sort";

interface Row {
  id: string;
  value: number | null;
  name: string;
}

const rows: Row[] = [
  { id: "a", value: 10, name: "Chain 10" },
  { id: "b", value: null, name: "Chain 2" },
  { id: "c", value: 3, name: "chain 9" },
  { id: "d", value: Number.NaN, name: "Alpha" },
  { id: "e", value: 10, name: "Beta" },
];

const ids = (list: Row[]) => list.map((row) => row.id).join("");

test("numbers ascend and descend with unknowns last both ways", () => {
  assert.equal(ids(sortRows(rows, (row) => row.value, "asc")), "caebd");
  assert.equal(ids(sortRows(rows, (row) => row.value, "desc")), "aecbd");
});

test("ties keep the input order (stable)", () => {
  const sorted = sortRows(rows, (row) => row.value, "desc");
  assert.deepEqual(
    sorted.filter((row) => row.value === 10).map((row) => row.id),
    ["a", "e"],
  );
});

test("text uses numeric, case-insensitive collation", () => {
  assert.equal(ids(sortRows(rows, (row) => row.name, "asc")), "debca");
  assert.equal(ids(sortRows(rows, (row) => row.name, "desc")), "acbed");
});

test("infinite values order like numbers and keep ties stable", () => {
  const edge: Row[] = [
    { id: "a", value: Number.POSITIVE_INFINITY, name: "" },
    { id: "b", value: 1, name: "" },
    { id: "c", value: Number.POSITIVE_INFINITY, name: "" },
    { id: "d", value: Number.NEGATIVE_INFINITY, name: "" },
  ];
  assert.equal(ids(sortRows(edge, (row) => row.value, "desc")), "acbd");
  assert.equal(ids(sortRows(edge, (row) => row.value, "asc")), "dbac");
});

test("the input array is not mutated", () => {
  const copy = rows.slice();
  sortRows(rows, (row) => row.value, "asc");
  assert.deepEqual(rows, copy);
});

test("nextSort: figures start descending, text ascending, same key flips", () => {
  assert.deepEqual(nextSort(null, "value", true), { key: "value", dir: "desc" });
  assert.deepEqual(nextSort(null, "name", false), { key: "name", dir: "asc" });
  assert.deepEqual(nextSort({ key: "value", dir: "desc" }, "value", true), { key: "value", dir: "asc" });
  assert.deepEqual(nextSort({ key: "value", dir: "asc" }, "value", true), { key: "value", dir: "desc" });
  assert.deepEqual(nextSort({ key: "value", dir: "asc" }, "name", false), { key: "name", dir: "asc" });
});
