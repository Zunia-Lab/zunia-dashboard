"use client";

import { usePathname } from "next/navigation";
import { PageSkeleton, skeletonShapeFor } from "./PageSkeleton";
import { useMarkRouteLoading } from "./ShellContext";
import styles from "./shell.module.css";

/**
 * The route loading state inside the app frame (prefetched, so navigation is
 * instant): the page's general shape rather than a spinner, while the frame
 * around it stays interactive. A client component to read the path the
 * skeleton is for (during a navigation it is already the destination's), and
 * to tell the top bar a page is on its way, so a detail page's bar holds its
 * place instead of naming the section first.
 */
export function RouteLoading() {
  const pathname = usePathname();
  useMarkRouteLoading();
  return (
    <div role="status" className={styles.enter}>
      <span className="sr-only">Loading…</span>
      <PageSkeleton shape={skeletonShapeFor(pathname)} />
    </div>
  );
}
