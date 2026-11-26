/**
 * The site's Proxy: one line in the app's `proxy.ts` hands every matched
 * request to the handlers plugins contribute (`contributes.proxy`), before the
 * page is served.
 *
 * ```ts
 * // src/proxy.ts
 * import { createNextlyProxy } from "nextly/runtime";
 * import nextlyConfig from "../nextly.config";
 *
 * export const proxy = createNextlyProxy(nextlyConfig);
 * export const config = { matcher: ["/((?!_next/static|_next/image).*)"] };
 * ```
 *
 * It imports only the handler registry and the Next.js loader at load, and
 * starts Nextly on the first request that needs it, so a site whose plugins
 * contribute no handler does nothing more than ask whether any exist. A
 * request only a handler can answer (`claims`) waits for that start, up to a
 * limit; every other request goes on to its page at once.
 *
 * @module runtime/proxy
 * @experimental
 */
import type { SanitizedNextlyConfig } from "../collections/config/define-config";
import { NextlyError } from "../errors/nextly-error";
import {
  answerProxyRequest,
  hasProxyHandlers,
  proxyHandlersReady,
  type CombinedProxyAnswer,
} from "../plugins/proxy/proxy-registry";
import type { PluginProxyHandler } from "../plugins/proxy/proxy-types";

import { loadNextModule, requireNextApi } from "./next-api";

/** What `NextResponse.next` is called with, as far as this module uses it. */
type NextResponseNext = (init?: { request?: { headers: Headers } }) => Response;

/**
 * @experimental What Next.js hands the Proxy beside the request, as far as
 * this module uses it: on a serverless platform, `waitUntil` keeps the
 * function running for work still under way once the request is answered.
 */
export interface NextlyProxyEvent {
  waitUntil?(promise: Promise<unknown>): void;
}

/**
 * How long a request only a handler can answer waits for a start under way.
 * A cold start against a near database takes a few seconds; one still under
 * way past this is answered "try again" rather than held further.
 */
const START_WAIT_MS = 10_000;

/** What the Proxy is given to reach Next.js and start Nextly; tests replace both. */
export interface NextlyProxyDeps {
  /** `NextResponse.next` from `next/server`. */
  next: () => NextResponseNext;
  /** Start Nextly (or find it started) with the site's config. */
  start: (config: SanitizedNextlyConfig) => Promise<unknown>;
}

const defaultDeps: NextlyProxyDeps = {
  next: () => {
    const mod = loadNextModule("next/server");
    if (!mod) {
      // Outside a Next.js app there is no request to continue: refused, as
      // the not-found helper refuses, rather than pretending to have served.
      throw NextlyError.internal({
        logContext: {
          reason:
            "createNextlyProxy requires next/server (use it in a Next.js app)",
        },
      });
    }
    const nextResponse = (mod.NextResponse ?? {}) as Record<string, unknown>;
    return requireNextApi<NextResponseNext>(
      nextResponse,
      "next/server",
      "next"
    ).bind(nextResponse);
  },
  start: async config => {
    // Loaded when first asked, so importing this module does not load the
    // whole start-up graph with it.
    const { getNextly } = await import("../init");
    return getNextly({ config });
  },
};

/** `response` with `headers` set on it, copied where its own are frozen. */
function withHeaders(
  response: Response,
  headers: Record<string, string>
): Response {
  if (Object.keys(headers).length === 0) return response;
  // `Response.redirect` and fetched responses have immutable headers, so the
  // answer is rebuilt around the same body and status.
  const copy = new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers: new Headers(response.headers),
  });
  for (const [name, value] of Object.entries(headers)) {
    copy.headers.set(name, value);
  }
  return copy;
}

/**
 * Whether some enabled plugin's handler claims `request`, asked before the
 * start, so read from the config rather than the registry the start fills.
 * A claim that throws claims nothing: the Proxy never takes the site down.
 */
function claimedBeforeStart(
  config: SanitizedNextlyConfig,
  request: Request
): boolean {
  return (config.plugins ?? [])
    .filter(plugin => plugin.enabled !== false)
    .flatMap(plugin => plugin.contributes?.proxy ?? [])
    .some(handler => claimsSafely(handler, request));
}

/** Whether `handler` claims `request`, a claim that throws claiming nothing. */
function claimsSafely(handler: PluginProxyHandler, request: Request): boolean {
  try {
    return handler.claims?.(request) === true;
  } catch {
    return false;
  }
}

