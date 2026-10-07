/**
 * A safe markdown subset for governance proposal text (and any other prose a
 * stranger wrote that the dashboard shows).
 *
 * Ported from zunia-extension lib/markdown.ts at 1453e7a, then extended for
 * the dashboard's wider page: pipe tables (parameter changes and treasury
 * proposals live in them), headings to level 6, nested lists, setext
 * headings, block quotes holding blocks, kept line breaks, backslash escapes,
 * and image syntax read as a plain link.
 *
 * The safety model is the point of this module:
 *
 * - It parses to a small AST, never to HTML. The renderer
 *   (`src/components/governance/Markdown.tsx`) turns each node into a React
 *   element, so nothing in a proposal is ever interpreted as markup.
 * - Raw HTML (proposals are often pasted from forums) is flattened to
 *   markdown or text before parsing; `<script>` / `<style>` bodies are dropped
 *   whole. Text inside code fences is left as typed, and shows as text.
 * - Links survive only for http(s) URLs (`www.` is read as https); every
 *   other scheme (`javascript:`, `data:`, relative paths) becomes plain text.
 * - Images are never loaded: `![alt](url)` becomes a link to the image, so
 *   displaying a proposal cannot make the browser fetch anything.
 * - Input is capped (`MAX_MARKDOWN_SOURCE`), and so are nesting, table size
 *   and list depth, so a hostile proposal cannot make the page do unbounded
 *   work.
 *
 * Pure: no DOM, no React, so `node --test` covers it.
 */

export type MdInline =
  | { readonly type: "text"; readonly value: string }
  | { readonly type: "strong"; readonly children: readonly MdInline[] }
  | { readonly type: "em"; readonly children: readonly MdInline[] }
  | { readonly type: "strike"; readonly children: readonly MdInline[] }
  | { readonly type: "code"; readonly value: string }
  | {
      readonly type: "link";
      readonly href: string;
      readonly children: readonly MdInline[];
      /** The source was image syntax: shown as a link, never loaded. */
      readonly image?: true;
    }
  | { readonly type: "break" };

export type MdVoteOption = "yes" | "no" | "veto" | "abstain";

export type MdAlign = "left" | "center" | "right" | null;

export interface MdListItem {
  readonly children: readonly MdInline[];
  /** A list nested under this item. */
  readonly sublist?: MdList;
}

export interface MdList {
  readonly type: "list";
  readonly ordered: boolean;
  /** First number of an ordered list ("3." starts at 3). */
  readonly start: number;
  readonly items: readonly MdListItem[];
}

export type MdBlock =
  | { readonly type: "heading"; readonly level: 1 | 2 | 3 | 4 | 5 | 6; readonly children: readonly MdInline[] }
  | { readonly type: "paragraph"; readonly children: readonly MdInline[] }
  | {
      /** "YES - you agree…": the option explanations most Cosmos proposals end with. */
      readonly type: "vote";
      readonly option: MdVoteOption;
      readonly children: readonly MdInline[];
    }
  | MdList
  | { readonly type: "quote"; readonly children: readonly MdBlock[] }
  | { readonly type: "code"; readonly value: string; readonly lang: string | null }
  | {
      readonly type: "table";
      readonly align: readonly MdAlign[];
      readonly head: readonly (readonly MdInline[])[];
      readonly rows: readonly (readonly (readonly MdInline[])[])[];
      /** Rows past the cap that were left out. */
      readonly omittedRows: number;
    }
  | { readonly type: "hr" };

export interface MdDocument {
  blocks: MdBlock[];
  /** The source was longer than `MAX_MARKDOWN_SOURCE` and was cut. */
  truncated: boolean;
}

/** The detail API serves at most 100 KB of description; parse that much. */
export const MAX_MARKDOWN_SOURCE = 100_000;
const MAX_TABLE_ROWS = 200;
const MAX_TABLE_COLUMNS = 12;
const MAX_QUOTE_DEPTH = 3;
const MAX_LIST_DEPTH = 4;
const MAX_INLINE_DEPTH = 6;

/** Parse `source` into blocks. */
export function parseMarkdown(source: string): MdBlock[] {
  return parseMarkdownDocument(source).blocks;
}

