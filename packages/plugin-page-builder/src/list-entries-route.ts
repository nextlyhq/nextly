/**
 * The read behind a collection list on the editor's canvas: one read of a
 * list's entries, AS THE PERSON EDITING reads them.
 *
 * The canvas draws a list with the renderer's own `readList`, which builds
 * its reads from the stored query exactly as on a published page. This route
 * answers each read through the editor reader (`createEditorReader`), which
 * takes the public reader's query, with its keys, refusals and limits, and
 * reads it as the signed-in person with drafts included: the author sees the
 * entries they could see in the admin, never more. A published page still
 * reads the same list as an anonymous visitor, published entries and public
 * fields only. A filter or sort the published page would refuse is refused
 * here too, so the canvas never draws a list the published page cannot.
 *
 * ## Who may ask
 *
 * The route is authenticated, and every read runs through core's one access
 * gate as the caller (`readingAsUser`, `overrideAccess: false`): the gate is
 * the only door. A caller who may not read the collection is refused by it
 * before any row is read or any read hook runs, with the refusal the admin
 * gives them, and their row and field rules apply exactly as they do to
 * their own reads there. No second check is made here, so the two can never
 * answer one caller differently.
 *
 * ## Caching
 *
 * None. The answer is one person's, so the route is `noStore`, it is never
 * tagged, and nothing a published page reads is made from it.
 *
 * @module list-entries-route
 */
import {
  LIST_MAX_SORT_KEYS,
  LIST_MAX_SORT_LENGTH,
  readListQuery,
} from "@nextlyhq/blocks-engine";
import type { PluginRouteContext } from "@nextlyhq/plugin-sdk";
import { respondList } from "nextly";
import { z } from "nextly/zod";

import { readBodyWith } from "./composition-route-kit";
import { readingAsUser } from "./library-route";
import {
  LIST_ENTRIES_ROUTE_PATH,
  LIST_ENTRY_OPS,
  type ListEntriesRequest,
  type ListEntriesResponse,
} from "./list-entries-contract";

/** A field name a list may name: no paths, operators or quoting. */
const FIELD = z.string().regex(/^[A-Za-z_][A-Za-z0-9_]*$/);

/** One literal a filter compares with. */
const SCALAR = z.union([z.string(), z.number().finite(), z.boolean()]);

/**
 * Whether a sort as sent is within the bounds the engine holds a stored sort
 * to: a string no longer than a stored sort, or a list of no more keys than
 * one sorts by. Asked of the value as it arrives, before any of it is read.
 */
function withinSortBounds(sort: unknown): boolean {
  if (typeof sort === "string") return sort.length <= LIST_MAX_SORT_LENGTH;
  return !Array.isArray(sort) || sort.length <= LIST_MAX_SORT_KEYS;
}

/**
 * A sort as a list stores it, judged by the engine's own reading of a stored
 * sort (`readListQuery`), in the string form or the one-key-per-entry list
 * form, read as the same keys joined. The bounds that reading holds a stored
 * sort to are checked first and stop the check there, so a sort past them is
 * refused before its keys are parsed, joined or read: the length of the
 * string, the number of keys in a list, and the length of each key.
 */
const SORT = z
  .unknown()
  .refine(withinSortBounds, {
    message: "The sort is longer than any a list stores.",
    abort: true,
  })
  .pipe(
    z.union([
      z.string(),
      z.array(
        z.string().max(LIST_MAX_SORT_LENGTH, {
          message: "A sort key is longer than any a list stores.",
          abort: true,
        })
      ),
    ])
  )
  .refine(
    sort =>
      readListQuery({ sort: typeof sort === "string" ? sort : sort.join(",") })
        .problems.length === 0,
    { message: "The sort is not one a list stores." }
  );

/**
 * The read, as the renderer sends it. Bounded as the reader bounds it, so a
 * body no list could build is refused here, before the caller is judged.
 */
const ListEntriesBody = z
  .object({
    query: z
      .object({
        collection: z.string().min(1),
        filters: z
          .array(
            z
              .object({
                field: FIELD,
                op: z.enum(LIST_ENTRY_OPS),
                value: z.union([SCALAR, z.array(SCALAR).max(100)]),
              })
              .strict()
          )
          // A list's own rows, and the `in` row a related list adds.
          .max(21)
          .optional(),
        sort: SORT.optional(),
        limit: z.number().int().min(1).max(100).optional(),
        offset: z.number().int().min(0).optional(),
        page: z.number().int().min(1).optional(),
        locale: z.string().optional(),
        select: z.array(FIELD).max(200).optional(),
      })
      .strict(),
  })
  .strict();

/** What the route reads with, injected so the read is tested without a server. */
export interface ListEntriesReads {
  /** One read as the caller reads it, drafts included, in the read's language. */
  find(query: ListEntriesRequest["query"]): Promise<ListEntriesResponse>;
}

/**
 * Answer one read: the rows as the caller reads them. Every refusal travels
 * unchanged: core's refusal of a collection the caller may not read, a sort
 * the reader will not take, or a field the public may not filter by, so the
 * canvas tells the author what the page would do.
 */
export function readListEntries(
  request: ListEntriesRequest,
  reads: ListEntriesReads
): Promise<ListEntriesResponse> {
  return reads.find(request.query);
}

/** The read the route binds: the editor reader, as the caller. */
function directListEntriesReads(ctx: PluginRouteContext): ListEntriesReads {
  return {
    // Imported at call time, so loading this module costs none of the
    // runtime, as the route's other reads are.
    find: async query => {
      const { createEditorReader, requireNextly } = await import(
        "nextly/runtime"
      );
      const nextly = requireNextly();
      // The caller as core judges their own reads: their user, and an API
      // key's own scope when the request carried one.
      const { user, actor } = await readingAsUser(ctx);
      const reader = createEditorReader(
        { find: async args => await nextly.find(args) },
        { user, ...(actor === undefined ? {} : { actor }) },
        query.locale === undefined ? {} : { locale: query.locale }
      );
      return reader.find(query);
    },
  };
}

/**
 * The route declaration. Authenticated (no `public: true`), with no
 * permission of its own: core's gate judges each read as the caller.
 * A POST because a read carries a query, never because it writes; `noStore`
 * because its answer is one person's.
 */
export function listEntriesRoute(): {
  method: "POST";
  path: string;
  noStore: true;
  handler: (req: Request, ctx: PluginRouteContext) => Promise<Response>;
} {
  return {
    method: "POST",
    path: LIST_ENTRIES_ROUTE_PATH,
    noStore: true,
    handler: async (req, ctx) => {
      const body = await readBodyWith(req, ListEntriesBody, "list entries");
      const answer = await readListEntries(body, directListEntriesReads(ctx));
      return respondList([...answer.items], answer.meta);
    },
  };
}
