/**
 * The read behind the inspector's relation control: a collection's entries,
 * searched by title or resolved by id, as `{ id, title }` and nothing else.
 *
 * ## Which collections it reads
 *
 * Only one that a REGISTERED block prop names as its relation target
 * (`{ type: "relation", relationTo: "<slug>" }`). The editor has no other
 * reason to read a collection, so a route that took any slug would be a general
 * entry browser handed to every signed-in author — and its answers, even its
 * refusals, would describe collections the editor never meant to show. Any
 * other slug is refused before anything is read, with the generic forbidden
 * answer, so the refusal reads the same whether or not the collection exists.
 *
 * ## Who decides what the caller may read
 *
 * Core, and nothing here. The read runs through the Direct API AS THE CALLER
 * (`readingAsUser`): `overrideAccess: false` with the identity the dispatcher
 * resolved. The collection's read rule, its row filters and its field-level
 * read rules all apply exactly as they do to the caller's own reads. The
 * target check above is not an access decision — it narrows which questions
 * may be asked, not who may have the answers — so the route has one door, and
 * it is core's.
 *
 * ## Why no declared permission
 *
 * A route's `requiredPermission` is resolved before the request is read, so it
 * cannot name a collection the query chooses. The route is authenticated (no
 * `public: true`), and the read permission is the read's own: a caller without
 * it is refused by core as any read of theirs would be.
 *
 * ## What travels
 *
 * The id and the title, read from the collection's title field — its
 * `admin.useAsTitle` when it nominates one, or the conventional name the admin
 * falls back to — and that field is the only one selected. Where the title is
 * absent or this caller may not read it, the entry is labelled with the
 * neutral {@link ENTRIES_UNTITLED}, never with another field.
 *
 * @module entries-route
 */
import { allBlocks } from "@nextlyhq/blocks-engine";
import { NextlyError, type PluginRouteContext } from "@nextlyhq/plugin-sdk";
import { respondList, type PaginationMeta, type WhereFilter } from "nextly";
import { entryTitleField, readableTitleText } from "nextly/config";
import { requireNextly } from "nextly/runtime";
import { z } from "nextly/zod";

import {
  ENTRIES_IDS_MAX,
  ENTRIES_LIMIT_DEFAULT,
  ENTRIES_LIMIT_MAX,
  ENTRIES_PARAMS,
  ENTRIES_ROUTE_PATH,
  ENTRIES_SEARCH_MAX,
  ENTRIES_UNTITLED,
  type EntriesResponse,
  type EntryItem,
} from "./entries-contract";
import { readingAsUser } from "./library-route";

/**
 * The longest single id the route accepts.
 *
 * Ids are uuids or short integers; a bound keeps one oversized value from
 * becoming an oversized `IN` list, which the count bound alone does not.
 */
const ENTRY_ID_MAX = 200;

/** A read the route will make, once its query has been checked. */
export interface EntriesRequest {
  readonly collection: string;
  /** Trimmed, non-empty, at most {@link ENTRIES_SEARCH_MAX} characters. */
  readonly search?: string;
  /** Distinct, non-empty, at most {@link ENTRIES_IDS_MAX} of them. */
  readonly ids?: readonly string[];
  /** Between 1 and {@link ENTRIES_LIMIT_MAX}. */
  readonly limit: number;
}

/**
 * The query, as zod reads it.
 *
 * Every value arrives as a string or not at all, which is what a URL carries.
 * A limit above the ceiling is CAPPED rather than refused (see the contract);
 * a limit that is not a positive whole number is refused, because it is not a
 * limit at all. An empty search is no search.
 */
const querySchema = z.object({
  [ENTRIES_PARAMS.collection]: z.string().trim().min(1),
  [ENTRIES_PARAMS.search]: z
    .string()
    .trim()
    .max(ENTRIES_SEARCH_MAX)
    .optional()
    .transform(value => (value === "" ? undefined : value)),
  [ENTRIES_PARAMS.limit]: z
    .string()
    .regex(/^\d+$/)
    .transform(Number)
    .pipe(z.number().int().min(1))
    .transform(value => Math.min(value, ENTRIES_LIMIT_MAX))
    .optional(),
  [ENTRIES_PARAMS.ids]: z
    .string()
    .transform(value =>
      // Split, trimmed, blanks dropped and repeats folded, so `a,,a, b`
      // names two entries rather than four.
      [
        ...new Set(
          value
            .split(",")
            .map(id => id.trim())
            .filter(id => id !== "")
        ),
      ]
    )
    .pipe(z.array(z.string().max(ENTRY_ID_MAX)).max(ENTRIES_IDS_MAX))
    .optional(),
});

