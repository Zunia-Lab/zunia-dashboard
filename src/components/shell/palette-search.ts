/**
 * Matching for the command palette: forgiving enough that "stk" finds
 * Staking and "osm" finds Osmosis, strict enough that the right thing comes
 * first.
 *
 * Every word of the query must match the item somewhere (its label, a
 * keyword, or its detail line), in order of preference:
 *   1. the label starts with the word;
 *   2. a word inside the label starts with it ("hub" → "Cosmos Hub");
 *   3. it appears inside the label;
 *   4. its letters appear in order (a subsequence: "stkg" → "Staking"),
 *      better when they are adjacent or start words.
 * Keyword and detail matches count for less than label matches, so "swap"
 * ranks the Swap page above a chain whose description mentions swaps.
 *
 * Pure; `node --test` covers it.
 */

export interface Searchable {
  label: string;
  keywords?: readonly string[];
  detail?: string;
}

const WEIGHT = { label: 1, keyword: 0.8, detail: 0.45 } as const;

/** Lower case, accents and punctuation folded, so "Réseau" and "reseau" meet. */
export function normalize(text: string): string {
  return text
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim();
}

function isWordStart(text: string, index: number): boolean {
  return index === 0 || text[index - 1] === " ";
}

/**
 * How well one (normalised) query word matches one (normalised) text;
 * higher is better, null when it does not match at all.
 */
export function wordScore(word: string, text: string): number | null {
  if (!word) return 0;
  if (!text) return null;
  const at = text.indexOf(word);
  if (at !== -1) {
    const tightness = Math.max(0, 40 - (text.length - word.length));
    if (at === 0) return 1000 + tightness;
    // The best occurrence may start a later word: "hub" in "cosmos hub".
    let wordStart = -1;
    for (let index = at; index !== -1; index = text.indexOf(word, index + 1)) {
      if (isWordStart(text, index)) {
        wordStart = index;
        break;
      }
    }
    if (wordStart !== -1) return 800 + tightness - wordStart;
    return 600 + tightness - at;
  }
  // Subsequence: every letter in order, rewarded for runs and word starts.
  let score = 300;
  let from = 0;
  let previous = -2;
  for (const char of word) {
    const index = text.indexOf(char, from);
    if (index === -1) return null;
    if (index === previous + 1) score += 12;
    else score -= Math.min(20, index - from);
    if (isWordStart(text, index)) score += 8;
    previous = index;
    from = index + 1;
  }
  return Math.max(1, score);
}

/** The item's score for a whole query, or null when some word matches nothing. */
export function matchScore(query: string, item: Searchable): number | null {
  const words = normalize(query).split(" ").filter(Boolean);
  if (words.length === 0) return 0;
  const label = normalize(item.label);
  const keywords = (item.keywords ?? []).map(normalize);
  const detail = item.detail ? normalize(item.detail) : "";
  let total = 0;
  for (const word of words) {
    let best: number | null = null;
    const consider = (score: number | null, weight: number) => {
      if (score === null) return;
      const weighted = score * weight;
      if (best === null || weighted > best) best = weighted;
    };
    consider(wordScore(word, label), WEIGHT.label);
    for (const keyword of keywords) consider(wordScore(word, keyword), WEIGHT.keyword);
    if (detail) consider(wordScore(word, detail), WEIGHT.detail);
    if (best === null) return null;
    total += best;
  }
  return total;
}

/**
 * Items matching `query`, best first (ties keep the input order). An empty
 * query returns the items as they are, cut to `limit`.
 */
export function rankMatches<T>(query: string, items: readonly T[], toSearchable: (item: T) => Searchable, limit = Infinity): T[] {
  if (!normalize(query)) return items.slice(0, limit);
  const scored: Array<{ item: T; score: number; index: number }> = [];
  items.forEach((item, index) => {
    const score = matchScore(query, toSearchable(item));
    if (score !== null) scored.push({ item, score, index });
  });
  scored.sort((a, b) => b.score - a.score || a.index - b.index);
  return scored.slice(0, limit).map((entry) => entry.item);
}
