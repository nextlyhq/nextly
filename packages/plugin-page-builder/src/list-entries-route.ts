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
 * ## A list whose source is a named query
 *
 * Its run function lives only on the server, so the canvas asks for one run
 * of it (`{ named }`), and the route makes it with the renderer's own
 * `readNamedList`, inside nextly's frame, over ONE base reader: the editor
 * reader above, as the caller, for the collections the query reads. Core's
 * gate judges each of those reads as the caller, as it judges a list's own,
 * so there is no second check here either.
 *
 * ## Caching
 *
 * None. The answer is one person's, so the route is `noStore`, it is never
 * tagged, and nothing a published page reads is made from it.
 *
 * @module list-entries-route
 */
import {
  calendarDayIn,
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
  DEFAULT_MAX_QUERIES,
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
import { assertMayOpen, directOpenReads } from "./conditions-preview-route";
import { editorReaderAsCaller, publicSourceReader } from "./entry-reads";
import { readingAsUser } from "./library-route";
import {
  LIST_ENTRIES_NAMED_MAX_PARAMS,
  LIST_ENTRIES_ROUTE_PATH,
  LIST_ENTRY_OPS,
  type ListEntriesNamedRequest,
  type ListEntriesNamedResponse,
  type ListEntriesRequest,
  type ListEntriesResponse,
} from "./list-entries-contract";
import type { TemplateGuardSetup } from "./templates/template-guard";

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

/** The document the editor has open, when a read asks as a visitor. */
const VISITOR = z
  .object({
    collection: z
      .string()
      .min(1)
      .max(128)
      .regex(/^[A-Za-z0-9_-]+$/),
    id: z.string().min(1).max(200),
  })
  .strict();

/**
 * The read, as the renderer sends it. Bounded as the reader bounds it, so a
 * body no list could build is refused here, before the caller is judged.
 */
const ListEntriesBody = z
  .object({
    visitor: VISITOR.optional(),
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
    visitor: VISITOR.optional(),
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
        // The node's id is written into the server log when a run fails, so
        // it may not carry a line break or a terminal control character.
        node: z
          .string()
          .max(200)
          .regex(/^[^\p{Cc}\p{Zl}\p{Zp}]*$/u, {
            message: "A node's id has no control characters.",
          })
          .optional(),
        allowance: z.number().int().min(0).max(DEFAULT_MAX_QUERIES).optional(),
      })
      .strict(),
  })
  .strict();

/** Either read the route takes: a list's read, or one named run. */
const ListEntriesAnyBody = z.union([ListEntriesBody, ListEntriesNamedBody]);

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

/**
 * What a named run is made with, injected so the run is tested without a
 * server. The canvas runs a query through ONE base reader, which the host
 * is built on: the reader the canvas's other list reads use, the editor
 * reader as the caller, so the rows an author designs around are the ones
 * they could read in the admin. Who may read what is core's gate's, inside
 * that reader; nothing here decides it again.
 */
