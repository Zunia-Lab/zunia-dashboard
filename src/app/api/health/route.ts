/**
 * `GET /api/health` — can this deployment serve its pages, and how are the
 * services those pages read doing?
 *
 * The status code is what an uptime monitor (Uptime Kuma) alerts on, so it
 * answers one question only: is the app up?
 *
 * - **200** while this process can serve pages, whatever its upstreams are
 *   doing. A slow or unreachable public node, or Numia, makes pages slower or
 *   partial, not unavailable (each card already says which read failed), and
 *   the old rule (503 when Safrochain's node missed a 5 s read) turned every
 *   hiccup of a node Zunia does not run into "the site is down": under load
 *   the monitor flapped.
 * - **503** only when this deployment cannot do its job whatever the
 *   upstreams do: today, a build whose chain catalog has no REST endpoint
 *   for the home chain (`checks.app`), so no chain read can even start.
 *   A crash is Next's own 500.
 *
 * The body says the rest:
 *
 * - `ok`: true on 200. `status`: `"ok"` (every check answered well),
 *   `"degraded"` (serving, but a check is slow, stalled or down) or `"down"`
 *   (the 503). `degraded` is `status === "degraded"`, kept for monitors that
 *   already read it.
 * - `checks.lcd`: Safrochain's public node, the home chain every page reads.
 *   `checks.numia`: the price source (prices fall back when it is down).
 *   Each has `ok` (it answered usably), `status` (`"ok"`, `"slow"` past
 *   {@link SLOW_AFTER_MS}, `"stalled"` for a node whose latest block is older
 *   than {@link STALL_AFTER_SEC}, or `"down"` with a `reason` code) and
 *   `latencyMs`.
 * - `updatedAt`: when the upstream checks ran.
 *
 * The checks run at most once per {@link CHECKS_TTL_MS} for the whole process,
 * so probing this route cannot be turned into a flood against the upstreams,
 * and a caller never waits long on them: a refresh that finishes within
 * {@link ANSWER_BUDGET_MS} is answered fresh, a slower one answers with the
 * last finished checks (see `updatedAt`) while it completes behind. Only the
 * first call after a start or a quiet spell ({@link MAX_STALE_MS}) waits for
 * the checks, bounded by their timeout.
 *
 * `?live=1` answers from the process alone (no upstream reads): the liveness
 * probe for a deploy script, which must not roll back a good release because
 * a public node is slow.
 *
 * Monitors: an HTTP monitor on this URL (accepted status 200-299) is the
 * uptime alert. A keyword monitor for `"status":"ok"` on the same URL, if
 * wanted, reports upstream trouble without calling it an outage.
 *
 * No internals: no store types, queues, wallet counts, hosts or upstream
 * bodies.
 */

import { restOf } from "@/lib/server/chains";
import { fetchJson, UpstreamError } from "@/lib/server/http";
import pkg from "../../../../package.json";

const SERVICE = "zunia-dashboard";
const LCD_CHAIN_ID = "safrochain-1";
const CHECK_TIMEOUT_MS = 5_000;
/** Answered, but slow enough that pages reading it feel it. Public nodes usually answer in under a second. */
const SLOW_AFTER_MS = 2_000;
const NUMIA_PROBE = "https://public-osmosis-api.numia.xyz/tokens/v2/OSMO";
/** Safrochain makes a block every ~5 s; two minutes without one is a halt, not jitter. */
const STALL_AFTER_SEC = 120;
/** How long one round of checks is reused. */
const CHECKS_TTL_MS = 10_000;
/** The longest a caller waits for a refresh before it gets the last finished checks. */
const ANSWER_BUDGET_MS = 2_500;
/**
 * Older than this, the last round is no answer at all (after a quiet night it
 * would describe the evening), so the caller waits for the running round,
 * which its checks' own timeout bounds. A monitor polling every minute never
 * gets here.
 */
const MAX_STALE_MS = 5 * 60_000;

type CheckStatus = "ok" | "slow" | "stalled" | "down";
/** Why a check is down, as a code: never an upstream's own words or host. */
type DownReason = "timeout" | "unreachable" | "http-error" | "unreadable" | "bad-answer" | "no-endpoint";

interface LcdCheck {
  ok: boolean;
  status: CheckStatus;
  chainId: string;
  latencyMs: number | null;
  height?: number;
  /** Seconds since the latest block: a stalled chain is visible even when the node answers. */
  blockAgeSec?: number;
  /** The latest block is older than {@link STALL_AFTER_SEC}. */
  stalled?: boolean;
  reason?: DownReason;
}

interface NumiaCheck {
  ok: boolean;
  status: CheckStatus;
  latencyMs: number | null;
  reason?: DownReason;
}

interface Checks {
  lcd: LcdCheck;
  numia: NumiaCheck;
  at: number;
}

/**
 * Not queued behind the pages' own reads of the same host (`fetchJson` caps
 * requests per host): under load that queue is this server's congestion, not
 * the upstream's health, and waiting in it is what made the old check time
 * out. The checks are one request per host per {@link CHECKS_TTL_MS} for the
 * whole process, so skipping the cap cannot crowd the node.
 */
