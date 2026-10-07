/**
 * Parsers for the NFT deployment keys.
 *
 * Split out from `lib/server/nft-config.ts` on purpose: that file carries
 * `import "server-only"` because it reads `process.env`, and a module that
 * cannot be imported outside a request cannot be unit-tested. These functions
 * take the raw string and return structure, touch no globals, and are the only
 * place a malformed operator value is interpreted.
 *
 * Every parser drops what it cannot read rather than guessing, and reports the
 * dropped entries so the config route can say "this key has two bad rows"
 * instead of silently offering a shorter list. A CW721 contract address that
 * arrives mangled is not a cosmetic problem: it becomes a contract this build
 * queries, and — for the ICS721 bridge — a contract an NFT is handed to.
 */

/** One rejected entry, with the text that produced it. */
export interface ConfigProblem {
  readonly key: string;
  readonly entry: string;
  readonly reason: string;
}

export interface ParsedChainMap<T> {
  readonly byChainId: Readonly<Record<string, T>>;
  readonly problems: readonly ConfigProblem[];
}

/**
 * A bech32-shaped address.
 *
 * Deliberately not `^[a-z]+1`: Safrochain's prefix is `addr_safro`, with an
 * underscore, and a character-class prefix test rejects it. Checksums are not
 * verified here — `@zunialab/interchain`'s `checkAddress` owns that, and it
 * needs a chain to check against, which a string parser does not have.
 */
const ADDRESS_SHAPE = /^[a-z][a-z0-9_-]{1,31}1[02-9ac-hj-np-z]{6,}$/;

/** `channel-` followed by digits. The same shape `normalizeChannelId` accepts. */
const CHANNEL_SHAPE = /^channel-\d+$/;

function splitGroups(raw: string): string[] {
  return raw
    .split(";")
    .map((group) => group.trim())
    .filter((group) => group.length > 0);
}

/** Comma-separated values, trimmed, empties dropped, order preserved. */
export function parseList(raw: string | undefined): string[] {
  if (!raw) return [];
  const seen = new Set<string>();
  const out: string[] = [];
  for (const entry of raw.split(",")) {
    const value = entry.trim();
    if (!value || seen.has(value)) continue;
    seen.add(value);
    out.push(value);
  }
  return out;
}

/**
 * `chain-1=addr1,addr2;chain-2=addr3` into `{ "chain-1": [addr1, addr2], … }`.
 *
 * Used for the known-collection list. A group with no `=` is a problem, not a
 * chain-less list of addresses: guessing which chain an address belongs to is
 * how a Juno collection ends up being queried on Osmosis.
 */
export function parseContractsByChain(
  raw: string | undefined,
  key: string,
): ParsedChainMap<readonly string[]> {
  const byChainId: Record<string, string[]> = {};
  const problems: ConfigProblem[] = [];
  if (!raw) return { byChainId, problems };

  for (const group of splitGroups(raw)) {
    const split = group.indexOf("=");
    if (split <= 0) {
      problems.push({
        key,
        entry: group,
        reason: 'Expected "chainId=address,address".',
      });
      continue;
    }
    const chainId = group.slice(0, split).trim();
    const addresses = parseList(group.slice(split + 1));
    if (!chainId) {
      problems.push({ key, entry: group, reason: "No chain id before the =." });
      continue;
    }
    const kept = byChainId[chainId] ?? [];
    for (const address of addresses) {
      if (!ADDRESS_SHAPE.test(address)) {
        problems.push({
          key,
          entry: `${chainId}=${address}`,
          reason: "Not a bech32-shaped contract address.",
        });
        continue;
      }
      if (!kept.includes(address)) kept.push(address);
    }
    if (kept.length > 0) byChainId[chainId] = kept;
    else if (addresses.length === 0) {
      problems.push({ key, entry: group, reason: "No addresses after the =." });
    }
  }

  return { byChainId, problems };
}

/**
 * `chain-1=addr;chain-2=addr2` into one address per chain.
 *
 * Used for the cw-ics721 bridge, of which a chain has exactly one in a given
 * deployment. A second entry for the same chain is a problem rather than a
 * silent overwrite — the operator meant something by it and we cannot tell
 * which one.
 */
export function parseAddressByChain(
  raw: string | undefined,
  key: string,
): ParsedChainMap<string> {
  const byChainId: Record<string, string> = {};
  const problems: ConfigProblem[] = [];
  if (!raw) return { byChainId, problems };

  for (const group of splitGroups(raw)) {
    const split = group.indexOf("=");
    if (split <= 0) {
      problems.push({
        key,
        entry: group,
        reason: 'Expected "chainId=address".',
      });
      continue;
    }
    const chainId = group.slice(0, split).trim();
    const address = group.slice(split + 1).trim();
    if (!chainId || !address) {
      problems.push({ key, entry: group, reason: "Chain id or address missing." });
      continue;
    }
    if (!ADDRESS_SHAPE.test(address)) {
      problems.push({
        key,
        entry: group,
        reason: "Not a bech32-shaped contract address.",
      });
      continue;
    }
    if (byChainId[chainId] !== undefined && byChainId[chainId] !== address) {
      problems.push({
        key,
        entry: group,
        reason: `${chainId} already has a different bridge address; both were dropped.`,
      });
      delete byChainId[chainId];
      continue;
    }
    byChainId[chainId] = address;
  }

  return { byChainId, problems };
}

