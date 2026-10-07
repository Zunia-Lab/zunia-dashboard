/**
 * Which remote URLs and addresses the server is allowed to fetch on a
 * stranger's behalf.
 *
 * The NFT metadata fetcher reads whatever `token_uri` a contract stores, and on
 * a permissionless wasm chain anyone can deploy a contract. Without a guard a
 * token_uri of `https://attacker.example/x` that redirects to
 * `http://127.0.0.1:8788/...` turns this server into a proxy onto the services
 * that share its host (backend :8788, indexer :8787, the other sites behind
 * nginx) and onto cloud metadata at 169.254.169.254. So every hop is checked
 * twice before a byte is requested:
 *
 * 1. the URL itself — `https://` only, no embedded credentials
 *    ({@link checkRemoteUrl});
 * 2. every address its host resolves to — public unicast only
 *    ({@link blockedReason}, applied by {@link assertPublicHost}).
 *
 * {@link fetchRemoteText} runs both on every redirect hop. It reaches the
 * network only through the `fetch` and `resolve` it is handed, so this module
 * stays free of direct I/O and of `server-only`, and `node --test` can pin
 * both the address tables (an off-by-one in a prefix length is exactly the
 * kind of bug that passes every manual check and ships) and the redirect loop.
 */

/** Why an address is not one the server may connect to on a user's behalf. */
export type BlockedAddressReason =
  | "invalid"
  | "unspecified"
  | "loopback"
  | "private"
  | "carrier-grade-nat"
  | "link-local"
  | "unique-local"
  | "multicast"
  | "documentation"
  | "benchmarking"
  | "translation"
  | "reserved";

type Rule = readonly [prefix: readonly number[], bits: number, reason: BlockedAddressReason];

/**
 * IPv4 special-purpose ranges (IANA registry, RFC 6890 and successors).
 *
 * Everything that is not plain public unicast is refused, not only the
 * "private" blocks: 100.64/10 is the carrier-grade NAT space some hosts use for
 * internal networks, 192.0.0/24 holds protocol anycast, and 240/4 is reserved
 * (it also contains the broadcast address).
 */
const IPV4_RULES: readonly Rule[] = [
  [[0], 8, "unspecified"],
  [[10], 8, "private"],
  [[100, 64], 10, "carrier-grade-nat"],
  [[127], 8, "loopback"],
  [[169, 254], 16, "link-local"],
  [[172, 16], 12, "private"],
  [[192, 0, 0], 24, "reserved"],
  [[192, 0, 2], 24, "documentation"],
  [[192, 88, 99], 24, "reserved"],
  [[192, 168], 16, "private"],
  [[198, 18], 15, "benchmarking"],
  [[198, 51, 100], 24, "documentation"],
  [[203, 0, 113], 24, "documentation"],
  [[224], 4, "multicast"],
  [[240], 4, "reserved"],
];

/**
 * IPv6 special-purpose ranges that sit inside 2000::/3 (global unicast).
 *
 * Anything outside 2000::/3 is refused wholesale afterwards — loopback, ULA
 * (fc00::/7), link-local (fe80::/10), multicast (ff00::/8), the discard prefix
 * and the rest — so only the carve-outs *within* the global block are listed.
 * 6to4 (2002::/16) and Teredo (inside 2001::/23) embed an IPv4 address a relay
 * would forward to, so they are refused rather than decoded.
 */
const IPV6_GLOBAL_CARVE_OUTS: readonly Rule[] = [
  [[0x20, 0x01, 0x00], 23, "reserved"],
  [[0x20, 0x01, 0x0d, 0xb8], 32, "documentation"],
  [[0x20, 0x02], 16, "translation"],
  [[0x3f, 0xff], 20, "documentation"],
];

function matches(bytes: Uint8Array, prefix: readonly number[], bits: number): boolean {
  let remaining = bits;
  for (let i = 0; remaining > 0; i += 1) {
    const take = Math.min(8, remaining);
    const mask = (0xff << (8 - take)) & 0xff;
    if (((bytes[i] ?? 0) & mask) !== ((prefix[i] ?? 0) & mask)) return false;
    remaining -= take;
  }
  return true;
}

function firstRule(bytes: Uint8Array, rules: readonly Rule[]): BlockedAddressReason | null {
  for (const [prefix, bits, reason] of rules) {
    if (matches(bytes, prefix, bits)) return reason;
  }
  return null;
}

/**
 * Dotted-quad IPv4 into 4 bytes, or null.
 *
 * Strict on purpose: `dns.lookup` and the WHATWG URL parser both hand back the
 * canonical form (`http://2130706433/` is already `127.0.0.1` by the time it
 * reaches here), so anything else is malformed and refused rather than
 * reinterpreted.
 */
