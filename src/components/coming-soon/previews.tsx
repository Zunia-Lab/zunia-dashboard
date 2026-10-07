"use client";

/**
 * Sketches for the coming-soon preview tiles: the shapes of the screens
 * being built, drawn with the kit's own pieces but with no words or numbers
 * in them (bars stand in for text), then blurred by the tile. They show the
 * direction, never a feature that pretends to work.
 */

import { Icon, type IconName } from "@/components/icons";
import { ProgressBar } from "@/components/ui";
import { ZuniaMark } from "@/components/landing/ZuniaMark";
import { cn } from "@/lib/cn";

/** A text-shaped bar. */
function Line({ width, className }: { width: number | string; className?: string }) {
  return <span className={cn("block h-2 rounded-full bg-[var(--d-glass-2)]", className)} style={{ width }} />;
}

function Glyph({ name, className }: { name: IconName; className?: string }) {
  return (
    <span className={cn("flex size-8 shrink-0 items-center justify-center rounded-[10px] border border-[var(--d-hairline)] bg-[var(--d-glass)] text-fg-muted", className)}>
      <Icon name={name} size={16} />
    </span>
  );
}

/* ------------------------------------------------------------------ missions */

export function QuestsSketch() {
  const quests: Array<{ icon: IconName; progress: number }> = [
    { icon: "staking", progress: 100 },
    { icon: "governance", progress: 60 },
    { icon: "bridge", progress: 20 },
  ];
  return (
    <div className="flex flex-col gap-3">
      {quests.map((quest) => (
        <div key={quest.icon} className="flex items-center gap-3">
          <Glyph name={quest.icon} />
          <div className="flex min-w-0 flex-1 flex-col gap-2">
            <Line width="58%" />
            <ProgressBar value={quest.progress} tone={quest.progress === 100 ? "success" : "accent"} />
          </div>
          <span className="h-5 w-10 shrink-0 rounded-full bg-[var(--d-accent-soft)]" />
        </div>
      ))}
    </div>
  );
}

export function LevelsSketch() {
  const circumference = 2 * Math.PI * 30;
  return (
    <div className="flex items-center gap-5">
      <svg width="76" height="76" viewBox="0 0 76 76" className="shrink-0" aria-hidden>
        <defs>
          <linearGradient id="cs-level" x1="0" y1="0" x2="1" y2="1">
            <stop offset="0" stopColor="#FF1B0C" />
            <stop offset="1" stopColor="#FFC414" />
          </linearGradient>
        </defs>
        <circle cx="38" cy="38" r="30" fill="none" stroke="var(--d-glass-2)" strokeWidth="7" />
        <circle
          cx="38"
          cy="38"
          r="30"
          fill="none"
          stroke="url(#cs-level)"
          strokeWidth="7"
          strokeLinecap="round"
          strokeDasharray={`${circumference * 0.64} ${circumference}`}
          transform="rotate(-90 38 38)"
        />
      </svg>
      <div className="flex min-w-0 flex-1 flex-col gap-3">
        <Line width="46%" className="h-3" />
        <Line width="78%" />
        <div className="flex gap-2">
          {["sparkle", "star", "shield"].map((name) => (
            <Glyph key={name} name={name as IconName} className="size-7 rounded-full" />
          ))}
        </div>
      </div>
    </div>
  );
}

export function SeasonsSketch() {
  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center gap-3">
        <Glyph name="sparkle" className="text-[var(--d-accent-text)]" />
        <div className="flex flex-1 flex-col gap-2">
          <Line width="52%" className="h-3" />
          <Line width="34%" />
        </div>
      </div>
      <div className="relative flex h-2 gap-1">
        {Array.from({ length: 8 }, (_, index) => (
          <span key={index} className={cn("h-full flex-1 rounded-full", index < 3 ? "bg-[image:var(--z-accent-gradient)]" : "bg-[var(--d-glass-2)]")} />
        ))}
      </div>
      <div className="flex justify-between">
        <Line width={36} />
        <Line width={36} />
        <Line width={36} />
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ apps */

export function DirectorySketch() {
  return (
    <div className="grid grid-cols-3 gap-3">
      {Array.from({ length: 6 }, (_, index) => (
        <div key={index} className="flex flex-col items-center gap-2">
          <span className={cn("size-10 rounded-[12px] border border-[var(--d-hairline)]", index === 1 ? "bg-[var(--d-accent-soft)]" : "bg-[var(--d-glass-2)]")} />
          <Line width="70%" />
        </div>
      ))}
    </div>
  );
}

export function SafetySketch() {
  return (
    <div className="flex flex-col gap-3">
      {[72, 58, 66].map((width, index) => (
        <div key={index} className="flex items-center gap-3">
          <span className="flex size-6 shrink-0 items-center justify-center rounded-full bg-[var(--z-success-fill)] text-[var(--z-success)]">
            <Icon name="check" size={13} />
          </span>
          <Line width={`${width}%`} />
        </div>
      ))}
    </div>
  );
}

export function OpenWithSketch() {
  return (
    <div className="flex flex-col items-center gap-4">
      <div className="flex items-center gap-3">
        <span className="size-11 rounded-[13px] border border-[var(--d-hairline)] bg-[var(--d-glass-2)]" />
        <span className="h-px w-10 bg-[repeating-linear-gradient(90deg,var(--d-hairline-strong)_0_5px,transparent_5px_9px)]" />
        <span className="flex size-11 items-center justify-center rounded-[13px] border border-[var(--d-hairline-strong)] bg-[var(--d-card)]">
          <ZuniaMark id="cs-open-mark" size={18} />
        </span>
      </div>
      <span className="h-8 w-32 rounded-[10px] bg-[image:var(--z-button-gradient)] opacity-80" />
    </div>
  );
}
