/**
 * `GET /templates/entry-designs?collection=<slug>`: the own designs of one
 * collection's entries, with the collection's template and names, for the
 * admin surfaces that show them (the entry's Design section, the entry list's
 * Design column, the template's own designs and its delete dialog). Asked
 * with `&entry=<id>` beside the collection, it answers that entry's own
 * design alone, which is how a surface asks whether an entry has one: the
 * list is capped, so its absence from the list says nothing. Asked with
 * `&entries=<id>,<id>`, it answers the own designs of those entries alone,
 * which is how the entry list's Design column marks the rows on its screen
 * whose designs lie past the capped list. Asked with
 * `?template=<id>` instead, it answers for the collection that template is
 * about, or, for an entry's own design, for that entry alone, which is how a
 * template's own screens find it.
 *
 * ## Read as the caller
 *
 * Each read is the caller's own, through core's read access, so a caller sees
 * only the templates they may read. Two questions come first, before anything
 * is read: whether the caller may read the collection, and whether they may
 * read templates. A caller refused either is answered an empty list and no
 * template, with `templateReadable` false, which says nothing of what is
 * stored. Those are questions about the collection and the templates, not
 * about entries: a collection whose read rule filters its rows lets a caller
 * read some entries and not others, and an own design names its entry, its
 * title that entry's title when it was given. So the own designs found are
 * kept only where the caller may read their entries, asked of the collection
 * in one read as the caller for each page of own designs.
 *
 * ## Read page by page
 *
 * Which own designs survive that filter is known only after the rows are
 * read, so the newest {@link ENTRY_DESIGNS_MAX} rows may hold few the caller
 * may read, or none, while older ones hold many. The rows are therefore read a
 * page of {@link ENTRY_DESIGNS_MAX} at a time, each page filtered as above,
 * until the list holds {@link ENTRY_DESIGNS_MAX} own designs or the rows run
 * out. A collection whose own designs fill
 * {@link ENTRY_DESIGNS_SCAN_PAGES} pages stops there, and so does a list cut
 * at its bound with rows still unread: both answer `meta.hasNext`, which the
 * surfaces read as "more may exist", never as the whole list.
 *
 * ## Three queries
 *
 * The collection's template is the one row naming the collection; its own
 * designs are the rows naming it as their entry's collection, an indexed
 * field, newest edit first, a page of {@link ENTRY_DESIGNS_MAX} at a time, or
 * the rows holding the unique keys of the entries asked about, in one read;
 * and, for each page, the entries those name that the caller may read, by
 * id. Each selects only the columns it needs.
 *
 * @experimental Settles when collection templates ship.
 * @module templates/entry-designs-route
 */
import {
  getCachedNextly,
  respondList,
  type PluginRouteContext,
} from "@nextlyhq/plugin-sdk";
import { z } from "nextly/zod";

import { labelOf, pluralLabelOf } from "../collection-labels";
import {
  entryDesignKey,
  TEMPLATE_COLLECTION_FIELD,
  TEMPLATE_ENTRY_COLLECTION_FIELD,
  TEMPLATE_ENTRY_FIELD,
  TEMPLATE_ENTRY_ID_FIELD,
} from "../collections/templates";
import { readOrNull } from "../composition-route-kit";
import { readingAsUser } from "../library-route";
import { parseRouteQuery } from "../route-query";

import {
  ENTRY_DESIGNS_ENTRIES_MAX,
  ENTRY_DESIGNS_MAX,
  ENTRY_DESIGNS_PARAMS,
  ENTRY_DESIGNS_ROUTE_PATH,
  type CollectionTemplate,
  type EntryDesignItem,
  type EntryDesignsResponse,
  type TemplateState,
} from "./entry-designs-contract";
import {
  templateCollectionProblem,
  type TemplateGuardSetup,
} from "./template-guard";

/**
 * The most pages of own design rows one read goes through looking for those
 * the caller may read: {@link ENTRY_DESIGNS_MAX} rows each. Own designs are the
 * exception in a collection, so a collection past this many is far outside
 * what the surfaces are for, and the read stops rather than walk every row of
 * it; `meta.hasNext` then says the list is not the whole.
 */
export const ENTRY_DESIGNS_SCAN_PAGES = 10;

/** One slug or id as a query carries it. */
const QUERY_ID = z.string().trim().min(1).max(512);

