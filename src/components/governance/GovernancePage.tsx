"use client";

/**
 * /governance — proposals across the networks in scope.
 *
 * Public: anyone sees what is up for a vote, the live tallies against each
 * chain's rules, what closes next and how recent proposals ended. A connected
 * wallet adds the personal layer: your voting power, your vote or the one
 * your validators cast for you, what still waits for you, and voting in
 * place (a side sheet).
 *
 * `?chain=<id>` (a chain page's "Proposals" link) narrows the whole page to
 * that network, followed or not, behind a chip that clears it. A pick in the
 * rail after the page opened wins over the link, as on /validators.
 *
 * Reads: one `status=all` list (every proposal in voting plus the 20 most
 * recent per chain) drives the strip, the tab counts, the voting and deposit
 * tabs and the recent outcomes; the Passed / Rejected tabs add a deeper read
 * of that status while they are open. Scope changes keep the previous answer
 * on screen, dimmed, until the new one lands. Ended votes' turnout estimates
 * pass through `withUsableTurnout` first, so no view shows a stale one.
 *
 * The route reads `?chain=` and the public list of the networks the first
 * render covers on the server (`link`, `initial`), so the first HTML lists
 * the proposals; `useProposals` shows that list while a remembered wallet is
 * restored, and the wallet's own read (`voter=`) replaces it.
 */

import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { Suspense, useEffect, useId, useLayoutEffect, useMemo, useState } from "react";
import { Icon } from "@/components/icons";
import { Page } from "@/components/shell/Page";
import {
  Button,
  Card,
  CardBody,
  CardHeader,
  ChainLogo,
  chainById,
  Chip,
  EmptyState,
  FilterBar,
  InlineError,
  PartialDataBadge,
  SearchInput,
  Sheet,
  SourceTag,
  Switch,
  TabPanel,
  Tabs,
  useIsPhone,
  useNow,
} from "@/components/ui";
import { cn } from "@/lib/cn";
import type { ProposalRow } from "@/lib/chain/types";
import { formatDuration } from "@/lib/format";
import { useProposals } from "@/lib/data/governance";
import type { ApiInitial } from "@/lib/useApi";
import { useChainScope } from "@/lib/useChainScope";
import { useWallet } from "@/providers/WalletProvider";
import { ClosingSoon, RecentOutcomes, RulesCard } from "./GovernanceAside";
import { filterRows, mergeRows, participation, pastOrNow, proposalHref, tabOf, type GovTab } from "./model";
import { votingEnded, withUsableTurnout } from "./rules";
import { ParticipationStrip } from "./ParticipationStrip";
import { ProposalCard, ProposalCardSkeleton } from "./ProposalCard";
import { ResultsTable } from "./ResultsTable";
import { VoteFlow } from "./VoteFlow";

const TABS: { value: GovTab; label: string }[] = [
  { value: "voting", label: "Voting now" },
  { value: "deposit", label: "Deposit" },
  { value: "passed", label: "Passed" },
  { value: "rejected", label: "Rejected" },
];

const rowKey = (row: Pick<ProposalRow, "chainId" | "id">) => `${row.chainId}:${row.id}`;
const chainName = (chainId: string) => chainById(chainId)?.chainName;

/**
 * The voting list's first cards, each with its own Vote button: a vote that
 * waits for you among them needs no card of its own above the list.
 */
const WAITING_SEEN_CARDS = 4;

/** A tab badge while its count loads: a digit-wide blank, so the tabs do not move when the number lands. */
const COUNT_PENDING = "\u2007";

/** A response's rows with every ended vote's turnout checked against when it was read. */
function usableRows(data: { proposals: ProposalRow[]; updatedAt: number } | null | undefined): ProposalRow[] {
  return (data?.proposals ?? []).map((row) => withUsableTurnout(row, data?.updatedAt ?? null));
}

/** Drops `?chain=` from the address bar; the router follows a native replace (useSearchParams updates). */
function clearChainLink() {
  const url = new URL(window.location.href);
  url.searchParams.delete("chain");
  window.history.replaceState(null, "", `${url.pathname}${url.search}${url.hash}`);
}

export function GovernancePage({ link, initial = null }: { link?: string | null; initial?: ApiInitial | null }) {
  // `?chain=` (a catalog chain, or null): as the route read it on the server
  // when it did, else undefined until the browser reads it (see ChainLink).
  const [linkChain, setLinkChain] = useState<string | null | undefined>(link);
  return (
    <Page title="Governance" access="public">
      <Suspense fallback={null}>
        <ChainLink onRead={setLinkChain} />
      </Suspense>
      <GovernanceView linkChain={linkChain} initial={initial} />
    </Page>
  );
}