/** Parse `source`, and say whether it had to be cut. */
export function parseMarkdownDocument(source: string): MdDocument {
  const raw = String(source ?? "");
  const truncated = raw.length > MAX_MARKDOWN_SOURCE;
  const text = prepareSource(truncated ? raw.slice(0, MAX_MARKDOWN_SOURCE) : raw);
  if (!text) return { blocks: [], truncated };
  return { blocks: parseBlocks(text.split("\n"), 0), truncated };
}

/* ------------------------------------------------------------------ blocks */

const FENCE_OPEN = /^ {0,3}(`{3,}|~{3,})\s*([^`\s]*)[^`]*$/;
const HEADING = /^ {0,3}(#{1,6})\s+(.*?)(?:\s+#+)?\s*$/;
const HR = /^ {0,3}([-*_])(?:\s*\1){2,}\s*$/;
const QUOTE = /^ {0,3}>\s?/;
const LIST_ITEM = /^(\s*)([-*+]|\d{1,9}[.)])\s+(.*)$/;
const SETEXT_1 = /^ {0,3}={2,}\s*$/;
const SETEXT_2 = /^ {0,3}-{2,}\s*$/;
const TABLE_DELIMITER = /^\s*\|?\s*:?-+:?\s*(?:\|\s*:?-+:?\s*)*\|?\s*$/;

function isBlank(line: string | undefined): boolean {
  return !line || !line.trim();
}

/** A line that starts a block of its own (ends a paragraph or a list item). */
function startsBlock(line: string, next: string | undefined): boolean {
  return (
    FENCE_OPEN.test(line) ||
    HEADING.test(line) ||
    HR.test(line) ||
    QUOTE.test(line) ||
    LIST_ITEM.test(line) ||
    isTableStart(line, next)
  );
}

/**
 * A GFM table starts with a row holding a pipe, right above a delimiter row
 * ("| -- | :-: |") with a pipe of its own and as many cells. "a | b" over a
 * bare "---" is not one (that is a heading underline or a rule).
 */
function isTableStart(line: string, next: string | undefined): boolean {
  if (next === undefined || !line.includes("|") || !next.includes("|") || !next.includes("-")) return false;
  if (!TABLE_DELIMITER.test(next)) return false;
  return splitRow(next).length === splitRow(line).length;
}

function parseBlocks(lines: readonly string[], quoteDepth: number): MdBlock[] {
  const blocks: MdBlock[] = [];
  let index = 0;

  while (index < lines.length) {
    const line = lines[index] ?? "";
    if (isBlank(line)) {
      index += 1;
      continue;
    }

    const fence = FENCE_OPEN.exec(line);
    if (fence) {
      const marker = fence[1] ?? "```";
      const lang = (fence[2] ?? "").toLowerCase().replace(/[^a-z0-9_+-]/g, "") || null;
      const body: string[] = [];
      index += 1;
      while (index < lines.length && !isFenceClose(lines[index] ?? "", marker)) {
        body.push(lines[index] ?? "");
        index += 1;
      }
      if (index < lines.length) index += 1;
      blocks.push({ type: "code", value: body.join("\n"), lang });
      continue;
    }

    if (HR.test(line)) {
      blocks.push({ type: "hr" });
      index += 1;
      continue;
    }

    const heading = HEADING.exec(line);
    if (heading) {
      const level = Math.min(6, (heading[1] ?? "#").length) as 1 | 2 | 3 | 4 | 5 | 6;
      const text = (heading[2] ?? "").trim();
      if (text) blocks.push({ type: "heading", level, children: parseInline(text) });
      index += 1;
      continue;
    }

    if (QUOTE.test(line)) {
      const quoted: string[] = [];
      while (index < lines.length && QUOTE.test(lines[index] ?? "")) {
        quoted.push((lines[index] ?? "").replace(QUOTE, ""));
        index += 1;
      }
      if (quoteDepth >= MAX_QUOTE_DEPTH) {
        blocks.push({ type: "paragraph", children: parseInline(quoted.join("\n")) });
      } else {
        const children = parseBlocks(quoted, quoteDepth + 1);
        if (children.length) blocks.push({ type: "quote", children });
      }
      continue;
    }

    if (isTableStart(line, lines[index + 1])) {
      const { block, next } = readTable(lines, index);
      blocks.push(block);
      index = next;
      continue;
    }

    if (LIST_ITEM.test(line)) {
      const { list, next } = readList(lines, index);
      blocks.push(list);
      index = next;
      continue;
    }

    // Paragraph: until a blank line or the start of another block. A setext
    // underline ("===" / "---" right under the text) turns a short one-line
    // paragraph into a heading. Under longer text it is read as a rule:
    // proposal authors draw "---" under a paragraph to separate sections, and
    // CommonMark's reading would turn the whole paragraph into a heading.
    const paragraph: string[] = [line.trim()];
    index += 1;
    let setext: 1 | 2 | null = null;
    while (index < lines.length) {
      const next = lines[index] ?? "";
      if (isBlank(next)) break;
      const underline = SETEXT_1.test(next) ? 1 : SETEXT_2.test(next) ? 2 : null;
      if (underline) {
        if (paragraph.length === 1 && (paragraph[0] ?? "").length <= 90) {
          setext = underline;
          index += 1;
        }
        break;
      }
      if (startsBlock(next, lines[index + 1])) break;
      paragraph.push(next.trim());
      index += 1;
    }
    if (setext) {
      blocks.push({ type: "heading", level: setext, children: parseInline(paragraph.join(" ")) });
      continue;
    }
    const joined = paragraph.join("\n");
    const vote = voteLeadOf(joined);
    if (vote) blocks.push({ type: "vote", option: vote.option, children: parseInline(vote.rest) });
    else blocks.push({ type: "paragraph", children: parseInline(joined) });
  }

  return blocks;
}

