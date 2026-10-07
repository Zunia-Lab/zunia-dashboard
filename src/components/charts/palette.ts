/**
 * Chart colours, by the job each one does.
 *
 * Every value is a CSS variable from `src/styles/viz.css`, never a hex: the
 * light and dark steps are separate, validated palettes (not a flip of each
 * other), and the browser swaps them when the theme changes without a single
 * chart re-rendering.
 *
 * Categorical slots carry identity and are handed out in a fixed order
 * (orange, blue, aqua, violet, yellow, magenta: design spec §8). The order is
 * the colour-blind safety mechanism (only neighbours ever touch, and every
 * neighbouring pair was validated), so it is never shuffled, never cycled,
 * and a seventh entity never gets a generated hue: it wears the "Other" grey.
 * Green and red are not slots at all: they mean good and bad.
 */

/** How many categorical slots the validated palette has. */
export const VIZ_SLOT_COUNT = 6;

/** Categorical slots in their validated order. */
export const VIZ_SLOTS: readonly string[] = Array.from(
  { length: VIZ_SLOT_COUNT },
  (_, i) => `var(--viz-${i + 1})`,
);

/** The de-emphasis grey: "Other", folded tails, context series. */
export const VIZ_OTHER = "var(--viz-other)";

/** Single-series charts wear the brand, not slot 1. */
export const VIZ_ACCENT = "var(--viz-accent)";

/** Far end of the brand ramp, for gradient strokes. */
export const VIZ_ACCENT_2 = "var(--viz-accent-2)";

/** Status colours. Only for values that mean good or bad, never for "series 4". */
export const VIZ_POS = "var(--viz-pos)";
export const VIZ_NEG = "var(--viz-neg)";
export const VIZ_WARN = "var(--viz-warn)";

/** A quiet line that carries shape, not identity (neutral sparklines). */
export const VIZ_NEUTRAL = "var(--viz-neutral)";

/** Id of the synthetic segment `foldOther` creates. */
export const OTHER_ID = "__other";

/**
 * Assigns categorical slots to ids in the order given; everything past the
 * sixth gets the "Other" grey.
 *
 * Build the map once from the full, unfiltered entity list (all followed
 * chains, every asset the wallet holds) and pass it to every chart on the
 * page: colour then follows the entity, so hiding one series never repaints
 * the survivors and "Osmosis" is the same blue in the donut and the bars.
 * Order the list by importance (largest holding first) so the entities a
 * reader will actually see hold the six hues. Duplicate ids keep their first
 * slot.
 */
export function stableColorMap(ids: Iterable<string>): Map<string, string> {
  const map = new Map<string, string>();
  for (const id of ids) {
    if (map.has(id)) continue;
    map.set(id, map.size < VIZ_SLOT_COUNT ? VIZ_SLOTS[map.size] : VIZ_OTHER);
  }
  return map;
}

/**
 * Colour for one entity: an explicit override, then the shared map, then
 * grey. Grey is also what the "Other" segment and any id the map has never
 * seen get, so an entity missing from the map reads as context, not as a
 * borrowed identity.
 */
export function colorFor(
  id: string,
  explicit: string | undefined,
  map: ReadonlyMap<string, string> | undefined,
): string {
  return explicit ?? map?.get(id) ?? VIZ_OTHER;
}
