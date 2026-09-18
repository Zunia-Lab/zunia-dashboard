/**
 * Resolve a validator moniker image once on the server, then hand the URL to
 * the client so the browser does not cascade through dozens of 404s.
 *
 * Order: Cosmostation chainlist (alias slug first) → Keybase identity picture.
 */

const SLUG_ALIASES: Record<string, string> = {
  "cosmoshub-4": "cosmos",
  "osmosis-1": "osmosis",
  celestia: "celestia",
  "neutron-1": "neutron",
  "akashnet-2": "akash",
  "juno-1": "juno",
  "kaiyo-1": "kujira",
  "phoenix-1": "terra",
  "dydx-mainnet-1": "dydx",
  "injective-1": "injective",
  "pacific-1": "sei",
  "core-1": "persistence",
  "stargaze-1": "stargaze",
  "stride-1": "stride",
  "noble-1": "noble",
  "axelar-dojo-1": "axelar",
  "evmos_9001-2": "evmos",
  "safrochain-1": "safrochain",
  "bbn-1": "babylon",
  "pio-mainnet-1": "provenance",
  "laozi-mainnet": "band",
  "regen-1": "regen",
  "sommelier-3": "sommelier",
  "umee-1": "umee",
  "quicksilver-2": "quicksilver",
  "chihuahua-1": "chihuahua",
  "bitcanna-1": "bitcanna",
  "bitsong-2b": "bitsong",
  "comdex-1": "comdex",
  "crescent-1": "crescent",
  "desmos-mainnet": "desmos",
  "emoney-3": "emoney",
  "fetchhub-4": "fetchai",
  "gravity-bridge-3": "gravity-bridge",
  "irishub-1": "iris",
  "kava_2222-10": "kava",
  "likecoin-mainnet-2": "likecoin",
  "lum-network-1": "lum",
  "mantle-1": "assetmantle",
};

export type LogoInput = {
  chainId: string;
  chainName?: string;
  operatorAddress: string;
  identity?: string;
};

const memory = new Map<string, string | null>();
const memoryAt = new Map<string, number>();
const MEMORY_TTL_MS = 6 * 60 * 60 * 1000;

function cacheKey(input: LogoInput): string {
  return `${input.chainId}:${input.operatorAddress}:${input.identity ?? ""}`;
}

function slugs(chainId: string, chainName?: string): string[] {
  const out: string[] = [];
  const push = (value: string | undefined) => {
    const slug = (value ?? "")
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9-]+/g, "")
      .replace(/^-+|-+$/g, "");
    if (slug && !out.includes(slug)) out.push(slug);
  };
  push(SLUG_ALIASES[chainId]);
  push(chainName?.replace(/\s+/g, ""));
  push(chainName);
  push(chainId.replace(/_\d+-\d+$/, "").replace(/-\d+$/, ""));
  push(chainId);
  return out;
}

function candidates(input: LogoInput): string[] {
  const operator = input.operatorAddress.trim();
  if (!operator) return [];
  const urls: string[] = [];
  for (const slug of slugs(input.chainId, input.chainName)) {
    // Prefer `main` — Cosmostation dropped the `master` branch tip.
    urls.push(
      `https://raw.githubusercontent.com/cosmostation/chainlist/main/chain/${slug}/moniker/${operator}.png`,
    );
    urls.push(
      `https://raw.githubusercontent.com/cosmostation/chainlist/master/chain/${slug}/moniker/${operator}.png`,
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

async function keybasePicture(identity: string): Promise<string | undefined> {
  const hex = identity.trim();
  if (!/^[a-fA-F0-9]{16}$/.test(hex)) return undefined;
  try {
    const res = await fetch(
      `https://keybase.io/_/api/1.0/user/lookup.json?key_suffix=${encodeURIComponent(hex)}&fields=pictures`,
      { signal: AbortSignal.timeout(4_000) },
    );
    if (!res.ok) return undefined;
    const body = (await res.json()) as {
      them?: Array<{ pictures?: { primary?: { url?: string } } }>;
    };
    return body.them?.[0]?.pictures?.primary?.url?.trim() || undefined;
  } catch {
    return undefined;
  }
}

/** First working logo URL, or null when none resolve. Cached in-process. */
export async function resolveValidatorLogoUrl(
  input: LogoInput,
): Promise<string | null> {
  const key = cacheKey(input);
  const at = memoryAt.get(key);
  if (at && Date.now() - at < MEMORY_TTL_MS && memory.has(key)) {
    return memory.get(key)!;
  }

  let found: string | null = null;
  for (const url of candidates(input)) {
    if (await headOk(url)) {
      found = url;
      break;
    }
  }
  if (!found && input.identity) {
    found = (await keybasePicture(input.identity)) ?? null;
  }

  memory.set(key, found);
  memoryAt.set(key, Date.now());
  return found;
}

export async function attachValidatorLogos<
  T extends LogoInput & { logoUrl?: string },
>(rows: T[], concurrency = 8): Promise<T[]> {
  const out = rows.slice();
  let next = 0;
  async function worker() {
    while (next < out.length) {
      const i = next++;
      const row = out[i]!;
      const url = await resolveValidatorLogoUrl(row);
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
