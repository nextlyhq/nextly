/**
 * The reads behind a template's preview in the editor: the entries of the
 * template's collection the author may preview, and the one being previewed.
 *
 * A template draws every entry of the collection it names, so while it is
 * edited the canvas draws it with one real entry of that collection, chosen
 * in the strip above the canvas. These two routes answer that strip and the
 * canvas, and store nothing: which entry is previewed is the editor's state,
 * so there is no builder op for it.
 *
 * ## Which collections they read
 *
 * Only one that may have a template, by the guard's own rule
 * (`templateCollectionProblem`): a real collection, not one of the page
 * builder's own and not one kept out of the admin. Anything else is refused
 * before a row is read, with the generic forbidden answer, and so is a
 * collection the caller may not read, so the refusal reads the same whether
 * the collection is missing or unreadable.
 *
 * ## Who decides what the caller may read
 *
 * Core, and nothing here. The list reads AS THE CALLER through the Direct API
 * (`findAsCaller`, every status, `overrideAccess: false`), the entry through
 * the editor reader (`createEditorReader`), which reads as the caller with
 * the working draft in place of the live row. An entry the caller may not
 * read is never listed and never answered. Whether they may create an entry
 * is the framework's own answer (`caller.can`), the one a create is judged by.
 *
 * ## The list
 *
 * The 20 most recently updated entries, then by id, each with its title, its
 * status in the admin's words, and when it was updated. A search matches the
 * collection's title field as the relation control's search does
 * (`searchOn`). Whether a published entry has a working draft waiting is
 * core's `_pendingChange` filter, read as the caller over the listed ids, as
 * the pages search reads it.
 *
 * ## Caching
 *
 * None: each answer is one person's, so both routes are `noStore`.
 *
 * @experimental Settles when collection templates ship.
 * @module templates/template-preview-route
 */
import type { BindingFieldShape } from "@nextlyhq/blocks-engine";
import {
  NextlyError,
  resolvedCollectionView,
  type PluginRouteContext,
} from "@nextlyhq/plugin-sdk";
import { respondDoc, respondList, type WhereFilter } from "nextly";
import { readableTitleText } from "nextly/config";
import { PENDING_CHANGE_KEY } from "nextly/reserved-filter-keys";
import { z } from "nextly/zod";

import { labelOf, pluralLabelOf } from "../collection-labels";
import { readBodyWith } from "../composition-route-kit";
import { ENTRIES_LOCALE_MAX } from "../entries-contract";
import {
  NO_MATCH,
  refusesTheFilter,
  searchOn,
  titleFieldIn,
} from "../entries-route";
import {
  editorReaderAsCaller,
  findAsCaller,
  idsKeptByWorkflowKey,
  type AsCallerFindArgs,
  type AsCallerPage,
} from "../entry-reads";
import { pageStateOf } from "../pages-search-route";

import { entryBlocksFieldsOf } from "./entry-content-fields";
import {
  templateCollectionProblem,
  type TemplateGuardSetup,
} from "./template-guard";
import {
  TEMPLATE_PREVIEW_ENTRIES_PATH,
  TEMPLATE_PREVIEW_ENTRY_PATH,
  TEMPLATE_PREVIEW_LIMIT,
  TEMPLATE_PREVIEW_SEARCH_MAX,
  type PreviewCollectionLabels,
  type PreviewEntriesRequest,
  type PreviewEntriesResponse,
  type PreviewEntryItem,
  type PreviewEntryRequest,
  type PreviewEntryResponse,
  type PreviewEntryStatus,
} from "./template-preview-contract";

/** A collection's slug, as the canvas bindings route takes one. */
const SLUG = z
  .string()
  .min(1)
  .max(128)
  .regex(/^[A-Za-z0-9_-]+$/);

/** The language being edited, bounded as the editor's other reads bound it. */
const LOCALE = z.string().min(1).max(ENTRIES_LOCALE_MAX).optional();

