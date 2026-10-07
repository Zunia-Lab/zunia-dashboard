"use client";

/**
 * The floating "Compare (n)" bar of the Chains table: appears once a row is
 * ticked, holds up to four, and opens /compare with them. It floats above
 * the phone tab bar (60px + safe area, plus room for its raised Swap button)
 * and at the bottom of the viewport on larger screens; the page reserves
 * room under its last row so the bar never hides it.
 */

import { createPortal } from "react-dom";
import { Button, LogoStack, chainById } from "@/components/ui";
import { compareHref, MAX_ENTITIES } from "@/components/compare/model";

interface CompareBarProps {
  selected: readonly string[];
  onClear: () => void;
}

export function CompareBar({ selected, onClear }: CompareBarProps) {
  // Selection only exists after a click, so this never renders on the server.
  if (selected.length === 0 || typeof document === "undefined") return null;
  const chains = selected.map((id) => chainById(id)).filter((chain): chain is NonNullable<typeof chain> => Boolean(chain));
  const ready = selected.length >= 2;
  const href = compareHref(selected.map((id) => ({ kind: "chain" as const, id })));
  const names = chains.map((chain) => chain.chainName);
  // Portalled to <body>: an ancestor with a transform (the page's enter
  // animation keeps one) would otherwise become the containing block of
  // this fixed bar and park it at the end of the page instead of the
  // viewport. <body> carries .zunia-root, so the tokens still apply.
  return createPortal(
    <div className="pointer-events-none fixed inset-x-0 bottom-[calc(80px+env(safe-area-inset-bottom))] z-40 flex justify-center px-4 md:bottom-6">
      <div
        role="region"
        aria-label="Chains selected to compare"
        className="d-fade-in pointer-events-auto flex max-w-full items-center gap-2.5 rounded-full border border-[var(--d-hairline-strong)] bg-[var(--d-pop-bg)] py-1.5 pl-2 pr-1.5 shadow-[var(--d-pop-shadow)] sm:gap-3"
      >
        <LogoStack items={chains.map((chain) => ({ src: chain.iconUrl, label: chain.chainName }))} size={24} max={MAX_ENTITIES} />
        <p className="min-w-0 truncate text-[13px] text-fg-muted" aria-live="polite">
          <span className="font-medium text-fg">{selected.length}</span>
          <span className="max-sm:hidden"> of {MAX_ENTITIES} selected</span>
          <span className="sr-only">: {names.join(", ")}</span>
          {!ready ? <span className="max-sm:hidden"> · pick one more</span> : null}
        </p>
        <Button variant="ghost" size="sm" onClick={onClear}>
          Clear
        </Button>
        <Button variant="primary" size="sm" href={ready ? href : undefined} disabled={!ready} iconRight="arrowRight">
          Compare{ready ? ` ${selected.length}` : ""}
        </Button>
      </div>
    </div>,
    document.body,
  );
}
