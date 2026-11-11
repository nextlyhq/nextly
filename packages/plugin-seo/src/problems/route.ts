/**
 * The problem list's routes: one reads the list, one checks the whole site
 * again and answers the list it leaves.
 *
 * Both are for a signed-in person who may read at least one of the types
 * SEO is added to, and each answers the problems of the pages they may read,
 * with the site-wide ones, so the list never names a page its reader cannot
 * open. The checks themselves read as the system: what they find is kept
 * for every reader, and each sees their share of it.
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

import { checkSite, problemList, type ProblemChecks } from "./check";
import { PROBLEMS_CHECK_ROUTE_PATH, PROBLEMS_ROUTE_PATH } from "./contract";

/**
 * The types the caller may read, of those SEO is added to; refused where
 * there is no caller or they may read none of them.
 */
async function readableTypes(
  ctx: PluginRouteContext,
  targets: readonly string[]
): Promise<Set<string>> {
  const caller = ctx.caller;
  if (ctx.user === null || caller === null) throw NextlyError.authRequired();
  const readable = new Set<string>();
  for (const slug of targets) {
    if (await caller.can("read", slug)) readable.add(slug);
  }
  if (readable.size === 0) throw NextlyError.forbidden();
  return readable;
}

/** The routes that read the list and check the site again. */
export function problemRoutes(checks: ProblemChecks): PluginRoute[] {
  return [
    {
      method: "GET",
      path: PROBLEMS_ROUTE_PATH,
      noStore: true,
      handler: async (_req, ctx) => {
        const readable = await readableTypes(ctx, checks.targets);
        return respondDoc(
          await problemList(ctx, checks, type => readable.has(type))
        );
      },
    },
    {
      method: "POST",
      path: PROBLEMS_CHECK_ROUTE_PATH,
      handler: async (_req, ctx) => {
        // Asked before the check, which reads and writes as the system.
        const readable = await readableTypes(ctx, checks.targets);
        await checkSite(ctx, checks);
        const list = await problemList(ctx, checks, type => readable.has(type));
        const pages = `${list.pagesChecked} ${list.pagesChecked === 1 ? "page" : "pages"}`;
        return respondAction(`Checked ${pages}.`, { ...list });
      },
    },
  ];
}