function isFenceClose(line: string, marker: string): boolean {
  const trimmed = line.trim();
  const char = marker[0] ?? "`";
  if (!trimmed.startsWith(char.repeat(marker.length))) return false;
  return trimmed.split("").every((c) => c === char);
}

/* ------------------------------------------------------------------ lists */

interface RawItem {
  indent: number;
  ordered: boolean;
  number: number;
  text: string[];
}

/**
 * A run of list lines, nested by indentation. Continuation lines (wrapped
 * item text, indented or not) join the item they follow; a blank line ends
 * the list unless the next line is another item.
 */
function readList(lines: readonly string[], start: number): { list: MdList; next: number } {
  const raw: RawItem[] = [];
  let index = start;
  while (index < lines.length) {
    const line = lines[index] ?? "";
    const item = LIST_ITEM.exec(line);
    if (item) {
      const marker = item[2] ?? "-";
      const ordered = /\d/.test(marker);
      raw.push({
        indent: expandTabs(item[1] ?? "").length,
        ordered,
        number: ordered ? Number.parseInt(marker, 10) : 1,
        text: [item[3] ?? ""],
      });
      index += 1;
      continue;
    }
    if (isBlank(line)) {
      // A loose list: items separated by blank lines stay one list.
      const after = lines[index + 1];
      if (after !== undefined && LIST_ITEM.test(after)) {
        index += 1;
        continue;
      }
      break;
    }
    // Continuation of the last item, unless the line starts another block.
    const last = raw[raw.length - 1];
    if (!last || startsBlock(line, lines[index + 1])) break;
    last.text.push(line.trim());
    index += 1;
  }
  // The shallowest item sets the top level, so an oddly indented first item
  // cannot strand the items after it.
  const top = raw.reduce((min, item) => Math.min(min, item.indent), Number.POSITIVE_INFINITY);
  return { list: buildList(raw, 0, 0, Number.isFinite(top) ? top : 0).list, next: index };
}

function buildList(
  raw: readonly RawItem[],
  from: number,
  depth: number,
  baseIndent = raw[from]?.indent ?? 0,
): { list: MdList; next: number } {
  const first = raw[from];
  const items: { children: MdInline[]; sublist?: MdList }[] = [];
  let index = from;
  while (index < raw.length) {
    const item = raw[index];
    if (!item) break;
    if (item.indent < baseIndent) break;
    if (item.indent > baseIndent && items.length > 0) {
      // Deeper: a nested list under the previous item (flattened past the cap).
      if (depth + 1 >= MAX_LIST_DEPTH) {
        items.push({ children: parseInline(item.text.join("\n")) });
        index += 1;
        continue;
      }
      const nested = buildList(raw, index, depth + 1);
      const parent = items[items.length - 1];
      if (parent) {
        parent.sublist = parent.sublist
          ? { ...parent.sublist, items: [...parent.sublist.items, ...nested.list.items] }
          : nested.list;
      }
      index = nested.next;
      continue;
    }
    items.push({ children: parseInline(item.text.join("\n")) });
    index += 1;
  }
  return {
    list: {
      type: "list",
      ordered: first?.ordered ?? false,
      start: first?.ordered ? Math.max(0, first.number) : 1,
      items,
    },
    next: index,
  };
}