/**
 * Entry ids as a query carries them: comma-separated, each trimmed, blanks
 * dropped and repeats folded, so `a,,a, b` names two entries. At least one
 * and at most {@link ENTRY_DESIGNS_ENTRIES_MAX}: more is refused rather than
 * cut, since a cut list answers for entries other than the ones asked about.
 */
const QUERY_IDS = z
  .string()
  .transform(value => [
    ...new Set(
      value
        .split(",")
        .map(id => id.trim())
        .filter(id => id !== "")
    ),
  ])
  .pipe(z.array(QUERY_ID).min(1).max(ENTRY_DESIGNS_ENTRIES_MAX));

/**
 * The route's query: the collection whose own designs are listed, with one
 * of its entries, or some of them, to answer for alone, or a template whose
 * collection is meant. A collection or a template, never both; an entry or
 * entries only with a collection, and never both.
 */
const ENTRY_DESIGNS_QUERY = z
  .object({
    [ENTRY_DESIGNS_PARAMS.collection]: QUERY_ID.optional(),
    [ENTRY_DESIGNS_PARAMS.entry]: QUERY_ID.optional(),
    [ENTRY_DESIGNS_PARAMS.entries]: QUERY_IDS.optional(),
    [ENTRY_DESIGNS_PARAMS.template]: QUERY_ID.optional(),
  })
  .refine(
    query =>
      (query[ENTRY_DESIGNS_PARAMS.collection] === undefined) !==
      (query[ENTRY_DESIGNS_PARAMS.template] === undefined),
    { message: "Name a collection or a template, and only one." }
  )
  .refine(
    query =>
      query[ENTRY_DESIGNS_PARAMS.entry] === undefined ||
      query[ENTRY_DESIGNS_PARAMS.collection] !== undefined,
    { message: "Name an entry only with its collection." }
  )
  .refine(
    query =>
      query[ENTRY_DESIGNS_PARAMS.entries] === undefined ||
      (query[ENTRY_DESIGNS_PARAMS.collection] !== undefined &&
        query[ENTRY_DESIGNS_PARAMS.entry] === undefined),
    { message: "Name entries only with their collection, and not an entry." }
  );

/** The route's query, read from `url`, or a validation error naming it. */
export function parseEntryDesignsQuery(
  url: string | URL
): z.output<typeof ENTRY_DESIGNS_QUERY> {
  return parseRouteQuery(
    url,
    Object.values(ENTRY_DESIGNS_PARAMS),
    ENTRY_DESIGNS_QUERY,
    "entry designs route"
  );
}

/** What the read is built with: the template guard's own lookups. */
export interface EntryDesignsSetup {
  readonly guard: () => TemplateGuardSetup;
}

/** The slice of the route context the read uses. */
type EntryDesignsContext = Pick<PluginRouteContext, "caller">;

/** What one read is about: a collection, and perhaps some entries of it. */
export interface EntryDesignsAsk {
  readonly collection: string;
  /** One entry to answer for alone; the collection's list when absent. */
  readonly entry?: string;
  /**
   * Entries to answer for alone, at most {@link ENTRY_DESIGNS_ENTRIES_MAX};
   * never beside `entry`. The collection's list when absent.
   */
  readonly entries?: readonly string[];
}

/** What the read needs to find templates, injected so it is tested alone. */
export interface EntryDesignsReads {
  /** Whether the caller may `action` on `slug`, of any entry. */
  can(action: "read" | "create", slug: string): Promise<boolean>;
  /** One template row by id, as the caller reads it, or null. */
  template(id: string): Promise<Record<string, unknown> | null>;
  /** Template rows matching `where`, as the caller reads them. */
  templates(args: {
    where: Record<string, unknown>;
    limit: number;
    select: Record<string, true>;
    sort?: string[];
    /** Which page of `limit` rows, from 1; the first when absent. */
    page?: number;
  }): Promise<{ rows: Record<string, unknown>[]; hasNext: boolean }>;
  /** Which of `ids` the caller may read in `collection`, in one read. */
  readableEntries(
    collection: string,
    ids: readonly string[]
  ): Promise<ReadonlySet<string>>;
}

/** A row's id as text, or undefined. */
function idOf(row: Record<string, unknown>): string | undefined {
  const id = row.id;
  return typeof id === "string" || typeof id === "number"
    ? String(id)
    : undefined;
}

