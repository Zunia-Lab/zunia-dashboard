/**
 * A page-shaped placeholder, shown by the route's loading boundary while a
 * route loads and by `<Page>` while a stored wallet session restores. Two
 * shapes, so the placeholder is laid out like what replaces it (spec §3: a
 * first-load skeleton shaped like the final content):
 *
 * - `kpi` (most pages): a KPI strip, then an analysis card beside a list card;
 * - `hero` (Overview): the net-worth hero beside the allocation card, then
 *   the six key figures, so a returning visitor's overview does not jump when
 *   the wallet restores.
 *
 * Plain markup on the kit's `.d-card` / `.d-skeleton` classes, so it renders
 * from a server component as well as a client one. Decorative: the caller
 * provides the status text.
 */

export type SkeletonShape = "kpi" | "hero";

/**
 * Which shape a route opens with. By path because neither caller knows the
 * page: the loading boundary renders before the page's code arrives, and the
 * restoring state renders in place of the page.
 */
export function skeletonShapeFor(pathname: string): SkeletonShape {
  return pathname === "/overview" ? "hero" : "kpi";
}

function Bar({ width, height = 10, className = "" }: { width: string | number; height?: number; className?: string }) {
  return <span aria-hidden className={`d-skeleton ${className}`} style={{ width, height }} />;
}

/** A key-figure tile: label, value, one line under it (the kit's StatTile, 108 px). */
function Tile() {
  return (
    <div className="d-card flex flex-col gap-3 p-[var(--d-pad)]">
      <Bar width="46%" height={10} />
      <Bar width="58%" height={28} />
      <Bar width="64%" height={10} />
    </div>
  );
}

function ListRows({ rows }: { rows: number }) {
  return (
    <>
      {Array.from({ length: rows }, (_, row) => (
        <div key={row} className="flex items-center gap-3">
          <span aria-hidden className="d-skeleton shrink-0 rounded-full" style={{ width: 28, height: 28 }} />
          <div className="flex flex-1 flex-col gap-1.5">
            <Bar width="70%" />
            <Bar width="40%" height={8} />
          </div>
          <Bar width={56} />
        </div>
      ))}
    </>
  );
}

/** Overview's opening: the hero and allocation row, then the key figures (same breakpoints as the page). */
function HeroSkeleton() {
  return (
    <div aria-hidden className="@container flex flex-col gap-[var(--d-gap)]">
      <div className="grid grid-cols-1 gap-[var(--d-gap)] @min-[880px]:grid-cols-12">
        {/* Net worth: label and scope chip with the range control, the
            figure, its moves, the chart and its caption, then the
            liquid / staked / rewards / unbonding split. */}
        <div className="d-card flex flex-col gap-4 p-[var(--d-pad)] @min-[880px]:col-span-7 @min-[1000px]:col-span-8">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="flex items-center gap-2">
              <Bar width={72} height={12} />
              <Bar width={110} height={22} className="rounded-full" />
            </div>
            <Bar width={216} height={30} className="rounded-[var(--d-radius-control)]" />
          </div>
          <Bar width="42%" height={44} />
          <Bar width="56%" height={14} />
          <span aria-hidden className="d-skeleton h-[240px] w-full rounded-[var(--d-radius-inner)] @min-[640px]:h-[290px]" />
          <div className="flex flex-col gap-2">
            <Bar width="62%" height={10} />
            <Bar width="46%" height={10} />
          </div>
          <Bar width="100%" height={6} className="mt-1 rounded-full" />
          <div className="grid grid-cols-2 gap-x-6 gap-y-4">
            {[0, 1, 2, 3].map((cell) => (
              <div key={cell} className="flex flex-col gap-2">
                <Bar width="38%" height={9} />
                <Bar width="52%" height={16} />
              </div>
            ))}
          </div>
        </div>
        {/* Allocation: title, view switch, donut, legend. */}
        <div className="d-card flex flex-col gap-4 p-[var(--d-pad)] @min-[880px]:col-span-5 @min-[1000px]:col-span-4">
          <div className="flex flex-col gap-2">
            <Bar width={96} height={13} />
            <Bar width={140} height={9} />
          </div>
          <Bar width="100%" height={32} className="rounded-[var(--d-radius-control)]" />
          <span aria-hidden className="d-skeleton mx-auto my-5 shrink-0 rounded-full" style={{ width: 164, height: 164 }} />
          {[0, 1, 2, 3].map((row) => (
            <div key={row} className="flex items-center gap-3">
              <Bar width={10} height={10} className="rounded-[3px]" />
              <Bar width="38%" />
              <span className="flex-1" />
              <Bar width={48} />
              <Bar width={34} />
            </div>
          ))}
        </div>
      </div>
      <div className="grid grid-cols-2 gap-[var(--d-gap)] @[640px]:grid-cols-3 @[1460px]:grid-cols-6">
        {[0, 1, 2, 3, 4, 5].map((tile) => (
          <Tile key={tile} />
        ))}
      </div>
    </div>
  );
}

export function PageSkeleton({ shape = "kpi" }: { shape?: SkeletonShape }) {
  if (shape === "hero") return <HeroSkeleton />;
  return (
    <div aria-hidden className="flex flex-col gap-[var(--d-gap)]">
      <div className="grid grid-cols-2 gap-[var(--d-gap)] lg:grid-cols-4">
        {[0, 1, 2, 3].map((tile) => (
          <Tile key={tile} />
        ))}
      </div>
      <div className="grid grid-cols-1 gap-[var(--d-gap)] xl:grid-cols-12">
        <div className="d-card flex flex-col gap-4 p-[var(--d-pad)] xl:col-span-8">
          <div className="flex items-center justify-between gap-3">
            <Bar width={140} height={12} />
            <Bar width={168} height={26} className="rounded-[var(--d-radius-control)]" />
          </div>
          <Bar width="38%" height={30} />
          <Bar width="100%" height={200} className="rounded-[var(--d-radius-inner)]" />
        </div>
        <div className="d-card flex flex-col gap-4 p-[var(--d-pad)] xl:col-span-4">
          <Bar width={120} height={12} />
          <ListRows rows={5} />
        </div>
      </div>
    </div>
  );
}