function expandTabs(value: string): string {
  return value.replace(/\t/g, "    ");
}

/* ------------------------------------------------------------------ tables */

function readTable(lines: readonly string[], start: number): { block: MdBlock; next: number } {
  const head = splitRow(lines[start] ?? "").slice(0, MAX_TABLE_COLUMNS);
  const align = splitRow(lines[start + 1] ?? "")
    .slice(0, head.length)
    .map(alignOf);
  while (align.length < head.length) align.push(null);
  const rows: MdInline[][][] = [];
  let omittedRows = 0;
  let index = start + 2;
  while (index < lines.length) {
    const line = lines[index] ?? "";
    if (isBlank(line) || !line.includes("|")) break;
    if (FENCE_OPEN.test(line) || HEADING.test(line) || QUOTE.test(line)) break;
    if (rows.length >= MAX_TABLE_ROWS) {
      omittedRows += 1;
      index += 1;
      continue;
    }
    const cells = splitRow(line).slice(0, head.length);
    while (cells.length < head.length) cells.push("");
    rows.push(cells.map((cell) => parseInline(cell)));
    index += 1;
  }
  return {
    block: { type: "table", align, head: head.map((cell) => parseInline(cell)), rows, omittedRows },
    next: index,
  };
}

/** Cells of a pipe-table row; `\|` and pipes inside backticks stay in the cell. */
function splitRow(line: string): string[] {
  let text = line.trim();
  if (text.startsWith("|")) text = text.slice(1);
  if (text.endsWith("|") && !text.endsWith("\\|")) text = text.slice(0, -1);
  const cells: string[] = [];
  let current = "";
  let inCode = false;
  for (let i = 0; i < text.length; i += 1) {
    const char = text[i] ?? "";
    if (char === "\\" && text[i + 1] === "|") {
      current += "|";
      i += 1;
      continue;
    }
    if (char === "`") inCode = !inCode;
    if (char === "|" && !inCode) {
      cells.push(current.trim());
      current = "";
      continue;
    }
    current += char;
  }
  cells.push(current.trim());
  return cells;
}

function alignOf(cell: string): MdAlign {
  const value = cell.trim();
  const left = value.startsWith(":");
  const right = value.endsWith(":");
  if (left && right) return "center";
  if (right) return "right";
  if (left) return "left";
  return null;
}

/* ------------------------------------------------------------------ vote leads */

const VOTE_LEAD = /^(?:\*\*|__)?\s*(YES|NO\s+WITH\s+VETO|NO|ABSTAIN)\s*(?:\*\*|__)?\s*[-–—:]\s*([\s\S]*)$/i;

function voteLeadOf(text: string): { option: MdVoteOption; rest: string } | null {
  const match = VOTE_LEAD.exec(text.trim());
  if (!match) return null;
  const raw = (match[1] ?? "").replace(/\s+/g, " ").toUpperCase();
  const option: MdVoteOption | null =
    raw === "YES" ? "yes" : raw === "NO WITH VETO" ? "veto" : raw === "ABSTAIN" ? "abstain" : raw === "NO" ? "no" : null;
  if (!option) return null;
  return { option, rest: (match[2] ?? "").trim() };
}

/* ------------------------------------------------------------------ source */

/**
 * Newlines normalised, literal "\n" sequences (proposals submitted through a
 * CLI often carry them) made real, and HTML flattened outside code fences.
 */
