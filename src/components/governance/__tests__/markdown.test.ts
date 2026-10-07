/**
 * The proposal markdown subset (src/lib/markdown.ts): what renders, and above
 * all what never does — markup, scripts, images, non-http links, links that
 * hide where they go.
 */

import assert from "node:assert/strict";
import { test } from "node:test";

import {
  MAX_MARKDOWN_SOURCE,
  displayMarkdownHref,
  headingTags,
  inlineText,
  isDeceptiveLink,
  markdownExcerpt,
  parseInline,
  parseMarkdown,
  parseMarkdownDocument,
  safeMarkdownHref,
  type MdBlock,
  type MdInline,
} from "@/lib/markdown";

function only<T extends MdBlock["type"]>(blocks: MdBlock[], type: T): Extract<MdBlock, { type: T }> {
  const block = blocks.find((b) => b.type === type);
  if (!block) throw new Error(`expected a ${type} block, got ${blocks.map((b) => b.type).join(", ")}`);
  return block as Extract<MdBlock, { type: T }>;
}

function walk(nodes: readonly MdInline[], visit: (node: MdInline) => void) {
  for (const node of nodes) {
    visit(node);
    if ("children" in node) walk(node.children, visit);
  }
}

function allInline(blocks: readonly MdBlock[]): MdInline[] {
  const out: MdInline[] = [];
  const collect = (nodes: readonly MdInline[]) => walk(nodes, (n) => out.push(n));
  for (const block of blocks) {
    switch (block.type) {
      case "heading":
      case "paragraph":
      case "vote":
        collect(block.children);
        break;
      case "list":
        for (const item of block.items) collect(item.children);
        break;
      case "quote":
        out.push(...allInline(block.children));
        break;
      case "table":
        for (const cell of block.head) collect(cell);
        for (const row of block.rows) for (const cell of row) collect(cell);
        break;
      default:
        break;
    }
  }
  return out;
}

/* ------------------------------------------------------------- ported cases */

test("## headings become heading blocks", () => {
  const [heading] = parseMarkdown("## Motivation\n\nShip the change.");
  assert.deepEqual({ type: heading?.type, level: heading?.type === "heading" ? heading.level : null }, { type: "heading", level: 2 });
});

test("lists, emphasis and links", () => {
  const blocks = parseMarkdown("- **Yes** on [forum](https://forum.cosmos.network/t/1)\n- skip `MsgVote`");
  const list = only(blocks, "list");
  assert.equal(list.ordered, false);
  assert.ok(list.items[0]?.children.some((n) => n.type === "strong"));
  assert.ok(list.items[0]?.children.some((n) => n.type === "link"));
  assert.ok(list.items[1]?.children.some((n) => n.type === "code"));
});

test("fenced code is kept and javascript links are dropped", () => {
  const blocks = parseMarkdown("See [x](javascript:alert(1))\n\n```\nmsg\n```");
  const paragraph = only(blocks, "paragraph");
  assert.equal(paragraph.children.some((n) => n.type === "link"), false);
  const code = only(blocks, "code");
  assert.equal(code.value, "msg");
});

test("common HTML paste is flattened", () => {
  const blocks = parseMarkdown("<h2>Summary</h2><p>Raise the <strong>cap</strong>.</p>");
  assert.equal(blocks[0]?.type, "heading");
  const paragraph = only(blocks, "paragraph");
  assert.ok(paragraph.children.some((n) => n.type === "strong"));
});

test("YES / NO / NO WITH VETO / ABSTAIN leads become vote blocks", () => {
  const blocks = parseMarkdown(
    "YES - You agree.\n\nNO - You disagree.\n\nNO WITH VETO - A `NoWithVeto` vote.\n\nABSTAIN - You sit out.",
  );
  assert.deepEqual(
    blocks.map((b) => (b.type === "vote" ? b.option : b.type)),
    ["yes", "no", "veto", "abstain"],
  );
});

test("bare https URLs are linked", () => {
  const [block] = parseMarkdown("Read https://forum.cosmos.network/t/10555 for the note.");
  assert.equal(block?.type, "paragraph");
  const link = block?.type === "paragraph" ? block.children.find((n) => n.type === "link") : undefined;
  assert.equal(link?.type === "link" ? link.href : null, "https://forum.cosmos.network/t/10555");
});

test("identifiers with underscores are not italicised", () => {
  const [block] = parseMarkdown("Use NO_WITH_VETO on chain and set min_deposit.");
  assert.ok(block?.type === "paragraph");
  assert.equal(allInline(parseMarkdown("Use NO_WITH_VETO on chain and set min_deposit.")).some((n) => n.type === "em"), false);
});

