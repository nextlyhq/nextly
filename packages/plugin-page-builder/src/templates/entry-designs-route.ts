/**
 * `GET /templates/entry-designs?collection=<slug>`: the own designs of one
 * collection's entries, with the collection's template and names, for the
 * admin surfaces that show them (the entry's Design section, the entry list's
 * Design column, the template's own designs and its delete dialog). Asked
 * with `?template=<id>` instead, it answers for the collection that template
 * is about, which is how a template's own screens find it.
 *
 * ## Read as the caller
 *
 * Each read is the caller's own, through core's read access, so a caller sees
 * only the templates they may read. Two questions come first, before anything
 * is read: whether the caller may read the collection, and whether they may
 * read templates. A caller refused either is answered an empty list and no
 * template, which says nothing of what is stored: an own design names its
 * entry, and its title is that entry's title when it was given.
 *
 * ## Two queries
 *
 * The collection's template is the one row naming the collection; its own
 * designs are the rows naming it as their entry's collection, an indexed
 * field, newest edit first and capped at {@link ENTRY_DESIGNS_MAX}. Both
 * select only the columns the surfaces show.
 *
 * @experimental Settles when collection templates ship.
 * @module templates/entry-designs-route
 */
import { getCachedNextly, type PluginRouteContext } from "@nextlyhq/plugin-sdk";
import { respondList } from "nextly";
import { z } from "nextly/zod";

import { labelOf, pluralLabelOf } from "../collection-labels";
import {
  TEMPLATE_COLLECTION_FIELD,
  TEMPLATE_ENTRY_COLLECTION_FIELD,
  TEMPLATE_ENTRY_ID_FIELD,
} from "../collections/templates";
import { readOrNull } from "../composition-route-kit";
import { readingAsUser } from "../library-route";
import { parseRouteQuery } from "../route-query";

import {
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

/** One slug or id as a query carries it. */
const QUERY_ID = z.string().trim().min(1).max(512);

/**
 * The route's query: the collection whose own designs are listed, or a
 * template whose collection is meant. Exactly one of the two.
 */
const ENTRY_DESIGNS_QUERY = z
  .object({
    [ENTRY_DESIGNS_PARAMS.collection]: QUERY_ID.optional(),
    [ENTRY_DESIGNS_PARAMS.template]: QUERY_ID.optional(),
  })
  .refine(
    query =>
      (query[ENTRY_DESIGNS_PARAMS.collection] === undefined) !==
      (query[ENTRY_DESIGNS_PARAMS.template] === undefined),
    { message: "Name a collection or a template, and only one." }
  );

/** What the read is built with: the template guard's own lookups. */
export interface EntryDesignsSetup {
  readonly guard: () => TemplateGuardSetup;
}

/** The slice of the route context the read uses. */
export type EntryDesignsContext = Pick<PluginRouteContext, "caller">;

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
  }): Promise<{ rows: Record<string, unknown>[]; hasNext: boolean }>;
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

/** The answer of a read that lists nothing: its meta, with nothing in it. */
function emptyAnswer(
  collection: string,
  templatesCollection: string,
  names: { singular: string; plural: string },
  templateAllowed: boolean,
  mayCreateTemplate: boolean
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
      templateAllowed,
      mayCreateTemplate,
      templatesCollection,
      names,
      collection,
    },
  };
}

/**
 * The collection a template is about: the one it draws, or the one whose
 * entry it serves. Read as the caller, so a template they may not read names
 * nothing; `""` then, which every read answers empty.
 */
export async function collectionOfTemplate(
  id: string,
  reads: EntryDesignsReads
): Promise<string> {
  const row = await reads.template(id);
  const named =
    row?.[TEMPLATE_COLLECTION_FIELD] ?? row?.[TEMPLATE_ENTRY_COLLECTION_FIELD];
  return typeof named === "string" ? named : "";
}

/** Answer one read for `collection`, as the module docblock describes. */
export async function readEntryDesigns(
  collection: string,
  guard: TemplateGuardSetup,
  reads: EntryDesignsReads
): Promise<EntryDesignsResponse> {
  const templates = guard.templatesCollection;
  const unknown = { singular: collection, plural: collection };
  // A template the caller may not read names no collection.
  if (collection === "") {
    return emptyAnswer(collection, templates, unknown, false, false);
  }
  // Preconditions first, asked together: nothing about the collection is
  // read for a caller who may not read it.
  const [mayReadCollection, mayReadTemplates] = await Promise.all([
    reads.can("read", collection),
    reads.can("read", templates),
  ]);
  if (!mayReadCollection) {
    return emptyAnswer(collection, templates, unknown, false, false);
  }
  const record = await guard.readCollection(collection);
  const names = namesOf(record, collection);
  const [problem, mayCreateTemplate] = await Promise.all([
    templateCollectionProblem(
      collection,
      () => Promise.resolve(record),
      guard.ownCollections()
    ),
    reads.can("create", templates),
  ]);
  const templateAllowed = problem === null;
  if (!mayReadTemplates) {
    return emptyAnswer(collection, templates, names, templateAllowed, false);
  }

  const [base, designs] = await Promise.all([
    reads.templates({
      where: { [TEMPLATE_COLLECTION_FIELD]: { equals: collection } },
      limit: 1,
      select: { id: true, title: true, status: true },
    }),
    reads.templates({
      where: { [TEMPLATE_ENTRY_COLLECTION_FIELD]: { equals: collection } },
      limit: ENTRY_DESIGNS_MAX,
      select: {
        id: true,
        title: true,
        status: true,
        updatedAt: true,
        [TEMPLATE_ENTRY_ID_FIELD]: true,
      },
      sort: ["-updatedAt", "id"],
    }),
  ]);

  const baseRow = base.rows[0];
  const baseId = baseRow === undefined ? undefined : idOf(baseRow);
  const template: CollectionTemplate | null =
    baseRow === undefined || baseId === undefined
      ? null
      : {
          id: baseId,
          title: titleOf(baseRow, baseId),
          status: stateOf(baseRow),
        };

  const items = designs.rows.flatMap((row): EntryDesignItem[] => {
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
  });

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
      templateAllowed,
      // Offered only where there is no template yet and one may be made.
      mayCreateTemplate: mayCreateTemplate && templateAllowed,
      templatesCollection: templates,
      names,
      collection,
    },
  };
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
          },
        })
      );
      return typeof found === "object" && found !== null
        ? (found as Record<string, unknown>)
        : null;
    },
    templates: async ({ where, limit, select, sort }) => {
      const found = await readOrNull(async () =>
        (await getCachedNextly()).find({
          collection: templates,
          where,
          limit,
          select,
          ...(sort === undefined ? {} : { sort }),
          ...(await readingAsUser(ctx)),
          status: "all",
          depth: 0,
        })
      );
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
    },
  };
}

/**
 * The route declaration. Authenticated (no `public: true`) with no permission
 * of its own: what it lists is asked of the caller above, collection and
 * templates alike.
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
      const query = parseRouteQuery(
        req.url,
        Object.values(ENTRY_DESIGNS_PARAMS),
        ENTRY_DESIGNS_QUERY,
        "entry designs route"
      );
      const guard = setup.guard();
      const reads = directEntryDesignsReads(ctx, guard.templatesCollection);
      const named = query[ENTRY_DESIGNS_PARAMS.collection];
      const template = query[ENTRY_DESIGNS_PARAMS.template];
      const collection =
        named ??
        (template === undefined
          ? ""
          : await collectionOfTemplate(template, reads));
      const answer = await readEntryDesigns(collection, guard, reads);
      return respondList([...answer.items], answer.meta);
    },
  };
}