function prepareSource(source: string): string {
  const text = source.replace(/\r\n?/g, "\n").replace(/\\n/g, "\n");
  const lines = text.split("\n");
  const out: string[] = [];
  let prose: string[] = [];
  let fence: string | null = null;
  const flush = () => {
    if (prose.length) out.push(...htmlToMarkdown(decodeEntities(prose.join("\n"))).split("\n"));
    prose = [];
  };
  for (const line of lines) {
    if (fence) {
      out.push(line);
      if (isFenceClose(line, fence)) fence = null;
      continue;
    }
    const open = FENCE_OPEN.exec(line);
    if (open) {
      flush();
      fence = open[1] ?? "```";
      out.push(line);
      continue;
    }
    prose.push(line);
  }
  flush();
  return out.join("\n").trim();
}

const NAMED_ENTITIES: Record<string, string> = {
  nbsp: " ",
  amp: "&",
  lt: "<",
  gt: ">",
  quot: '"',
  apos: "'",
  ndash: "–",
  mdash: "—",
  hellip: "…",
  rsquo: "’",
  lsquo: "‘",
  rdquo: "”",
  ldquo: "“",
};

function decodeEntities(value: string): string {
  return value.replace(/&(#x[0-9a-f]{1,6}|#\d{1,7}|[a-z]{2,8});/gi, (whole, body: string) => {
    if (body.startsWith("#")) {
      const code = body[1] === "x" || body[1] === "X" ? Number.parseInt(body.slice(2), 16) : Number.parseInt(body.slice(1), 10);
      // Control characters and lone surrogates stay encoded.
      if (!Number.isFinite(code) || code < 32 || (code >= 0xd800 && code <= 0xdfff) || code > 0x10ffff) return whole;
      return String.fromCodePoint(code);
    }
    return NAMED_ENTITIES[body.toLowerCase()] ?? whole;
  });
}

/**
 * HTML element names that are removed as markup. Anything else in angle
 * brackets (`<denom>`, `<https://…>`) is text and stays.
 */
const HTML_TAGS = new Set(
  (
    "a abbr address article aside b big blockquote body br caption center cite code col colgroup dd del details dfn div dl dt em " +
    "figcaption figure font footer form h1 h2 h3 h4 h5 h6 head header hr html i img input ins kbd label li link main mark meta nav " +
    "ol option p picture pre q s section select small source span strike strong sub summary sup table tbody td textarea tfoot th " +
    "thead title tr tt u ul video audio iframe embed object svg button"
  ).split(" "),
);

const TAG = /<\/?([a-z][a-z0-9]*)\b[^<>]*>/gi;

function htmlToMarkdown(text: string): string {
  if (!/<\/?[a-z][a-z0-9]*\b[^<>]*>|<!--/i.test(text)) return text;
  return text
    .replace(/<!--[\s\S]*?-->/g, "")
    .replace(/<(script|style)\b[^>]*>[\s\S]*?<\/\1\s*>/gi, "")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<hr\s*\/?>/gi, "\n\n---\n\n")
    .replace(/<h([1-6])\b[^>]*>/gi, (_, level: string) => `\n\n${"#".repeat(Number(level))} `)
    .replace(/<\/h[1-6]\s*>/gi, "\n\n")
    .replace(/<li\b[^>]*>/gi, "\n- ")
    .replace(/<\/(p|div|ul|ol|li|table|tr|blockquote|section|article)\s*>/gi, "\n")
    .replace(/<(p|div|ul|ol|table|blockquote|section|article)\b[^>]*>/gi, "\n")
    .replace(/<a\b[^>]*?href\s*=\s*["']([^"']+)["'][^>]*>([\s\S]*?)<\/a\s*>/gi, (_, href: string, label: string) => {
      const inner = label.replace(TAG, "").trim();
      return `[${inner || href}](${href})`;
    })
    .replace(/<img\b[^>]*?src\s*=\s*["']([^"']+)["'][^>]*>/gi, (whole: string, src: string) => {
      const alt = /alt\s*=\s*["']([^"']*)["']/i.exec(whole)?.[1] ?? "";
      return `![${alt}](${src})`;
    })
    .replace(/<\/?(strong|b)\s*>/gi, "**")
    .replace(/<\/?(em|i)\s*>/gi, "*")
    .replace(/<\/?code\s*>/gi, "`")
    .replace(TAG, (whole: string, name: string) => (HTML_TAGS.has(name.toLowerCase()) ? "" : whole))
    .replace(/\n{3,}/g, "\n\n");
}