export function parseIpv4(text: string): Uint8Array | null {
  const parts = text.split(".");
  if (parts.length !== 4) return null;
  const out = new Uint8Array(4);
  for (let i = 0; i < 4; i += 1) {
    const part = parts[i]!;
    if (!/^(0|[1-9]\d{0,2})$/.test(part)) return null;
    const value = Number(part);
    if (value > 255) return null;
    out[i] = value;
  }
  return out;
}

/**
 * IPv6 text (with `::` compression, an optional embedded dotted quad and an
 * optional `%zone`) into 16 bytes, or null.
 */
export function parseIpv6(text: string): Uint8Array | null {
  let value = text;
  const zone = value.indexOf("%");
  if (zone !== -1) value = value.slice(0, zone);
  if (value.length === 0 || value.length > 45) return null;

  let tail: Uint8Array | null = null;
  const lastColon = value.lastIndexOf(":");
  if (value.includes(".")) {
    tail = parseIpv4(value.slice(lastColon + 1));
    if (!tail) return null;
    // Swap the dotted quad for two placeholder groups so the hex parser below
    // sees plain IPv6; the real bytes are written over them at the end.
    value = value.slice(0, lastColon + 1) + "0:0";
  }

  const doubleColon = value.indexOf("::");
  if (doubleColon !== -1 && value.indexOf("::", doubleColon + 1) !== -1) return null;

  const parseGroups = (part: string): number[] | null => {
    if (part === "") return [];
    const groups = part.split(":");
    const out: number[] = [];
    for (const group of groups) {
      if (!/^[0-9a-fA-F]{1,4}$/.test(group)) return null;
      out.push(parseInt(group, 16));
    }
    return out;
  };

  let groups: number[];
  if (doubleColon !== -1) {
    const head = parseGroups(value.slice(0, doubleColon));
    const rest = parseGroups(value.slice(doubleColon + 2));
    if (!head || !rest) return null;
    const missing = 8 - head.length - rest.length;
    if (missing < 1) return null;
    groups = [...head, ...new Array<number>(missing).fill(0), ...rest];
  } else {
    const all = parseGroups(value);
    if (!all || all.length !== 8) return null;
    groups = all;
  }

  const out = new Uint8Array(16);
  groups.forEach((group, index) => {
    out[index * 2] = group >> 8;
    out[index * 2 + 1] = group & 0xff;
  });
  if (tail) out.set(tail, 12);
  return out;
}

function classifyIpv4(bytes: Uint8Array): BlockedAddressReason | null {
  return firstRule(bytes, IPV4_RULES);
}

/** The IPv4 address carried in the low 32 bits of an IPv6 address. */
function embeddedIpv4(bytes: Uint8Array): Uint8Array {
  return bytes.slice(12, 16);
}

function classifyIpv6(bytes: Uint8Array): BlockedAddressReason | null {
  const zeroUpTo = (end: number) => bytes.subarray(0, end).every((byte) => byte === 0);

  if (zeroUpTo(16)) return "unspecified";
  if (zeroUpTo(15) && bytes[15] === 1) return "loopback";

  // IPv4-mapped (::ffff:a.b.c.d) and IPv4-translated (::ffff:0:a.b.c.d) are
  // the same IPv4 host to the kernel, so they get the IPv4 verdict. So does
  // the deprecated IPv4-compatible form (::a.b.c.d).
  if (zeroUpTo(10) && bytes[10] === 0xff && bytes[11] === 0xff) {
    return classifyIpv4(embeddedIpv4(bytes));
  }
  if (zeroUpTo(8) && bytes[8] === 0xff && bytes[9] === 0xff && bytes[10] === 0 && bytes[11] === 0) {
    return classifyIpv4(embeddedIpv4(bytes));
  }
  if (zeroUpTo(12)) return classifyIpv4(embeddedIpv4(bytes));

  // NAT64 well-known prefix 64:ff9b::/96: a DNS64 resolver synthesises these
  // for IPv4-only hosts, and the gateway forwards to the embedded address.
  if (
    bytes[0] === 0x00 && bytes[1] === 0x64 && bytes[2] === 0xff && bytes[3] === 0x9b &&
    bytes.subarray(4, 12).every((byte) => byte === 0)
  ) {
    return classifyIpv4(embeddedIpv4(bytes));
  }

  // Only global unicast (2000::/3) is reachable on purpose; everything else —
  // ULA fc00::/7, link-local fe80::/10, multicast ff00::/8, the local-use NAT64
  // 64:ff9b:1::/48, discard 100::/64 — is refused here.
  if ((bytes[0]! & 0xe0) !== 0x20) {
    if ((bytes[0]! & 0xfe) === 0xfc) return "unique-local";
    if (bytes[0] === 0xfe && (bytes[1]! & 0xc0) === 0x80) return "link-local";
    if (bytes[0] === 0xff) return "multicast";
    if (bytes[0] === 0x00 && bytes[1] === 0x64 && bytes[2] === 0xff && bytes[3] === 0x9b) {
      return "translation";
    }
    return "reserved";
  }
  return firstRule(bytes, IPV6_GLOBAL_CARVE_OUTS);
}