/**
 * Reads `?chain=` (a catalog chain, or nothing: anything else is ignored)
 * and hands it up, now and whenever the query changes in place (the chip's
 * clear, a rail pick dropping the link). It renders nothing, alone in its
 * Suspense boundary: should the page ever be prerendered again, where there
 * is no query string, only this part would wait for the browser, while the
 * page itself stays in the HTML and hydrates with the shell (a boundary that
 * hydrated later could meet a wallet already restored, and mismatch the
 * server's HTML).
 */
function ChainLink({ onRead }: { onRead: (chainId: string | null) => void }) {
  const raw = useSearchParams().get("chain");
  const chainId = raw && chainById(raw) ? raw : null;
  // Before paint: a client navigation never shows a frame without the link.
  useLayoutEffect(() => onRead(chainId), [chainId, onRead]);
  return null;
}

function GovernanceView({ linkChain, initial }: { linkChain: string | null | undefined; initial: ApiInitial | null }) {
  const tabsId = useId();
  const now = useNow();
  const { account } = useWallet();
  const connected = account !== null;
  const { scopedChainIds, selectedChainId } = useChainScope();

  // Until the link is read, no list is: reading the scope first would paint
  // the wrong networks for a moment, then swap them out.
  const known = linkChain !== undefined;
  // A rail pick made after the page opened wins over the link. The scope as
  // first seen after hydration (for this link) is the baseline, not a pick:
  // the stored scope arrives with hydration and must not undo a deep link.
  const [baseline, setBaseline] = useState<{ link: string | null; scope: string | null } | null>(null);
  if (now !== null && known && (baseline === null || baseline.link !== linkChain)) setBaseline({ link: linkChain, scope: selectedChainId });
  const railPicked = Boolean(linkChain) && baseline !== null && baseline.link === linkChain && baseline.scope !== selectedChainId;
  const linked = railPicked ? null : (linkChain ?? null);
  useEffect(() => {
    if (railPicked) clearChainLink();
  }, [railPicked]);
  const chainIds = useMemo(() => (linked ? [linked] : scopedChainIds), [linked, scopedChainIds]);

  const [tab, setTab] = useState<GovTab>("voting");
  const [query, setQuery] = useState("");
  const [onlyVotable, setOnlyVotable] = useState(false);
  const [voteKey, setVoteKey] = useState<string | null>(null);
  const [voteBusy, setVoteBusy] = useState(false);

  const all = useProposals({ status: "all", chains: known ? chainIds : [], initial });
  const historyTab = tab === "passed" || tab === "rejected" ? tab : null;
  // Idle (no chains, no request) unless a results tab is open.
  const history = useProposals({ status: historyTab ?? "passed", chains: historyTab && known ? chainIds : [] });
  const listLoading = !known || all.loading;

  const allRows = useMemo(() => usableRows(all.data), [all.data]);
  const historyRows = useMemo(() => (historyTab ? usableRows(history.data) : null), [history.data, historyTab]);
  const rows = useMemo(() => mergeRows(allRows, historyRows), [allRows, historyRows]);
  const p = useMemo(() => participation(allRows, now), [allRows, now]);
  const counts = useMemo(() => {
    const out: Record<GovTab, number> = { voting: 0, deposit: 0, passed: 0, rejected: 0 };
    for (const row of allRows) {
      const key = tabOf(row.status);
      if (key) out[key] += 1;
    }
    return out;
  }, [allRows]);
  const shown = useMemo(
    () => filterRows(rows, { tab, query, onlyVotable: connected && onlyVotable, chainName }),
    [rows, tab, query, onlyVotable, connected],
  );
  const waiting = useMemo(
    () =>
      all.awaitingVote
        .filter((row) => !votingEnded(row, now))
        .sort((a, b) => Date.parse(a.votingEndTime ?? "") - Date.parse(b.votingEndTime ?? "")),
    [all.awaitingVote, now],
  );
  // The waiting card only when it adds something: a vote that waits for you
  // further down the voting list (in its own order, before any search) than
  // its first cards. Above them it would repeat them, Vote buttons and all.
  const waitingBuried = useMemo(() => {
    if (waiting.length === 0) return false;
    const seen = new Set(filterRows(rows, { tab: "voting" }).slice(0, WAITING_SEEN_CARDS).map(rowKey));
    return waiting.some((row) => !seen.has(rowKey(row)));
  }, [rows, waiting]);

  const voteTarget = voteKey ? (rows.find((row) => rowKey(row) === voteKey) ?? null) : null;
  const listState = historyTab ? history : all;
  const firstLoad = listLoading || (historyTab !== null && history.loading && shown.length === 0);
  const pending = all.stale || (historyTab !== null && history.stale);
  const errors = [...(all.data?.errors ?? []), ...(historyTab ? (history.data?.errors ?? []) : [])];
  const networks = chainIds.length;
  // The list read failed outright (the list shows the Retry), or answered
  // without some networks: the strip must not read either as "nothing open".
  const failed = all.status === "error";
  const unreadable = (all.data?.chains ?? []).filter((chain) => chain.status === "error").length;
  const tabCount = (value: GovTab): number | string | undefined => {
    // Results tabs hold the latest per network, not a total: no count.
    if (value !== "voting" && value !== "deposit") return undefined;
    if (all.data) return counts[value];
    return !known || all.status === "loading" ? COUNT_PENDING : failed ? "—" : undefined;
  };

  return (
    <>
      <ParticipationStrip
        p={p}
        connected={connected}
        // Skeleton tiles until the clock starts as well: the server renders
        // the list it read, but without a clock (there, and in the hydrating
        // render) "Ending < 48 h" would read 0 whatever the deadlines.
        loading={listLoading || now === null}
        now={now}
        scopeCount={networks}
        failed={failed}
        unreadable={unreadable}
      />

      <div className="grid grid-cols-1 gap-[var(--d-gap)] xl:grid-cols-12 xl:items-start">
        <section aria-labelledby={`${tabsId}-heading`} className="flex min-w-0 flex-col gap-3 xl:col-span-8 2xl:col-span-9">
          <h2 id={`${tabsId}-heading`} className="sr-only">
            Proposals
          </h2>
          <Tabs
            id={tabsId}
            ariaLabel="Proposal status"
            value={tab}
            onChange={setTab}
            items={TABS.map((item) => ({ value: item.value, label: item.label, count: tabCount(item.value) }))}
          />
          <FilterBar
            end={
              <>
                {/* With the source line, the switch shares one row on phones. */}
                {connected ? (
                  <Switch
                    checked={onlyVotable}
                    onCheckedChange={setOnlyVotable}
                    size="sm"
                    label={<span className="text-[13px] text-fg-muted">Only where I can vote</span>}
                    className="items-center"
                  />
                ) : null}
                <span className="flex items-center gap-2">
                  <PartialDataBadge errors={errors} />
                  {all.data ? <SourceTag source="Chain LCD" at={pastOrNow(listState.updatedAt ?? all.updatedAt, now)} /> : null}
                </span>
              </>
            }
          >
            <SearchInput
              value={query}
              onChange={setQuery}
              // One network shown: a little narrower beside its chip, so both share a line on wide screens.
              placeholder={linked ? "Search title, type, #id" : "Search title, type, #id, network"}
              aria-label="Search proposals"
              size="sm"
              className={cn("w-full", linked ? "sm:w-52" : "sm:w-64")}
            />
            {linked ? (
              <Chip
                size="md"
                leading={<ChainLogo chainId={linked} size={16} />}
                onRemove={clearChainLink}
                removeLabel={`Show every network, not only ${chainName(linked) ?? linked}`}
              >
                <span className="sr-only">Showing only </span>
                {chainName(linked) ?? linked}
              </Chip>
            ) : null}
          </FilterBar>

          {TABS.map((item) => (
            <TabPanel key={item.value} tabsId={tabsId} value={item.value} active={tab === item.value}>
              {/* With the cards it sits on, never ahead of them: both come
                  from the voter's answer, so nothing on screen moves for it. */}
              {item.value === "voting" && connected && waitingBuried ? (
                <WaitingCard rows={waiting} now={now} pending={pending} onVote={(row) => setVoteKey(rowKey(row))} className="mb-3" />
              ) : null}
              {shown.length > 0 ? <TabNote tab={item.value} /> : null}
              {firstLoad ? (
                <div className="grid grid-cols-1 gap-[var(--d-gap)] 2xl:grid-cols-2">
                  <ProposalCardSkeleton />
                  <ProposalCardSkeleton />
                  <ProposalCardSkeleton />
                </div>
              ) : listState.error && !listState.data && shown.length === 0 ? (
                <InlineError
                  title="Proposals could not be loaded"
                  message={listState.error.message}
                  onRetry={listState.refetch}
                  retrying={listState.refreshing}
                />
              ) : shown.length === 0 ? (
                <Card>
                  <EmptyList
                    tab={item.value}
                    query={query}
                    onlyVotable={connected && onlyVotable}
                    networks={networks}
                    onClearQuery={() => setQuery("")}
                    onShowAll={() => setOnlyVotable(false)}
                    onShowResults={() => setTab("passed")}
                  />
                </Card>
              ) : item.value === "passed" || item.value === "rejected" ? (
                <>
                  {/* The deeper history read failed, the recent ones from the
                      main list are still shown: say what is missing. */}
                  {history.error && !history.data ? (
                    <InlineError
                      className="mb-3"
                      title="Older results could not be loaded"
                      message={`Showing only the most recent proposals. ${history.error.message}`}
                      onRetry={history.refetch}
                      retrying={history.refreshing}
                    />
                  ) : null}
                  <ResultsTable rows={shown} tab={item.value} pending={pending} />
                </>
              ) : (
                <ul
                  className={cn(
                    "grid grid-cols-1 gap-[var(--d-gap)] transition-opacity duration-[160ms] 2xl:grid-cols-2",
                    pending && "opacity-60",
                  )}
                  aria-busy={pending || undefined}
                >
                  {shown.map((row) => (
                    <li key={rowKey(row)} className="flex min-w-0">
                      <ProposalCard proposal={row} connected={connected} onVote={(target) => setVoteKey(rowKey(target))} className="w-full" />
                    </li>
                  ))}
                </ul>
              )}
            </TabPanel>
          ))}
        </section>

        {/* A side column from 1280 px; under it the cards pair up from 768 px
            rather than stretching one per row across the page. */}
        <aside
          aria-label="Deadlines, outcomes and rules"
          className="grid min-w-0 grid-cols-1 items-start gap-[var(--d-gap)] md:grid-cols-2 md:[&>:only-child]:col-span-2 xl:col-span-4 xl:flex xl:flex-col xl:items-stretch 2xl:col-span-3"
        >
          <ClosingSoon rows={allRows} now={now} pending={pending} />
          <RecentOutcomes rows={allRows} chainIds={chainIds} loading={listLoading} pending={all.stale} />
          {networks > 0 ? <RulesCard chainIds={chainIds} selectedChainId={linked ?? selectedChainId} ready={known} /> : null}
        </aside>
      </div>

      <Sheet
        open={voteTarget !== null}
        onOpenChange={(open) => {
          if (!open && !voteBusy) setVoteKey(null);
        }}
        title={voteTarget ? `Vote on ${chainName(voteTarget.chainId) ?? voteTarget.chainId} #${voteTarget.id}` : "Vote"}
        description={voteTarget?.title}
        width={460}
      >
        {voteTarget ? (
          <div className="flex flex-col gap-4">
            <VoteFlow proposal={voteTarget} variant="sheet" onDone={() => setVoteKey(null)} onBusyChange={setVoteBusy} />
            <Button href={proposalHref(voteTarget.chainId, voteTarget.id)} variant="ghost" size="sm" iconRight="arrowRight" className="self-start">
              Read the full proposal
            </Button>
          </div>
        ) : null}
      </Sheet>
    </>
  );
}

