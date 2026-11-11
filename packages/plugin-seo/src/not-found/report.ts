/**
 * What a site's not-found page calls to log the address that was not found.
 *
 * The site's Proxy passes the address a page was asked for on to its render
 * in a request header; the not-found page hands its request headers here,
 * and the address is counted in the log. A request the Proxy did not pass
 * on (the admin, the API, an asset, or a site without the Proxy) carries no
 * such header and is not logged.
 *
 * @module not-found/report
 */
import type { PluginContext } from "@nextlyhq/plugin-sdk";

import { ASKED_FOR_HEADER, REQUEST_HEADER } from "../redirects/proxy-handler";
import { askedAddress } from "../redirects/served";

import { notAPageAddress, recordNotFound } from "./log";

/**
 * The SEO plugin's context, once it has started, on `globalThis` so the
 * not-found page reaches it even where its module is evaluated apart from
 * the one the plugin started in.
 */
const shared = globalThis as unknown as {
  __nextly_seoPluginContext?: PluginContext;
};

/** Keep the started plugin's context for {@link logNotFound}. */
export function keepSeoContext(ctx: PluginContext): void {
  shared.__nextly_seoPluginContext = ctx;
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

/** Anything that reads a request header by name, as `headers()` does. */
export interface HeaderReader {
  get(name: string): string | null;
}

/**
 * Log that the address this request asked for was not found. Call it from
 * the site's not-found page with its request headers:
 *
 * ```tsx
 * import { headers } from "next/headers";
 * import { connection } from "next/server";
 * import { logNotFound } from "@nextlyhq/plugin-seo";
 *
 * async function LogThisAddress() {
 *   await connection();
 *   await logNotFound(await headers());
 *   return null;
 * }
 * ```
 *
 * rendered inside `<Suspense>` on the not-found page. A request is counted
 * once however many times Next.js renders its not-found page. It never
 * throws: a log that cannot be written must not break the page.
 */
export async function logNotFound(headers: HeaderReader): Promise<void> {
  const ctx = shared.__nextly_seoPluginContext;
  const asked = headers.get(ASKED_FOR_HEADER);
  if (ctx === undefined || asked === null || asked === "") return;
  if (loggedBefore(headers.get(REQUEST_HEADER))) return;
  try {
    const url = new URL(asked);
    if (notAPageAddress(url.pathname)) return;
    // Kept by language and path, so `/gone` on two languages' domains is
    // two addresses, each answered by its own language's redirect.
    await recordNotFound(ctx, {
      ...(await askedAddress(ctx, url)),
      asked: url.pathname,
    });
  } catch (error) {
    ctx.logger.warn("An address not found could not be logged", { error });
  }
}

/** The started plugin's context, if it has started: for the plugin's own code and tests. */
export function keptSeoContext(): PluginContext | undefined {
  return shared.__nextly_seoPluginContext;
}