test("safeMarkdownHref allows http(s) only", () => {
  assert.equal(safeMarkdownHref("https://cosmos.network"), "https://cosmos.network");
  assert.equal(safeMarkdownHref("www.cosmos.network"), "https://www.cosmos.network");
  assert.equal(safeMarkdownHref("javascript:alert(1)"), null);
  assert.equal(safeMarkdownHref("JaVaScRiPt:alert(1)"), null);
  assert.equal(safeMarkdownHref("data:text/html,<script>alert(1)</script>"), null);
  assert.equal(safeMarkdownHref("/local"), null);
  assert.equal(safeMarkdownHref("//evil.example"), null);
});

/* --------------------------------------------------------------- new cases */

test("credentials in a URL are refused (the 'trusted.com@evil.com' trick)", () => {
  assert.equal(safeMarkdownHref("https://app.osmosis.zone@evil.example/claim"), null);
  const inline = parseInline("[Claim](https://app.osmosis.zone@evil.example/claim)");
  assert.equal(inline.some((n) => n.type === "link"), false);
  assert.equal(inlineText(inline), "Claim");
});

test("raw HTML never survives as markup; script and style bodies are dropped", () => {
  const blocks = parseMarkdown('<script>alert("x")</script><style>p{}</style><div onclick="x()">Hello <iframe src="https://e.x"></iframe>world</div>');
  const text = allInline(blocks)
    .filter((n) => n.type === "text")
    .map((n) => (n.type === "text" ? n.value : ""))
    .join(" ");
  assert.ok(!text.includes("<"), text);
  assert.ok(!text.includes("alert"), text);
  assert.ok(text.includes("Hello") && text.includes("world"), text);
});

test("entity-encoded HTML is decoded, then flattened too", () => {
  const text = inlineText(only(parseMarkdown("&lt;b&gt;bold&lt;/b&gt; &amp; more"), "paragraph").children);
  assert.equal(text, "bold & more");
});

test("angle-bracket text that is not an HTML tag stays", () => {
  const text = inlineText(only(parseMarkdown("Set <denom> to <b>uatom</b>"), "paragraph").children);
  assert.equal(text, "Set <denom> to uatom");
});

test("code fences keep HTML as text", () => {
  const code = only(parseMarkdown("```html\n<script>alert(1)</script>\n```"), "code");
  assert.equal(code.value, "<script>alert(1)</script>");
  assert.equal(code.lang, "html");
});

test("images are never loaded: they become links", () => {
  const nodes = allInline(parseMarkdown("![chart](https://example.com/chart.png) and ![x](javascript:alert(1))"));
  const links = nodes.filter((n) => n.type === "link");
  assert.equal(links.length, 1);
  const link = links[0];
  assert.ok(link?.type === "link" && link.image === true && link.href === "https://example.com/chart.png");
  assert.equal(inlineText(link?.type === "link" ? link.children : []), "Image: chart");
  assert.ok(!nodes.some((n) => n.type === "text" && n.value.includes("!")), "no stray '!' left");
});

test("pipe tables with alignment and inline content", () => {
  const source = [
    "| Pool | Pair | ~Value |",
    "| -- | :-: | --: |",
    "| [1252](https://app.osmosis.zone/pool/1252) | stOSMO/OSMO | ~$170,000 |",
    "| 1923 | ampOSMO/OSMO | ~$79,000 |",
  ].join("\n");
  const table = only(parseMarkdown(source), "table");
  assert.deepEqual(table.align, [null, "center", "right"]);
  assert.equal(table.head.length, 3);
  assert.equal(table.rows.length, 2);
  assert.ok(table.rows[0]?.[0]?.some((n) => n.type === "link"));
  assert.equal(inlineText(table.rows[1]?.[2] ?? []), "~$79,000");
});

test("a pipe inside code or escaped stays in its cell", () => {
  const table = only(parseMarkdown("| a | b |\n| - | - |\n| `x|y` | c \\| d |"), "table");
  assert.equal(inlineText(table.rows[0]?.[0] ?? []), "x|y");
  assert.equal(inlineText(table.rows[0]?.[1] ?? []), "c | d");
});

test("'a | b' over a bare rule is not a table", () => {
  const blocks = parseMarkdown("Price | Value\n---");
  assert.equal(blocks.some((b) => b.type === "table"), false);
});

