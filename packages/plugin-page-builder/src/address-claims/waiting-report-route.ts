/**
 * The documents left unserved because another holds the address they would
 * be served at, and what holds it: the address store's report, read through
 * the API.
 *
 * A document waits when its address follows from something else and is
 * already taken (see `claimOrWait`); it keeps its save and is served once
 * every claim in its way is released. This route lists those waits a page at
 * a time, naming each document as the caller may see it: by title where the
 * caller may read it, by its id alone where not.
 *
 * @module address-claims/waiting-report-route
 */
import type {
  PluginRouteContext,
  PluginRoutePermissionScope,
} from "@nextlyhq/plugin-sdk";
import { respondList, type PaginationMeta } from "nextly";
import { requireNextly } from "nextly/runtime";
import { z } from "nextly/zod";

import { ADDRESS_CLAIMS_SLUG } from "../collections/address-claims";
import { PAGES_SLUG } from "../collections/pages";
import { titlesAsCaller } from "../publish-readiness";

import { pathOf } from "./claim-key";
import { committedClaims, type Claims, type Holder } from "./claim-store";

export const ADDRESS_WAITING_ROUTE_PATH = "/address-claims/waiting";

/** How many waits one page of the report lists. */
const PAGE_SIZE = 50;

/** A document as the report names it: `title` is null where it is hidden. */
interface ReportedDocument extends Holder {
  readonly title: string | null;
}

/** One document waiting for an address, and what holds it. */
interface WaitingReportItem {
  readonly document: ReportedDocument;
  readonly address: { readonly locale: string; readonly path: string };
  /** Null where the claim it waits on is no longer stored. */
  readonly blockedBy: ReportedDocument | null;
}

const reportQuery = z.object({
  page: z.coerce.number().int().min(1).max(10_000).default(1),
});

/** One page of the report, with the list's paging. */
async function readWaitingReport(
  ctx: Pick<PluginRouteContext, "caller">,
  reads: {
    readonly claims: Claims;
    readonly nextly: Parameters<typeof titlesAsCaller>[1];
  },
  page: number
): Promise<{ items: WaitingReportItem[]; meta: PaginationMeta }> {
  const { rows, total } = await committedClaims(
    reads.claims,
    { kind: { equals: "waiting" } },
    { limit: PAGE_SIZE, page }
  );
  const blockingKeys = [
    ...new Set(
      rows.flatMap(row => (row.blockedBy === null ? [] : [row.blockedBy]))
    ),
  ];
  const { rows: blocking } =
    blockingKeys.length === 0
      ? { rows: [] }
      : await committedClaims(
          reads.claims,
          { claimKey: { in: blockingKeys } },
          { limit: blockingKeys.length }
        );
  const holderOf = new Map(blocking.map(row => [row.key, row.holder]));
  const named = await titles(ctx, reads.nextly, [
    ...rows.map(row => row.holder),
    ...blocking.map(row => row.holder),
  ]);
  const items = rows.flatMap((row): WaitingReportItem[] => {
    if (row.holder === null || row.address === null) return [];
    const blocker =
      row.blockedBy === null ? null : (holderOf.get(row.blockedBy) ?? null);
    return [
      {
        document: named(row.holder),
        address: { locale: row.address.locale, path: pathOf(row.address) },
        blockedBy: blocker === null ? null : named(blocker),
      },
    ];
  });
  const totalPages = Math.ceil(total / PAGE_SIZE);
  return {
    items,
    meta: {
      total,
      page,
      limit: PAGE_SIZE,
      totalPages,
      hasNext: page < totalPages,
      hasPrev: page > 1,
    },
  };
}

/**
 * The titles of `holders` the caller may read, collection by collection, as a
 * function naming any of them.
 */
async function titles(
  ctx: Pick<PluginRouteContext, "caller">,
  nextly: Parameters<typeof titlesAsCaller>[1],
  holders: readonly (Holder | null)[]
): Promise<(holder: Holder) => ReportedDocument> {
  const ids = new Map<string, Set<string>>();
  for (const holder of holders) {
    if (holder === null) continue;
    const set = ids.get(holder.collection) ?? new Set<string>();
    set.add(holder.id);
    ids.set(holder.collection, set);
  }
  const found = new Map<string, Map<string, string>>();
  for (const [collection, set] of ids) {
    found.set(
      collection,
      await titlesAsCaller(ctx, nextly, collection, [...set])
    );
  }
  return holder => ({
    ...holder,
    title: found.get(holder.collection)?.get(holder.id) ?? null,
  });
}

/**
 * The route: open to whoever may update pages, the people whose saves the
 * store refuses or leaves waiting.
 */
export function addressWaitingRoute(): {
  method: "GET";
  path: string;
  requiredPermission: (scope: PluginRoutePermissionScope) => string;
  handler: (req: Request, ctx: PluginRouteContext) => Promise<Response>;
} {
  return {
    method: "GET",
    path: ADDRESS_WAITING_ROUTE_PATH,
    // Computed, so a host that renamed the collection still reaches it.
    requiredPermission: ({ collection }) => collection(PAGES_SLUG, "update"),
    handler: async (req, ctx) => {
      const { page } = reportQuery.parse(
        Object.fromEntries(new URL(req.url).searchParams)
      );
      const report = await readWaitingReport(
        ctx,
        {
          claims: {
            services: ctx.services,
            slug:
              ctx.self.collections[ADDRESS_CLAIMS_SLUG] ?? ADDRESS_CLAIMS_SLUG,
          },
          // The Direct API, read through the one method the reads need.
          nextly: requireNextly() as unknown as Parameters<
            typeof titlesAsCaller
          >[1],
        },
        page
      );
      return respondList(report.items, report.meta);
    },
  };
}
