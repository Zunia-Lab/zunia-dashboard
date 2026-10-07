/**
 * /governance/<chainId>/<id> — one proposal (public, indexable on mainnets).
 *
 * The server reads the proposal once (React `cache` shares it between the
 * metadata and the page) so the title, description and tally are in the
 * first HTML for readers and crawlers; the client body then keeps it live
 * and adds the connected wallet's vote. A cold read that takes longer than
 * the render budget is not waited for: the page renders, and the browser
 * finishes the read (which the server read has meanwhile warmed).
 *
 * 404 for a chain the catalog does not know, a malformed id, or a proposal
 * the chain does not have. An unreachable node is not a 404. The status is a
 * real 404: this route sits outside the wallet pages' loading boundary, so
 * nothing has streamed when `notFound()` runs. A malformed URL is refused
 * before any read; a proposal the chain does not have is only known after
 * the read, and Next answers that one with its error document
 * (the 404 status and head from the server, the not-found page drawn in the
 * browser).
 */

import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { descriptionWithoutTitle } from "@/components/governance/model";
import { ProposalPage } from "@/components/governance/ProposalPage";
import { markdownExcerpt } from "@/lib/markdown";
import { findServerChain } from "@/lib/server/chains";
import { clipDescription, governanceMetadata } from "../../seo";
import { loadProposal as load } from "./load";

type Params = Promise<{ chainId: string; id: string }>;

async function resolve(params: Params): Promise<{ chainId: string; id: string }> {
  const raw = await params;
  try {
    return { chainId: decodeURIComponent(raw.chainId), id: decodeURIComponent(raw.id).trim() };
  } catch {
    notFound();
  }
}

export async function generateMetadata({ params }: { params: Params }): Promise<Metadata> {
  const { chainId, id } = await resolve(params);
  const loaded = await load(chainId, id);
  if (loaded.kind === "not-found") notFound();
  const chain = findServerChain(chainId);
  const name = chain?.chainName ?? chainId;
  const path = `/governance/${encodeURIComponent(chainId)}/${id}`;
  const index = chain?.network === "mainnet";
  if (loaded.kind === "unavailable") {
    return governanceMetadata({
      title: `${name} proposal #${id}`,
      description: `Governance proposal #${id} on ${name}: live tally against quorum and threshold, deadlines, and how to vote.`,
      path,
      index,
    });
  }
  const proposal = loaded.body.proposal;
  // The author's opening sentences read better in a search result than the
  // server's excerpt, which runs headings into the prose.
  const opening = markdownExcerpt(descriptionWithoutTitle(proposal.description, proposal.title), 240);
  return governanceMetadata({
    title: `${proposal.title} · ${name} #${id}`,
    description: clipDescription(opening || proposal.summary || `Governance proposal #${id} on ${name}.`),
    path,
    index,
  });
}

export default async function Page({ params }: { params: Params }) {
  const { chainId, id } = await resolve(params);
  const loaded = await load(chainId, id);
  if (loaded.kind === "not-found") notFound();
  return <ProposalPage chainId={chainId} id={id} initial={loaded.kind === "ok" ? loaded.body : null} />;
}
