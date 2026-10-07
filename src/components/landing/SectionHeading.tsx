import type { ReactNode } from "react";
import { cn } from "@/lib/cn";

/**
 * A landing section's heading block: mono eyebrow, h2, one paragraph. The
 * section element points its aria-labelledby at `id`.
 *
 * `split` puts the paragraph beside the title from 1024px (title left,
 * text right, bottoms aligned), so a wide screen reads the section's promise
 * in one glance instead of a narrow column with empty space beside it.
 */
export function SectionHeading({
  id,
  eyebrow,
  title,
  children,
  split = false,
  className,
}: {
  id: string;
  eyebrow: string;
  title: ReactNode;
  children?: ReactNode;
  split?: boolean;
  className?: string;
}) {
  const heading = (
    <div className="flex flex-col gap-3">
      <p className="d-label">{eyebrow}</p>
      <h2 id={id} className="text-[29px] font-medium leading-[1.12] tracking-[-0.035em] text-fg sm:text-[38px]">
        {title}
      </h2>
    </div>
  );
  const text = children ? <p className="max-w-[58ch] text-[15.5px] leading-[1.65] text-fg-muted sm:text-[16.5px]">{children}</p> : null;
  if (split) {
    return (
      <div className={cn("grid gap-4 lg:grid-cols-2 lg:items-end lg:gap-16", className)}>
        <div className="max-w-[600px]">{heading}</div>
        {text ? <div className="lg:justify-self-end lg:pb-1">{text}</div> : null}
      </div>
    );
  }
  return (
    <div className={cn("flex max-w-[660px] flex-col gap-3", className)}>
      {heading}
      {text}
    </div>
  );
}
