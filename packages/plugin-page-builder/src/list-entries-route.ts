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
 * ## A list whose source is a named query
 *
 * Its run function lives only on the server, so the canvas asks for one run
 * of it (`{ named }`) and the route makes it with the renderer's own
 * `readNamedList`, over the same public reader, inside nextly's frame: the
 * rows, refusals and failures are the published page's. The caller must be
 * able to read every collection the query declares, asked before it runs.
 *
 * @module list-entries-route
 */
import {
  calendarDayIn,
  getNamedQuery,
  isNamedQueryName,
  isNamedQueryParamKey,
  LIST_LIMIT_MAX,
  LIST_LIMIT_MIN,
  LIST_MAX_SORT_KEYS,
  LIST_MAX_SORT_LENGTH,
  NAMED_QUERY_TEXT_MAX,
  readListQuery,
  safeTimeZone,
  type BindingFieldShape,
  type NamedQueryDefinition,
} from "@nextlyhq/blocks-engine";
import {
  createQueryBudget,
  createStandaloneContext,
  type ListBaseReader,
  type NamedQueryFailure,
  type NamedQueryHost,
  type QueryBudget,
} from "@nextlyhq/blocks-react";
import {
  namedQueryFailureLine,
  readNamedList,
} from "@nextlyhq/blocks-react/blocks";
import { NextlyError, type PluginRouteContext } from "@nextlyhq/plugin-sdk";
import { respondList } from "nextly";
import { z } from "nextly/zod";