/**
 * Why `address` must not be connected to, or `null` when it is a public
 * unicast address.
 *
 * Accepts what `dns.lookup` returns (and bracket-less IPv6 literals). Anything
 * that does not parse is `"invalid"` — refused, never guessed at.
 */
export function blockedReason(address: string): BlockedAddressReason | null {
  const text = address.trim();
  if (text.includes(":")) {
    const bytes = parseIpv6(text);
    return bytes ? classifyIpv6(bytes) : "invalid";
  }
  const bytes = parseIpv4(text);
  return bytes ? classifyIpv4(bytes) : "invalid";
}

/** A sentence for an operator log or an error detail. */
export function describeBlockedReason(reason: BlockedAddressReason): string {
  switch (reason) {
    case "invalid":
      return "an address that could not be read";
    case "unspecified":
      return "an unspecified address";
    case "loopback":
      return "a loopback address";
    case "private":
      return "a private-network address";
    case "carrier-grade-nat":
      return "a carrier-grade NAT address";
    case "link-local":
      return "a link-local address";
    case "unique-local":
      return "a unique-local address";
    case "multicast":
      return "a multicast address";
    case "documentation":
      return "a documentation-only address";
    case "benchmarking":
      return "a benchmarking address";
    case "translation":
      return "an address-translation prefix";
    case "reserved":
      return "a reserved address";
  }
}

export type RemoteUrlCheck =
  | {
      readonly ok: true;
      readonly url: URL;
      /** The host to resolve, without IPv6 brackets. */
      readonly hostname: string;
      /**
       * True only for the development-time `http://127.0.0.1` exception: the
       * caller skips the address check for it, because the address check would
       * (correctly) refuse loopback.
       */
      readonly loopbackException: boolean;
    }
  | { readonly ok: false; readonly reason: string };

/**
 * May the server request `raw` at all, before any DNS is consulted?
 *
 * `https://` only. Cleartext lets anyone on the path rewrite the document —
 * the artwork and traits of an asset the user is about to act on — and the
 * https requirement is also what makes DNS rebinding toothless here: an
 * internal service cannot present a certificate for the attacker's hostname.
 *
 * `allowLoopbackHttp` keeps the media path testable against a local gateway in
 * development; it is an exact `http://127.0.0.1` match, and the caller passes
 * `NODE_ENV !== "production"`, so a production server never takes it.
 */
export function checkRemoteUrl(
  raw: string,
  options: { readonly allowLoopbackHttp: boolean },
): RemoteUrlCheck {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return { ok: false, reason: "Not a valid URL." };
  }
  if (url.username || url.password) {
    return { ok: false, reason: "URLs with embedded credentials are not fetched." };
  }
  const hostname = url.hostname.replace(/^\[(.*)\]$/, "$1");
  if (!hostname) return { ok: false, reason: "The URL has no host." };

  if (url.protocol === "https:") {
    return { ok: true, url, hostname, loopbackException: false };
  }
  if (url.protocol === "http:" && options.allowLoopbackHttp && hostname === "127.0.0.1") {
    return { ok: true, url, hostname, loopbackException: true };
  }
  return { ok: false, reason: "Only https:// URLs are fetched." };
}

/** HTTP statuses that carry a `Location` worth following. */
export function isFollowableRedirect(status: number): boolean {
  return status === 301 || status === 302 || status === 303 || status === 307 || status === 308;
}

/* -------------------------------------------------------------------------- *
 * The guarded fetch loop
 * -------------------------------------------------------------------------- */

/**
 * The outside world, injected: the server passes the global `fetch` and a
 * `dns.lookup(host, { all: true })` wrapper; the tests pass fakes and count
 * every request the loop would have made. That is what lets the SSRF rules
 * below be pinned by `node --test` instead of by a live probe nobody re-runs.
 */