/** How a start came out within the wait: finished, failed, or still under way. */
type StartOutcome = "started" | "failed" | "waiting";

/** What `start` came to within `ms`, the timer cleared either way. */
async function startWithin(
  start: Promise<unknown>,
  ms: number
): Promise<StartOutcome> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const limit = new Promise<StartOutcome>(resolve => {
    timer = setTimeout(resolve, ms, "waiting");
  });
  try {
    return await Promise.race([
      start.then(
        (): StartOutcome => "started",
        (): StartOutcome => "failed"
      ),
      limit,
    ]);
  } finally {
    clearTimeout(timer);
  }
}

/**
 * The answer to a request only a handler can answer, while the start that
 * brings the handler is still under way: the page would answer not found,
 * which a reader may keep, so it is asked to come back instead.
 */
function stillStarting(): Response {
  return new Response("The site is starting. Try again shortly.", {
    status: 503,
    headers: { "cache-control": "no-store", "retry-after": "30" },
  });
}

/**
 * What a request that finds the handlers not ready is answered with, or
 * `"started"` where it waited and the start has made them ready.
 */
async function beforeStart(
  config: SanitizedNextlyConfig,
  request: Request,
  event: NextlyProxyEvent | undefined,
  deps: NextlyProxyDeps
): Promise<Response | undefined | "started"> {
  // The handlers come with the start, which is begun or joined here. A start
  // that fails is reported by the page's own read; the Proxy only stands
  // aside.
  const start = deps.start(config);
  const settled = start.catch(() => undefined);
  // Never waited for on a request a page can answer: holding it would hold
  // every page and file the Proxy matches, the prebuilt admin among them,
  // for the whole start (over a minute against a far database). It goes
  // through as the page alone, and the handlers apply from the first request
  // after the start finishes. On a serverless platform the start is kept
  // running past the answer, or the function could be frozen with it half
  // done and every cold request would begin it again.
  if (!claimedBeforeStart(config, request)) {
    event?.waitUntil?.(settled);
    return undefined;
  }
  // A request only a handler can answer, such as a page's plain-text copy:
  // the page would answer not found, so it waits for the start.
  const outcome = await startWithin(start, START_WAIT_MS);
  if (outcome === "waiting") {
    event?.waitUntil?.(settled);
    return stillStarting();
  }
  return outcome === "started" && proxyHandlersReady() ? "started" : undefined;
}

/** Continue to the page with what the handlers asked for, or nothing at all. */
function continueWith(
  request: Request,
  answer: CombinedProxyAnswer,
  deps: NextlyProxyDeps
): Response | undefined {
  const requestHeaders = Object.entries(answer.requestHeaders);
  const headers = Object.entries(answer.headers);
  if (requestHeaders.length === 0 && headers.length === 0) return undefined;
  const next = deps.next();
  let response: Response;
  if (requestHeaders.length > 0) {
    // Next.js replaces the request's headers with the set it is handed, so
    // the request's own are carried over beside the added ones.
    const forwarded = new Headers(request.headers);
    for (const [name, value] of requestHeaders) forwarded.set(name, value);
    response = next({ request: { headers: forwarded } });
  } else {
    response = next();
  }
  for (const [name, value] of headers) response.headers.set(name, value);
  return response;
}

/**
 * @experimental The Proxy function for the app's `proxy.ts`: asks every
 * plugin's proxy handlers about each request and answers, adds headers, or
 * lets the request through untouched (`undefined`). A start that fails, or
 * no handler at all, lets every request through, so the Proxy never takes
 * the site down. Next.js's `event` is optional: where it has `waitUntil`, a
 * start the request does not wait for is kept running after the answer.
 */
export function createNextlyProxy(
  config: SanitizedNextlyConfig,
  deps: NextlyProxyDeps = defaultDeps
): (
  request: Request,
  event?: NextlyProxyEvent
) => Promise<Response | undefined> {
  return async (request, event) => {
    if (!proxyHandlersReady()) {
      const early = await beforeStart(config, request, event, deps);
      if (early !== "started") return early;
    }
    if (!hasProxyHandlers()) return undefined;
    const answer = await answerProxyRequest(request);
    if (answer.response !== undefined) {
      return withHeaders(answer.response, answer.headers);
    }
    return continueWith(request, answer, deps);
  };
}