/**
 * Read the request's query into an {@link EntriesRequest}, or refuse it.
 *
 * Parsed at the boundary with zod, and refused as a validation error that
 * names the parameter and never echoes its value: what the caller sent goes
 * nowhere but the read it was checked for.
 */
export function parseEntriesQuery(url: string | URL): EntriesRequest {
  const params = new URL(url).searchParams;
  // Only the parameters the route reads, and each once: a repeated parameter
  // takes its first value, as `URLSearchParams.get` does everywhere.
  const raw: Record<string, string> = {};
  for (const name of Object.values(ENTRIES_PARAMS)) {
    const value = params.get(name);
    if (value !== null) raw[name] = value;
  }
  const parsed = querySchema.safeParse(raw);
  if (!parsed.success) {
    throw NextlyError.validation({
      errors: parsed.error.issues.map(issue => ({
        path: issue.path.map(String).join(".") || "query",
        code: "INVALID_QUERY",
        message: "This parameter is not one the entries route accepts.",
      })),
    });
  }
  const query = parsed.data;
  const ids = query[ENTRIES_PARAMS.ids];
  const search = query[ENTRIES_PARAMS.search];
  return {
    collection: query[ENTRIES_PARAMS.collection],
    ...(search === undefined ? {} : { search }),
    ...(ids === undefined || ids.length === 0 ? {} : { ids }),
    limit: query[ENTRIES_PARAMS.limit] ?? ENTRIES_LIMIT_DEFAULT,
  };
}

/**
 * Every collection a registered block prop names as a relation target.
 *
 * Read from the live registry on every call, as the save route reads it, so a
 * block registered after boot — or a re-registration — is seen. A prop counts
 * when it declares `type: "relation"` and a non-empty string `relationTo`;
 * anything else declares no target, and a malformed declaration must not open
 * a collection by accident.
 */
export function relationTargets(
  blocks: readonly { props?: unknown }[] = allBlocks()
): ReadonlySet<string> {
  const targets = new Set<string>();
  for (const block of blocks) collectTargets(block.props, targets, 0);
  return targets;
}

/**
 * How deep a list's item schemas are followed. A list of records holding
 * lists is as deep as the inspector draws; past that a declaration is not
 * one an author can reach, and the walk over untrusted schemas stays bounded.
 */
const MAX_SCHEMA_DEPTH = 4;

/**
 * Add every relation target a record of prop schemas names, including those
 * inside a list's `item` schema: the inspector draws a list item's fields
 * with the same controls, so a relation there searches this route too.
 */
function collectTargets(
  props: unknown,
  targets: Set<string>,
  depth: number
): void {
  if (depth > MAX_SCHEMA_DEPTH) return;
  if (typeof props !== "object" || props === null) return;
  for (const schema of Object.values(props)) {
    if (typeof schema !== "object" || schema === null) continue;
    const { type, relationTo, item } = schema as Record<string, unknown>;
    if (
      type === "relation" &&
      typeof relationTo === "string" &&
      relationTo !== ""
    ) {
      targets.add(relationTo);
    }
    if (type === "array") collectTargets(item, targets, depth + 1);
  }
}

/** One as-user list read, as the route asks the Direct API for it. */
export interface EntriesFindArgs {
  readonly collection: string;
  readonly where?: WhereFilter;
  readonly select: Record<string, boolean>;
  readonly limit: number;
}

/** What one list read answers: the rows and the read's pagination. */
export interface EntriesPage {
  readonly items: readonly unknown[];
  readonly meta: PaginationMeta;
}

/**
 * What the route reads with, injected so the decisions in {@link readEntries}
 * can be tested without a server and the route declaration is the one place
 * that binds them.
 */
export interface EntriesReads {
  /** The collections a registered block names as relation targets. */
  targets(): ReadonlySet<string>;
  /**
   * The collection's configuration, from which its title field is read. A
   * collection that does not exist answers `NextlyError.notFound`.
   */
  collection(slug: string): Promise<unknown>;
  /** One list read, AS THE CALLER. */
  find(args: EntriesFindArgs): Promise<EntriesPage>;
}

/**
 * Answer one read: refuse an undeclared collection, then read as the caller.
 *
 * The target check runs FIRST and reads nothing: it is a precondition, and a
 * refusal that came after a read of the collection could answer differently
 * for a collection that exists and one that does not.
 */
