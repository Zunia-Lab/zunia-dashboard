/**
 * Reading what an LCD says about an `ibc/` voucher. Pure, so the shapes are
 * tested; `trace-resolver.ts` does the reads.
 */

export interface Trace {
  path: string;
  baseDenom: string;
}

type Fields = Record<string, unknown>;

function asRecord(value: unknown): Fields | null {
  return typeof value === "object" && value !== null && !Array.isArray(value) ? (value as Fields) : null;
}

function str(record: Fields | null, key: string): string | null {
  const value = record?.[key];
  return typeof value === "string" ? value : null;
}

/**
 * The three shapes LCDs answer with: `{denom_trace:{path,base_denom}}`, the
 * same unwrapped, and ibc-go v9's `{denom:{base,trace:[{port_id,channel_id}]}}`.
 * Null when none matches: an endpoint that answers "I don't know this hash"
 * with an empty body must not be mistaken for a native denom.
 */
export function parseTraceBody(body: unknown): Trace | null {
  const root = asRecord(body);
  if (!root) return null;
  const wrapped = asRecord(root["denom_trace"]);
  const flat = wrapped ?? (root["base_denom"] !== undefined ? root : null);
  if (flat) {
    const baseDenom = (str(flat, "base_denom") ?? "").trim();
    const rawPath = flat["path"];
    if (!baseDenom || (rawPath !== undefined && typeof rawPath !== "string")) return null;
    return { path: (typeof rawPath === "string" ? rawPath : "").replace(/^\/+|\/+$/g, ""), baseDenom };
  }
  const v9 = asRecord(root["denom"]);
  if (v9) {
    const baseDenom = (str(v9, "base") ?? "").trim();
    if (!baseDenom) return null;
    const rawTrace = v9["trace"];
    if (rawTrace !== undefined && rawTrace !== null && !Array.isArray(rawTrace)) return null;
    const parts: string[] = [];
    for (const raw of Array.isArray(rawTrace) ? rawTrace : []) {
      const hop = asRecord(raw);
      const port = str(hop, "port_id");
      const channel = str(hop, "channel_id");
      if (!port || !channel) return null;
      parts.push(port, channel);
    }
    return { path: parts.join("/"), baseDenom };
  }
  return null;
}

/**
 * gRPC "unimplemented" answered with HTTP 200, as some gateways do (Cosmos
 * Hub's public LCDs retired `/denom_traces` that way).
 */
export function traceUnimplemented(body: unknown): boolean {
  const root = asRecord(body);
  if (!root) return false;
  if (root["code"] === 12 || root["code"] === "12") return true;
  return /not implemented/i.test(str(root, "message") ?? "");
}

/**
 * The chain id a channel's light client tracks, from
 * `/ibc/core/channel/v1/channels/{ch}/ports/{port}/client_state`.
 */
export function readClientChainId(body: unknown): string | null {
  const state = asRecord(asRecord(asRecord(body)?.["identified_client_state"])?.["client_state"]);
  const id = str(state, "chain_id");
  return id && id.length <= 64 && /^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(id) ? id : null;
}