/** A row's state; anything but published is not live. */
function stateOf(row: Record<string, unknown>): TemplateState {
  return row.status === "published" ? "published" : "draft";
}

/** A row's title, or its id where it has none. */
function titleOf(row: Record<string, unknown>, id: string): string {
  return typeof row.title === "string" && row.title.trim() !== ""
    ? row.title
    : id;
}

/** When a row was last saved, as an ISO string, or null. */
function updatedOf(row: Record<string, unknown>): string | null {
  const value = row.updatedAt;
  if (typeof value === "string" && value !== "") return value;
  if (value instanceof Date && !Number.isNaN(value.getTime())) {
    return value.toISOString();
  }
  return null;
}

/** A collection's names: its labels, or its slug where it has none. */
function namesOf(
  record: Record<string, unknown> | null,
  slug: string
): { singular: string; plural: string } {
  if (record === null) return { singular: slug, plural: slug };
  const labels = record.labels;
  const singular =
    typeof labels === "object" &&
    labels !== null &&
    typeof (labels as { singular?: unknown }).singular === "string" &&
    (labels as { singular: string }).singular.trim() !== ""
      ? (labels as { singular: string }).singular
      : labelOf(record, slug);
  return { singular, plural: pluralLabelOf(record).pluralLabel ?? singular };
}

/**
 * The answer of a read that withheld the collection's templates: nothing
 * listed, no template, and nothing offered.
 */
function withheldAnswer(
  ask: EntryDesignsAsk,
  templatesCollection: string,
  names: { singular: string; plural: string },
  templateAllowed: boolean
): EntryDesignsResponse {
  return {
    items: [],
    meta: {
      total: 0,
      page: 1,
      limit: ENTRY_DESIGNS_MAX,
      totalPages: 0,
      hasNext: false,
      hasPrev: false,
      template: null,
      templateReadable: false,
      templateAllowed,
      mayCreateTemplate: false,
      mayGiveDesign: false,
      entry: ask.entry ?? null,
      templatesCollection,
      names,
      collection: ask.collection,
    },
  };
}

/**
 * What a template is about: the collection it draws, or, for an entry's own
 * design, that entry and its collection. Read as the caller, so a template
 * they may not read names nothing; an empty collection then, which every
 * read answers withheld.
 */
export async function askOfTemplate(
  id: string,
  reads: EntryDesignsReads
): Promise<EntryDesignsAsk> {
  const row = await reads.template(id);
  const base = row?.[TEMPLATE_COLLECTION_FIELD];
  if (typeof base === "string" && base !== "") return { collection: base };
  const collection = row?.[TEMPLATE_ENTRY_COLLECTION_FIELD];
  const entry = row?.[TEMPLATE_ENTRY_ID_FIELD];
  return typeof collection === "string" && typeof entry === "string"
    ? { collection, entry }
    : { collection: "" };
}

/**
 * The own design rows `ask` is about, from the indexed field or the unique
 * keys of the entries asked about. Each entry has at most one own design, so
 * a read of the keys holds them all in one page.
 */
function designsQuery(
  ask: EntryDesignsAsk
): Parameters<EntryDesignsReads["templates"]>[0] {
  const select: Record<string, true> = {
    id: true,
    title: true,
    status: true,
    updatedAt: true,
    [TEMPLATE_ENTRY_ID_FIELD]: true,
  };
  if (ask.entries !== undefined) {
    return {
      where: {
        [TEMPLATE_ENTRY_FIELD]: {
          in: ask.entries.map(id => entryDesignKey(ask.collection, id)),
        },
      },
      limit: ask.entries.length,
      select,
      sort: ["-updatedAt", "id"],
    };
  }
  return ask.entry === undefined
    ? {
        where: {
          [TEMPLATE_ENTRY_COLLECTION_FIELD]: { equals: ask.collection },
        },
        limit: ENTRY_DESIGNS_MAX,
        select,
        sort: ["-updatedAt", "id"],
      }
    : {
        where: {
          [TEMPLATE_ENTRY_FIELD]: {
            equals: entryDesignKey(ask.collection, ask.entry),
          },
        },
        limit: 1,
        select,
      };
}