test("nested lists by indentation, ordered start kept", () => {
  const list = only(parseMarkdown("3. First\n4. Second\n   - nested a\n   - nested b\n5. Third"), "list");
  assert.equal(list.ordered, true);
  assert.equal(list.start, 3);
  assert.equal(list.items.length, 3);
  assert.equal(list.items[1]?.sublist?.items.length, 2);
  assert.equal(inlineText(list.items[1]?.sublist?.items[1]?.children ?? []), "nested b");
});

test("wrapped list item lines join their item", () => {
  const list = only(parseMarkdown("- one line\n  that wraps\n- two"), "list");
  assert.equal(list.items.length, 2);
  assert.equal(inlineText(list.items[0]?.children ?? []), "one line that wraps");
});

test("headings to level 6 and closing hashes", () => {
  const heading = only(parseMarkdown("###### Deep ##"), "heading");
  assert.equal(heading.level, 6);
  assert.equal(inlineText(heading.children), "Deep");
  assert.equal(parseMarkdown("#1049 is not a heading")[0]?.type, "paragraph");
});

test("heading outline: the shallowest level used starts under the card, and no level is skipped", () => {
  const tagsOf = (source: string, base = 3) => {
    const blocks = parseMarkdown(source);
    const tags = headingTags(blocks, base);
    const out: string[] = [];
    const visit = (list: readonly MdBlock[]) => {
      for (const block of list) {
        if (block.type === "heading") out.push(`${inlineText(block.children)}:h${tags.get(block)}`);
        else if (block.type === "quote") visit(block.children);
      }
    };
    visit(blocks);
    return out;
  };
  // osmosis-1 #1049 once its "# Title" is dropped: "##" sections, "###" under them.
  assert.deepEqual(tagsOf("## Background\n\nText\n\n## Current positions\n\n### stOSMO\n\nMore"), [
    "Background:h3",
    "Current positions:h3",
    "stOSMO:h4",
  ]);
  // A jump from "#" to "###" is one level in the outline.
  assert.deepEqual(tagsOf("# A\n\n### B\n\n#### C"), ["A:h3", "B:h4", "C:h5"]);
  // A deeper heading first never opens below the card's next level.
  assert.deepEqual(tagsOf("### Summary\n\n# Proposal\n\n### Detail"), ["Summary:h3", "Proposal:h3", "Detail:h4"]);
  // Quotes are part of the outline; the deepest tag is h6.
  assert.deepEqual(tagsOf("## A\n\n> ### Quoted"), ["A:h3", "Quoted:h4"]);
  assert.deepEqual(tagsOf("# 1\n\n## 2\n\n### 3\n\n#### 4\n\n##### 5", 4), ["1:h4", "2:h5", "3:h6", "4:h6", "5:h6"]);
  assert.equal(headingTags(parseMarkdown("No headings here."), 3).size, 0);
});

test("setext: a short line becomes a heading, a long paragraph keeps its text", () => {
  assert.equal(parseMarkdown("Summary\n=======")[0]?.type, "heading");
  const long = "This paragraph is far too long to be a heading, so the rule under it separates sections instead of turning it into one.";
  const blocks = parseMarkdown(`${long}\n---\nNext`);
  assert.equal(blocks[0]?.type, "paragraph");
});

test("soft line breaks are kept", () => {
  const paragraph = only(parseMarkdown("Title: X\nAuthor: Y"), "paragraph");
  assert.ok(paragraph.children.some((n) => n.type === "break"));
});

test("literal \\n sequences from CLI-submitted proposals become lines", () => {
  const blocks = parseMarkdown("## Summary\\n\\nText here");
  assert.equal(blocks[0]?.type, "heading");
  assert.equal(blocks[1]?.type, "paragraph");
});

test("backslash escapes print the character", () => {
  const text = inlineText(only(parseMarkdown("\\*not em\\* and \\_x\\_"), "paragraph").children);
  assert.equal(text, "*not em* and _x_");
});

test("block quotes hold blocks", () => {
  const quote = only(parseMarkdown("> ## Note\n> - a\n> - b"), "quote");
  assert.equal(quote.children[0]?.type, "heading");
  assert.equal(quote.children[1]?.type, "list");
});

test("a URL inside parentheses does not swallow the closing one", () => {
  const nodes = parseInline("(see https://forum.cosmos.network/t/1)");
  const link = nodes.find((n) => n.type === "link");
  assert.equal(link?.type === "link" ? link.href : null, "https://forum.cosmos.network/t/1");
  assert.equal(inlineText(nodes), "(see forum.cosmos.network/t/1)");
});

