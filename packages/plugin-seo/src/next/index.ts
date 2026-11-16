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
import { after } from "next/server";

import type { HeaderReader } from "../not-found/report";

/** The started SEO plugin's logger, where the plugin has started in this process. */
function startedLogger(): ((headers: HeaderReader) => Promise<void>) | null {
  const shared = globalThis as {
    __nextly_seoLogNotFound?: (headers: HeaderReader) => Promise<void>;
  };
  return shared.__nextly_seoLogNotFound ?? null;
}

/**
 * Log this request's address as not found once the response is sent, where
 * the SEO plugin runs in this process.
 *
 * The request is read first, whether or not the plugin runs here, so the
 * answer is always decided per request: a prerender that reached a miss
 * without reading it would keep the 404 and serve it from then on without
 * rendering, and no later request for the address would be logged. A
 * prerender's read waits for a request, which Next.js's own interrupt says,
 * and that passes on. Anything else (a read inside a cache scope, which has
 * no request) leaves the miss unlogged rather than breaking the answer.
 */
async function logAfterResponse(): Promise<void> {
  let requestHeaders: HeaderReader;
  try {
    requestHeaders = await headers();
  } catch (error) {
    unstable_rethrow(error);
    return;
  }
  const log = startedLogger();
  if (log === null) return;
  try {
    after(() => log(requestHeaders));
  } catch (error) {
    unstable_rethrow(error);
  }
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
 * interrupts while prerendering.
 *
 * It reads the request, so call it where the route answers per request.
 * Without Cache Components, Next.js refuses a read of the request in a page
 * it renders once and keeps (a statically generated page, or one with
 * `generateStaticParams` rendered on its first request); the page builder's
 * public routes leave it out there themselves.
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
  await logAfterResponse();
  notFound();
}
