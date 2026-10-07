/**
 * `GET /api/health` — is this deployment able to serve its pages?
 *
 * - `lcd` (critical): a sample read of Safrochain's public node, the home
 *   chain every page reads. It failing answers 503, so a monitor (Uptime
 *   Kuma) and the deploy gate see a real outage instead of the old stub's
 *   permanent `ok: true`.
 * - `numia` (not critical): the price source; when it is down prices degrade
 *   to the fallbacks, so it sets `degraded` but not 503.
 * - A Safrochain node that answers but whose latest block is older than
 *   `STALL_AFTER_SEC` also sets `degraded` (`checks.lcd.stalled`): pages
 *   still render, but nothing new confirms.
 *
 * `?live=1` answers from the process alone (no upstream reads): the liveness
 * probe for a deploy script, which must not roll back a good release because a
 * public node is slow.
 *
 * No internals: no store types, queues, wallet counts or upstream bodies.
 * Results are shared for 10 s, so probing this route cannot be turned into a
 * flood against the upstreams.
 */

import { cached } from "@/lib/server/cache";
import { restOf } from "@/lib/server/chains";
import { fetchJson } from "@/lib/server/http";
import pkg from "../../../../package.json";

const SERVICE = "zunia-dashboard";
const LCD_CHAIN_ID = "safrochain-1";
const CHECK_TIMEOUT_MS = 5_000;
const NUMIA_PROBE = "https://public-osmosis-api.numia.xyz/tokens/v2/OSMO";
/** Safrochain makes a block every ~5 s; two minutes without one is a halt, not jitter. */
const STALL_AFTER_SEC = 120;

interface LcdCheck {
  ok: boolean;
  chainId: string;
  latencyMs: number | null;
  height?: number;
  /** Seconds since the latest block: a stalled chain is visible even when the node answers. */
  blockAgeSec?: number;
  /** The latest block is older than {@link STALL_AFTER_SEC}. */
  stalled?: boolean;
}

interface NumiaCheck {
  ok: boolean;
  latencyMs: number | null;
}

async function checkLcd(): Promise<LcdCheck> {
  const rest = restOf(LCD_CHAIN_ID);
  if (!rest) return { ok: false, chainId: LCD_CHAIN_ID, latencyMs: null };
  const started = performance.now();
  try {
    const body = await fetchJson<{ height?: unknown; timestamp?: unknown }>(`${rest}/cosmos/base/node/v1beta1/status`, {
      timeoutMs: CHECK_TIMEOUT_MS,
    });
    const latencyMs = Math.round(performance.now() - started);
    const height = typeof body.height === "string" && /^\d+$/.test(body.height) ? Number(body.height) : null;
    const time = typeof body.timestamp === "string" ? Date.parse(body.timestamp) : Number.NaN;
    if (height === null) return { ok: false, chainId: LCD_CHAIN_ID, latencyMs };
    const blockAgeSec = Number.isFinite(time) ? Math.max(0, Math.round((Date.now() - time) / 1000)) : null;
    return {
      ok: true,
      chainId: LCD_CHAIN_ID,
      latencyMs,
      height,
      ...(blockAgeSec !== null ? { blockAgeSec, stalled: blockAgeSec > STALL_AFTER_SEC } : {}),
    };
  } catch {
    return { ok: false, chainId: LCD_CHAIN_ID, latencyMs: null };
  }
}

async function checkNumia(): Promise<NumiaCheck> {
  const started = performance.now();
  try {
    const body = await fetchJson<unknown>(NUMIA_PROBE, { timeoutMs: CHECK_TIMEOUT_MS });
    return { ok: Array.isArray(body) && body.length > 0, latencyMs: Math.round(performance.now() - started) };
  } catch {
    return { ok: false, latencyMs: null };
  }
}

export async function GET(req: Request) {
  const base = {
    service: SERVICE,
    version: pkg.version,
    uptimeSec: Math.round(process.uptime()),
  };
  const headers = { "cache-control": "no-store" };

  if (new URL(req.url).searchParams.get("live") === "1") {
    return Response.json({ ok: true, ...base, updatedAt: Date.now() }, { headers });
  }

  // Both checks catch their own failures, so this never rejects.
  const checks = await cached("health:checks", { ttlMs: 10_000, staleMs: 0 }, async () => {
    const [lcd, numia] = await Promise.all([checkLcd(), checkNumia()]);
    return { lcd, numia, at: Date.now() };
  });
  const ok = checks.lcd.ok;
  return Response.json(
    {
      ok,
      degraded: ok && (!checks.numia.ok || checks.lcd.stalled === true),
      ...base,
      checks: { lcd: checks.lcd, numia: checks.numia },
      updatedAt: checks.at,
    },
    { status: ok ? 200 : 503, headers },
  );
}