export async function readEntries(
  request: EntriesRequest,
  reads: EntriesReads
): Promise<EntriesResponse> {
  if (!reads.targets().has(request.collection)) {
    throw refusal(request.collection);
  }
  const title = await titleFieldOf(request.collection, reads);
  const titleField = title?.name;
  const where = whereFor(request, title);
  // A search nothing can match — no title field to search, or a number field
  // and words — matches nothing, rather than falling back to a field the
  // collection never said names its entries.
  if (where === NO_MATCH) return { items: [], meta: emptyMeta(request.limit) };
  let page: EntriesPage;
  try {
    page = await reads.find({
      collection: request.collection,
      ...(where === undefined ? {} : { where }),
      // The title field and nothing else. `id` is named so a collection with
      // no title field still selects SOMETHING: an empty selection selects
      // every field, which is the opposite of what is meant.
      select: {
        id: true,
        ...(titleField === undefined ? {} : { [titleField]: true }),
      },
      // A resolve answers in one page whatever limit was asked, since the ids
      // already bound it.
      limit: request.ids?.length ?? request.limit,
    });
  } catch (error) {
    // A caller who may read the entries but not their title field cannot
    // filter on it: core refuses the filter rather than reveal the field
    // through the rows. For this caller the search matches nothing, which is
    // the honest answer, rather than a failure the control can only retry.
    if (
      request.search !== undefined &&
      NextlyError.isCode(error, "FIELD_NOT_FILTERABLE")
    ) {
      return { items: [], meta: emptyMeta(request.limit) };
    }
    throw error;
  }
  return {
    items: page.items.flatMap(row => {
      const item = itemOf(row, titleField);
      return item === undefined ? [] : [item];
    }),
    meta: canonicalMeta(page.meta),
  };
}

/**
 * The generic refusal, the same for every slug the route will not read.
 *
 * The slug goes to the log and nowhere else: naming it in the answer, or
 * answering differently for a slug that exists, would let a caller map the
 * site's collections through this route.
 */
function refusal(collection: string): NextlyError {
  return NextlyError.forbidden({
    logContext: { route: ENTRIES_ROUTE_PATH, collection },
  });
}

/**
 * The field that names this collection's entries, or `undefined` for none.
 *
 * Core's own rule (`entryTitleField`), which the admin and the dashboard ask
 * too: the nominated `admin.useAsTitle` when the collection has that field,
 * else the first conventional title name it has. A second rule here would name
 * an entry one thing in the picker and another in the entry list.
 *
 * A declared target whose collection does not exist is refused exactly as an
 * undeclared one is, so the answer never says which of the two it was.
 */
/** The field that names a collection's entries, and whether it holds a number. */
interface TitleField {
  readonly name: string;
  readonly numeric: boolean;
}

async function titleFieldOf(
  slug: string,
  reads: EntriesReads
): Promise<TitleField | undefined> {
  let record: unknown;
  try {
    record = await reads.collection(slug);
  } catch (error) {
    if (NextlyError.isNotFound(error)) throw refusal(slug);
    throw error;
  }
  if (typeof record !== "object" || record === null) throw refusal(slug);
  const { admin, fields } = record as { admin?: unknown; fields?: unknown };
  const nominated =
    typeof admin === "object" && admin !== null
      ? (admin as { useAsTitle?: unknown }).useAsTitle
      : undefined;
  const name = entryTitleField(
    typeof nominated === "string" ? nominated : undefined,
    fieldNames(fields)
  );
  if (name === undefined) return undefined;
  return { name, numeric: NUMERIC_FIELD_TYPES.has(fieldType(fields, name)) };
}

/** The field types that hold a number, which a text search cannot match. */
const NUMERIC_FIELD_TYPES: ReadonlySet<string | undefined> = new Set([
  "number",
]);

/** A top-level field's declared type, or `undefined` when it has none. */
function fieldType(fields: unknown, name: string): string | undefined {
  if (!Array.isArray(fields)) return undefined;
  for (const field of fields) {
    if (typeof field !== "object" || field === null) continue;
    const { name: own, type } = field as { name?: unknown; type?: unknown };
    if (own === name) return typeof type === "string" ? type : undefined;
  }
  return undefined;
}

/** The names of a collection's top-level fields, from its stored declaration. */
function fieldNames(fields: unknown): string[] {
  if (!Array.isArray(fields)) return [];
  return fields.flatMap(field => {
    const name =
      typeof field === "object" && field !== null
        ? (field as { name?: unknown }).name
        : undefined;
    return typeof name === "string" && name !== "" ? [name] : [];
  });
}

/**
 * The where clause for one read: the ids asked for, the search on the title
 * field, both, or neither.
 *
 * `contains` is the Direct API's case-insensitive substring match on every
 * dialect, and the search is passed as typed: the query layer matches it
 * literally rather than as a pattern.
 */
function whereFor(
  request: EntriesRequest,
  title: TitleField | undefined
): WhereFilter | typeof NO_MATCH | undefined {
  const conditions: WhereFilter[] = [];
  if (request.ids !== undefined) {
    conditions.push({ id: { in: [...request.ids] } });
  }
  if (request.search !== undefined) {
    const searched = searchOn(request.search, title);
    if (searched === NO_MATCH) return NO_MATCH;
    conditions.push(searched);
  }
  if (conditions.length === 0) return undefined;
  return conditions.length === 1 ? conditions[0] : { and: conditions };
}

