/**
 * CSV export: exact values, RFC 4180 quoting, and no formula injection from
 * stranger-chosen text (memos, token names, monikers).
 */

import assert from "node:assert/strict";
import { test } from "node:test";

import { csvFileName, toCsv, type CsvColumn } from "../csv";

interface Tx {
  hash: string;
  memo: string | null;
  amount: number | null;
  units: bigint;
  ok: boolean;
}

const columns: CsvColumn<Tx>[] = [
  { header: "Hash", value: (row) => row.hash },
  { header: "Memo", value: (row) => row.memo },
  { header: "Amount", value: (row) => row.amount },
  { header: "Base units", value: (row) => row.units },
  { header: "Success", value: (row) => row.ok },
];

test("header, CRLF lines, raw numbers, empty unknowns", () => {
  const csv = toCsv<Tx>([{ hash: "ABC", memo: null, amount: -12.5, units: BigInt("1234567890123456789"), ok: true }], columns);
  assert.equal(csv, "Hash,Memo,Amount,Base units,Success\r\nABC,,-12.5,1234567890123456789,true\r\n");
});

test("quotes commas, quotes, line breaks and edge spaces", () => {
  const csv = toCsv<Tx>(
    [{ hash: "A", memo: 'say "hi", then\nleave ', amount: Number.NaN, units: BigInt(0), ok: false }],
    columns,
  );
  assert.equal(csv.split("\r\n")[1], 'A,"say ""hi"", then\nleave ",,0,false');
});

test("text that a spreadsheet would run as a formula is neutralised", () => {
  const rows: Tx[] = [
    { hash: "1", memo: '=HYPERLINK("https://evil.example","claim")', amount: 1, units: BigInt(1), ok: true },
    { hash: "2", memo: "+1+1", amount: 1, units: BigInt(1), ok: true },
    { hash: "3", memo: "-2+3", amount: 1, units: BigInt(1), ok: true },
    { hash: "4", memo: "@SUM(A1)", amount: 1, units: BigInt(1), ok: true },
    { hash: "5", memo: "\tcmd", amount: 1, units: BigInt(1), ok: true },
  ];
  const memos = toCsv(rows, columns)
    .trim()
    .split("\r\n")
    .slice(1)
    .map((line) => line.split(",")[1]);
  assert.deepEqual(memos, [`"'=HYPERLINK(""https://evil.example""`, "'+1+1", "'-2+3", "'@SUM(A1)", "'\tcmd"]);
});

test("a negative number stays a number (no apostrophe)", () => {
  const csv = toCsv<Tx>([{ hash: "x", memo: "", amount: -3, units: BigInt(-3), ok: true }], columns);
  assert.equal(csv.split("\r\n")[1], "x,,-3,-3,true");
});

test("csvFileName is safe and dated", () => {
  const at = Date.UTC(2026, 9, 7, 12);
  assert.equal(csvFileName("zunia activity", at), "zunia-activity-2026-10-07.csv");
  assert.equal(csvFileName("../../etc/passwd", at), "..-..-etc-passwd-2026-10-07.csv");
  assert.equal(csvFileName("", at), "export-2026-10-07.csv");
});