/** A configured ICS721 channel, on the source chain, towards one destination. */
export interface Ics721Link {
  readonly sourceChainId: string;
  readonly destChainId: string;
  readonly channelId: string;
}

export interface ParsedIcs721Links {
  readonly links: readonly Ics721Link[];
  readonly problems: readonly ConfigProblem[];
}

/**
 * `source>dest=channel-7;source>other=channel-9`.
 *
 * ICS721 does not run on the `transfer` port, so the engine's channel discovery
 * — which is transfer-only, correctly — can never find these. They are
 * deployment facts, and they are directional: `channel-7` on the source is not
 * `channel-7` on the destination.
 */
export function parseIcs721Links(
  raw: string | undefined,
  key: string,
): ParsedIcs721Links {
  const links: Ics721Link[] = [];
  const problems: ConfigProblem[] = [];
  if (!raw) return { links, problems };

  for (const group of splitGroups(raw)) {
    const split = group.indexOf("=");
    if (split <= 0) {
      problems.push({
        key,
        entry: group,
        reason: 'Expected "sourceChainId>destChainId=channel-N".',
      });
      continue;
    }
    const pair = group.slice(0, split).trim();
    const channelId = group.slice(split + 1).trim();
    const arrow = pair.indexOf(">");
    if (arrow <= 0) {
      problems.push({
        key,
        entry: group,
        reason: 'Expected "sourceChainId>destChainId" before the =.',
      });
      continue;
    }
    const sourceChainId = pair.slice(0, arrow).trim();
    const destChainId = pair.slice(arrow + 1).trim();
    if (!sourceChainId || !destChainId) {
      problems.push({ key, entry: group, reason: "Chain id missing." });
      continue;
    }
    if (!CHANNEL_SHAPE.test(channelId)) {
      problems.push({
        key,
        entry: group,
        reason: 'Channel must look like "channel-7".',
      });
      continue;
    }
    if (
      links.some(
        (link) =>
          link.sourceChainId === sourceChainId && link.destChainId === destChainId,
      )
    ) {
      problems.push({
        key,
        entry: group,
        reason: "This chain pair is already configured; the later entry was dropped.",
      });
      continue;
    }
    links.push({ sourceChainId, destChainId, channelId });
  }

  return { links, problems };
}

/**
 * The entry as it may be echoed back in a problem.
 *
 * Problems are served by `/api/nft/config`, which anyone can read, and an
 * operator's slip is exactly when a secret lands in the wrong key. So the
 * userinfo goes (everything up to the *last* `@`: a password may itself
 * contain `/` or `@`, and a malformed entry still has to come back clean), and
 * so does any query string or fragment, which is where gateway and index
 * tokens live (`?token=…`).
 */