/** The list's body, as the strip sends it. An empty search is no search. */
const EntriesBody = z
  .object({
    collection: SLUG,
    search: z
      .string()
      .trim()
      .max(TEMPLATE_PREVIEW_SEARCH_MAX)
      .optional()
      .transform(value => (value === "" ? undefined : value)),
    locale: LOCALE,
  })
  .strict();

/** The entry read's body: the collection and the entry's id. */
const EntryBody = z
  .object({
    collection: SLUG,
    id: z.string().min(1).max(200),
    locale: LOCALE,
  })
  .strict();

/** The guard's reads the routes share: what may have a template. */
type CollectionJudge = Pick<
  TemplateGuardSetup,
  "readCollection" | "ownCollections"
>;

/** What the list reads with, injected so it is tested without a server. */
export interface PreviewEntriesReads {
  readonly collections: CollectionJudge;
  /** One list read, AS THE CALLER, every status. */
  find(args: AsCallerFindArgs): Promise<AsCallerPage>;
  /** Whether the caller may create an entry of `collection`. */
  mayCreate(collection: string): Promise<boolean>;
}

/** What the entry read reads with, injected so it is tested without a server. */
export interface PreviewEntryReads {
  readonly collections: CollectionJudge;
  /** The entry as the caller reads it, its working draft where one waits. */
  editorEntry(
    request: PreviewEntryRequest
  ): Promise<Record<string, unknown> | null>;
  /** The published entry as an anonymous visitor reads it, or `null`. */
  publicEntry(
    request: PreviewEntryRequest
  ): Promise<Record<string, unknown> | null>;
  /** The collection's field shapes as the public may read them. */
  publicFields(
    collection: string,
    locale: string | undefined
  ): Promise<readonly BindingFieldShape[] | undefined>;
}

/**
 * The one refusal both routes give, for a collection that may not have a
 * template, one the caller may not read, and an entry that is missing or
 * unreadable: the same words for each, so the answer never says which. The
 * slug goes to the log and nowhere else.
 */
function previewRefusal(route: string, collection: string): NextlyError {
  return NextlyError.forbidden({ logContext: { route, collection } });
}

/** Whether a read failed because the thing is missing or the caller may not read it. */
function missedOrRefused(error: unknown): boolean {
  return (
    NextlyError.isNotFound(error) ||
    NextlyError.isForbidden(error) ||
    NextlyError.isAuthRequired(error)
  );
}

/**
 * The collection's registry record, when it may have a template; refused
 * otherwise. The guard's own rule, asked as the guard asks it, so a
 * collection the editor previews is one a template may draw.
 */
async function templatedRecord(
  collection: string,
  judge: CollectionJudge,
  route: string
): Promise<Record<string, unknown>> {
  // Read once: the guard's rule reads the record, and so does the route.
  let read: Promise<Record<string, unknown> | null> | undefined;
  const once = (slug: string) => (read ??= judge.readCollection(slug));
  const problem = await templateCollectionProblem(
    collection,
    once,
    judge.ownCollections()
  );
  const record = problem === null ? await once(collection) : null;
  if (record === null) throw previewRefusal(route, collection);
  return record;
}

/** The collection's names, as the editor's other surfaces name it. */
function labelsOf(
  record: Record<string, unknown>,
  collection: string
): PreviewCollectionLabels {
  const singular = labelOf(record, collection);
  return { singular, plural: pluralLabelOf(record).pluralLabel ?? singular };
}

/**
 * Where an entry stands in the admin's words, from its stored status and
 * whether a working draft waits on it: the pages search's own reading
 * (`pageStateOf`), with nothing scheduled asked. An entry of a collection
 * without drafts is published.
 */
export function previewStatusOf(
  status: unknown,
  hasWorkingDraft: boolean
): PreviewEntryStatus {
  const stored =
    status === "draft" || status === "published" ? status : undefined;
  const state = pageStateOf(stored, hasWorkingDraft, false);
  return state === "draft" || state === "changed" ? state : "published";
}

