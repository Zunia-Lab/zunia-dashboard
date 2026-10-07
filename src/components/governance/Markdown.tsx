"use client";

/**
 * Renders the safe markdown subset of `@/lib/markdown` as React elements.
 *
 * Nothing here takes HTML: every node becomes an element built in this file,
 * text is text, and links are the parser's http(s)-only hrefs, opened in a
 * new tab with `rel="noopener noreferrer nofollow ugc"` (proposal text is
 * user-generated: no referrer, no search-engine endorsement) and the ↗ that
 * says they leave the dashboard. A link whose visible text names a different
 * site than the one it opens also shows the real host, in warning colours.
 *
 * Headings start at `baseLevel` (default h3: the page's h1 is the top bar,
 * the card holding the text is an h2), so a proposal's "# Title" never adds a
 * second h1 to the page, and follow the levels the text actually uses
 * (`headingTags`): a text that opens at "##" still starts at h3, and the
 * outline never skips a level.
 */

import { Fragment, useMemo, type ReactNode } from "react";
import { Icon } from "@/components/icons";
import { cn } from "@/lib/cn";
import {
  headingTags,
  inlineText,
  isDeceptiveLink,
  markdownLinkHost,
  parseMarkdownDocument,
  type MdBlock,
  type MdInline,
  type MdList,
  type MdVoteOption,
} from "@/lib/markdown";
import { VoteSwatch } from "./TallyBar";

const VOTE_LEAD_LABEL: Record<MdVoteOption, string> = {
  yes: "Yes",
  no: "No",
  veto: "No with veto",
  abstain: "Abstain",
};

export interface MarkdownProps {
  source: string;
  /** Heading level of the text's shallowest heading (default 3: under a card's h2). */
  baseLevel?: 2 | 3 | 4;
  className?: string;
}

export function Markdown({ source, baseLevel = 3, className }: MarkdownProps) {
  const doc = useMemo(() => parseMarkdownDocument(source), [source]);
  const tags = useMemo(() => headingTags(doc.blocks, baseLevel), [doc, baseLevel]);
  if (doc.blocks.length === 0) return null;
  return (
    <div className={cn("flex min-w-0 max-w-full flex-col gap-3.5 text-[14px] leading-[1.65] text-fg-muted", className)}>
      <Blocks blocks={doc.blocks} tags={tags} />
      {doc.truncated ? (
        <p className="text-[12.5px] italic text-fg-dim">The text is very long; the end is not shown here.</p>
      ) : null}
    </div>
  );
}

/** Each heading's HTML level, from `headingTags`. */
type HeadingTags = ReturnType<typeof headingTags>;

function Blocks({ blocks, tags }: { blocks: readonly MdBlock[]; tags: HeadingTags }) {
  return (
    <>
      {blocks.map((block, index) => (
        <Block key={`${block.type}-${index}`} block={block} tags={tags} first={index === 0} />
      ))}
    </>
  );
}