function redactEntry(entry: string): string {
  const cut = entry.search(/[?#]/);
  let text = cut === -1 ? entry : `${entry.slice(0, cut + 1)}<redacted>`;
  const scheme = /^[a-z][a-z0-9+.-]*:\/\//i.exec(text);
  const start = scheme ? scheme[0].length : 0;
  const at = text.lastIndexOf("@");
  if (at >= start) text = `${text.slice(0, start)}<redacted>${text.slice(at)}`;
  return text;
}

/**
 * Parse one operator URL under the transport rule every NFT upstream shares:
 * `https://`, or `http://127.0.0.1` exactly — never a prefix match, which
 * also accepts `http://127.0.0.1.attacker.example` — when the caller allows
 * it (`allowLoopback: NODE_ENV !== "production"`), and no `user:password@`
 * (fetch refuses such a URL, and a gateway one would reach every browser).
 */
function parseOperatorUrl(
  entry: string,
  key: string,
  options: { readonly allowLoopback?: boolean },
  what: string,
): { readonly url: URL; readonly problem: null } | { readonly url: null; readonly problem: ConfigProblem } {
  let url: URL;
  try {
    url = new URL(entry);
  } catch {
    return { url: null, problem: { key, entry: redactEntry(entry), reason: "Not a valid URL." } };
  }
  if (url.username || url.password) {
    return {
      url: null,
      problem: { key, entry: redactEntry(entry), reason: `${what} must not carry credentials in the URL.` },
    };
  }
  const loopback = url.protocol === "http:" && url.hostname === "127.0.0.1";
  if (url.protocol !== "https:" && !(loopback && options.allowLoopback === true)) {
    return {
      url: null,
      problem: {
        key,
        entry: redactEntry(entry),
        reason: loopback
          ? "A loopback address is only accepted in local development."
          : `${what} must be https:// — cleartext can be rewritten in flight.`,
      },
    };
  }
  return { url, problem: null };
}

/**
 * Gateway base URLs for `ipfs://` and `ar://`.
 *
 * `https://` only: a metadata document read over cleartext can be rewritten in
 * flight, and the thing it rewrites is the artwork and the trait list of an
 * asset the user is about to act on. A gateway on `http://127.0.0.1` has no
 * network to be rewritten on and keeps the media path testable locally, so it
 * is accepted when — and only when — the caller says so
 * (`allowLoopback: NODE_ENV !== "production"`); off by default, so a caller
 * that forgets the option can never let a production build talk cleartext.
 *
 * A gateway base ends up in `<img src>` for every visitor, so one that carries
 * credentials is refused rather than handed to the browser. So is one with a
 * query string or fragment: the engine appends the content path to the base
 * (`{base}{cid}/{path}`), which would land inside the query and fetch nothing.
 */
export function parseGateways(
  raw: string | undefined,
  key: string,
  options: { readonly allowLoopback?: boolean } = {},
): { readonly gateways: readonly string[]; readonly problems: readonly ConfigProblem[] } {
  const gateways: string[] = [];
  const problems: ConfigProblem[] = [];
  for (const entry of parseList(raw)) {
    const parsed = parseOperatorUrl(entry, key, options, "Gateways");
    if (parsed.problem) {
      problems.push(parsed.problem);
      continue;
    }
    if (parsed.url.search || parsed.url.hash || /[?#]/.test(entry)) {
      problems.push({
        key,
        entry: redactEntry(entry),
        reason: "A gateway is a base path: the content id is appended to it, so it cannot have a query string or fragment.",
      });
      continue;
    }
    gateways.push(entry.endsWith("/") ? entry : `${entry}/`);
  }
  return { gateways, problems };
}

/**
 * `ZUNIA_NFT_INDEXER_URL`, the "contracts by owner" index.
 *
 * The same transport rule as the gateways ({@link parseOperatorUrl}). A query
 * string is kept — an index may want a key in it, and the URL never leaves the
 * server — but a problem never echoes it. A trailing slash is dropped because
 * the caller appends `?chainId=&owner=` through the URL API.
 */
export function parseIndexerUrl(
  raw: string | undefined,
  key: string,
  options: { readonly allowLoopback?: boolean } = {},
): { readonly url: string | null; readonly problems: readonly ConfigProblem[] } {
  const value = raw?.trim();
  if (!value) return { url: null, problems: [] };
  const parsed = parseOperatorUrl(value, key, options, "The NFT index URL");
  if (parsed.problem) return { url: null, problems: [parsed.problem] };
  return { url: value.replace(/\/$/, ""), problems: [] };
}

/** An explicit operator opt-in. Anything but a recognised true is false. */
export function parseFlag(raw: string | undefined): boolean {
  const value = raw?.trim().toLowerCase();
  return value === "1" || value === "true" || value === "yes";
}

/**
 * `chain-1=https://explorer.example/nft/{contract}/{tokenId};…`
 *
 * Explorer URLs are per-chain deployment data. There is no default and there
 * will not be one: guessing a domain and linking a user's token to it is the
 * same class of defect as a fabricated transaction hash — it looks
 * authoritative and it is made up. A chain with no template simply gets no
 * link, and the UI says why.
 *
 * https only, and every substituted value is URL-encoded at render time, so a
 * token id containing a slash cannot rewrite the path.
 */
export function parseTemplateByChain(
  raw: string | undefined,
  key: string,
  required: readonly string[],
): ParsedChainMap<string> {
  const byChainId: Record<string, string> = {};
  const problems: ConfigProblem[] = [];
  if (!raw) return { byChainId, problems };

  for (const group of splitGroups(raw)) {
    const split = group.indexOf("=");
    if (split <= 0) {
      problems.push({
        key,
        entry: group,
        reason: `Expected "chainId=https://…{${required[0] ?? "value"}}…".`,
      });
      continue;
    }
    const chainId = group.slice(0, split).trim();
    const template = group.slice(split + 1).trim();
    if (!chainId || !template) {
      problems.push({ key, entry: group, reason: "Chain id or template missing." });
      continue;
    }
    if (!template.startsWith("https://")) {
      problems.push({ key, entry: group, reason: "Explorer templates must be https://." });
      continue;
    }
    const missing = required.filter(
      (placeholder) => !template.includes(`{${placeholder}}`),
    );
    if (missing.length > 0) {
      problems.push({
        key,
        entry: group,
        reason: `Template is missing ${missing.map((name) => `{${name}}`).join(" and ")}.`,
      });
      continue;
    }
    byChainId[chainId] = template;
  }

  return { byChainId, problems };
}

/**
 * Fill a template's `{name}` placeholders, URL-encoding every value.
 *
 * Returns null for an unfilled placeholder rather than emitting a URL with a
 * literal `{tokenId}` in it: a broken link is worse than no link, because the
 * user cannot tell which of the two they are looking at.
 */
export function fillTemplate(
  template: string,
  values: Readonly<Record<string, string>>,
): string | null {
  let filled = template;
  for (const [name, value] of Object.entries(values)) {
    filled = filled.split(`{${name}}`).join(encodeURIComponent(value));
  }
  return /\{[A-Za-z0-9_]+\}/.test(filled) ? null : filled;
}
