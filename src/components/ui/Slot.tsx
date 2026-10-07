"use client";

/**
 * `asChild` support: render the single child element instead of our own,
 * merging our props into it.
 *
 * A dozen lines instead of `@radix-ui/react-slot`: that package is a
 * dependency of @zunialab/ui, not of the dashboard, and pnpm does not let us
 * import a transitive dependency. Same merge rules as Radix: the child's
 * props win, event handlers run child-first then ours, class names and
 * styles are combined, refs are composed.
 */

import { Children, cloneElement, isValidElement, type CSSProperties, type ReactNode, type Ref } from "react";
import { cn } from "@/lib/cn";
import { composeRefs } from "./hooks";

type AnyProps = Record<string, unknown>;
type Handler = (...args: unknown[]) => unknown;

export interface SlotProps extends AnyProps {
  children?: ReactNode;
  ref?: Ref<HTMLElement>;
}

export function Slot({ children, ref, ...slotProps }: SlotProps) {
  const child = Children.only(children);
  if (!isValidElement<AnyProps>(child)) return null;
  const childProps = child.props;
  const merged: AnyProps = { ...slotProps, ...childProps };

  for (const key of Object.keys(slotProps)) {
    const ours = slotProps[key];
    const theirs = childProps[key];
    if (/^on[A-Z]/.test(key) && typeof ours === "function" && typeof theirs === "function") {
      merged[key] = (...args: unknown[]) => {
        (theirs as Handler)(...args);
        (ours as Handler)(...args);
      };
    } else if (key === "className") {
      merged.className = cn(ours as string | undefined, theirs as string | undefined);
    } else if (key === "style") {
      merged.style = { ...(ours as CSSProperties | undefined), ...(theirs as CSSProperties | undefined) };
    }
  }

  merged.ref = composeRefs(ref, childProps.ref as Ref<HTMLElement> | undefined);
  return cloneElement(child, merged);
}