/** An entry's title, read by core's rule for a title value, else its id. */
function titleOrId(
  row: Record<string, unknown>,
  titleField: string | undefined,
  id: string
): string {
  if (titleField === undefined || !Object.hasOwn(row, titleField)) return id;
  return readableTitleText(row[titleField]) ?? id;
}

/** A row's id as text, or `undefined` where it carries none. */
function idOf(row: Record<string, unknown>): string | undefined {
  const id = typeof row.id === "number" ? String(row.id) : row.id;
  return typeof id === "string" && id !== "" ? id : undefined;
}

/** A stored time as ISO 8601, or `null` where the row keeps none. */
function timeOf(value: unknown): string | null {
  if (value instanceof Date) {
    return Number.isFinite(value.getTime()) ? value.toISOString() : null;
  }
  return typeof value === "string" && value !== "" ? value : null;
}

/** The field the collection keeps its last update in, unless it keeps none. */
const UPDATED_AT = "updatedAt";

/** The column a Draft/Published collection keeps its state in. */
const STATUS_COLUMN = "status";

/** What a list read is made of, read once from the collection's record. */
interface ListShape {
  readonly title: string | undefined;
  readonly lifecycle: boolean;
  readonly stamps: boolean;
}

/** The record's title field, lifecycle and timestamps, as the list reads them. */
function listShapeOf(record: Record<string, unknown>): ListShape {
  return {
    title: titleFieldIn(record)?.name,
    lifecycle: resolvedCollectionView(record).status === true,
    stamps: (record as { timestamps?: unknown }).timestamps !== false,
  };
}

/**
 * The list's read: the columns each row is shown with and no others (`id`
 * named so a collection with no title field still selects something), the
 * most recently updated first with ties by id (by id alone where the
 * collection keeps no times), and the title condition where there is one.
 * A search nothing can match is still asked of core's gate with the smallest
 * read it can judge, so whether a search can match never decides whether
 * access is checked.
 */
function listReadOf(
  request: PreviewEntriesRequest,
  shape: ListShape,
  where: WhereFilter | undefined,
  matchesNothing: boolean
): AsCallerFindArgs {
  const { title, lifecycle, stamps } = shape;
  return {
    collection: request.collection,
    ...(where === undefined ? {} : { where }),
    select: {
      id: true,
      ...(title === undefined ? {} : { [title]: true }),
      ...(lifecycle ? { [STATUS_COLUMN]: true } : {}),
      ...(stamps ? { [UPDATED_AT]: true } : {}),
    },
    sort: stamps ? [`-${UPDATED_AT}`, "id"] : ["id"],
    limit: matchesNothing ? 1 : TEMPLATE_PREVIEW_LIMIT,
    ...(request.locale === undefined ? {} : { locale: request.locale }),
  };
}

/**
 * The rows the caller's read answers, or `null` where their search matches
 * nothing for them. A refusal of the collection is the routes' one refusal.
 */
async function rowsAsCaller(
  reads: PreviewEntriesReads,
  args: AsCallerFindArgs
): Promise<{ rows: Record<string, unknown>[]; total: number } | null> {
  try {
    const page = await reads.find(args);
    return {
      rows: page.items.flatMap(row =>
        typeof row === "object" && row !== null
          ? [row as Record<string, unknown>]
          : []
      ),
      total: page.meta.total,
    };
  } catch (error) {
    if (missedOrRefused(error)) {
      throw previewRefusal(TEMPLATE_PREVIEW_ENTRIES_PATH, args.collection);
    }
    // A caller who may read the entries but not their title may not filter
    // on it, so the search matches nothing for them, as for the relation
    // control's search.
    if (args.where !== undefined && refusesTheFilter(error)) return null;
    throw error;
  }
}