export interface NamedListEntriesReads {
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
function countingBudget(
  max: number | undefined
): QueryBudget & { readonly taken: () => number } {
  const budget = createQueryBudget(max);
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
 * Answer one named run: the run's rows, made as the published page makes
 * them, over the base reader. A run that fails (a read the caller may not
 * make among them) answers no rows and its failure as the run judged it, so
 * the canvas draws the note a preview would, under the reference the log
 * names it by.
 */
export async function readNamedListEntries(
  request: ListEntriesNamedRequest,
  reads: NamedListEntriesReads
): Promise<ListEntriesNamedResponse> {
  const { name, params, limit, offset, locale, node, allowance } =
    request.named;
  const definition = reads.definitionOf(name);
  // No more than the canvas's draw has left, so the page's lists share one
  // allowance whichever of them runs where.
  const budget = countingBudget(allowance);
  const host: NamedQueryHost = {
    definitionOf: asked => (asked === name ? definition : undefined),
    reader: await reads.baseReader(locale),
    // Today is read from the site settings: a read like the query's own,
    // claimed from the same allowance and counted in what the answer says
    // it cost, as a published page claims it.
    today: async () => {
      if (!budget.take()) {
        throw new Error("The page's read allowance is spent.");
      }
      return await reads.today();
    },
    fieldsOf: collection => reads.fieldsOf(collection, locale),
    ...(reads.frame === undefined ? {} : { frame: reads.frame }),
    report: failure => reads.report(failure),
  };
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

/** Whether a Single's read found nothing the caller may see: absent or refused. */
function missedOrRefused(error: unknown): boolean {
  return (
    NextlyError.isNotFound(error) ||
    NextlyError.isForbidden(error) ||
    NextlyError.isAuthRequired(error)
  );
}

/** A document kept to the fields a query selects, its id always. */
function selectedOnly(
  document: Record<string, unknown>,
  select: readonly string[] | undefined
): Record<string, unknown> {
  if (select === undefined) return document;
  const kept = new Set(["id", ...select]);
  return Object.fromEntries(
    Object.entries(document).filter(([field]) => kept.has(field))
  );
}

/**
 * The canvas's base for a named run: what the person editing may read,
 * drafts included, as the canvas's other list reads read. Collections
 * through the editor reader; a Single through the Direct API as that person
 * (`overrideAccess: false`, their user and key), with the public read's own
 * refusals of the query first and its latest version, so a draft Single
 * reads as the admin shows it. A Single absent or refused reads as nothing,
 * as the public reader answers. Only the site settings stay the public's:
 * they are the site's public settings either way.
 */
async function canvasBaseReader(
  ctx: PluginRouteContext,
  locale: string | undefined
): Promise<ListBaseReader> {
  const {
    createEditorReader,
    readPublicSiteSettings,
    requireNextly,
    toPublicFindSingle,
  } = await import("nextly/runtime");
  const nextly = requireNextly();
  const { user, actor } = await readingAsUser(ctx);
  const person = { user, ...(actor === undefined ? {} : { actor }) };
  const binding = locale === undefined ? {} : { locale };
  const editor = createEditorReader(
    { find: async args => await nextly.find(args) },
    person,
    binding
  );
  return {
    find: query => editor.find(query),
    count: query => editor.count(query),
    findSingle: async query => {
      const args = {
        ...toPublicFindSingle(query, binding),
        status: "all" as const,
        draft: true,
        overrideAccess: false,
        ...person,
      };
      try {
        const found: unknown = await nextly.findSingle(args);
        return typeof found === "object" && found !== null
          ? selectedOnly(found as Record<string, unknown>, query.select)
          : null;
      } catch (error) {
        if (missedOrRefused(error)) return null;
        throw error;
      }
    },
    siteSettings: async () => ({ ...(await readPublicSiteSettings()) }),
  };
}

/**
 * The base for a named run asked as a visitor: what an anonymous visitor
 * reads, published entries and public fields only, through the public reader
 * a published page's runs use, and the site's public settings.
 */
async function visitorBaseReader(
  locale: string | undefined
): Promise<ListBaseReader> {
  const { readPublicSiteSettings } = await import("nextly/runtime");
  const reader = await publicSourceReader(locale);
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
  definitionOf: (name: string) => NamedQueryDefinition | undefined,
  /** Run over what a visitor reads, rather than what the caller reads. */
  asVisitor: boolean
): NamedListEntriesReads {
  return {
    definitionOf,
    baseReader: locale =>
      asVisitor ? visitorBaseReader(locale) : canvasBaseReader(ctx, locale),
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
    // The site's zone, else UTC, as a published page with no zone of its
    // own reads it. Settings that cannot be read fail the run, which the
    // canvas then says, rather than a day in the wrong zone.
    today: async () => {
      const { readPublicSiteSettings } = await import("nextly/runtime");
      const settings = await readPublicSiteSettings();
      return calendarDayIn(
        safeTimeZone(settings.timezone ?? undefined).zone,
        new Date()
      );
    },
    // Its code and reference only: the error's words may hold whatever the
    // query's code put in them.
    report: failure =>
      ctx.logger.warn(namedQueryFailureLine(failure, "the editor's canvas")),
  };
}

/**
 * The read the route binds: the editor reader as the caller; or, asked as a
 * visitor, the public reader, which reads published entries and the fields a
 * visitor may read, judged by the anonymous caller's rules.
 */
function directListEntriesReads(
  ctx: PluginRouteContext,
  asVisitor: boolean
): ListEntriesReads {
  return {
    // Built per read in the read's own language.
    find: async query =>
      asVisitor
        ? (await publicSourceReader(query.locale)).find(query)
        : (await editorReaderAsCaller(ctx, query.locale)).find(query),
  };
}

/** The route's name in the log, beside the collection a refusal names. */
const ROUTE = "list entries";

/**
 * The route declaration. Authenticated (no `public: true`), with no
 * permission of its own: core's gate judges each read as the caller.
 * A POST because a read carries a query, never because it writes; `noStore`
 * because its answer is one person's.
 */
export function listEntriesRoute(
  /** The registered named query of a name: this instance's own registry. */
  definitionOf: (name: string) => NamedQueryDefinition | undefined,
  /** The collections' records, for the visitor read's open guard. */
  guard: () => TemplateGuardSetup
): {
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
      const body = await readBodyWith(req, ListEntriesAnyBody, ROUTE);
      const locale = "named" in body ? body.named.locale : body.query.locale;
      // Asked as a visitor: first, before anything is read, whether the
      // caller may open the document named, with 2a's one guard and its one
      // forbidden answer.
      const asVisitor = body.visitor !== undefined;
      if (body.visitor !== undefined) {
        await assertMayOpen(
          { ...body.visitor, ...(locale === undefined ? {} : { locale }) },
          directOpenReads(ctx, guard),
          ROUTE
        );
      }
      if ("named" in body) {
        const answer = await readNamedListEntries(
          body,
          directNamedListEntriesReads(ctx, definitionOf, asVisitor)
        );
        return respondList([...answer.items], answer.meta);
      }
      const answer = await readListEntries(
        body,
        directListEntriesReads(ctx, asVisitor)
      );
      return respondList([...answer.items], answer.meta);
    },
  };
}
