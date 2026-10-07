/**
 * Where Next's image optimizer may fetch logos from: the one list behind
 * `images.remotePatterns` in next.config.ts and behind which logos
 * ui/Logos.tsx asks /_next/image for. A logo the kit sends to the optimizer
 * that the config refuses would answer 400 and fall back to its monogram, so
 * logo-hosts.test.ts checks that next.config.ts lists exactly these.
 *
 * Pure and dependency-free, so tests (and any server code) can import it.
 */

export const OPTIMIZED_LOGO_PREFIXES: readonly string[] = [
  // Token and chain logos: TOKEN_LOGO_PREFIXES in lib/token/registry.generated.ts.
  "https://raw.githubusercontent.com/cosmos/chain-registry/master/",
  "https://raw.githubusercontent.com/Zunia-Lab/zunia-chain-registry/main/images/",
  "https://raw.githubusercontent.com/osmosis-labs/assetlists/main/",
  // Validator avatars resolved from keybase (lib/server/validator-logos.ts).
  "https://s3.amazonaws.com/keybase_processed_uploads/",
];

const PREFIXES = OPTIMIZED_LOGO_PREFIXES.map((prefix) => new URL(prefix));

/**
 * Whether `src` may go through the optimizer: https, one of the hosts above,
 * under its path once normalised (so "/master/../../x" is refused), and no
 * query, fragment, port or credentials (the patterns allow none).
 */
export function isOptimizableLogo(src: string): boolean {
  let url: URL;
  try {
    url = new URL(src);
  } catch {
    return false;
  }
  if (url.protocol !== "https:" || url.search || url.hash || url.port || url.username || url.password) return false;
  return PREFIXES.some((prefix) => url.hostname === prefix.hostname && url.pathname.startsWith(prefix.pathname));
}

/** The same list as `images.remotePatterns` entries (what next.config.ts must hold). */
export function logoRemotePatterns(): { protocol: "https"; hostname: string; port: ""; pathname: string; search: "" }[] {
  return PREFIXES.map((prefix) => ({ protocol: "https", hostname: prefix.hostname, port: "", pathname: `${prefix.pathname}**`, search: "" }));
}
