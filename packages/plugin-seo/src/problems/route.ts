/**
 * The problem list's routes: one reads the list, one checks the whole site
 * again and answers the list it leaves.
 *
 * Both are for a signed-in person who may read at least one of the types
 * SEO is added to, and each answers the problems of the pages they may read,
 * with the site-wide ones, so the list never names a page its reader cannot
 * open, and names a redirect only to someone holding site-wide SEO. The
 * checks themselves read as the system: what they find is kept for every
 * reader, and each sees their share of it.
 *
 * @module problems/route
 */
import {
  NextlyError,
  respondAction,
  respondDoc,
  type PluginRoute,
  type PluginRouteContext,
} from "@nextlyhq/plugin-sdk";

import {
  addressRecordReady,
  retryFailedCatchUp,
} from "../address-record/catch-up";
import { seoCan } from "../permissions";

import {
  checkSite,
  problemList,
  type ProblemChecks,
  type Reader,
} from "./check";
import { PROBLEMS_CHECK_ROUTE_PATH, PROBLEMS_ROUTE_PATH } from "./contract";
import { singleKey } from "./page-types";
import { callerReads, readerAs } from "./reader";

/**
 * The types the caller may read, of those SEO is added to, by the key their
 * pages are kept under (a Single's `single:<slug>`); refused where there is
 * no caller or they may read none of them.
 */
async function readableTypes(
  ctx: PluginRouteContext,
  checks: ProblemChecks
): Promise<Set<string>> {
  const caller = ctx.caller;
  if (ctx.user === null || caller === null) throw NextlyError.authRequired();
  const readable = new Set<string>();
  for (const slug of checks.targets) {
    if (await caller.can("read", slug)) readable.add(slug);
  }
  for (const slug of checks.singles) {
    if (await caller.can("read", slug)) readable.add(singleKey(slug));
  }
  if (readable.size === 0) throw NextlyError.forbidden();
  return readable;
}

/** Which pages the route's caller may read, each read made as them. */
async function readerOf(
  ctx: PluginRouteContext,
  types: ReadonlySet<string>
): Promise<Reader> {
  // Redirects are site-wide SEO's: named only to someone holding it.
  return readerAs(callerReads(ctx), types, await seoCan(ctx, "manage"));
}

/** The routes that read the list and check the site again. */
export function problemRoutes(checks: ProblemChecks): PluginRoute[] {
  return [
    {
      method: "GET",
      path: PROBLEMS_ROUTE_PATH,
      noStore: true,
      handler: async (_req, ctx) => {
        const readable = await readableTypes(ctx, checks);
        const list = await problemList(
          ctx,
          checks,
          await readerOf(ctx, readable)
        );
        return respondDoc({ ...list });
      },
    },
    {
      method: "POST",
      path: PROBLEMS_CHECK_ROUTE_PATH,
      handler: async (_req, ctx) => {
        // Asked before the check, which reads and writes as the system.
        const readable = await readableTypes(ctx, checks);
        // While the address record catches up, or after a catch-up that
        // failed, a page may not hold its address yet and would be checked
        // as not public: the person is asked to try again, as the sitemap
        // asks crawlers, and a failed catch-up is tried again.
        if (!addressRecordReady()) {
          retryFailedCatchUp();
          throw NextlyError.serviceUnavailable({
            publicMessage:
              "The site's addresses are being brought up to date. Check again in a minute.",
            logContext: { reason: "address-record-not-ready" },
          });
        }
        await checkSite(ctx, checks);
        const list = await problemList(
          ctx,
          checks,
          await readerOf(ctx, readable)
        );
        const pages = `${list.pagesChecked} ${list.pagesChecked === 1 ? "page" : "pages"}`;
        return respondAction(`Checked ${pages}.`, { ...list });
      },
    },
  ];
}
