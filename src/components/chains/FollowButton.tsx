"use client";

/**
 * The follow toggle: a star in tables and lists, a labelled button on a
 * chain's own page. Both are toggle buttons (aria-pressed) whose name says
 * what pressing does, so a screen reader hears "Follow Osmosis, not pressed".
 * The caller owns the rules (cap, last chain, undo): see `useFollow`.
 */

import { Icon } from "@/components/icons";
import { Button, IconButton } from "@/components/ui";
import { cn } from "@/lib/cn";

interface FollowButtonProps {
  chainName: string;
  followed: boolean;
  onToggle: () => void;
  /** `star` (tables, cards) or `button` (a chain's hero). */
  variant?: "star" | "button";
  className?: string;
}

export function FollowButton({ chainName, followed, onToggle, variant = "star", className }: FollowButtonProps) {
  if (variant === "button") {
    return (
      <Button
        variant={followed ? "secondary" : "primary"}
        size="sm"
        aria-pressed={followed}
        onClick={onToggle}
        iconLeft={<Icon name="star" size={14} fill={followed ? "currentColor" : "none"} className={cn("shrink-0", followed && "text-[var(--z-warning)]")} />}
        className={className}
      >
        {followed ? "Following" : "Follow"}
      </Button>
    );
  }

  return (
    <IconButton
      label={followed ? `Unfollow ${chainName}` : `Follow ${chainName}`}
      tooltip={followed ? "Following · click to unfollow" : "Follow this chain"}
      // aria-pressed without the kit's pressed fill: a filled gold star is
      // state enough, and a tinted square on every row would be noise.
      aria-pressed={followed}
      size="sm"
      onClick={onToggle}
      data-row-action=""
      className={cn(followed ? "text-[var(--z-warning)] hover:text-[var(--z-warning)]" : "text-fg-dim", className)}
    >
      <Icon name="star" size={16} fill={followed ? "currentColor" : "none"} />
    </IconButton>
  );
}
