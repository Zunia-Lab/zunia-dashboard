"use client";

/**
 * Lazy boundary for the feature tiles' pictures. They sit below the fold
 * and are decoration, so their code (chart components, d3) loads after
 * hydration instead of riding in the first bundle; the tile keeps its fixed
 * picture box either way, so nothing moves when they appear.
 */

import dynamic from "next/dynamic";
import type { FeatureVisualProps } from "./FeatureVisuals";

const FeatureVisuals = dynamic(() => import("./FeatureVisuals"), { ssr: false });

export function FeatureVisual(props: FeatureVisualProps) {
  return <FeatureVisuals {...props} />;
}
