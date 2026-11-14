/**
 * `@nextlyhq/plugin-seo/next`: what a Next.js site calls where a route
 * decides it has nothing for a request, so the SEO plugin's log of addresses
 * not found counts that request.
 *
 * A subpath of its own because it imports `next`, and the package root stays
 * free of it for headless and admin-only projects. It imports none of the
 * plugin's server code either: the started plugin leaves its logger on
 * `globalThis` (`keepSeoContext`), so this module also loads on the Edge
 * runtime, where no plugin has started and nothing is logged.
 *
 * @module next
 */
import { headers } from "next/headers";
import { notFound, unstable_rethrow } from "next/navigation";
import { after, connection } from "next/server";

import type { HeaderReader } from "../not-found/report";

/** The started SEO plugin's logger, where the plugin has started in this process. */
function startedLogger(): ((headers: HeaderReader) => Promise<void>) | null {
  const shared = globalThis as {
    __nextly_seoLogNotFound?: (headers: HeaderReader) => Promise<void>;
  };
  return shared.__nextly_seoLogNotFound ?? null;
}

/** Read the request and hand its headers to the started plugin's logger once the response is sent. */
async function logAfterResponse(): Promise<void> {
  const log = startedLogger();
  if (log === null) return;
  const requestHeaders: HeaderReader = await headers();
  after(() => log(requestHeaders));
}

/**
 * Log this request's address as not found once the response is sent, but
 * only from a render made for a request, and without holding the answer up.
 *
 * Under Cache Components Next.js also renders a miss with no request at all
 * (the prerender it keeps and serves later requests from, and the one for a
 * runtime prefetch), and any read of the request there turns the kept 404
 * into a 200 streamed for every request. So nothing request-scoped is read
 * here: `connection()` resolves only where a request is being answered, and
 * in a prerender waits until the prerender ends and then rejects, so the
 * request's headers are read, and the log scheduled, from a request's render
 * alone. A miss Next.js answers from its kept 404 is not rendered, so it is
 * not logged again. Nothing is awaited, because the answer must not wait for
 * a request a prerender never gets.
 *
 * A `connection()` that throws at once is Next.js's interrupt where a page
 * without Cache Components is generated statically, which passes on, or a
 * call inside a cache scope, which has no request and leaves the miss
 * unlogged rather than breaking the answer. A read that fails once the
 * request is known leaves the miss unlogged too: the answer is sent already.
 */
function logOnceRequested(): void {
  let requested: Promise<void>;
  try {
    requested = connection();
  } catch (error) {
    unstable_rethrow(error);
    return;
  }
  requested.then(logAfterResponse).catch(() => undefined);
}

/**
 * Answer not found, and count the address in the SEO plugin's log of
 * addresses not found once the response is sent.
 *
 * Call it where a route decides it has nothing for the request, in place of
 * Next.js's `notFound()`, and pass it as a content route's `notFound`
 * (`createContentPage`, `createBlocksPage`, `createContentRoute` and the
 * rest), so the page builder's and Nextly's own routes log their misses too.
 * A request is counted once, though its page and its `generateMetadata` both
 * answer it; a prefetch, and a request the site's Proxy did not pass on, are
 * not counted. It throws only Next.js's own errors: its not-found, and its
 * interrupt where a page is generated statically without Cache Components.
 *
 * It answers at once and reads nothing of the request where Next.js renders
 * the miss without one, so under Cache Components a route Next.js keeps (a
 * public content route, or a page with `generateStaticParams`) keeps a real
 * 404: the first request is counted, and later requests Next.js answers from
 * the kept 404 are not, since nothing renders them. Without Cache
 * Components, Next.js refuses a page it renders once and keeps that waits
 * for a request (a statically generated page, or one with
 * `generateStaticParams` rendered on its first request), so call it there
 * only where the route answers per request; the page builder's public
 * routes leave it out there themselves.
 *
 * @example
 * ```tsx
 * import { notFoundLogged } from "@nextlyhq/plugin-seo/next";
 *
 * const post = await getPost(slug);
 * if (post === null) return notFoundLogged();
 * ```
 *
 * @experimental Its name and shape may change before 1.0.
 */
export async function notFoundLogged(): Promise<never> {
  // Not awaited: the log waits for a request, and the answer must not.
  logOnceRequested();
  notFound();
}