/* ------------------------------------------------------------------ inline */

/**
 * One pass over the text with every inline construct as an alternative, in
 * priority order. Group map:
 *  1 escaped char · 2–3 code span · 4–5 image · 6 autolink · 7–8 link
 *  9 strong ** · 10 strong __ · 11 strike · 12 em * · 13 em _
 *
 * Labels and URLs stop at the next bracket (and an autolink at the next
 * "<"): a hostile proposal of "[a](" or "<https://" repeated would otherwise
 * make every opening try scan to the end of the text, quadratic work that
 * froze a render for seconds at the 100 KB cap. Nested brackets never formed
 * a link anyway.
 */
const INLINE =
  /\\([!-/:-@[-`{-~])|(`+)([^`]+?)\2|!\[([^[\]]*)\]\(\s*<?([^)\s<>[\]]+)>?(?:\s+["'][^"']*["'])?\s*\)|<((?:https?:\/\/|www\.)[^<>\s]+)>|\[([^[\]]+)\]\(\s*<?([^)\s<>[\]]+)>?(?:\s+["'][^"']*["'])?\s*\)|\*\*(?=\S)([\s\S]+?)\*\*|__(?=\S)([\s\S]+?)__|~~(?=\S)([\s\S]+?)~~|\*(?=[^\s*])([^*]+?)\*|_(?=[^\s_])([^_]+?)_/g;

/**
 * Inline nodes of `source`. Inside a link label (`inLink`) nothing becomes a
 * link again: a URL written as its own label (`[https://x](https://x)`) or a
 * link nested in a label stays text, so the renderer never nests anchors.
 */
export function parseInline(source: string, depth = 0, inLink = false): MdInline[] {
  const out: MdInline[] = [];
  if (!source) return out;
  if (depth >= MAX_INLINE_DEPTH) {
    pushText(out, source, inLink);
    return out;
  }
  const pattern = new RegExp(INLINE.source, "g");
  let cursor = 0;
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(source))) {
    const whole = match[0];
    // `_em_` only at word edges: snake_case identifiers (NO_WITH_VETO,
    // min_deposit) keep their underscores.
    if (match[13] !== undefined) {
      const before = source[match.index - 1] ?? "";
      const after = source[match.index + whole.length] ?? "";
      if (/[A-Za-z0-9]/.test(before) || /[A-Za-z0-9]/.test(after)) {
        pattern.lastIndex = match.index + 1;
        continue;
      }
    }
    if (match.index > cursor) pushText(out, source.slice(cursor, match.index), inLink);
    if (match[1] !== undefined) {
      pushPlain(out, match[1]);
    } else if (match[3] !== undefined) {
      out.push({ type: "code", value: match[3].replace(/^ (.*) $/, "$1") });
    } else if (match[5] !== undefined) {
      const href = inLink ? null : safeMarkdownHref(match[5]);
      const alt = (match[4] ?? "").trim();
      if (href) out.push({ type: "link", href, image: true, children: [{ type: "text", value: alt ? `Image: ${alt}` : "Image" }] });
      else if (alt) pushPlain(out, alt);
    } else if (match[6] !== undefined) {
      if (inLink) pushPlain(out, match[6]);
      else pushLink(out, match[6], [{ type: "text", value: displayMarkdownHref(match[6]) }]);
    } else if (match[7] !== undefined) {
      const href = inLink ? null : safeMarkdownHref(match[8] ?? "");
      // A label that is itself a URL reads as the short host + path form.
      const label = BARE_URL_ONLY.test(match[7].trim())
        ? [{ type: "text" as const, value: displayMarkdownHref(match[7].trim()) }]
        : parseInline(match[7], depth + 1, true);
      if (href) out.push({ type: "link", href, children: label });
      else out.push(...label);
    } else if (match[9] !== undefined || match[10] !== undefined) {
      out.push({ type: "strong", children: parseInline(match[9] ?? match[10] ?? "", depth + 1, inLink) });
    } else if (match[11] !== undefined) {
      out.push({ type: "strike", children: parseInline(match[11], depth + 1, inLink) });
    } else {
      out.push({ type: "em", children: parseInline(match[12] ?? match[13] ?? "", depth + 1, inLink) });
    }
    cursor = match.index + whole.length;
  }
  if (cursor < source.length) pushText(out, source.slice(cursor), inLink);
  return out;
}

const BARE_URL_ONLY = /^(?:https?:\/\/|www\.)\S+$/i;

/** Text with its line breaks kept as `break` nodes, bare URLs linked (not inside a link). */
function pushText(out: MdInline[], value: string, inLink = false) {
  if (!value) return;
  const lines = value.split("\n");
  lines.forEach((line, index) => {
    if (index > 0) out.push({ type: "break" });
    if (inLink) pushPlain(out, line);
    else pushUrls(out, line);
  });
}

/** Text only: no URL detection (escaped characters, alt text). */
function pushPlain(out: MdInline[], value: string) {
  const last = out[out.length - 1];
  if (last && last.type === "text") out[out.length - 1] = { type: "text", value: last.value + value };
  else out.push({ type: "text", value });
}

const BARE_URL = /(?:https?:\/\/|www\.)[^\s<>"'`]+/gi;

function pushUrls(out: MdInline[], value: string) {
  if (!value) return;
  const pattern = new RegExp(BARE_URL.source, "gi");
  let cursor = 0;
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(value))) {
    const raw = trimUrlPunct(match[0]);
    const trailing = match[0].slice(raw.length);
    if (match.index > cursor) pushPlain(out, value.slice(cursor, match.index));
    pushLink(out, raw, [{ type: "text", value: displayMarkdownHref(raw) }]);
    if (trailing) pushPlain(out, trailing);
    cursor = match.index + match[0].length;
  }
  if (cursor < value.length) pushPlain(out, value.slice(cursor));
}

function pushLink(out: MdInline[], raw: string, children: readonly MdInline[]) {
  const href = safeMarkdownHref(trimUrlPunct(raw));
  if (href) out.push({ type: "link", href, children });
  else pushPlain(out, raw);
}

const URL_TRAILING_PUNCT = new Set([".", ",", ";", ":", "!", "?", "'", '"']);

/**
 * A bare URL without the sentence punctuation after it. A closing
 * parenthesis belongs to the URL only when it opened one (Wikipedia-style
 * "…/Foo_(bar)"), not when the URL sits in parentheses.
 *
 * One pass from the end with running counts: the regex-and-recount version
 * was quadratic, and "https://a" followed by 90,000 ")" took seconds.
 */
function trimUrlPunct(value: string): string {
  let open = 0;
  let close = 0;
  for (let i = 0; i < value.length; i += 1) {
    if (value[i] === "(") open += 1;
    else if (value[i] === ")") close += 1;
  }
  let end = value.length;
  for (;;) {
    while (end > 0 && URL_TRAILING_PUNCT.has(value[end - 1] ?? "")) end -= 1;
    if (end > 0 && value[end - 1] === ")" && open < close) {
      end -= 1;
      close -= 1;
      continue;
    }
    return value.slice(0, end);
  }
}

/* ------------------------------------------------------------------ links */

/**
 * http(s) URLs only; `www.` is read as https. Relative paths, `javascript:`,
 * `data:` and every other scheme return null (the label is kept as text).
 * URLs carrying credentials (`https://user@host`) are refused too: the part
 * before `@` is a classic way to show one domain and open another.
 */
export function safeMarkdownHref(href: string): string | null {
  const value = href.trim();
  let candidate: string | null = null;
  if (/^https?:\/\//i.test(value)) candidate = value;
  else if (/^www\./i.test(value)) candidate = `https://${value}`;
  if (!candidate) return null;
  try {
    const url = new URL(candidate);
    if (url.protocol !== "http:" && url.protocol !== "https:") return null;
    if (url.username || url.password) return null;
    if (!url.hostname) return null;
    return candidate;
  } catch {
    return null;
  }
}

/** The host a link really opens, without "www.": "forum.cosmos.network". */
export function markdownLinkHost(href: string): string | null {
  try {
    return new URL(href).hostname.replace(/^www\./i, "").toLowerCase();
  } catch {
    return null;
  }
}

const DOMAIN_LIKE = /^(?:https?:\/\/)?(?:www\.)?((?:[a-z0-9-]+\.)+[a-z]{2,})(?:[/:?#]\S*)?$/i;

/**
 * Whether a link's visible text names a different site than the one it
 * opens: `[app.osmosis.zone](https://osmosis-claim.xyz)`. Proposals are
 * written by anyone with a deposit, and this is the usual phishing shape, so
 * the renderer shows the real host next to such a link.
 */
export function isDeceptiveLink(label: string, href: string): boolean {
  const shown = DOMAIN_LIKE.exec(label.trim());
  if (!shown) return false;
  const actual = markdownLinkHost(href);
  const claimed = (shown[1] ?? "").replace(/^www\./i, "").toLowerCase();
  if (!actual || !claimed) return false;
  return actual !== claimed && !actual.endsWith(`.${claimed}`);
}

/** Short label for a bare URL: host + a clipped path. */
export function displayMarkdownHref(href: string): string {
  const absolute = safeMarkdownHref(href) ?? href;
  try {
    const url = new URL(absolute);
    const host = url.hostname.replace(/^www\./, "");
    const path = `${url.pathname}${url.search}`.replace(/\/$/, "");
    const shown = path && path !== "/" ? `${host}${path}` : host;
    return shown.length > 48 ? `${shown.slice(0, 45)}…` : shown;
  } catch {
    return href;
  }
}

type MdHeading = Extract<MdBlock, { type: "heading" }>;

/**
 * The HTML heading level (h2–h6) of every heading of a document rendered
 * under a card whose own title is one level above `base`: the levels the
 * text uses, shallowest first, take `base`, `base + 1`… and no heading goes
 * more than one level deeper than the one before it. Proposal text routinely
 * starts at "##" (its "# Title" is dropped as a repeat of the page's) or
 * jumps from "##" to "####"; mapped as written, the page outline would skip
 * levels (card h2 → h4), which screen readers announce as missing sections.
 * The renderer keeps each heading's look by its markdown level.
 */
export function headingTags(blocks: readonly MdBlock[], base: number): ReadonlyMap<MdHeading, number> {
  const headings: MdHeading[] = [];
  const collect = (list: readonly MdBlock[]) => {
    for (const block of list) {
      if (block.type === "heading") headings.push(block);
      else if (block.type === "quote") collect(block.children);
    }
  };
  collect(blocks);
  const rank = new Map([...new Set(headings.map((heading) => heading.level))].sort((a, b) => a - b).map((level, index) => [level, index]));
  const tags = new Map<MdHeading, number>();
  let previous = base - 1;
  for (const heading of headings) {
    const tag = Math.min(6, base + (rank.get(heading.level) ?? 0), previous + 1);
    tags.set(heading, tag);
    previous = tag;
  }
  return tags;
}

/** The visible text of inline nodes (for link labels, headings' ids, tests). */
export function inlineText(nodes: readonly MdInline[]): string {
  return nodes
    .map((node) => {
      switch (node.type) {
        case "text":
        case "code":
          return node.value;
        case "break":
          return " ";
        default:
          return inlineText(node.children);
      }
    })
    .join("");
}

/** The opening of a long text that an excerpt reads from. */
const EXCERPT_SOURCE = 20_000;

/**
 * A plain-text excerpt of the opening prose, for a page header: paragraphs
 * in order, headings, code and tables skipped, each closed as a sentence,
 * cut at a word near `max`. Flattened markdown reads as "Summary Background
 * On September…"; this reads as the author's first sentences. "" when the
 * text opens with no prose at all.
 */
export function markdownExcerpt(source: string, max = 320): string {
  const parts: string[] = [];
  let length = 0;
  for (const block of parseMarkdown(String(source ?? "").slice(0, EXCERPT_SOURCE))) {
    if (block.type !== "paragraph" && block.type !== "vote") continue;
    const text = inlineText(block.children).replace(/\s+/g, " ").trim();
    if (!text) continue;
    parts.push(/[.!?:;…]$/.test(text) ? text : `${text}.`);
    length += text.length + 1;
    if (length >= max) break;
  }
  const joined = parts.join(" ");
  if (joined.length <= max) return joined;
  const cut = joined.slice(0, max);
  const space = cut.lastIndexOf(" ");
  return `${(space > max * 0.6 ? cut.slice(0, space) : cut).replace(/[\s,.;:]+$/, "")}…`;
}
