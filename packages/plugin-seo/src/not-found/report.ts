/**
 * What logs the address a request was not found at.
 *
 * The site's Proxy passes the address a page was asked for on to its render
 * in a request header; where a route decides it has nothing for the request,
 * `notFoundLogged` (`@nextlyhq/plugin-seo/next`) hands the request headers
 * here, and the address is counted in the log. A request the Proxy did not
 * pass on (the admin, the API, an asset, a prefetch, or a site without the
 * Proxy) carries no such header and is not logged.
 *
 * Never from the site's root `not-found` page: Next.js renders that page's
 * element on every request, for every page, so the log would count every
 * page view as a miss.
 *
 * @module not-found/report
 */
import type { PluginContext } from "@nextlyhq/plugin-sdk";

import { ASKED_FOR_HEADER, REQUEST_HEADER } from "../redirects/proxy-handler";
import { askedAddress } from "../redirects/served";

import { recordNotFound } from "./log";
import { notAPageAddress } from "./page-address";
import { isBotProbe } from "./probes";

/**
 * The SEO plugin's context, once it has started, on `globalThis` so the
 * not-found page reaches it even where its module is evaluated apart from
 * the one the plugin started in.
 */
const shared = globalThis as unknown as {
  __nextly_seoPluginContext?: PluginContext;
  __nextly_seoLogNotFound?: (headers: HeaderReader) => Promise<void>;
};

/**
 * Keep the started plugin's context for {@link logNotFound}, and the logger
 * itself where `notFoundLogged` reaches it: on `globalThis`, so the helper
 * imports none of the plugin's server code (which a page rendered on the
 * Edge runtime could not load) and every request is counted by the one
 * module that remembers which requests it has logged.
 */
export function keepSeoContext(ctx: PluginContext): void {
  shared.__nextly_seoPluginContext = ctx;
  shared.__nextly_seoLogNotFound = logNotFound;
}

/** How many requests' ids are remembered as logged, the oldest let go first. */
const REMEMBERED_REQUESTS = 1000;

/**
 * The requests this process has logged, by the id the Proxy gave each. Every
 * render of one request runs in the process that received it, so this is
 * enough to count it once.
 */
const loggedRequests = new Set<string>();

/**
 * Whether the request `id` names is logged already, marking it logged. Kept
 * synchronous, so of two renders of one request at once only the first logs.
 */
function loggedBefore(id: string | null): boolean {
  // A request without an id (the site's Proxy predates it) is logged each time.
  if (id === null || id === "") return false;
  if (loggedRequests.has(id)) return true;
  loggedRequests.add(id);
  if (loggedRequests.size > REMEMBERED_REQUESTS) {
    const oldest = loggedRequests.values().next().value;
    if (oldest !== undefined) loggedRequests.delete(oldest);
  }
  return false;
}

/**
 * Where a visitor came from, as the log keeps it, from the page that sent
 * them (the request's `referer`): a path on this site without its query,
 * another site's host, or nothing for one who came directly. Only what the
 * list needs is kept: never another site's path or anyone's query.
 */
export function cameFromOf(
  referer: string | null,
  asked: URL
): string | undefined {
  if (referer === null || referer.trim() === "") return undefined;
  let from: URL;
  try {
    from = new URL(referer);
  } catch {
    return undefined;
  }
  if (from.protocol !== "http:" && from.protocol !== "https:") return undefined;
  return from.origin === asked.origin ? from.pathname : from.host;
}

/** Anything that reads a request header by name, as `headers()` does. */
export interface HeaderReader {
  get(name: string): string | null;
}

/**
 * Log that the address this request asked for was not found, from the
 * request's headers. A site calls `notFoundLogged` from
 * `@nextlyhq/plugin-seo/next` where a route decides not found, which calls
 * this once the response is sent; call this directly only where the headers
 * are already in hand, from code that runs for a not-found answer alone.
 *
 * A request is counted once however many times it is called for it (a page
 * and its `generateMetadata` both answer a miss). It never throws: a log that
 * cannot be written must not break the page.
 */
export async function logNotFound(headers: HeaderReader): Promise<void> {
  const ctx = shared.__nextly_seoPluginContext;
  const asked = headers.get(ASKED_FOR_HEADER);
  if (ctx === undefined || asked === null || asked === "") return;
  if (loggedBefore(headers.get(REQUEST_HEADER))) return;
  try {
    const url = new URL(asked);
    if (notAPageAddress(url.pathname) || isBotProbe(url.pathname)) return;
    // Kept by language and path, so `/gone` on two languages' domains is
    // two addresses, each answered by its own language's redirect.
    const cameFrom = cameFromOf(headers.get("referer"), url);
    await recordNotFound(ctx, {
      ...(await askedAddress(ctx, url)),
      asked: url.pathname,
      ...(cameFrom === undefined ? {} : { cameFrom }),
    });
  } catch (error) {
    ctx.logger.warn("An address not found could not be logged", { error });
  }
}

/** The started plugin's context, if it has started: for the plugin's own code and tests. */
export function keptSeoContext(): PluginContext | undefined {
  return shared.__nextly_seoPluginContext;
}
