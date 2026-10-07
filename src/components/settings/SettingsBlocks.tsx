"use client";

/**
 * The Settings page's two building blocks: a section card (anchored, titled,
 * with the rows inside it) and a row (what the setting is and does on the
 * left, its control on the right; stacked on phones so a three-way control
 * never squeezes the sentence that explains it).
 */

import type { ReactNode } from "react";
import type { IconName } from "@/components/icons";
import { Card, CardBody, CardHeader } from "@/components/ui";
import { cn } from "@/lib/cn";

export interface SettingsSectionProps {
  id: string;
  title: string;
  subtitle?: ReactNode;
  icon: IconName;
  /** Right side of the header (a status badge). */
  actions?: ReactNode;
  children: ReactNode;
  className?: string;
}

export function SettingsSection({ id, title, subtitle, icon, actions, children, className }: SettingsSectionProps) {
  return (
    <Card as="section" id={id} aria-labelledby={`${id}-title`} className={cn("scroll-mt-[calc(var(--d-sticky-top)+16px)]", className)}>
      <CardHeader id={`${id}-title`} title={title} subtitle={subtitle} icon={icon} actions={actions} />
      <CardBody className="-mb-1">{children}</CardBody>
    </Card>
  );
}

export interface SettingRowProps {
  title: ReactNode;
  description?: ReactNode;
  /** The control. With `controlId`, the title is its <label>. */
  control?: ReactNode;
  controlId?: string;
  /** Under the text, full width (a list, a note, a warning). */
  children?: ReactNode;
  /**
   * Keep the control beside the text on phones too (a switch): only wider
   * controls (segmented choices, buttons) drop under it.
   */
  inline?: boolean;
  className?: string;
}

export function SettingRow({ title, description, control, controlId, children, inline, className }: SettingRowProps) {
  const heading = controlId ? (
    <label htmlFor={controlId} className="block text-[14px] font-medium leading-snug text-fg">
      {title}
    </label>
  ) : (
    <div className="text-[14px] font-medium leading-snug text-fg">{title}</div>
  );
  return (
    <div className={cn("flex flex-col gap-3 border-t border-[var(--d-hairline)] py-3.5 first:border-t-0 first:pt-1", className)}>
      <div className={cn("flex gap-2.5 sm:flex-row sm:items-center sm:justify-between sm:gap-6", inline ? "flex-row items-start justify-between gap-4" : "flex-col")}>
        <div className="min-w-0 flex-1">
          {heading}
          {description ? <div className="mt-0.5 max-w-[62ch] text-[13px] leading-[1.5] text-fg-dim">{description}</div> : null}
        </div>
        {control ? <div className={cn("flex shrink-0 flex-wrap items-center gap-2", inline && "pt-0.5 sm:pt-0")}>{control}</div> : null}
      </div>
      {children}
    </div>
  );
}
