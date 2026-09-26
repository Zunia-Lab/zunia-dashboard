/**
 * Validator logos come from Keybase, the same way TheHub does it.
 *
 * `description.identity` is a hex PGP suffix. We look that account up and
 * use `them[0].pictures.primary.url`. Cosmostation moniker PNGs are only
 * tried when Keybase has no picture.
 */

import { findChain } from "../chains";

export type LogoInput = {
  chainId: string;
  chainName?: string;
  operatorAddress: string;
  identity?: string;
  logoSlugs?: readonly string[];
};

const memory = new Map<string, string | null>();
const memoryAt = new Map<string, number>();
const HIT_TTL_MS = 7 * 24 * 60 * 60 * 1000;
const MISS_TTL_MS = 60 * 60 * 1000;

function isValidKeybaseIdentity(identity: string): boolean {
  const hex = identity.trim();
  return hex.length >= 8 && hex.length <= 64 && /^[0-9a-f]+$/i.test(hex);
}

function cacheKey(identity: string): string {
  return identity.trim().toLowerCase();
}

function slugs(input: LogoInput): string[] {
  const out: string[] = [];
  const push = (value: string | undefined) => {
    const slug = (value ?? "")
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9-]+/g, "")
      .replace(/^-+|-+$/g, "");
    if (slug && !out.includes(slug)) out.push(slug);
  };
  const extra = input.logoSlugs ?? findChain(input.chainId)?.logoSlugs;
  for (const slug of extra ?? []) push(slug);
  push(input.operatorAddress.match(/^([a-z0-9]+)valoper/i)?.[1]);
  push(input.chainName?.replace(/\s+/g, ""));
  push(input.chainName);
  push(input.chainId.replace(/_\d+-\d+$/, "").replace(/-\d+$/, ""));
  push(input.chainId);
  return out;
}

function candidates(input: LogoInput): string[] {
  const operator = input.operatorAddress.trim();
  if (!operator) return [];
  const urls: string[] = [];
  for (const slug of slugs(input)) {
    urls.push(
      `https://raw.githubusercontent.com/cosmostation/chainlist/main/chain/${slug}/moniker/${operator}.png`,
    );
  }
  return urls;
}

async function headOk(url: string): Promise<boolean> {
  try {
    const res = await fetch(url, {
      method: "HEAD",
      redirect: "follow",
      signal: AbortSignal.timeout(4_000),
    });
    if (res.ok) return true;
    if (res.status === 403 || res.status === 405) {
      const get = await fetch(url, {
        method: "GET",
        headers: { Range: "bytes=0-0" },
        signal: AbortSignal.timeout(4_000),
      });
      return get.ok || get.status === 206;
    }
    return false;
  } catch {
    return false;
  }
}

async function keybasePicture(identity: string): Promise<string | null> {
  const hex = identity.trim();
  if (!isValidKeybaseIdentity(hex)) return null;
  const key = cacheKey(hex);
  const at = memoryAt.get(key);
  if (at && memory.has(key)) {
    const cached = memory.get(key)!;
    const age = Date.now() - at;
    if (cached && age < HIT_TTL_MS) return cached;
    if (cached === null && age < MISS_TTL_MS) return null;
  }
  try {
    const res = await fetch(
      `https://keybase.io/_/api/1.0/user/lookup.json?key_suffix=${encodeURIComponent(hex)}&fields=pictures`,
      { signal: AbortSignal.timeout(5_000), headers: { Accept: "application/json" } },
    );
    if (!res.ok) {
      memory.set(key, null);
      memoryAt.set(key, Date.now());
      return null;
    }
    const body = (await res.json()) as {
      them?: Array<{ pictures?: { primary?: { url?: string } } }>;
    };
    const url = body.them?.[0]?.pictures?.primary?.url?.trim() || null;
    memory.set(key, url);
    memoryAt.set(key, Date.now());
    return url;
  } catch {
    memory.set(key, null);
    memoryAt.set(key, Date.now());
    return null;
  }
}

async function cosmostationPicture(input: LogoInput): Promise<string | null> {
  for (const url of candidates(input)) {
    if (await headOk(url)) return url;
  }
  return null;
}

/** Keybase first, Cosmostation if Keybase has no picture. */
export async function resolveValidatorLogoUrl(
  input: LogoInput,
): Promise<string | null> {
  if (input.identity) {
    const fromKeybase = await keybasePicture(input.identity);
    if (fromKeybase) return fromKeybase;
  }
  return cosmostationPicture(input);
}

export async function attachValidatorLogos<
  T extends LogoInput & { logoUrl?: string },
>(rows: T[], concurrency = 5): Promise<T[]> {
  const unique = [
    ...new Set(rows.map((row) => row.identity?.trim()).filter(Boolean)),
  ] as string[];
  const byIdentity = new Map<string, string | null>();
  for (let i = 0; i < unique.length; i += concurrency) {
    const batch = unique.slice(i, i + concurrency);
    const found = await Promise.all(
      batch.map(async (id) => [id, await keybasePicture(id)] as const),
    );
    for (const [id, url] of found) byIdentity.set(id, url);
  }

  const out = rows.slice();
  let next = 0;
  async function worker() {
    while (next < out.length) {
      const i = next++;
      const row = out[i]!;
      const identity = row.identity?.trim();
      const fromKeybase = identity ? byIdentity.get(identity) : null;
      const url = fromKeybase || (await cosmostationPicture(row));
      if (url) out[i] = { ...row, logoUrl: url };
    }
  }
  await Promise.all(
    Array.from({ length: Math.min(concurrency, Math.max(out.length, 1)) }, () =>
      worker(),
    ),
  );
  return out;
}