/** A search that cannot match anything, answered without a read. */
const NO_MATCH = Symbol("no match");

/**
 * The condition one search puts on the title field.
 *
 * A text field is matched by `contains`. A number field is matched exactly,
 * and only by a search that is a number: `contains` lower-cases its column,
 * which PostgreSQL refuses for a number while MySQL and SQLite convert it, so
 * a text match there would fail on one dialect alone.
 */
function searchOn(
  search: string,
  title: TitleField | undefined
): WhereFilter | typeof NO_MATCH {
  if (title === undefined) return NO_MATCH;
  if (!title.numeric) return { [title.name]: { contains: search } };
  const value = Number(search);
  return search.trim() !== "" && Number.isFinite(value)
    ? { [title.name]: { equals: value } }
    : NO_MATCH;
}

/**
 * One row as the control shows it, or nothing when it carries no usable id.
 *
 * The title is read through core's rule for a title VALUE, so a title of
 * spaces is as untitled here as on every other surface. A row without one —
 * empty, or removed by field-level read access — is labelled neutrally.
 */
function itemOf(
  row: unknown,
  titleField: string | undefined
): EntryItem | undefined {
  if (typeof row !== "object" || row === null) return undefined;
  const record = row as Record<string, unknown>;
  const id = typeof record.id === "number" ? String(record.id) : record.id;
  if (typeof id !== "string" || id === "") return undefined;
  const title =
    titleField === undefined
      ? undefined
      : readableTitleText(
          Object.hasOwn(record, titleField) ? record[titleField] : undefined
        );
  return { id, title: title ?? ENTRIES_UNTITLED };
}

/**
 * The read's pagination, as the canonical list meta and no more.
 *
 * Copied field by field rather than forwarded whole: the Direct API's meta may
 * carry more than paging, and anything forwarded unread is something this
 * route has said without deciding to.
 */
function canonicalMeta(meta: PaginationMeta): PaginationMeta {
  return {
    total: meta.total,
    page: meta.page,
    limit: meta.limit,
    totalPages: meta.totalPages,
    hasNext: meta.hasNext,
    hasPrev: meta.hasPrev,
  };
}

/** The meta of a read that matched nothing without being made. */
function emptyMeta(limit: number): PaginationMeta {
  return {
    total: 0,
    page: 1,
    limit,
    totalPages: 0,
    hasNext: false,
    hasPrev: false,
  };
}

/** The route context this reads: who is asking, and the collection service. */
interface EntriesRouteContext {
  readonly caller: PluginRouteContext["caller"];
  readonly services: {
    readonly collections: {
      getCollection(
        name: string,
        context: Record<string, never>
      ): Promise<unknown>;
    };
  };
}

/**
 * The reads the route binds: the live block registry, the collection's stored
 * configuration, and the Direct API AS THE CALLER.
 *
 * The configuration read is not an access decision and runs as nobody in
 * particular: it only says which field names an entry, and it is made only for
 * a collection a block already names in code. The ROWS are read as the user,
 * through the one statement of that this package has.
 */
function directEntriesReads(ctx: EntriesRouteContext): EntriesReads {
  return {
    targets: () => relationTargets(),
    collection: slug => ctx.services.collections.getCollection(slug, {}),
    find: async args => {
      const result = await requireNextly().find({
        collection: args.collection,
        ...(await readingAsUser(ctx)),
        // Every status, as the admin's own relationship picker asks: an
        // author may point at a post that is not published yet. Which rows
        // this caller sees is still core's to decide, through the line above.
        status: "all",
        ...(args.where === undefined ? {} : { where: args.where }),
        select: args.select,
        limit: args.limit,
      });
      return { items: result.items, meta: result.meta };
    },
  };
}

/**
 * The route declaration, thin on purpose: the method, the path, and that it is
 * authenticated. Everything it decides lives in {@link readEntries} and
 * {@link parseEntriesQuery}.
 */
export function entriesRoute(): {
  method: "GET";
  path: string;
  handler: (req: Request, ctx: PluginRouteContext) => Promise<Response>;
} {
  return {
    method: "GET",
    path: ENTRIES_ROUTE_PATH,
    // No `public: true`, which is what makes this authenticated, and no
    // `requiredPermission`: the collection is chosen by the query, which a
    // permission resolver never sees. The read's own access is core's.
    handler: async (req, ctx) => {
      const answer = await readEntries(
        parseEntriesQuery(req.url),
        directEntriesReads(ctx)
      );
      return respondList([...answer.items], answer.meta);
    },
  };
}
