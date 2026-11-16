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
 * contribute no handler does nothing more than ask whether any exist.
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

import { loadNextModule, requireNextApi } from "./next-api";

/** What `NextResponse.next` is called with, as far as this module uses it. */
type NextResponseNext = (init?: { request?: { headers: Headers } }) => Response;

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
 * the site down.
 */
export function createNextlyProxy(
  config: SanitizedNextlyConfig,
  deps: NextlyProxyDeps = defaultDeps
): (request: Request) => Promise<Response | undefined> {
  return async request => {
    if (!proxyHandlersReady()) {
      // Never waited for: the handlers come with the start, and holding the
      // request for it would hold every page and file the Proxy matches,
      // the prebuilt admin among them, for the whole start (over a minute
      // against a far database). The start is begun, or joined, and the
      // request goes through as the page alone; the handlers apply from the
      // first request after it finishes. A start that fails is reported by
      // the page's own read; the Proxy only stands aside.
      deps.start(config).catch(() => undefined);
      return undefined;
    }
    if (!hasProxyHandlers()) return undefined;
    const answer = await answerProxyRequest(request);
    if (answer.response !== undefined) {
      return withHeaders(answer.response, answer.headers);
    }
    return continueWith(request, answer, deps);
  };
}
