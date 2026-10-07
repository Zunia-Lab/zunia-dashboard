/**
 * CSV export for tables (Activity, Assets, Markets): build the text, then
 * hand it to the browser as a download. Client-side only, nothing is sent
 * anywhere.
 *
 * `toCsv` is pure so node:test covers it. Two rules matter for a wallet:
 *
 * - **Formula injection.** Memos, token names and validator monikers are
 *   chosen by strangers; a memo of `=HYPERLINK("https://…")` opened in a
 *   spreadsheet would run as a formula. Text cells starting with = + - @ or a
 *   tab / carriage return get a leading apostrophe (the OWASP CSV advice), so
 *   spreadsheets show them as text. Numbers are written as numbers and are
 *   never prefixed, so a negative amount stays a number.
 * - **Exact figures.** Pass raw values (a number, a decimal string, a bigint
 *   of base units), not display strings: "$12.4k" in a CSV is useless to
 *   anyone summing a column. A null cell stays empty, never "0".
 */

export type CsvCell = string | number | bigint | boolean | null | undefined;

export interface CsvColumn<T> {
  header: string;
  value: (row: T) => CsvCell;
}

/** Text that a spreadsheet would read as a formula. */
const FORMULA_START = /^[=+\-@\t\r]/;

function cellText(cell: CsvCell): string {
  if (cell === null || cell === undefined) return "";
  if (typeof cell === "number") return Number.isFinite(cell) ? String(cell) : "";
  if (typeof cell === "bigint") return cell.toString();
  if (typeof cell === "boolean") return cell ? "true" : "false";
  return FORMULA_START.test(cell) ? `'${cell}` : cell;
}

function quote(text: string): string {
  return /[",\r\n]/.test(text) || text !== text.trim() ? `"${text.replace(/"/g, '""')}"` : text;
}

/**
 * RFC 4180 text: a header row, then one line per row, CRLF line ends,
 * fields quoted only when they need it.
 */
export function toCsv<T>(rows: readonly T[], columns: readonly CsvColumn<T>[]): string {
  const lines = [columns.map((column) => quote(cellText(column.header))).join(",")];
  for (const row of rows) {
    lines.push(columns.map((column) => quote(cellText(column.value(row)))).join(","));
  }
  return `${lines.join("\r\n")}\r\n`;
}

/**
 * A file name that is safe on every OS: "zunia-activity-2026-10-07.csv".
 * Keeps letters, digits, dot, dash and underscore.
 */
export function csvFileName(stem: string, at: number = Date.now()): string {
  const safe = stem.replace(/[^A-Za-z0-9._-]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 80) || "export";
  const day = new Date(at).toISOString().slice(0, 10);
  return `${safe}-${day}.csv`;
}

/**
 * Saves `csv` as a file through a temporary object URL. The byte-order mark
 * makes Excel read the file as UTF-8 (tickers like "USDC.n", "−" signs and
 * non-Latin monikers survive). Browser only; a no-op on the server.
 */
export function downloadCsv(fileName: string, csv: string): void {
  if (typeof document === "undefined") return;
  const blob = new Blob(["﻿", csv], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = fileName;
  link.rel = "noopener";
  link.style.display = "none";
  document.body.append(link);
  link.click();
  link.remove();
  // Revoke on the next tick: Safari cancels a download whose URL is revoked
  // synchronously inside the click.
  setTimeout(() => URL.revokeObjectURL(url), 0);
}