/** An own design row as the surfaces read it, or nothing for a malformed one. */
function designItemOf(row: Record<string, unknown>): EntryDesignItem[] {
  const id = idOf(row);
  const entryId = row[TEMPLATE_ENTRY_ID_FIELD];
  if (id === undefined || typeof entryId !== "string" || entryId === "") {
    return [];
  }
  return [
    {
      id,
      entryId,
      title: titleOf(row, id),
      status: stateOf(row),
      updatedAt: updatedOf(row),
    },
  ];
}

/** The collection's template row as the surfaces name it, or null. */
function templateOf(
  row: Record<string, unknown> | undefined
): CollectionTemplate | null {
  const id = row === undefined ? undefined : idOf(row);
  return row === undefined || id === undefined
    ? null
    : { id, title: titleOf(row, id), status: stateOf(row) };
}

/** The own designs a read found that the caller may read, and if more may. */
interface ReadableDesigns {
  readonly items: EntryDesignItem[];
  readonly hasNext: boolean;
}

/**
 * The own designs `ask` is about whose entries the caller may read, newest
 * edit first: read a page at a time and filtered as each page lands, until
 * the bound is filled, the rows run out or the page ceiling is reached. An
 * own design a page repeats, as one edited mid-read can move between pages,
 * is listed once.
 */
async function readableDesigns(
  ask: EntryDesignsAsk,
  reads: EntryDesignsReads
): Promise<ReadableDesigns> {
  const query = designsQuery(ask);
  const items: EntryDesignItem[] = [];
  const seen = new Set<string>();
  for (let page = 1; ; page += 1) {
    const designs = await reads.templates({ ...query, page });
    const found = designs.rows
      .flatMap(designItemOf)
      .filter(item => !seen.has(item.id));
    for (const item of found) seen.add(item.id);
    const readable = await reads.readableEntries(
      ask.collection,
      found.map(item => item.entryId)
    );
    items.push(...found.filter(item => readable.has(item.entryId)));
    // Past the bound, the rest are cut: more exist.
    if (items.length > query.limit) {
      return { items: items.slice(0, query.limit), hasNext: true };
    }
    if (!designs.hasNext) return { items, hasNext: false };
    // Rows remain unread, so whether any of them is readable is not known:
    // the list is honest only as "these, and perhaps more".
    if (items.length === query.limit || page >= ENTRY_DESIGNS_SCAN_PAGES) {
      return { items, hasNext: true };
    }
  }
}

/** Answer one read for `ask`, as the module docblock describes. */
export async function readEntryDesigns(
  ask: EntryDesignsAsk,
  guard: TemplateGuardSetup,
  reads: EntryDesignsReads
): Promise<EntryDesignsResponse> {
  const templates = guard.templatesCollection;
  const { collection } = ask;
  const unknown = { singular: collection, plural: collection };
  // A template the caller may not read names no collection.
  if (collection === "") {
    return withheldAnswer(ask, templates, unknown, false);
  }
  // Preconditions first, asked together: nothing about the collection is
  // read for a caller who may not read it.
  const [mayReadCollection, mayReadTemplates] = await Promise.all([
    reads.can("read", collection),
    reads.can("read", templates),
  ]);
  if (!mayReadCollection) {
    return withheldAnswer(ask, templates, unknown, false);
  }
  const record = await guard.readCollection(collection);
  const names = namesOf(record, collection);
  const [problem, mayCreate] = await Promise.all([
    templateCollectionProblem(
      collection,
      () => Promise.resolve(record),
      guard.ownCollections()
    ),
    reads.can("create", templates),
  ]);
  const templateAllowed = problem === null;
  if (!mayReadTemplates) {
    return withheldAnswer(ask, templates, names, templateAllowed);
  }

  const [base, designs] = await Promise.all([
    reads.templates({
      where: { [TEMPLATE_COLLECTION_FIELD]: { equals: collection } },
      limit: 1,
      select: { id: true, title: true, status: true },
    }),
    // Only the own designs of entries the caller may read, page by page.
    readableDesigns(ask, reads),
  ]);
  const template = templateOf(base.rows[0]);
  const { items } = designs;

  return {
    items,
    meta: {
      total: items.length,
      page: 1,
      limit: ENTRY_DESIGNS_MAX,
      totalPages: items.length === 0 ? 0 : 1,
      hasNext: designs.hasNext,
      hasPrev: false,
      template,
      templateReadable: true,
      templateAllowed,
      mayCreateTemplate: mayCreate && templateAllowed && template === null,
      mayGiveDesign: mayCreate && template?.status === "published",
      entry: ask.entry ?? null,
      templatesCollection: templates,
      names,
      collection,
    },
  };
}