const PROBE = { timeoutMs: CHECK_TIMEOUT_MS, hostConcurrency: Number.POSITIVE_INFINITY } as const;

function downReason(error: unknown): DownReason {
  if (!(error instanceof UpstreamError)) return "unreachable";
  switch (error.kind) {
    case "timeout":
      return "timeout";
    case "http":
      return "http-error";
    case "parse":
      return "unreadable";
    default:
      return "unreachable";
  }
}

function since(started: number): number {
  return Math.round(performance.now() - started);
}

async function checkLcd(): Promise<LcdCheck> {
  const rest = restOf(LCD_CHAIN_ID);
  if (!rest) return { ok: false, status: "down", chainId: LCD_CHAIN_ID, latencyMs: null, reason: "no-endpoint" };
  const started = performance.now();
  try {
    const body = await fetchJson<{ height?: unknown; timestamp?: unknown }>(`${rest}/cosmos/base/node/v1beta1/status`, PROBE);
    const latencyMs = since(started);
    const height = typeof body.height === "string" && /^\d+$/.test(body.height) ? Number(body.height) : null;
    const time = typeof body.timestamp === "string" ? Date.parse(body.timestamp) : Number.NaN;
    if (height === null) return { ok: false, status: "down", chainId: LCD_CHAIN_ID, latencyMs, reason: "bad-answer" };
    const blockAgeSec = Number.isFinite(time) ? Math.max(0, Math.round((Date.now() - time) / 1000)) : null;
    const stalled = blockAgeSec !== null && blockAgeSec > STALL_AFTER_SEC;
    return {
      ok: true,
      status: stalled ? "stalled" : latencyMs > SLOW_AFTER_MS ? "slow" : "ok",
      chainId: LCD_CHAIN_ID,
      latencyMs,
      height,
      ...(blockAgeSec !== null ? { blockAgeSec, stalled } : {}),
    };
  } catch (error) {
    return { ok: false, status: "down", chainId: LCD_CHAIN_ID, latencyMs: null, reason: downReason(error) };
  }
}

async function checkNumia(): Promise<NumiaCheck> {
  const started = performance.now();
  try {
    const body = await fetchJson<unknown>(NUMIA_PROBE, PROBE);
    const latencyMs = since(started);
    if (!Array.isArray(body) || body.length === 0) return { ok: false, status: "down", latencyMs, reason: "bad-answer" };
    return { ok: true, status: latencyMs > SLOW_AFTER_MS ? "slow" : "ok", latencyMs };
  } catch (error) {
    return { ok: false, status: "down", latencyMs: null, reason: downReason(error) };
  }
}

interface CheckState {
  last: Checks | null;
  running: Promise<Checks> | null;
}

/** On `globalThis`, like the read cache, so Next's dev HMR does not reset it on every edit. */
const STATE_KEY = "__zuniaHealthChecks";

function checkState(): CheckState {
  const g = globalThis as unknown as Record<string, CheckState | undefined>;
  return (g[STATE_KEY] ??= { last: null, running: null });
}

/**
 * The checks to answer with: this round's when it is fresh or finishes within
 * the budget, otherwise the last finished round (if recent) while this one
 * completes. One round at a time for the whole process (single flight).
 * Never rejects: each check catches its own failure.
 */
async function latestChecks(): Promise<Checks> {
  const state = checkState();
  if (state.last && Date.now() - state.last.at < CHECKS_TTL_MS) return state.last;
  const running = (state.running ??= Promise.all([checkLcd(), checkNumia()])
    .then(([lcd, numia]) => {
      const checks = { lcd, numia, at: Date.now() };
      state.last = checks;
      return checks;
    })
    .finally(() => {
      state.running = null;
    }));
  const fallback = state.last && Date.now() - state.last.at < MAX_STALE_MS ? state.last : null;
  if (!fallback) return running;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const budget = new Promise<null>((resolve) => {
    timer = setTimeout(() => resolve(null), ANSWER_BUDGET_MS);
  });
  try {
    return (await Promise.race([running, budget])) ?? fallback;
  } finally {
    clearTimeout(timer);
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

  // What this deployment needs whatever the upstreams do. Today one thing:
  // an endpoint for the home chain in the build's own catalog.
  const serving = restOf(LCD_CHAIN_ID) !== null;
  const checks = await latestChecks();
  const status = !serving ? "down" : checks.lcd.status === "ok" && checks.numia.status === "ok" ? "ok" : "degraded";
  return Response.json(
    {
      ok: serving,
      status,
      degraded: status === "degraded",
      ...base,
      checks: {
        app: serving ? { ok: true, status: "ok" } : { ok: false, status: "down", reason: "no-endpoint" },
        lcd: checks.lcd,
        numia: checks.numia,
      },
      updatedAt: checks.at,
    },
    { status: serving ? 200 : 503, headers },
  );
}