test("deceptive links: the visible domain differs from the real one", () => {
  assert.equal(isDeceptiveLink("app.osmosis.zone", "https://osmosis-claim.xyz/airdrop"), true);
  assert.equal(isDeceptiveLink("https://www.mintscan.io/cosmos", "https://mintscan-io.app/x"), true);
  assert.equal(isDeceptiveLink("app.osmosis.zone/pool/1252", "https://app.osmosis.zone/pool/1252"), false);
  assert.equal(isDeceptiveLink("osmosis.zone", "https://app.osmosis.zone"), false);
  assert.equal(isDeceptiveLink("forum post", "https://evil.example"), false);
});

test("displayMarkdownHref: host and a clipped path", () => {
  assert.equal(displayMarkdownHref("https://www.forum.cosmos.network/t/10555/"), "forum.cosmos.network/t/10555");
  assert.ok(displayMarkdownHref(`https://example.com/${"a".repeat(80)}`).endsWith("…"));
});

test("long sources are cut and say so", () => {
  const doc = parseMarkdownDocument("word ".repeat(MAX_MARKDOWN_SOURCE));
  assert.equal(doc.truncated, true);
  assert.ok(doc.blocks.length > 0);
  assert.equal(parseMarkdownDocument("short").truncated, false);
});

test("empty and whitespace-only input render nothing", () => {
  assert.deepEqual(parseMarkdown(""), []);
  assert.deepEqual(parseMarkdown("  \n\n  "), []);
});

test("a URL written as its own link label never nests a link", () => {
  const url = "https://forum.osmosis.zone/t/withdraw-margined-managed-osmo-lst-and-eth-btc-liquidity/4142";
  const nodes = parseInline(`**Forum Post:** [${url}](${url}) and [see [x](https://a.example)](https://b.example)`);
  const links: MdInline[] = [];
  walk(nodes, (n) => {
    if (n.type === "link") links.push(n);
  });
  for (const link of links) {
    if (link.type !== "link") continue;
    const inner: MdInline[] = [];
    walk(link.children, (n) => inner.push(n));
    assert.equal(inner.some((n) => n.type === "link"), false, "no link inside a link");
  }
  const first = links[0];
  const text = first?.type === "link" ? inlineText(first.children) : "";
  assert.ok(text.startsWith("forum.osmosis.zone/t/withdraw") && text.endsWith("…"), text);
});

test("hostile input stays linear: no quadratic scan on unclosed links, autolinks or parentheses", () => {
  // Each of these took seconds at the 100 KB cap before labels and URLs
  // stopped at the next bracket and trailing ")" were trimmed in one pass.
  const cases = [
    "[a](".repeat(25_000),
    "[".repeat(90_000),
    "![".repeat(40_000),
    "<https://".repeat(10_000),
    `see https://a${")".repeat(90_000)}`,
  ];
  for (const source of cases) {
    const started = performance.now();
    parseMarkdownDocument(source);
    const ms = performance.now() - started;
    assert.ok(ms < 1_000, `${source.slice(0, 12)}… took ${ms.toFixed(0)} ms`);
  }
});

test("a label holding an opening bracket links only the inner label", () => {
  const nodes = parseInline("[a [b](https://x.example)");
  const links = nodes.filter((node): node is Extract<MdInline, { type: "link" }> => node.type === "link");
  assert.equal(links.length, 1);
  assert.equal(inlineText(links[0]?.children ?? []), "b");
  assert.equal(inlineText(nodes), "[a b");
});

test("URL punctuation: parentheses balance, sentence marks drop", () => {
  const link = (text: string) => parseInline(text).find((node) => node.type === "link") as Extract<MdInline, { type: "link" }> | undefined;
  assert.equal(link("(see https://en.wikipedia.org/wiki/Foo_(bar)).")?.href, "https://en.wikipedia.org/wiki/Foo_(bar)");
  assert.equal(link("Read https://forum.cosmos.network/t/1?x=1!")?.href, "https://forum.cosmos.network/t/1?x=1");
});

test("excerpt: the opening prose as sentences, headings and code skipped", () => {
  const source = "1.2M ATOM Refund\n\n## Background\n\nOn September 22 the **Hub** halted.\n\n```\ncode\n```\n\nMore text here.";
  assert.equal(markdownExcerpt(source), "1.2M ATOM Refund. On September 22 the Hub halted. More text here.");
  const long = `${"word ".repeat(120)}end`;
  const cut = markdownExcerpt(long, 100);
  assert.ok(cut.length <= 101 && cut.endsWith("…"), cut);
  assert.equal(markdownExcerpt("# Only a heading\n\n| a | b |\n| - | - |\n| 1 | 2 |"), "");
});