/** Rows a caller-scoped find answered, or none. */
function rowsOf(found: unknown): {
  rows: Record<string, unknown>[];
  hasNext: boolean;
} {
  const answer =
    typeof found === "object" && found !== null
      ? (found as { items?: unknown; meta?: { hasNext?: unknown } })
      : {};
  const rows = Array.isArray(answer.items)
    ? answer.items.filter(
        (row): row is Record<string, unknown> =>
          typeof row === "object" && row !== null
      )
    : [];
  return { rows, hasNext: answer.meta?.hasNext === true };
}

/** The reads the route binds: the caller's rights, and core's find as them. */
function directEntryDesignsReads(
  ctx: EntryDesignsContext,
  templates: string
): EntryDesignsReads {
  return {
    // No caller is no reader: the route is authenticated, so this guards a
    // caller the dispatcher could not resolve, and it lists nothing.
    can: (action, slug) =>
      ctx.caller === null
        ? Promise.resolve(false)
        : ctx.caller.can(action, slug, { anyEntry: true }),
    template: async id => {
      const found = await readOrNull(async () =>
        (await getCachedNextly()).findByID({
          collection: templates,
          id,
          ...(await readingAsUser(ctx)),
          status: "all",
          depth: 0,
          select: {
            id: true,
            [TEMPLATE_COLLECTION_FIELD]: true,
            [TEMPLATE_ENTRY_COLLECTION_FIELD]: true,
            [TEMPLATE_ENTRY_ID_FIELD]: true,
          },
        })
      );
      return typeof found === "object" && found !== null
        ? (found as Record<string, unknown>)
        : null;
    },
    templates: async ({ where, limit, select, sort, page }) =>
      rowsOf(
        await readOrNull(async () =>
          (await getCachedNextly()).find({
            collection: templates,
            where,
            limit,
            ...(page === undefined ? {} : { page }),
            select,
            ...(sort === undefined ? {} : { sort }),
            ...(await readingAsUser(ctx)),
            status: "all",
            depth: 0,
          })
        )
      ),
    // The collection's own read, as the caller: its read rule, a filter
    // included, decides which of the entries come back.
    readableEntries: async (collection, ids) => {
      if (ids.length === 0) return new Set<string>();
      const { rows } = rowsOf(
        await readOrNull(async () =>
          (await getCachedNextly()).find({
            collection,
            where: { id: { in: [...ids] } },
            limit: ids.length,
            select: { id: true },
            ...(await readingAsUser(ctx)),
            status: "all",
            depth: 0,
          })
        )
      );
      return new Set(rows.flatMap(row => idOf(row) ?? []));
    },
  };
}

/**
 * The route declaration. Authenticated (no `public: true`) with no permission
 * of its own: what it lists is asked of the caller above, collection,
 * templates and entries alike.
 */
export function entryDesignsRoute(setup: EntryDesignsSetup): {
  method: "GET";
  path: string;
  handler: (req: Request, ctx: PluginRouteContext) => Promise<Response>;
} {
  return {
    method: "GET",
    path: ENTRY_DESIGNS_ROUTE_PATH,
    handler: async (req, ctx) => {
      const query = parseEntryDesignsQuery(req.url);
      const guard = setup.guard();
      const reads = directEntryDesignsReads(ctx, guard.templatesCollection);
      const collection = query[ENTRY_DESIGNS_PARAMS.collection];
      const entry = query[ENTRY_DESIGNS_PARAMS.entry];
      const entries = query[ENTRY_DESIGNS_PARAMS.entries];
      const template = query[ENTRY_DESIGNS_PARAMS.template];
      const ask: EntryDesignsAsk =
        collection !== undefined
          ? {
              collection,
              ...(entry === undefined ? {} : { entry }),
              ...(entries === undefined ? {} : { entries }),
            }
          : template === undefined
            ? { collection: "" }
            : await askOfTemplate(template, reads);
      const answer = await readEntryDesigns(ask, guard, reads);
      return respondList([...answer.items], answer.meta);
    },
  };
}