/** One row as the list shows it, or nothing where it carries no id. */
function itemOf(
  row: Record<string, unknown>,
  shape: ListShape,
  pending: ReadonlySet<string>
): PreviewEntryItem[] {
  const id = idOf(row);
  if (id === undefined) return [];
  return [
    {
      id,
      title: titleOrId(row, shape.title, id),
      status: previewStatusOf(row[STATUS_COLUMN], pending.has(id)),
      updatedAt: timeOf(row[UPDATED_AT]),
    },
  ];
}

/**
 * Answer the list: the collection judged first, then its entries read as the
 * caller, most recently updated first, with whether each waits on a working
 * draft and whether the caller may create another.
 */
export async function readPreviewEntries(
  request: PreviewEntriesRequest,
  reads: PreviewEntriesReads
): Promise<PreviewEntriesResponse> {
  const { collection } = request;
  const record = await templatedRecord(
    collection,
    reads.collections,
    TEMPLATE_PREVIEW_ENTRIES_PATH
  );
  const shape = listShapeOf(record);
  const searched =
    request.search === undefined
      ? undefined
      : searchOn(request.search, titleFieldIn(record));
  const matchesNothing = searched === NO_MATCH;
  const read = await rowsAsCaller(
    reads,
    listReadOf(
      request,
      shape,
      matchesNothing ? undefined : searched,
      matchesNothing
    )
  );
  const found = read === null || matchesNothing ? null : read;
  const rows = found?.rows ?? [];
  const ids = rows.flatMap(row => idOf(row) ?? []);
  const none: ReadonlySet<string> = new Set();
  const [pending, mayCreate] = await Promise.all([
    shape.lifecycle ? pendingIds(reads, collection, ids, request.locale) : none,
    reads.mayCreate(collection),
  ]);
  const items = rows.flatMap(row => itemOf(row, shape, pending));
  const total = found?.total ?? 0;
  return {
    items,
    meta: {
      total,
      page: 1,
      limit: TEMPLATE_PREVIEW_LIMIT,
      totalPages: total === 0 ? 0 : Math.ceil(total / TEMPLATE_PREVIEW_LIMIT),
      hasNext: total > items.length,
      hasPrev: false,
      mayCreate,
      labels: labelsOf(record, collection),
      // What the template's Entry content block may draw, for its Field menu.
      blocksFields: entryBlocksFieldsOf(record),
    },
  };
}

/**
 * Which listed entries wait on a working draft. A failed read leaves the
 * statuses as stored rather than failing the list: a status is a label, never
 * worth the list.
 */
async function pendingIds(
  reads: PreviewEntriesReads,
  collection: string,
  ids: readonly string[],
  locale: string | undefined
): Promise<ReadonlySet<string>> {
  try {
    return await idsKeptByWorkflowKey(
      async args =>
        await reads.find(locale === undefined ? args : { ...args, locale }),
      collection,
      ids,
      PENDING_CHANGE_KEY
    );
  } catch {
    return new Set();
  }
}

/**
 * Answer the entry read: the collection judged first, then the entry as the
 * caller reads it, as the public reads it, and the fields the public may
 * read. An entry the caller may not read is refused as a missing one is.
 */
export async function readPreviewEntry(
  request: PreviewEntryRequest,
  reads: PreviewEntryReads
): Promise<PreviewEntryResponse> {
  const route = TEMPLATE_PREVIEW_ENTRY_PATH;
  const { collection } = request;
  const record = await templatedRecord(collection, reads.collections, route);
  let editorValues: Record<string, unknown> | null;
  try {
    editorValues = await reads.editorEntry(request);
  } catch (error) {
    if (missedOrRefused(error)) throw previewRefusal(route, collection);
    throw error;
  }
  const id = editorValues === null ? undefined : idOf(editorValues);
  if (editorValues === null || id === undefined) {
    throw previewRefusal(route, collection);
  }
  const [publicValues, fields] = await Promise.all([
    // A visitor who may not read the entry, or may not read it yet, reads
    // nothing: the published page then draws each binding's fallback.
    reads.publicEntry(request).catch((error: unknown) => {
      if (missedOrRefused(error)) return null;
      throw error;
    }),
    reads.publicFields(collection, request.locale),
  ]);
  const lifecycle = resolvedCollectionView(record).status === true;
  return {
    id,
    title: titleOrId(editorValues, titleFieldIn(record)?.name, id),
    // The editor reader marks a working draft it read in place of the live
    // row, which is what the admin's own pill reads.
    status: lifecycle
      ? previewStatusOf(
          editorValues[STATUS_COLUMN],
          editorValues._isWorkingDraft === true
        )
      : "published",
    editorValues,
    publicValues,
    fields: fields ?? [],
  };
}

