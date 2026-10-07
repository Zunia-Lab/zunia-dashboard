"use client";

/**
 * The slim "Connect to see your position" card the public validator pages
 * show where a wallet would add personal data (spec §6: public pages show
 * it inline). One line of what connecting adds, one button.
 */

import type { ReactNode } from "react";
import { Button, Card } from "@/components/ui";
import { Icon } from "@/components/icons";

export function ConnectBanner({ children, onConnect }: { children: ReactNode; onConnect: () => void }) {
  return (
    <Card className="flex-row flex-wrap items-center gap-3 py-3">
      <span className="flex size-9 shrink-0 items-center justify-center rounded-[10px] bg-[var(--d-accent-soft)] text-[var(--d-accent-text)]">
        <Icon name="wallet" size={18} />
      </span>
      <p className="min-w-0 flex-1 basis-[16rem] text-[13.5px] leading-snug text-fg-muted">{children}</p>
      <Button size="sm" variant="primary" onClick={onConnect}>
        Connect wallet
      </Button>
    </Card>
  );
}