function Block({ block, tags, first }: { block: MdBlock; tags: HeadingTags; first: boolean }) {
  switch (block.type) {
    case "heading":
      return (
        <Heading level={block.level} tag={tags.get(block) ?? 3} first={first}>
          <Inline nodes={block.children} />
        </Heading>
      );
    case "paragraph":
      return (
        <p className="m-0 min-w-0 max-w-[78ch] break-words [overflow-wrap:anywhere]">
          <Inline nodes={block.children} />
        </p>
      );
    case "vote":
      return (
        <div className="flex min-w-0 max-w-[78ch] gap-3 rounded-[var(--d-radius-inner)] border border-[var(--d-hairline)] bg-[var(--d-card-2)] px-3.5 py-2.5">
          <VoteSwatch option={block.option} className="mt-[7px]" />
          <p className="m-0 min-w-0 break-words [overflow-wrap:anywhere]">
            <span className="mr-1.5 font-mono text-[11px] font-medium uppercase tracking-[0.08em] text-fg">{VOTE_LEAD_LABEL[block.option]}</span>
            <Inline nodes={block.children} />
          </p>
        </div>
      );
    case "quote":
      return (
        <blockquote className="m-0 flex min-w-0 flex-col gap-2.5 border-l-2 border-[var(--d-accent-line)] pl-3.5 text-fg-muted">
          <Blocks blocks={block.children} tags={tags} />
        </blockquote>
      );
    case "list":
      return <List list={block} />;
    case "code":
      return (
        <pre className="d-scroll m-0 max-h-[420px] max-w-full overflow-auto rounded-[var(--d-radius-inner)] border border-[var(--d-hairline)] bg-[var(--d-card-2)] px-3.5 py-3 font-mono text-[12.5px] leading-[1.6] text-fg">
          <code>{block.value}</code>
        </pre>
      );
    case "table":
      return (
        <div className="d-scroll max-w-full overflow-x-auto rounded-[var(--d-radius-inner)] border border-[var(--d-hairline)]">
          <table className="w-full min-w-max border-collapse text-[13px] tabular-nums">
            <thead className="bg-[var(--d-card-2)]">
              <tr>
                {block.head.map((cell, index) => (
                  <th
                    key={index}
                    scope="col"
                    className="whitespace-nowrap border-b border-[var(--d-hairline)] px-3 py-2 font-medium text-fg-dim"
                    style={{ textAlign: block.align[index] ?? "left" }}
                  >
                    <Inline nodes={cell} />
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {block.rows.map((row, rowIndex) => (
                <tr key={rowIndex} className="border-b border-[var(--d-hairline)] last:border-b-0">
                  {row.map((cell, index) => (
                    <td key={index} className="px-3 py-2 align-top text-fg-muted" style={{ textAlign: block.align[index] ?? "left" }}>
                      <Inline nodes={cell} />
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
          {block.omittedRows > 0 ? (
            <p className="border-t border-[var(--d-hairline)] px-3 py-2 text-[12px] text-fg-dim">
              {block.omittedRows} more {block.omittedRows === 1 ? "row" : "rows"} not shown
            </p>
          ) : null}
        </div>
      );
    case "hr":
      return <hr className="m-0 border-0 border-t border-[var(--d-hairline)]" />;
  }
}

/**
 * Proposal headings, visually a step under the card title: a proposal's "#"
 * is section-sized here, "##" a sub-section, deeper levels the mono label.
 * The look follows the markdown level; the element (`tag`) the outline.
 */
function Heading({ level, tag, first, children }: { level: number; tag: number; first: boolean; children: ReactNode }) {
  const style =
    level === 1
      ? "text-[17px] font-semibold leading-snug tracking-[-0.02em] text-fg"
      : level === 2
        ? "text-[15.5px] font-semibold leading-snug tracking-[-0.015em] text-fg"
        : level === 3
          ? "text-[14px] font-semibold leading-snug text-fg"
          : "font-mono text-[11px] font-medium uppercase tracking-[0.08em] text-fg-dim";
  const className = cn("m-0 break-words [overflow-wrap:anywhere]", style, !first && (level <= 2 ? "mt-3" : "mt-1.5"));
  if (tag <= 2) return <h2 className={className}>{children}</h2>;
  if (tag === 3) return <h3 className={className}>{children}</h3>;
  if (tag === 4) return <h4 className={className}>{children}</h4>;
  if (tag === 5) return <h5 className={className}>{children}</h5>;
  return <h6 className={className}>{children}</h6>;
}

function List({ list, nested = false }: { list: MdList; nested?: boolean }) {
  const items = list.items.map((item, index) => (
    <li key={index} className="flex min-w-0 gap-2.5">
      {list.ordered ? (
        <span aria-hidden className="min-w-[1.25rem] shrink-0 text-right font-mono text-[12px] leading-[23px] text-fg-dim">
          {list.start + index}.
        </span>
      ) : (
        <span aria-hidden className="mt-[0.66em] size-[5px] shrink-0 rounded-full bg-[var(--d-accent-text)] opacity-80" />
      )}
      <div className="min-w-0 flex-1 break-words [overflow-wrap:anywhere]">
        {item.children.length ? <Inline nodes={item.children} /> : null}
        {item.sublist ? <List list={item.sublist} nested /> : null}
      </div>
    </li>
  ));
  const className = cn("m-0 flex min-w-0 max-w-[78ch] list-none flex-col gap-1.5 p-0", nested && "mt-1.5");
  // Native list semantics (item counts for screen readers); the markers are drawn.
  return list.ordered ? (
    <ol className={className} start={list.start}>
      {items}
    </ol>
  ) : (
    <ul className={className}>{items}</ul>
  );
}

function Inline({ nodes }: { nodes: readonly MdInline[] }) {
  return (
    <>
      {nodes.map((node, index) => (
        <InlineNode key={index} node={node} />
      ))}
    </>
  );
}

function InlineNode({ node }: { node: MdInline }) {
  switch (node.type) {
    case "text":
      return <Fragment>{node.value}</Fragment>;
    case "break":
      return <br />;
    case "strong":
      return (
        <strong className="font-semibold text-fg">
          <Inline nodes={node.children} />
        </strong>
      );
    case "em":
      return (
        <em className="italic">
          <Inline nodes={node.children} />
        </em>
      );
    case "strike":
      return (
        <s className="text-fg-dim">
          <Inline nodes={node.children} />
        </s>
      );
    case "code":
      return (
        <code className="break-words rounded-[5px] bg-[var(--d-glass-2)] px-[5px] py-[1px] font-mono text-[0.88em] text-fg [overflow-wrap:anywhere]">
          {node.value}
        </code>
      );
    case "link":
      return <SafeLink href={node.href} label={node.children} image={node.image === true} />;
  }
}

function SafeLink({ href, label, image }: { href: string; label: readonly MdInline[]; image: boolean }) {
  const text = inlineText(label);
  const deceptive = isDeceptiveLink(text, href);
  const host = markdownLinkHost(href);
  return (
    <>
      <a
        href={href}
        target="_blank"
        rel="noopener noreferrer nofollow ugc"
        title={href}
        className="break-words text-fg underline decoration-[var(--d-accent-line)] decoration-1 underline-offset-[3px] transition-colors duration-[160ms] [overflow-wrap:anywhere] hover:text-[var(--d-accent-text)] hover:decoration-[var(--d-accent-text)]"
      >
        {image ? <Icon name="nfts" size={13} className="mr-1 inline-block align-[-2px]" /> : null}
        <Inline nodes={label} />
        {/* An image link's label says nothing about where it goes: name the host. */}
        {image && host ? <span className="ml-1 font-mono text-[0.85em] text-fg-dim">{host}</span> : null}
        <Icon name="arrowUpRight" size={12} className="ml-0.5 inline-block align-[-1px] text-fg-dim" />
        <span className="sr-only"> (opens {host ?? "another site"} in a new tab)</span>
      </a>
      {deceptive && host ? (
        <span
          title="The link text shows a different site than the one it opens"
          className="ml-1 inline-flex items-center gap-1 rounded-[5px] bg-[var(--z-warning-fill)] px-1.5 align-[1px] font-mono text-[11px] leading-[18px] text-[var(--z-warning)]"
        >
          <Icon name="warning" size={11} />
          opens {host}
        </span>
      ) : null}
    </>
  );
}
