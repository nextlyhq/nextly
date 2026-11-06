/**
 * The read behind a collection list on the editor's canvas: one read of a
 * list's entries, as a VISITOR reads them.
 *
 * The canvas draws a list with the renderer's own `readList`, which builds
 * its reads from the stored query exactly as on a published page; this route
 * answers each read through the public reader a published page reads with
 * (`createPublicReader`), so the entries the author designs around, the
 * order they come in and a sort or a filter the reader refuses are the
 * visitor's. Its refusals travel unchanged, so the canvas tells the author
 * what a visitor's page would hide.
 *
 * ## Who may ask
 *
 * The route is authenticated, and a read of a collection the caller may not
 * read (`caller.can("read", slug)`) is refused before anything is read, as
 * the loop collections route lists only those. The rows themselves are the
 * public's: published entries and public fields only, whoever asks.
 *
 * @module list-entries-route
 */
import {
  LIST_MAX_SORT_KEYS,
  LIST_MAX_SORT_LENGTH,
  readListQuery,
} from "@nextlyhq/blocks-engine";
import { NextlyError, type PluginRouteContext } from "@nextlyhq/plugin-sdk";
import { respondList } from "nextly";
import { z } from "nextly/zod";

import { readBodyWith } from "./composition-route-kit";
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

/**
 * What the route reads with, injected so the gate and the read are tested
 * without a server.
 */
export interface ListEntriesReads {
  /** Whether the caller may read this collection. */
  mayRead(slug: string): Promise<boolean>;
  /** One read as a visitor reads it, in the read's language. */
  publicFind(query: ListEntriesRequest["query"]): Promise<ListEntriesResponse>;
}

/**
 * Answer one read: refused unless the caller may read the collection, and
 * otherwise the public's rows.
 */
export async function readListEntries(
  request: ListEntriesRequest,
  reads: ListEntriesReads
): Promise<ListEntriesResponse> {
  // The precondition runs first: nothing is read for a caller who may not
  // read the collection, and the refusal names nothing about it.
  if (!(await reads.mayRead(request.query.collection))) {
    throw NextlyError.forbidden({
      logContext: {
        reason: "list-entries-forbidden",
        collection: request.query.collection,
      },
    });
  }
  try {
    return await reads.publicFind(request.query);
  } catch (error) {
    throw visitorRefusal(error, request.query.collection);
  }
}

/**
 * A refusal of the visitor's read, as the editor is told it. The read is made
 * as no one, so a collection visitors may not read answers "sign in" (401);
 * handed back as that, the admin would take the AUTHOR's session for expired
 * and send them to sign in. It is the page's visitors who are refused, so it
 * travels as a refusal (403) saying so. Any other failure travels unchanged.
 */
function visitorRefusal(error: unknown, collection: string): unknown {
  if (!NextlyError.isAuthRequired(error) && !NextlyError.isForbidden(error)) {
    return error;
  }
  return new NextlyError({
    code: "FORBIDDEN",
    publicMessage: `Visitors can't read ${collection}, so a published list of it shows nothing.`,
    logMessage: "A canvas list's visitor read was refused",
    logContext: { reason: "list-entries-visitor-refused", collection },
    ...(error instanceof Error ? { cause: error } : {}),
  });
}

/** The reads the route binds: the caller's permission and the public reader. */
function directListEntriesReads(ctx: PluginRouteContext): ListEntriesReads {
  return {
    // No caller is no reader: the route is authenticated, so this is a guard
    // for a caller the dispatcher could not resolve.
    mayRead: slug =>
      ctx.caller === null
        ? Promise.resolve(false)
        : ctx.caller.can("read", slug),
    // Imported at call time, so loading this module costs none of the
    // runtime, as the route's other reads are.
    publicFind: async query => {
      const { createPublicReader, requireNextly } = await import(
        "nextly/runtime"
      );
      const nextly = requireNextly();
      const reader = createPublicReader(
        { find: async args => await nextly.find(args) },
        query.locale === undefined ? {} : { locale: query.locale }
      );
      return reader.find(query);
    },
  };
}

/**
 * The route declaration. Authenticated (no `public: true`), with no
 * permission of its own: the collection read is asked of the caller above.
 * A POST because a read carries a query, never because it writes.
 */
export function listEntriesRoute(): {
  method: "POST";
  path: string;
  handler: (req: Request, ctx: PluginRouteContext) => Promise<Response>;
} {
  return {
    method: "POST",
    path: LIST_ENTRIES_ROUTE_PATH,
    handler: async (req, ctx) => {
      const body = await readBodyWith(req, ListEntriesBody, "list entries");
      const answer = await readListEntries(body, directListEntriesReads(ctx));
      return respondList([...answer.items], answer.meta);
    },
  };
}
