/**
 * An address the way people check one: the prefix dim, the data in short
 * groups, the last six characters strong. The groups are spaced with margins
 * and joined by `<wbr>` (break opportunities, not characters), so a selection
 * or a copy is still the exact address, and a line only ever breaks between
 * two groups, never inside the tail people compare.
 */

import { cn } from "@/lib/cn";
import { addressParts } from "./logic";

export function AddressChunks({
  address,
  tone = "accent",
  className,
}: {
  address: string;
  /** `accent`: the tail in the brand colour (Receive); `strong`: in the foreground (review cards). */
  tone?: "accent" | "strong";
  className?: string;
}) {
  const { head, groups, tail } = addressParts(address);
  return (
    <span className={cn("font-mono tabular-nums", className)} translate="no">
      {head ? <span className="text-fg-dim">{head}</span> : null}
      {groups.map((group, index) => (
        <span key={`${index}-${group}`}>
          <wbr />
          <span className={cn("text-fg", (head || index > 0) && "ml-[0.36ch]")}>{group}</span>
        </span>
      ))}
      <wbr />
      <span
        className={cn(
          "whitespace-nowrap font-semibold",
          (head || groups.length > 0) && "ml-[0.36ch]",
          tone === "accent" ? "text-[var(--d-accent-text)]" : "text-fg",
        )}
      >
        {tail}
      </span>
    </span>
  );
}
