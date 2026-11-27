/**
 * The site's Proxy: one line in the app's `proxy.ts` hands every matched
 * request to the handlers plugins contribute (`contributes.proxy`), before the
 * page is served.
 *
 * ```ts
 * // src/proxy.ts
 * import { composeProxy, createNextlyProxy } from "nextly/runtime";
 * import nextlyConfig from "../nextly.config";
 *
 * export const proxy = composeProxy(createNextlyProxy(nextlyConfig));
 * // Written out, as Next.js reads it at build time: `nextlyProxyMatcher`.
 * export const config = {
 *   matcher: [
 *     "/((?!_next/static|_next/image|admin(?:/|$)|.*\\.(?:js|mjs|cjs|css|map|png|jpe?g|gif|webp|avif|svg|ico|bmp|tiff?|woff2?|ttf|otf|eot|mp4|webm|ogg|mp3|wav|flac|m4a|mov)$).*)",
 *   ],
 * };
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
import { isVercelFunction } from "@nextlyhq/adapter-drizzle/serverless";
import type { PoolConfig, PoolStats } from "@nextlyhq/adapter-drizzle/types";

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
  /**
   * Start Nextly (or find it started) with the site's config, answering the
   * started instance, whose `adapter` the Proxy asks how many connections
   * its pool holds.
   */
  start: (config: SanitizedNextlyConfig) => Promise<unknown>;
  /**
   * Whether the Proxy runs in a serverless function of its own (Vercel's),
   * where it closes its connections before the function is suspended. Not
   * serverless where absent.
   */
  serverless?: () => boolean;
  /** Waits `ms`; a test gives a clock of its own. */
  sleep?: (ms: number) => Promise<void>;
}

/**
 * The database pool the Proxy starts Nextly with in a serverless function of
 * its own. On Vercel the Proxy is deployed as a function apart from the app's
 * and runs before every request it matches, so it scales with all of the
 * site's traffic rather than with the pages that read the database: a pool
 * of the app's size in each of its instances fills a small database's
 * connections. Its handlers read the database rarely (what they read is kept
 * in the process), so one connection, closed a second after its last use,
 * is enough.
 */
export const PROXY_DATABASE_POOL: Readonly<PoolConfig> = Object.freeze({
  max: 1,
  min: 0,
  idleTimeoutMs: 1000,
});

/**
 * How long, at most, a serverless Proxy keeps its function running after an
 * answer for its pool's connections to close: the idle timeout, and time for
 * work under way on the connection (a start's background reads) to end.
 */
const RELEASE_WAIT_MS = 5000;