/**
 * "Waiting for your vote": open proposals where you have power and no vote,
 * soonest deadline first, for a voting list long enough to bury some.
 */
function WaitingCard({
  rows,
  now,
  pending,
  onVote,
  className,
}: {
  rows: ProposalRow[];
  now: number | null;
  pending: boolean;
  onVote: (row: ProposalRow) => void;
  className?: string;
}) {
  const shown = rows.slice(0, 3);
  return (
    <Card className={cn("border-[var(--z-warning-line)]", className)} pending={pending}>
      <CardHeader
        title={rows.length === 1 ? "A vote is waiting for you" : `${rows.length} votes are waiting for you`}
        subtitle="Until you vote, your validators vote for your stake."
        icon="governance"
      />
      <CardBody flush>
        <ul className="divide-y divide-[var(--d-hairline)] border-t border-[var(--d-hairline)]">
          {shown.map((row) => {
            const end = row.votingEndTime ? Date.parse(row.votingEndTime) : null;
            const left = end !== null && now !== null ? end - now : null;
            return (
              <li key={rowKey(row)} className="flex min-w-0 flex-wrap items-center gap-x-3 gap-y-2 px-[var(--d-pad)] py-2.5">
                <ChainLogo chainId={row.chainId} size={20} />
                <Link href={proposalHref(row.chainId, row.id)} className="min-w-0 flex-[1_1_16rem] text-[13.5px] hover:underline hover:underline-offset-[3px]">
                  <span className="font-medium text-fg">
                    {chainName(row.chainId) ?? row.chainId} <span className="font-mono text-[12.5px] text-fg-dim">#{row.id}</span>
                  </span>
                  <span className="block truncate text-fg-muted">{row.title}</span>
                </Link>
                {left !== null && left > 0 ? (
                  <span className="inline-flex items-center gap-1 whitespace-nowrap text-[12.5px] tabular-nums text-fg-dim">
                    <Icon name="clock" size={13} />
                    {formatDuration(left / 1000)} left
                  </span>
                ) : null}
                <Button size="sm" variant="primary" iconLeft="governance" onClick={() => onVote(row)}>
                  Vote
                </Button>
              </li>
            );
          })}
        </ul>
        {rows.length > shown.length ? (
          <p className="border-t border-[var(--d-hairline)] px-[var(--d-pad)] py-2.5 text-[12.5px] text-fg-dim">
            and {rows.length - shown.length} more in the list below
          </p>
        ) : null}
      </CardBody>
    </Card>
  );
}

