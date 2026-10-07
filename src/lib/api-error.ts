/**
 * How a failed read of the dashboard's own `/api/*` routes is described.
 *
 * About twenty cards print `error.message` in their inline error, so the
 * message is written for the person reading the page. Before, a parse failure
 * said "Response was not JSON" and a dropped connection said whatever the
 * browser says ("Failed to fetch" in Chrome, "Load failed" in Safari). The
 * routes' own messages (an HTTP error with a JSON body) are already written
 * for users and are kept; only what the browser or the parser produced is
 * replaced, and its raw text stays in `detail` for the console and debugging.
 *
 * No trailing full stop: several cards append their own sentence after the
 * message ("… The node may be busy"), as they do after the routes' messages.
 *
 * Pure (no "use client"): the hooks share it, and tests import it.
 */

export interface ApiError {
  kind: "http" | "network" | "parse";
  /** Present when a response arrived. */
  status?: number;
  /** Server-provided error code (`error` field of the JSON body), if any. */
  code?: string;
  /** For the page: the route's own message, or one of {@link API_ERROR_TEXT}. */
  message: string;
  /** The raw text behind a client-side failure (the browser's or the parser's words). Never shown. */
  detail?: string;
}

export const API_ERROR_TEXT = {
  /** The request never got an answer: offline, DNS, CORS, a dropped connection. */
  network: "Couldn't reach Zunia's server — check your connection",
  /** An answer arrived but was not JSON (an HTML error page from a proxy, a cut-off body). */
  parse: "Zunia's server sent an answer that couldn't be read",
  /** JSON arrived but not in the shape the page expects (a deploy mid-way, a proxy's JSON). */
  shape: "Zunia's server sent an answer this page couldn't use",
} as const;

/** An HTTP failure whose body carried no message of its own. */
export function httpErrorText(status: number): string {
  return `Zunia's server returned an error (HTTP ${status})`;
}

function rawText(error: unknown): string | undefined {
  if (error instanceof Error) return error.message || error.name;
  return typeof error === "string" ? error : undefined;
}

/** A request that never got an answer. */
export function networkError(error: unknown): ApiError {
  const detail = rawText(error);
  return { kind: "network", message: API_ERROR_TEXT.network, ...(detail ? { detail } : {}) };
}

/** An answer that was not JSON. */
export function parseError(error?: unknown): ApiError {
  const detail = rawText(error);
  return { kind: "parse", message: API_ERROR_TEXT.parse, ...(detail ? { detail } : {}) };
}

/** JSON in a shape the page cannot use. */
export function shapeError(): ApiError {
  return { kind: "parse", message: API_ERROR_TEXT.shape };
}

/** Longest route message shown as is; anything longer is not a sentence for the page. */
const MAX_ROUTE_MESSAGE = 400;

/** A non-2xx answer: the route's own message and code when its body has them. */
export async function readApiError(response: Response): Promise<ApiError> {
  let code: string | undefined;
  let message = httpErrorText(response.status);
  try {
    const body = (await response.json()) as { error?: unknown; message?: unknown };
    if (typeof body.error === "string") code = body.error;
    if (typeof body.message === "string" && body.message.length > 0 && body.message.length < MAX_ROUTE_MESSAGE) {
      message = body.message;
    }
  } catch {
    /* not JSON: the plain sentence stays */
  }
  return { kind: "http", status: response.status, ...(code ? { code } : {}), message };
}
