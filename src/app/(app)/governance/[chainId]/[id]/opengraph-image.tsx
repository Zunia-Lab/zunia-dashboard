/** Share image of a proposal (Open Graph). See ./og-card.tsx. */

import { OG_ALT, OG_SIZE, proposalShareImage } from "./og-card";

export const alt = OG_ALT;
export const size = OG_SIZE;
export const contentType = "image/png";
/** The tally moves while voting is open; social platforms cache on their side anyway. */
export const revalidate = 600;

export default function OpenGraphImage({ params }: { params: Promise<{ chainId: string; id: string }> }) {
  return proposalShareImage(params);
}