/** Honest context per tab: what the list covers, what to watch out for. */
function TabNote({ tab }: { tab: GovTab }) {
  if (tab === "passed" || tab === "rejected") {
    return (
      <p className="mb-3 flex items-start gap-1.5 text-[12.5px] leading-snug text-fg-dim">
        <Icon name="info" size={14} className="mt-px shrink-0" />
        The latest {tab === "rejected" ? "rejected and failed" : "passed"} proposals, up to 20 per network. Turnout of an ended vote is
        estimated against today&apos;s staked total (≈), for the last three months only.
      </p>
    );
  }
  if (tab === "deposit") {
    return (
      <p className="mb-3 flex items-start gap-1.5 text-[12.5px] leading-snug text-fg-dim">
        <Icon name="shield" size={14} className="mt-px shrink-0" />
        Proposals collecting their deposit are not vetted by anyone yet. Never connect your wallet to a site a proposal links to.
      </p>
    );
  }
  return null;
}

function EmptyList({
  tab,
  query,
  onlyVotable,
  networks,
  onClearQuery,
  onShowAll,
  onShowResults,
}: {
  tab: GovTab;
  query: string;
  onlyVotable: boolean;
  networks: number;
  onClearQuery: () => void;
  onShowAll: () => void;
  onShowResults: () => void;
}) {
  // One compact row from 640 px; stacked on a phone, where a row would
  // squeeze the sentence into a column beside the button.
  const inline = !useIsPhone();
  if (networks === 0) {
    return (
      <EmptyState
        inline={inline}
        icon="networks"
        title="No networks followed"
        body="Follow a network to see its proposals."
        action={
          <Button href="/networks" size="sm">
            Manage networks
          </Button>
        }
      />
    );
  }
  if (query.trim()) {
    return (
      <EmptyState
        inline={inline}
        icon="search"
        title={`Nothing matches “${query.trim()}”`}
        body="Search covers titles, summaries, types, networks and proposal numbers."
        action={
          <Button size="sm" onClick={onClearQuery}>
            Clear search
          </Button>
        }
      />
    );
  }
  if (onlyVotable) {
    return (
      <EmptyState
        inline={inline}
        icon="governance"
        title="Nothing here where you can vote"
        body="You have no voting power on the networks with proposals in this list."
        action={
          <Button size="sm" onClick={onShowAll}>
            Show all
          </Button>
        }
      />
    );
  }
  const scope = networks === 1 ? "this network" : `these ${networks} networks`;
  switch (tab) {
    case "voting":
      return (
        <EmptyState
          inline={inline}
          icon="governance"
          title="Nothing is up for a vote"
          body={`No proposal is in its voting period on ${scope} right now.`}
          action={
            <Button size="sm" onClick={onShowResults}>
              Recent results
            </Button>
          }
        />
      );
    case "deposit":
      return <EmptyState inline={inline} icon="hourglass" title="No proposal is collecting deposits" body={`Nothing is waiting to enter voting on ${scope}.`} />;
    case "passed":
      return <EmptyState inline={inline} icon="success" title="No passed proposals" body={`None among the latest proposals on ${scope}.`} />;
    default:
      return <EmptyState inline={inline} icon="inbox" title="No rejected proposals" body={`None among the latest proposals on ${scope}.`} />;
  }
}