import { readBodyWith } from "./composition-route-kit";
import {
  LIST_ENTRIES_NAMED_MAX_PARAMS,
  LIST_ENTRIES_ROUTE_PATH,
  LIST_ENTRY_OPS,
  type ListEntriesNamedRequest,
  type ListEntriesNamedResponse,
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
 * One run of a named query, as the canvas asks for it: a registered name,
 * a literal per input within what a list stores, and the window the list is
 * drawn with. The inputs' meaning is judged by the run, with the engine's
 * `judgeNamedParams`, as on a published page.
 */
const ListEntriesNamedBody = z
  .object({
    named: z
      .object({
        name: z.string().refine(isNamedQueryName, {
          message: "This is not a named query's name.",
        }),
        params: z
          .record(
            z.string().refine(isNamedQueryParamKey, {
              message: "This is not an input's key.",
            }),
            z.union([
              z.string().max(NAMED_QUERY_TEXT_MAX),
              z.number().finite(),
              z.boolean(),
            ])
          )
          .refine(
            params =>
              Object.keys(params).length <= LIST_ENTRIES_NAMED_MAX_PARAMS,
            { message: "A list stores no more inputs than this." }
          )
          .optional(),
        limit: z.number().int().min(LIST_LIMIT_MIN).max(LIST_LIMIT_MAX),
        offset: z.number().int().min(0),
        locale: z.string().max(64).optional(),
        node: z.string().max(200).optional(),
      })
      .strict(),
  })
  .strict();

/** Either read the route takes: a list's read, or one named run. */
const ListEntriesAnyBody = z.union([ListEntriesBody, ListEntriesNamedBody]);

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

/**
 * What a named run is made with, injected so the gate and the run are
 * tested without a server. The canvas runs a query through ONE base reader,
 * which the host is built on: the reader the canvas's other list reads use,
 * today the public one, so the rows an author designs around are a
 * visitor's. A reader with the editing person's access fits the same seam.
 */
export interface NamedListEntriesReads {
  /** Whether the caller may read this collection. */
  mayRead(slug: string): Promise<boolean>;
  /** The registered query of a name, run function included. */
  definitionOf(name: string): NamedQueryDefinition | undefined;
  /** The base reader a run's scoped reader wraps, in the run's language. */
  baseReader(locale: string | undefined): Promise<ListBaseReader>;
  /** The public fields of a collection, which rows that are its entries keep. */
  fieldsOf(
    collection: string,
    locale: string | undefined
  ): Promise<readonly BindingFieldShape[] | undefined>;
  /** The frame each run executes in, which refuses every other read. */
  frame?: NamedQueryHost["frame"];
  /** Today in the site's time zone, `YYYY-MM-DD`. */
  today(): Promise<string>;
  /** Told about a failed run, for the server log. */
  report(failure: NamedQueryFailure): void;
}

/** A budget that counts what it gave, so the answer says what a run cost. */
function countingBudget(): QueryBudget & { readonly taken: () => number } {
  const budget = createQueryBudget();
  let taken = 0;
  return {
    take: () => {
      const granted = budget.take();
      if (granted) taken += 1;
      return granted;
    },
    taken: () => taken,
  };
}

/**
 * Answer one named run: refused unless the caller may read every collection
 * the query declares, and otherwise the run's rows, made as the published
 * page makes them. A run that fails answers no rows and its failure as the
 * run judged it, so the canvas draws the note a preview would, under the
 * reference the log names it by.
 */
export async function readNamedListEntries(
  request: ListEntriesNamedRequest,
  reads: NamedListEntriesReads
): Promise<ListEntriesNamedResponse> {
  const { name, params, limit, offset, locale, node } = request.named;
  const definition = reads.definitionOf(name);
  // The precondition runs first, as for a list's read: nothing is run for a
  // caller who may not read what the query reads.
  for (const slug of definition?.reads.collections ?? []) {
    if (!(await reads.mayRead(slug))) {
      throw NextlyError.forbidden({
        logContext: { reason: "list-entries-named-forbidden", name },
      });
    }
  }
  const host: NamedQueryHost = {
    definitionOf: asked => (asked === name ? definition : undefined),
    reader: await reads.baseReader(locale),
    today: () => reads.today(),
    fieldsOf: collection => reads.fieldsOf(collection, locale),
    ...(reads.frame === undefined ? {} : { frame: reads.frame }),
    report: failure => reads.report(failure),
  };
  const budget = countingBudget();
  const ctx = createStandaloneContext({
    namedQueries: host,
    queries: budget,
    diagnostics: true,
    ...(locale === undefined ? {} : { locale }),
  });
  const outcome = await readNamedList(
    { name, params: params ?? {} },
    { limit, offset },
    { ...ctx, namedQueries: host },
    node ?? "canvas"
  );
  const total = outcome.total ?? outcome.items.length;
  return {
    items: outcome.items,
    meta: {
      total,
      page: 1,
      limit,
      totalPages: total === 0 ? 0 : Math.ceil(total / limit),
      hasNext: offset + outcome.items.length < total,
      hasPrev: offset > 0,
      named: {
        counted: outcome.total !== undefined,
        reads: budget.taken(),
        ...(outcome.failure === undefined
          ? {}
          : { failure: { ...outcome.failure } }),
      },
    },
  };
}

/** The public reader over this instance, in a language: the canvas's base. */
async function publicBaseReader(
  locale: string | undefined
): Promise<ListBaseReader> {
  const { createPublicReader, readPublicSiteSettings, requireNextly } =
    await import("nextly/runtime");
  const nextly = requireNextly();
  const reader = createPublicReader(
    {
      find: async args => await nextly.find(args),
      findSingle: async args => await nextly.findSingle(args),
    },
    locale === undefined ? {} : { locale }
  );
  return {
    find: query => reader.find(query),
    count: query => reader.count(query),
    findSingle: query => reader.findSingle(query),
    siteSettings: async () => ({ ...(await readPublicSiteSettings()) }),
  };
}

/** The reads a named run binds: the caller's permission, the registry, the reader. */
function directNamedListEntriesReads(
  ctx: PluginRouteContext,
  definitionOf: (name: string) => NamedQueryDefinition | undefined
): NamedListEntriesReads {
  return {
    mayRead: slug =>
      ctx.caller === null
        ? Promise.resolve(false)
        : ctx.caller.can("read", slug),
    definitionOf,
    baseReader: publicBaseReader,
    fieldsOf: async (collection, locale) => {
      const { bindingFieldShapes } = await import("nextly/runtime");
      return bindingFieldShapes(
        { collection },
        locale === undefined ? {} : { locale }
      );
    },
    // nextly's frame, as a published page's runs use: inside it the Direct
    // API refuses every call, and the reader reads through its own door.
    frame: name => {
      const opened = import("nextly/runtime").then(runtime =>
        runtime.openNamedQueryFrame(name)
      );
      return {
        run: async operation => (await opened).run(operation),
        read: async operation => (await opened).read(operation),
      };
    },
    today: async () => {
      const { readPublicSiteSettings } = await import("nextly/runtime");
      const settings = await readPublicSiteSettings().catch(() => undefined);
      return calendarDayIn(
        safeTimeZone(settings?.timezone ?? undefined).zone,
        new Date()
      );
    },
    // Its code and reference only: the error's words may hold whatever the
    // query's code put in them.
    report: failure =>
      ctx.logger.warn(namedQueryFailureLine(failure, "the editor's canvas")),
  };
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
export function listEntriesRoute(
  /** The registered named query of a name: the engine's registry. */
  definitionOf: (
    name: string
  ) => NamedQueryDefinition | undefined = getNamedQuery
): {
  method: "POST";
  path: string;
  handler: (req: Request, ctx: PluginRouteContext) => Promise<Response>;
} {
  return {
    method: "POST",
    path: LIST_ENTRIES_ROUTE_PATH,
    handler: async (req, ctx) => {
      const body = await readBodyWith(req, ListEntriesAnyBody, "list entries");
      if ("named" in body) {
        const answer = await readNamedListEntries(
          body,
          directNamedListEntriesReads(ctx, definitionOf)
        );
        return respondList([...answer.items], answer.meta);
      }
      const answer = await readListEntries(body, directListEntriesReads(ctx));
      return respondList([...answer.items], answer.meta);
    },
  };
}