/** The reads the list binds: the guard's, the Direct API as the caller, and its grants. */
function directEntriesReads(
  ctx: PluginRouteContext,
  guard: () => TemplateGuardSetup
): PreviewEntriesReads {
  return {
    collections: guard(),
    find: args => findAsCaller(ctx, args),
    // The framework's own answer, the one a create is judged by; a caller
    // nobody identified may not create.
    mayCreate: async collection =>
      ctx.caller === null ? false : await ctx.caller.can("create", collection),
  };
}

/** The reads the entry read binds: the editor reader as the caller, the public reader, the shapes. */
function directEntryReads(
  ctx: PluginRouteContext,
  guard: () => TemplateGuardSetup
): PreviewEntryReads {
  return {
    collections: guard(),
    // The editor reader as the caller, whose by-id read returns the entry
    // with its pending working draft.
    editorEntry: async request =>
      await (
        await editorReaderAsCaller(ctx, request.locale)
      ).findById({ collection: request.collection, id: request.id }),
    publicEntry: async request => {
      const { createPublicReader, requireNextly } = await import(
        "nextly/runtime"
      );
      const nextly = requireNextly();
      const reader = createPublicReader(
        { find: async args => await nextly.find(args) },
        request.locale === undefined ? {} : { locale: request.locale }
      );
      const { items } = await reader.find({
        collection: request.collection,
        filters: [{ field: "id", op: "equals", value: request.id }],
        limit: 1,
      });
      return items[0] ?? null;
    },
    publicFields: async (collection, locale) => {
      const { bindingFieldShapes } = await import("nextly/runtime");
      return await bindingFieldShapes(
        { collection },
        locale === undefined ? {} : { locale }
      );
    },
  };
}

/** A read-only route's declaration, as the two below share it. */
interface PreviewRoute {
  method: "POST";
  path: string;
  noStore: true;
  handler: (req: Request, ctx: PluginRouteContext) => Promise<Response>;
}

/**
 * The list route. Authenticated (no `public: true`), with no permission of
 * its own: the collection is chosen by the body, which a permission resolver
 * never sees, and core's gate judges the read as the caller. A POST because
 * the read carries a body, never because it writes.
 */
export function templatePreviewEntriesRoute(setup: {
  readonly guard: () => TemplateGuardSetup;
}): PreviewRoute {
  return {
    method: "POST",
    path: TEMPLATE_PREVIEW_ENTRIES_PATH,
    noStore: true,
    handler: async (req, ctx) => {
      const body = await readBodyWith(
        req,
        EntriesBody,
        "template preview entries"
      );
      const answer = await readPreviewEntries(
        body,
        directEntriesReads(ctx, setup.guard)
      );
      return respondList([...answer.items], answer.meta);
    },
  };
}

/** The entry route, authenticated and read-only as the list route is. */
export function templatePreviewEntryRoute(setup: {
  readonly guard: () => TemplateGuardSetup;
}): PreviewRoute {
  return {
    method: "POST",
    path: TEMPLATE_PREVIEW_ENTRY_PATH,
    noStore: true,
    handler: async (req, ctx) => {
      const body = await readBodyWith(req, EntryBody, "template preview entry");
      return respondDoc(
        await readPreviewEntry(body, directEntryReads(ctx, setup.guard))
      );
    },
  };
}
