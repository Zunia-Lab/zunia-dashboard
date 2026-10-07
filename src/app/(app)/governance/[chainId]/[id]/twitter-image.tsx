/**
 * Share image of a proposal on X. The root layout ships its own file-based
 * twitter-image, which would otherwise win over this route's Open Graph one.
 */

import { OG_ALT, OG_SIZE, proposalShareImage } from "./og-card";

export const alt = OG_ALT;
export const size = OG_SIZE;
export const contentType = "image/png";
export const revalidate = 600;

export default function TwitterImage({ params }: { params: Promise<{ chainId: string; id: string }> }) {
  return proposalShareImage(params);
}