export interface RemoteFetchDeps {
  readonly fetch: (url: URL, init: RequestInit) => Promise<Response>;
  /** Every address `hostname` resolves to. Gives up when `signal` aborts. */
  readonly resolve: (
    hostname: string,
    signal: AbortSignal,
  ) => Promise<ReadonlyArray<{ readonly address: string }>>;
}

export interface RemoteFetchPolicy {
  /** The development-only `http://127.0.0.1` exception ({@link checkRemoteUrl}). */
  readonly allowLoopbackHttp: boolean;
  /** Redirects followed after the first request; one more is an error. */
  readonly maxRedirects: number;
  /** Body cap: checked against `content-length` first, then while streaming. */
  readonly maxBytes: number;
  /** Sent as the `accept` header. */
  readonly accept: string;
}

/** Drop a body we are not going to read, so the socket is released. */
async function discard(response: Response): Promise<void> {
  await response.body?.cancel().catch(() => undefined);
}

/**
 * Refuse a host unless every address it resolves to is public unicast.
 *
 * Every address, not the first: a name that answers with one public and one
 * private address would otherwise pass here and then be connected to on the
 * private one. There is a window between this lookup and the one `fetch` makes
 * (DNS rebinding); it is closed in practice by the https-only rule — a service
 * on this host cannot present a valid certificate for the attacker's name, so
 * the TLS handshake fails before a request is sent.
 */
export async function assertPublicHost(
  hostname: string,
  signal: AbortSignal,
  resolve: RemoteFetchDeps["resolve"],
): Promise<void> {
  const answers = await resolve(hostname, signal);
  if (answers.length === 0) throw new Error(`${hostname} did not resolve`);
  for (const { address } of answers) {
    const blocked = blockedReason(address);
    if (blocked) {
      throw new Error(`Refused to contact ${hostname}: it resolves to ${describeBlockedReason(blocked)}`);
    }
  }
}

/** Read at most `max` bytes, then give up on the body rather than buffering it. */
export async function readCapped(response: Response, max: number): Promise<string> {
  const body = response.body;
  if (!body) return await response.text();
  const reader = body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      if (!value) continue;
      total += value.byteLength;
      if (total > max) throw new Error(`The response exceeded ${max} bytes`);
      chunks.push(value);
    }
  } finally {
    await reader.cancel().catch(() => undefined);
  }
  const joined = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    joined.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return new TextDecoder().decode(joined);
}

/**
 * GET a stranger's URL as text, with every hop checked *before* it is
 * requested.
 *
 * Redirects are followed here, by hand (`redirect: "manual"`), never by
 * `fetch`: a check on `response.url` after the fact runs once the internal
 * request has already been made — which is exactly the hole the old
 * `redirect: "follow"` fetcher had. Each hop goes through {@link
 * checkRemoteUrl} and {@link assertPublicHost} again, and a chain longer than
 * `maxRedirects` is a loop or a probe, not a CDN.
 *
 * `signal` is the caller's whole budget (DNS, every hop and the body), so a
 * deadline set once by the caller bounds the entire read.
 */
export async function fetchRemoteText(
  raw: string,
  signal: AbortSignal,
  deps: RemoteFetchDeps,
  policy: RemoteFetchPolicy,
): Promise<string> {
  let target = raw;
  for (let hop = 0; ; hop += 1) {
    const checked = checkRemoteUrl(target, { allowLoopbackHttp: policy.allowLoopbackHttp });
    if (!checked.ok) throw new Error(checked.reason);
    if (!checked.loopbackException) await assertPublicHost(checked.hostname, signal, deps.resolve);

    const response = await deps.fetch(checked.url, {
      signal,
      redirect: "manual",
      // Next patches the server's `fetch` with a data cache; a stranger's
      // document must never land in it.
      cache: "no-store",
      headers: { accept: policy.accept },
    });

    if (isFollowableRedirect(response.status)) {
      await discard(response);
      if (hop >= policy.maxRedirects) throw new Error(`More than ${policy.maxRedirects} redirects`);
      const location = response.headers.get("location");
      if (!location) throw new Error(`HTTP ${response.status} without a Location header`);
      try {
        target = new URL(location, checked.url).href;
      } catch {
        throw new Error("The redirect target is not a valid URL");
      }
      continue;
    }

    if (!response.ok) {
      await discard(response);
      throw new Error(`HTTP ${response.status}`);
    }
    const declared = Number(response.headers.get("content-length") ?? Number.NaN);
    if (Number.isFinite(declared) && declared > policy.maxBytes) {
      await discard(response);
      throw new Error(`The response exceeded ${policy.maxBytes} bytes`);
    }
    return readCapped(response, policy.maxBytes);
  }
}
