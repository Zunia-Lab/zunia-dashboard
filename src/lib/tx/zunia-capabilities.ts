/**
 * What the connected Zunia extension can sign, from what its provider reports.
 *
 * Zunia 0.1.0 to 0.1.4 report the provider API version "0.1.0" and nothing
 * more, so they cannot be told apart. From 0.1.5 the provider (`window.zunia`,
 * and `window.keplr` when the alias is on) also reports `extensionVersion`
 * (the manifest version, "" when unreadable), `isZunia` and `features`, a list
 * of the strings in `ZUNIA_SIGNING_FEATURES`. A build signs everything in
 * direct mode when `features` holds "sign-direct:wasm-contract-32", or, when
 * it reports no `features`, when `extensionVersion` is 0.1.5 or later; anything
 * else is a legacy build (`sign-mode.ts` keeps its workaround for those).
 *
 * A copy of `zuniaCapabilities` and `ZUNIA_SIGNING_FEATURES` from zunia-sdk
 * packages/core/src/signing.ts (sdk-core 0.1.1), with the same strings. Once
 * the dashboard takes sdk-core 0.1.1 from npm, this file goes and the import
 * comes from `@zunialab/sdk-core`.
 */

/** `features` strings the extension reports from 0.1.5. */
export const ZUNIA_SIGNING_FEATURES = {
  /** Direct mode decodes `MsgExecuteContract` to 32-byte contracts. */
  directContractCalls: "sign-direct:wasm-contract-32",
  /** Direct mode decodes `MsgSend` to a 32-byte address (a contract, an interchain account). */
  directSends32: "sign-direct:send-32",
  /** Direct mode decodes Osmosis poolmanager swaps (single and split routes). */
  directPoolmanager: "sign-direct:osmosis-poolmanager",
  /** Direct mode decodes Osmosis exact-out swaps (single and split routes). */
  directExactOut: "sign-direct:osmosis-exact-out",
  /** Amino sign bytes escape `&`, `<`, `>`, U+2028 and U+2029 as the chain does. */
  aminoEscaping: "sign-amino:escaped",
  /** Amino mode describes Osmosis poolmanager swaps instead of refusing them. */
  aminoPoolmanager: "sign-amino:osmosis-poolmanager",
} as const;

export interface ZuniaCapabilities {
  /** The extension's version when it reports one (0.1.5+). Null for 0.1.0 to 0.1.4, which cannot be told apart. */
  extensionVersion: string | null;
  directContractCalls: boolean;
  directSends32: boolean;
  /** Null when unknown: 0.1.3 cannot, 0.1.4 can, and both report the same version. */
  directPoolmanager: boolean | null;
  directExactOut: boolean;
  aminoEscaping: boolean;
  /** Optional in 0.1.5, so only `features` reports it. */
  aminoPoolmanager: boolean;
}

/** The provider fields this reads (`ExtensionProvider` has them). Read from a page object, so checked at runtime too. */
export interface ZuniaProviderIdentity {
  readonly version?: string;
  readonly extensionVersion?: string;
  readonly features?: readonly string[];
}

const FIXED_IN: readonly [number, number, number] = [0, 1, 5];

function parseVersion(value: unknown): [number, number, number] | null {
  if (typeof value !== "string") return null;
  const match = /^(\d+)\.(\d+)\.(\d+)/.exec(value.trim());
  return match ? [Number(match[1]), Number(match[2]), Number(match[3])] : null;
}

function atLeast(version: readonly number[], floor: readonly number[]): boolean {
  for (let i = 0; i < 3; i++) {
    const a = version[i] ?? 0;
    const b = floor[i] ?? 0;
    if (a !== b) return a > b;
  }
  return true;
}

/** What the connected Zunia extension can sign, from what its provider reports. */
export function zuniaCapabilities(provider: ZuniaProviderIdentity | null | undefined): ZuniaCapabilities {
  const api = parseVersion(provider?.version);
  // 0.1.5 reports "" when it cannot read its manifest: no version, its features still count.
  const reported = typeof provider?.extensionVersion === "string" ? provider.extensionVersion.trim() || null : null;
  // Every build before 0.1.5 answers the API version "0.1.0"; only a higher one is a release.
  const extensionVersion = reported ?? (api && atLeast(api, [0, 1, 1]) ? (provider?.version ?? null) : null);
  const parsed = parseVersion(extensionVersion);
  const fixed = parsed !== null && atLeast(parsed, FIXED_IN);
  const features = Array.isArray(provider?.features) ? provider.features : null;
  const has = (feature: string): boolean => (features ? features.includes(feature) : fixed);
  return {
    extensionVersion,
    directContractCalls: has(ZUNIA_SIGNING_FEATURES.directContractCalls),
    directSends32: has(ZUNIA_SIGNING_FEATURES.directSends32),
    directPoolmanager: features || fixed ? has(ZUNIA_SIGNING_FEATURES.directPoolmanager) : null,
    directExactOut: has(ZUNIA_SIGNING_FEATURES.directExactOut),
    aminoEscaping: has(ZUNIA_SIGNING_FEATURES.aminoEscaping),
    aminoPoolmanager: features?.includes(ZUNIA_SIGNING_FEATURES.aminoPoolmanager) ?? false,
  };
}
