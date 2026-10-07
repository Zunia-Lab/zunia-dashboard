/**
 * Byte helpers for transaction encoding (no wallet kernel, no Node Buffer:
 * this runs in the browser and in `node --test` alike).
 */

export function toBase64(bytes: Uint8Array): string {
  let binary = "";
  for (const b of bytes) binary += String.fromCharCode(b);
  return btoa(binary);
}

export function fromBase64(value: string): Uint8Array {
  const binary = atob(value);
  const out = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) out[i] = binary.charCodeAt(i);
  return out;
}

export function toHex(bytes: Uint8Array): string {
  let out = "";
  for (const b of bytes) out += b.toString(16).padStart(2, "0");
  return out;
}

export function fromHex(value: string): Uint8Array {
  const clean = value.trim().toLowerCase();
  if (clean.length % 2 !== 0 || !/^[0-9a-f]*$/.test(clean)) {
    throw new Error("Not a hex string");
  }
  const out = new Uint8Array(clean.length / 2);
  for (let i = 0; i < out.length; i++) out[i] = parseInt(clean.slice(i * 2, i * 2 + 2), 16);
  return out;
}

export function bytesEqual(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
  return true;
}

/**
 * Bytes out of whatever a wallet handed back.
 *
 * Extensions answer across `postMessage`, which turns a `Uint8Array` into a
 * plain array or an index-keyed object depending on the wallet; the SDK
 * normalises its own transports but not a raw `window.keplr`. Anything else is
 * a broken answer, and guessing at it would mean broadcasting bytes nobody
 * signed.
 */
export function asBytes(value: unknown, what: string): Uint8Array {
  if (value instanceof Uint8Array) return value;
  if (Array.isArray(value) && value.every((n) => Number.isInteger(n) && n >= 0 && n <= 255)) {
    return Uint8Array.from(value as number[]);
  }
  if (typeof value === "string") return fromBase64(value);
  if (value && typeof value === "object") {
    const record = value as Record<string, unknown>;
    const keys = Object.keys(record);
    if (keys.length > 0 && keys.every((k, i) => k === String(i))) {
      const out = new Uint8Array(keys.length);
      for (let i = 0; i < keys.length; i++) {
        const n = record[String(i)];
        if (typeof n !== "number" || !Number.isInteger(n) || n < 0 || n > 255) {
          throw new Error(`The wallet returned unreadable ${what}`);
        }
        out[i] = n;
      }
      return out;
    }
  }
  throw new Error(`The wallet returned unreadable ${what}`);
}

/** What Go's JSON encoder escapes in a string, and how it writes each one. */
const GO_ESCAPES: Readonly<Record<string, string>> = {
  "&": "\\u0026",
  "<": "\\u003c",
  ">": "\\u003e",
  "\u2028": "\\u2028",
  "\u2029": "\\u2029",
};

/**
 * Amino sign bytes as the chain rebuilds them (the A1 rule every Zunia
 * serializer follows): keys sorted at every level, compact JSON, `&`, `<`,
 * `>` written `\u0026`, `\u003c`, `\u003e` and U+2028, U+2029 written
 * `\u2028`, `\u2029`, encoded as UTF-8. That is what Go's `json.Marshal`
 * writes when the chain rebuilds the document (Cosmos SDK x/tx aminojson).
 * CosmJS `serializeSignDoc`, Keplr and Zunia Mobile escape only the first
 * three, so a document holding U+2028 or U+2029 gets a signature from them
 * that the chain refuses: the memo field refuses both (`memoProblem` in
 * `./flow`). The Zunia extension up to 0.1.4 escapes none of the five,
 * which is why the sign-mode policy keeps it off amino for such documents
 * (`aminoNeedsEscaping`). The escapes only ever appear inside strings: none
 * of the five characters can appear in JSON outside one.
 */
export function serializeAminoSignDoc(value: unknown): Uint8Array {
  const json = JSON.stringify(sortKeysDeep(value)).replace(/[&<>\u2028\u2029]/g, (char) => GO_ESCAPES[char] ?? char);
  return new TextEncoder().encode(json);
}

/** Exported so the wasm execute body is serialised the same way the sign doc is. */
export function sortKeysDeep(value: unknown): unknown {
  if (value === null || typeof value !== "object") return value;
  if (Array.isArray(value)) return value.map(sortKeysDeep);
  const obj = value as Record<string, unknown>;
  const sorted: Record<string, unknown> = {};
  for (const key of Object.keys(obj).sort()) {
    // JSON.stringify drops undefined members; dropping them here keeps the
    // canonical form and a deep comparison of two documents in agreement.
    if (obj[key] === undefined) continue;
    sorted[key] = sortKeysDeep(obj[key]);
  }
  return sorted;
}

/** Canonical JSON of a value, for comparing two amino documents. */
export function canonicalJson(value: unknown): string {
  return JSON.stringify(sortKeysDeep(value));
}
