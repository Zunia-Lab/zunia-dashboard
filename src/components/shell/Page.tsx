"use client";

/**
 * The root of every page inside the app frame.
 *
 * - Renders the page's one h1 (visually hidden: the top bar shows the same
 *   title) and publishes the title / breadcrumbs to the top bar (see
 *   ShellContext). The heading lives here, not in the bar, because the bar
 *   learns the title only after hydration: in the server HTML the bar still
 *   holds a placeholder, while this heading already reads "CrowdControl" or
 *   "Proposal #1049", for crawlers and for a screen reader landing before
 *   the scripts have run.
 * - Gates wallet pages: with `access="wallet"` and no linked wallet it renders
 *   the connect panel instead of the page, so pages never run with a null
 *   account. While a stored session restores it shows the page's skeleton
 *   rather than flashing the connect panel. Public pages render either way
 *   and decide per section what a wallet adds.
 * - Owns the page's vertical rhythm and its entrance (a 6 px rise and fade
 *   when a client-side navigation brings the page in, none under reduced
 *   motion), so page bodies only lay out sections.
 */

import { useEffect, useState, type ReactNode } from "react";
import { usePathname } from "next/navigation";
import { ConnectPanel } from "@/components/connect/ConnectPanel";
import { usePageMeta, type Crumb } from "@/components/shell/ShellContext";
import { cn } from "@/lib/cn";
import { navItemFor } from "@/lib/nav";
import { useWallet } from "@/providers/WalletProvider";
import { PageSkeleton, skeletonShapeFor } from "./PageSkeleton";
import styles from "./shell.module.css";

export interface PageProps {
  title: string;
  /** One line about the page, shown beside the scope control on wide screens. */
  subtitle?: string;
  /** Detail pages: shown under the title instead of the scope control. */
  breadcrumbs?: Crumb[];
  /** Defaults to the nav entry's access for this path, else "wallet". */
  access?: "public" | "wallet";
  /** Right-aligned controls in the page's own toolbar row (filters, actions). */
  actions?: ReactNode;
  /** Text for the connect panel on wallet pages. */
  connectTitle?: string;
  connectDescription?: string;
  className?: string;
  children: ReactNode;
}

/**
 * Set once the page the document loaded with has mounted. That page is
 * painted from the server HTML: starting it at opacity 0 would hide it for
 * the length of the animation, and Chrome never counts text first painted at
 * opacity 0 as the largest contentful paint (on a busy phone the fade only
 * gets its frames after hydration, which pushed LCP back by seconds). Only
 * pages mounted by a later client-side navigation rise in.
 *
 * Set from the page's own effect, not the frame's: the frame's effects run
 * before a page inside the route's loading boundary hydrates, and a flag
 * flipped that early would give the hydrating page a class the server HTML
 * does not have.
 */
let firstPageMounted = false;

export function Page({
  title,
  subtitle,
  breadcrumbs,
  access,
  actions,
  connectTitle,
  connectDescription,
  className,
  children,
}: PageProps) {
  usePageMeta({ title, subtitle, breadcrumbs });
  const pathname = usePathname();
  const { account, restoring } = useWallet();
  const needsWallet = (access ?? navItemFor(pathname)?.access ?? "wallet") === "wallet";
  // Read once, at mount: false on the server and while the first page
  // hydrates (so the markup matches), true for every page after it.
  const [entering] = useState(() => firstPageMounted);
  useEffect(() => {
    firstPageMounted = true;
  }, []);
  const enter = entering ? styles.enter : undefined;
  // Outside any role="status" region, so it is announced as a heading and
  // never as a status update.
  const heading = <h1 className="sr-only">{title}</h1>;

  if (needsWallet && !account) {
    if (restoring) {
      return (
        <>
          {heading}
          <div role="status" className={enter}>
            <span className="sr-only">Restoring your wallet…</span>
            <PageSkeleton shape={skeletonShapeFor(pathname)} />
          </div>
        </>
      );
    }
    return (
      <>
        {heading}
        <div className={enter}>
          <ConnectPanel title={connectTitle} description={connectDescription} />
        </div>
      </>
    );
  }

  return (
    <>
      {heading}
      <div className={cn(enter, "flex flex-col gap-4 xl:gap-5", className)}>
        {actions ? <div className="flex flex-wrap items-center justify-end gap-2">{actions}</div> : null}
        {children}
      </div>
    </>
  );
}