/** How often a Proxy waiting for its connections to close looks again. */
const RELEASE_POLL_MS = 100;

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
    // In a serverless function of its own the Proxy's start takes the
    // smallest pool. Elsewhere it shares the app's process, and the app's
    // pool: a start already made there is found, not made again.
    return getNextly({
      config,
      ...(isVercelFunction() ? { databasePool: PROXY_DATABASE_POOL } : {}),
    });
  },
  serverless: () => isVercelFunction(),
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
  const unavailable = NextlyError.serviceUnavailable({
    publicMessage: "The site is starting. Try again shortly.",
  });
  return new Response(unavailable.publicMessage, {
    status: unavailable.statusCode,
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
  deps: NextlyProxyDeps,
  release: Release
): Promise<Response | undefined | "started"> {
  // The handlers come with the start, which is begun or joined here. A start
  // that fails is reported by the page's own read; the Proxy only stands
  // aside.
  const start = deps.start(config);
  // The instance it starts is kept, so its connections can be closed after
  // the answers that follow; once settled, they are closed after this one.
  const settled = start.then(
    instance => {
      release.started(instance);
      return release.afterStart();
    },
    () => undefined
  );
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

/** What the Proxy decided for one request, before it is made a response. */
type ProxyDecision =
  /** Answered by a handler: the page is not served. */
  | { kind: "answer"; response: Response }
  /** Served, with headers on the answer and on the request the page reads. */
  | {
      kind: "continue";
      headers: Record<string, string>;
      requestHeaders: Record<string, string>;
    }
  /** Served as it came. */
  | undefined;

/** Continue to the page with what the handlers asked for, or nothing at all. */
function continueWith(
  request: Request,
  decision: Exclude<ProxyDecision, { kind: "answer" } | undefined>,
  deps: NextlyProxyDeps
): Response {
  const requestHeaders = Object.entries(decision.requestHeaders);
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
  for (const [name, value] of Object.entries(decision.headers)) {
    response.headers.set(name, value);
  }
  return response;
}

/** The decision a handlers' combined answer comes to. */
function decisionOf(answer: CombinedProxyAnswer): ProxyDecision {
  if (answer.response !== undefined) {
    return {
      kind: "answer",
      response: withHeaders(answer.response, answer.headers),
    };
  }
  if (
    Object.keys(answer.headers).length === 0 &&
    Object.keys(answer.requestHeaders).length === 0
  ) {
    return undefined;
  }
  return {
    kind: "continue",
    headers: answer.headers,
    requestHeaders: answer.requestHeaders,
  };
}

/** The pool statistics of a started instance's adapter, where it has a pool. */
function poolStatsOf(instance: unknown): PoolStats | null {
  if (typeof instance !== "object" || instance === null) return null;
  const adapter: unknown = Reflect.get(instance, "adapter");
  if (typeof adapter !== "object" || adapter === null) return null;
  const stats: unknown = Reflect.get(adapter, "getPoolStats");
  if (typeof stats !== "function") return null;
  const answered: unknown = Reflect.apply(stats, adapter, []);
  return typeof answered === "object" && answered !== null
    ? (answered as PoolStats)
    : null;
}

/** Closing the Proxy's connections before a serverless function is suspended. */
interface Release {
  /** Note the instance a start made. */
  started(instance: unknown): void;
  /** What the function waits for once the start has settled. */
  afterStart(): Promise<void>;
  /** Keep the function running, through `event`, until the pool is empty. */
  after(event: NextlyProxyEvent | undefined): void;
}

/**
 * Where the Proxy runs in a serverless function of its own, the function is
 * kept running after each answer (`event.waitUntil`) until its pool's
 * connections have closed, up to {@link RELEASE_WAIT_MS}. A suspended
 * function runs no timers, so a connection left idle when it is suspended
 * would stay open until the database ends it: with many instances that holds
 * a small database's every connection. This does what `@vercel/functions`'
 * `attachDatabasePool` does, with the `event` Next.js hands the Proxy, so it
 * needs no package of the site's. One wait at a time, which every answer in
 * the meantime joins. Elsewhere it does nothing.
 */
function releaseFor(deps: NextlyProxyDeps): Release {
  const serverless = deps.serverless?.() === true;
  const sleep =
    deps.sleep ??
    ((ms: number) => new Promise<void>(resolve => setTimeout(resolve, ms)));
  let instance: unknown;
  let waiting: Promise<void> | undefined;

  /** Whether the pool still holds a connection, open or being opened. */
  const holds = (): boolean => (poolStatsOf(instance)?.total ?? 0) > 0;

  async function closed(): Promise<void> {
    const until = Date.now() + RELEASE_WAIT_MS;
    while (holds() && Date.now() < until) await sleep(RELEASE_POLL_MS);
  }

  function emptied(): Promise<void> {
    waiting ??= closed().finally(() => {
      waiting = undefined;
    });
    return waiting;
  }

  return {
    started(made) {
      instance = made;
    },
    afterStart: () => (serverless && holds() ? emptied() : Promise.resolve()),
    after(event) {
      if (!serverless || event?.waitUntil === undefined || !holds()) return;
      event.waitUntil(emptied());
    },
  };
}

/** How a Proxy `createNextlyProxy` made decides, and answers a decision. */
interface ProxyParts {
  decide(request: Request, event?: NextlyProxyEvent): Promise<ProxyDecision>;
  continueWith(
    request: Request,
    decision: Exclude<ProxyDecision, { kind: "answer" } | undefined>
  ): Response;
}

/** The parts of every Proxy `createNextlyProxy` made, for `composeProxy`. */
const proxyParts = new WeakMap<object, ProxyParts>();

/**
 * @experimental The function `createNextlyProxy` answers: the app's Proxy,
 * or Nextly's part of it inside {@link composeProxy}.
 */
export type NextlyProxy = (
  request: Request,
  event?: NextlyProxyEvent
) => Promise<Response | undefined>;

/**
 * @experimental The Proxy function for the app's `proxy.ts`: asks every
 * plugin's proxy handlers about each request and answers, adds headers, or
 * lets the request through untouched (`undefined`). A start that fails, or
 * no handler at all, lets every request through, so the Proxy never takes
 * the site down. Next.js's `event` is optional: where it has `waitUntil`, a
 * start the request does not wait for is kept running after the answer, and
 * in a serverless function the pool's connections are closed before the
 * function is suspended.
 */
export function createNextlyProxy(
  config: SanitizedNextlyConfig,
  deps: NextlyProxyDeps = defaultDeps
): NextlyProxy {
  const release = releaseFor(deps);

  async function decide(
    request: Request,
    event?: NextlyProxyEvent
  ): Promise<ProxyDecision> {
    if (!proxyHandlersReady()) {
      const early = await beforeStart(config, request, event, deps, release);
      if (early === undefined) return undefined;
      if (early !== "started") return { kind: "answer", response: early };
    }
    if (!hasProxyHandlers()) return undefined;
    const decision = decisionOf(await answerProxyRequest(request));
    // What the handlers read may have opened a connection: closed before
    // the function is suspended.
    release.after(event);
    return decision;
  }

  const proxy: NextlyProxy = async (request, event) => {
    const decision = await decide(request, event);
    if (decision === undefined) return undefined;
    if (decision.kind === "answer") return decision.response;
    return continueWith(request, decision, deps);
  };
  proxyParts.set(proxy, {
    decide,
    continueWith: (request, decision) => continueWith(request, decision, deps),
  });
  return proxy;
}

/**
 * The first path segments the Nextly Proxy never runs for: Next.js's built
 * files and image optimiser, and the admin, whose requests no proxy handler
 * answers. Each is a pattern for the matcher's look-ahead.
 */
const LEFT_OUT_PATHS = ["_next/static", "_next/image", "admin(?:/|$)"];

/**
 * The files a browser fetches for a page, never pages: scripts, styles,
 * images, fonts and media. `.md` and `.txt` are not among them, as a page's
 * plain-text copy and the IndexNow key are answered by the Proxy.
 */
const ASSET_FILES =
  ".*\\.(?:js|mjs|cjs|css|map|png|jpe?g|gif|webp|avif|svg|ico|bmp|tiff?|woff2?|ttf|otf|eot|mp4|webm|ogg|mp3|wav|flac|m4a|mov)$";

/** The look-ahead both the matcher and the Proxy's own check are built from. */
const LEFT_OUT = [...LEFT_OUT_PATHS, ASSET_FILES].join("|");

/**
 * @experimental The addresses the Nextly Proxy runs for, as the `matcher` of
 * the app's `proxy.ts` takes them: every address but Next.js's built files,
 * its image optimiser, the admin and static assets. Page addresses ending in
 * `.md` and the IndexNow key file (`/<key>.txt`) are included.
 *
 * Next.js reads `config.matcher` from `proxy.ts` when it builds, and only a
 * value written out there: an imported constant is refused. So `proxy.ts`
 * writes this pattern out, and this constant is what it is checked against.
 * A site that needs more addresses adds its own patterns beside it;
 * `composeProxy` asks Nextly only about the addresses this one matches.
 */
export const nextlyProxyMatcher: readonly string[] = Object.freeze([
  `/((?!${LEFT_OUT}).*)`,
]);

/** {@link nextlyProxyMatcher} as a regular expression over a request's path. */
const NEXTLY_PROXY_PATH = new RegExp(`^/(?!${LEFT_OUT}).*$`);

/** Whether `pathname` is one the Nextly Proxy runs for. */
export function nextlyProxyRunsFor(pathname: string): boolean {
  return NEXTLY_PROXY_PATH.test(pathname);
}

/** What a site's own Proxy answers, as Next.js takes it. */
type SiteProxyAnswer = Response | null | undefined | void;

/**
 * @experimental A site's own Proxy function, as `proxy.ts` would export it:
 * given the request Next.js hands it (a `NextRequest`) and the event.
 */
export type SiteProxy<
  R extends Request = Request,
  E extends NextlyProxyEvent = NextlyProxyEvent,
> = (request: R, event: E) => SiteProxyAnswer | Promise<SiteProxyAnswer>;

/** Next.js's response headers that say what to do with the request. */
const MIDDLEWARE_NEXT = "x-middleware-next";
const MIDDLEWARE_REWRITE = "x-middleware-rewrite";
const OVERRIDE_HEADERS = "x-middleware-override-headers";
const REQUEST_HEADER_PREFIX = "x-middleware-request-";

/**
 * `answered` with Nextly's `decision` added: each response header Nextly sets
 * that the site's answer does not, and, where the answer goes on to a page
 * (`NextResponse.next` or `rewrite`), each request header Nextly adds that
 * the site's does not. The site's own headers, its cookies among them, are
 * kept as the site set them.
 *
 * Request headers are written as `NextResponse.next({ request })` writes
 * them: the page's request takes exactly the headers the override list
 * names, so where the site's answer names none, the request's own are named
 * with Nextly's.
 */
function withNextlyDecision(
  answered: Response,
  request: Request,
  decision: Exclude<ProxyDecision, { kind: "answer" } | undefined>
): Response {
  const added: Record<string, string> = {};
  for (const [name, value] of Object.entries(decision.headers)) {
    if (!answered.headers.has(name)) added[name] = value;
  }
  const toPage =
    answered.headers.has(MIDDLEWARE_NEXT) ||
    answered.headers.has(MIDDLEWARE_REWRITE);
  if (toPage) {
    Object.assign(
      added,
      requestHeadersAdded(answered, request, decision.requestHeaders)
    );
  }
  return withHeaders(answered, added);
}

/**
 * The response headers that hand the page `asked` beside what `answered`
 * already hands it, as `NextResponse.next({ request })` encodes them: none
 * where Nextly asks for none.
 */
function requestHeadersAdded(
  answered: Response,
  request: Request,
  asked: Record<string, string>
): Record<string, string> {
  const entries = Object.entries(asked);
  if (entries.length === 0) return {};
  const added: Record<string, string> = {};
  const listed = answered.headers.get(OVERRIDE_HEADERS);
  // With no list of its own, the site's answer goes on with the request's
  // own headers, which the list must then name as well.
  const names =
    listed === null
      ? [...request.headers.keys()]
      : listed.split(",").filter(name => name !== "");
  if (listed === null) {
    for (const [name, value] of request.headers) {
      added[REQUEST_HEADER_PREFIX + name] = value;
    }
  }
  for (const [name, value] of entries) {
    if (names.includes(name)) continue;
    names.push(name);
    added[REQUEST_HEADER_PREFIX + name] = value;
  }
  added[OVERRIDE_HEADERS] = names.join(",");
  return added;
}

/**
 * @experimental One Proxy for `proxy.ts` from Nextly's and the site's own.
 *
 * Nextly's handlers are asked first, for the addresses
 * {@link nextlyProxyMatcher} covers. Where one answers (a redirect, a page
 * gone, a plain-text copy, the IndexNow key), that answer is sent and the
 * site's Proxy is not called. Otherwise the site's Proxy is called with the
 * request and the event, and its answer is sent with Nextly's headers added
 * where it sets none of its own (`X-Robots-Tag` on a staging host, the
 * request headers a page's not-found log reads); with no answer from the
 * site, Nextly's own is sent. Next.js's `event` reaches both, so work either
 * keeps running past the answer (`waitUntil`) is kept.
 *
 * ```ts
 * export const proxy = composeProxy(createNextlyProxy(nextlyConfig), siteProxy);
 * ```
 */
export function composeProxy<
  R extends Request = Request,
  E extends NextlyProxyEvent = NextlyProxyEvent,
>(
  nextly: NextlyProxy,
  site?: SiteProxy<R, E>
): (request: R, event: E) => Promise<Response | undefined> {
  const parts = proxyParts.get(nextly);
  if (parts === undefined) {
    // Refused when the site's Proxy is put together, not on a request: only
    // a Proxy `createNextlyProxy` made can say what it decided.
    throw NextlyError.configuration({
      logMessage:
        "composeProxy takes the Proxy createNextlyProxy(config) makes, from the same nextly/runtime import.",
    });
  }
  const ownAnswer = async (
    request: R,
    event: E
  ): Promise<Response | undefined> =>
    (await site?.(request, event)) ?? undefined;

  return async (request, event) => {
    if (!nextlyProxyRunsFor(new URL(request.url).pathname)) {
      return ownAnswer(request, event);
    }
    const decision = await parts.decide(request, event);
    if (decision?.kind === "answer") return decision.response;
    const answered = await ownAnswer(request, event);
    if (decision === undefined) return answered;
    if (answered === undefined) return parts.continueWith(request, decision);
    return withNextlyDecision(answered, request, decision);
  };
}
