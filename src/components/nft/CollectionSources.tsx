"use client";

/**
 * Where this list came from, and how to widen it.
 *
 * CosmWasm has no chain-level "tokens by owner" index. `tokens` is a query on
 * one contract, so a wallet can only ask about contracts whose address it
 * already has, and a list of NFTs can therefore never be promised to be
 * complete unless a real index answered. The engine says exactly that in
 * `NFT_DISCOVERY_LIMITATION` and this panel is where the user reads it.
 *
 * All three paths are shown with their real state, including the ones that are
 * off — "no index is configured" is information the user needs to interpret an
 * empty grid, and hiding it is how "you own no NFTs" gets rendered over a query
 * that never ran.
 */

import { useState } from "react";
import {
  Button,
  Callout,
  Input,
  Pill,
  SectionLabel,
  truncateAddress,
} from "@zunialab/ui";
import { checkAddress, type ChainInfoLike } from "@zunialab/interchain";
import type { ChainEntry } from "@/lib/chains";
import type { NftCollectionsBody, NftConfigWire } from "@/lib/nft/wire";

export interface CollectionSourcesProps {
  readonly chain: ChainEntry;
  readonly config: NftConfigWire;
  /** Null until discovery has answered; the panel still explains what is configured. */
  readonly result: NftCollectionsBody | null;
  readonly userContracts: readonly string[];
  readonly onAddContract: (address: string) => void;
  readonly onRemoveContract: (address: string) => void;
}

export function CollectionSources({
  chain,
  config,
  result,
  userContracts,
  onAddContract,
  onRemoveContract,
}: CollectionSourcesProps) {
  const [draft, setDraft] = useState("");

  const trimmed = draft.trim();
  const check = trimmed ? checkAddress(trimmed, chain as ChainInfoLike) : null;
  const duplicate = trimmed.length > 0 && userContracts.includes(trimmed);
  const addProblem = !trimmed
    ? null
    : check && !check.ok
      ? check.problem === "wrong-prefix"
        ? `That is a "${check.prefix}" address; ${chain.chainName} uses "${check.expectedPrefix}".`
        : check.problem === "bad-checksum"
          ? "That address fails its own checksum, so a character is wrong."
          : "That is not a bech32 contract address."
      : duplicate
        ? "That collection is already in the list."
        : null;

  const rows = [
    {
      key: "known",
      label: "Collections Zunia ships",
      state:
        config.discovery.knownContractCount > 0
          ? `${config.discovery.knownContractCount} for ${chain.chainName}`
          : "none for this chain",
      detail:
        config.discovery.knownContractCount > 0
          ? null
          : `No curated list is configured for ${chain.chainName} (${config.configKeys.knownContracts}). Nothing is queried from this path.`,
    },
    {
      key: "indexer",
      label: "NFT index",
      state: config.discovery.indexerConfigured
        ? (config.discovery.indexerName ?? "configured")
        : "not configured",
      detail: config.discovery.indexerConfigured
        ? "An index can answer which contracts hold your tokens, which is the only way a list here can be complete."
        : `No NFT index is configured for this deployment (${config.configKeys.indexer}). Without one, this list can only ever cover contracts whose addresses Zunia already has.`,
    },
    {
      key: "user",
      label: "Collections you added",
      state:
        userContracts.length > 0
          ? `${userContracts.length}`
          : "none yet",
      detail: null,
    },
  ] as const;

  return (
    <div className="flex min-w-0 flex-col gap-3">
      <SectionLabel>Where this list comes from</SectionLabel>

      <dl className="m-0 flex flex-col gap-2">
        {rows.map((row) => {
          const used = result?.sources.includes(
            row.key as "known" | "indexer" | "user",
          );
          return (
            <div key={row.key} className="min-w-0">
              <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
                <dt className="text-[length:var(--z-type-row)] text-fg">
                  {row.label}
                </dt>
                <dd className="m-0 flex shrink-0 items-center gap-2">
                  {used ? <Pill tone="success">found tokens</Pill> : null}
                  <span className="font-mono text-[length:var(--z-type-micro)] text-fg-dim">
                    {row.state}
                  </span>
                </dd>
              </div>
              {row.detail ? (
                <p className="m-0 mt-1 text-[length:var(--z-type-micro)] leading-relaxed text-fg-muted">
                  {row.detail}
                </p>
              ) : null}
            </div>
          );
        })}
      </dl>

      {userContracts.length > 0 ? (
        <ul className="m-0 flex flex-wrap gap-2 p-0">
          {userContracts.map((address) => (
            <li key={address} className="flex min-w-0 items-center gap-1 rounded-full bg-[var(--z-glass)] py-1 pl-3 pr-1">
              <span
                className="min-w-0 truncate font-mono text-[length:var(--z-type-micro)] text-fg-muted"
                title={address}
              >
                {truncateAddress(address, 8, 6)}
              </span>
              <Button
                variant="ghost"
                size="sm"
                aria-label={`Stop checking collection ${address}`}
                onClick={() => onRemoveContract(address)}
              >
                remove
              </Button>
            </li>
          ))}
        </ul>
      ) : null}

      <form
        className="flex flex-col gap-2"
        onSubmit={(event) => {
          event.preventDefault();
          if (!trimmed || addProblem) return;
          onAddContract(trimmed);
          setDraft("");
        }}
      >
        <Input
          label="Add a collection by contract address"
          placeholder={`${chain.bech32Prefix}1…`}
          value={draft}
          spellCheck={false}
          autoComplete="off"
          state={addProblem ? "error" : "default"}
          hint={
            addProblem ??
            `Zunia asks this contract whether your address holds anything in it. Addresses are kept in this browser only.`
          }
          onChange={(event) => setDraft(event.target.value)}
        />
        <Button
          type="submit"
          variant="secondary"
          size="sm"
          className="self-start"
          disabled={!trimmed || addProblem !== null}
        >
          Check this collection
        </Button>
      </form>

      {result && userContracts.length > result.plan.userContracts.length ? (
        <Callout tone="warning" title="Not every collection you added was checked">
          {result.plan.userContracts.length} of your {userContracts.length} added
          collections were queried in this pass. The rest were not, so they are
          not part of the list below either way — remove one to make room.
        </Callout>
      ) : null}

      {result ? <Completeness result={result} /> : null}
    </div>
  );
}

/**
 * What the list can and cannot promise.
 *
 * `complete` is only true when an index answered without errors. Everything
 * else — including a clean run over a shipped contract list — is partial, and
 * says so in the engine's own words rather than in a reassuring paraphrase.
 */
function Completeness({ result }: { readonly result: NftCollectionsBody }) {
  return (
    <div className="flex flex-col gap-2">
      {result.complete ? (
        <Callout tone="success" title="This list is complete">
          An index answered for this address, so every collection it holds
          something in is listed.
        </Callout>
      ) : (
        <Callout tone="neutral" title="This list is not complete">
          {result.limitation ??
            "Only contracts Zunia already knows about were checked."}
        </Callout>
      )}

      {result.issues.length > 0 ? (
        <Callout
          tone="warning"
          title={`${result.issues.length} source${result.issues.length === 1 ? "" : "s"} could not be read`}
        >
          <ul className="m-0 flex list-none flex-col gap-1 p-0">
            {result.issues.map((issue) => (
              <li key={`${issue.contractAddress ?? "source"}-${issue.message}`}>
                <span className="font-mono break-all">
                  {issue.contractAddress
                    ? truncateAddress(issue.contractAddress, 8, 6)
                    : "index"}
                </span>{" "}
                — {issue.message}
              </li>
            ))}
          </ul>
        </Callout>
      ) : null}
    </div>
  );
}
