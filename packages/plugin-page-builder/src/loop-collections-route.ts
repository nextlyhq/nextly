/**
 * The read behind a collection list's inspector: the collections it can
 * read, each with the fields its filters and sort may name and the to-many
 * relations a related list may show, as `{ slug, label, singular, fields,
 * relations }`.
 *
 * ## Which collections it lists
 *
 * The site's collections, from the LIVE registry so one the Schema Builder
 * adds later is listed too, less three kinds:
 *
 * - the plugin's own stores (patterns, components, Layouts, its indexes),
 *   which hold what pages are built from rather than content to list. Its
 *   Pages are kept: a list of pages is a page a site may want.
 * - a collection hidden from the admin's navigation, which is somebody's
 *   machinery rather than content an author would recognise.
 * - a collection whose schema is not live yet, whose read would fail.
 *
 * ## Who may see each one
 *
 * Only a collection the caller may read (`caller.can("read", slug)`). Which
 * collections exist, and what their fields are called, is configuration, but
 * it is configuration about content the caller may have no business with, so
 * nothing of a collection they cannot read travels. This shapes a menu and
 * decides no read: the page's own read of the list's entries is core's, as
 * whoever views the page.
 *
 * ## Which fields it offers
 *
 * The fields a list may name, as a save judges them: `listFieldsFrom`, the
 * collection's fields as the PUBLIC may read them (`bindingFieldShapes`).
 * Which entries a list shows, and in what order, would otherwise reveal a
 * field no visitor may see, so a field only the author may read is not
 * offered, and the save refuses it. Of those, a field is offered when the
 * engine names a kind for it (`listFieldKind`): one scalar value, never a
 * field holding several, rich text, media or a container. The id is not
 * offered, since it orders and filters by nothing an author reads.
 *
 * A related list may show a to-many relation visitors can see
 * (`listRelationTarget`), when its entries are in a collection listed here,
 * so the menu offers a source whose fields it also lists.
 *
 * @module loop-collections-route
 */
import {
  listFieldKind,
  listRelationTarget,
  type BindingFieldShape,
} from "@nextlyhq/blocks-engine";
import {
  addressableFields,
  type PluginRouteContext,
} from "@nextlyhq/plugin-sdk";
import { respondList, type PaginationMeta } from "nextly";
import { humanizeFieldName } from "nextly/field-label";
import { z } from "nextly/zod";

import { labelOf, pluralLabelOf } from "./collection-labels";
import { PAGES_SLUG } from "./collections/pages";
import { ENTRIES_LOCALE_MAX } from "./entries-contract";
import { listFieldsFrom } from "./fields/list-query-judgement";
import { DEFAULT_COMPONENT_STORE, type ComponentStore } from "./library-route";
import {
  LOOP_COLLECTIONS_PARAMS,
  LOOP_COLLECTIONS_ROUTE_PATH,
  type LoopCollectionItem,
  type LoopCollectionsResponse,
  type LoopFieldOption,
  type LoopListFieldItem,
  type LoopRelationItem,
} from "./loop-collections-contract";
import {
  registryRecords,
  schemaIsLive,
  slugOf,
  type PageCollectionsContext,
} from "./pages-search-route";
import { optionalText, parseRouteQuery } from "./route-query";

/**
 * The timestamps a collection keeps unless it turns them off, named as the
 * admin's entry list heads their columns.
 */
const TIMESTAMP_LABELS: Readonly<Record<string, string>> = {
  createdAt: "Created",
  updatedAt: "Updated",
};

/** A field as a registry record declares it, as far as its words go. */
interface DeclaredField {
  readonly name?: unknown;
  readonly label?: unknown;
  readonly options?: unknown;
}

/** What an author calls a field: its label, or its name in words. */
function fieldWordsOf(
  name: string,
  declared: DeclaredField | undefined
): string {
  const label = declared?.label;
  if (typeof label === "string" && label.trim() !== "") return label;
  return TIMESTAMP_LABELS[name] ?? humanizeFieldName(name);
}

/** One declared choice, as stored and as named, or `undefined` for none. */
function optionOf(value: unknown): LoopFieldOption | undefined {
  if (typeof value === "string") return { value, label: value };
  if (typeof value !== "object" || value === null) return undefined;
  const { value: stored, label } = value as {
    value?: unknown;
    label?: unknown;
  };
  if (typeof stored !== "string") return undefined;
  return {
    value: stored,
    label: typeof label === "string" && label.trim() !== "" ? label : stored,
  };
}

/**
 * A choice field's choices: the values the public's shape holds, each named
 * as the record declares it.
 */
function optionsOf(
  shape: BindingFieldShape,
  declared: DeclaredField | undefined
): LoopFieldOption[] {
  const named = new Map<string, string>();
  for (const value of Array.isArray(declared?.options)
    ? declared.options
    : []) {
    const option = optionOf(value);
    if (option !== undefined) named.set(option.value, option.label);
  }
  return (shape.options ?? []).map(value => ({
    value,
    label: named.get(value) ?? value,
  }));
}

/** A readable field as the menu offers it, or `undefined` for one it leaves out. */
function listFieldOf(
  shape: BindingFieldShape,
  declared: DeclaredField | undefined
): LoopListFieldItem | undefined {
  if (shape.name === "id") return undefined;
  const kind = listFieldKind(shape);
  if (kind === undefined) return undefined;
  return {
    name: shape.name,
    label: fieldWordsOf(shape.name, declared),
    kind,
    ...(kind === "choice" ? { options: optionsOf(shape, declared) } : {}),
    ...(kind === "entry" && typeof shape.relationTo === "string"
      ? { relationTo: shape.relationTo }
      : {}),
    ...(kind === "date" && shape.dateOnly === true ? { dateOnly: true } : {}),
  };
}

/** A record's declared fields by name, for the words each is offered with. */
function declaredByName(
  record: Record<string, unknown>
): ReadonlyMap<string, DeclaredField> {
  const byName = new Map<string, DeclaredField>();
  for (const field of addressableFields(record.fields)) {
    if (typeof field.name === "string") byName.set(field.name, field);
  }
  return byName;
}

/**
 * The public's fields first in the collection's order, then the timestamps,
 * as the admin lists a collection's columns.
 */
function timestampsLast(
  shapes: readonly BindingFieldShape[]
): BindingFieldShape[] {
  // Each name once: a collection that declares a timestamp itself is read
  // with it as `listFieldsFrom` adds it.
  const seen = new Set<string>();
  const once = shapes.filter(shape => {
    if (seen.has(shape.name)) return false;
    seen.add(shape.name);
    return true;
  });
  const stamp = (shape: BindingFieldShape) =>
    Object.hasOwn(TIMESTAMP_LABELS, shape.name);
  return [
    ...once.filter(shape => !stamp(shape)),
    ...once.filter(shape => stamp(shape)),
  ];
}

/** Whether a record is hidden from the admin's navigation. */
function hiddenInAdmin(record: Record<string, unknown>): boolean {
  const admin = record.admin;
  return (
    typeof admin === "object" &&
    admin !== null &&
    (admin as { hidden?: unknown }).hidden === true
  );
}

/** A record's singular name: its label, or its slug. */
function singularOf(record: Record<string, unknown>, slug: string): string {
  const labels = record.labels;
  const singular =
    typeof labels === "object" && labels !== null
      ? (labels as { singular?: unknown }).singular
      : undefined;
  return typeof singular === "string" && singular !== ""
    ? singular
    : labelOf(record, slug);
}

/**
 * What the route reads with, injected so the decisions in
 * {@link readLoopCollections} are tested without a server.
 */
export interface LoopCollectionsReads {
  /** Every collection record the registry holds. */
  collections(): Promise<readonly unknown[]>;
  /** The collections never listed: the plugin's own stores, resolved. */
  internal(): ReadonlySet<string>;
  /** Whether the caller may read this collection. */
  mayRead(slug: string): Promise<boolean>;
  /**
   * The fields of a collection the public may read, as a published page's
   * bindings are judged; `undefined` when the public may read none of it.
   */
  publicFields(
    slug: string,
    locale?: string
  ): Promise<readonly BindingFieldShape[] | undefined>;
}

/** The meta of an answer that is the whole list on one page. */
function onePage(total: number): PaginationMeta {
  return {
    total,
    page: 1,
    limit: Math.max(total, 1),
    totalPages: total === 0 ? 0 : 1,
    hasNext: false,
    hasPrev: false,
  };
}

/** One listed collection, its fields and relations read as the public's. */
async function collectionItem(
  slug: string,
  record: Record<string, unknown>,
  listedSlugs: ReadonlySet<string>,
  reads: LoopCollectionsReads,
  locale: string | undefined
): Promise<LoopCollectionItem> {
  // The fields a list may name, as a save judges them: the record's
  // declared fields, and those the public may read, in the save's language.
  const fields = await listFieldsFrom({
    record: () => Promise.resolve(record),
    readable: (collection, language) =>
      language === undefined
        ? reads.publicFields(collection)
        : reads.publicFields(collection, language),
  })(slug, locale);
  const declared = declaredByName(record);
  const shapes = timestampsLast(fields?.readable ?? []);
  return {
    slug,
    label: pluralLabelOf(record).pluralLabel ?? labelOf(record, slug),
    singular: singularOf(record, slug),
    fields: shapes.flatMap(shape => {
      const field = listFieldOf(shape, declared.get(shape.name));
      return field === undefined ? [] : [field];
    }),
    relations: shapes.flatMap((shape): LoopRelationItem[] => {
      const collection = listRelationTarget(shape);
      return collection !== undefined && listedSlugs.has(collection)
        ? [
            {
              field: shape.name,
              label: fieldWordsOf(shape.name, declared.get(shape.name)),
              collection,
            },
          ]
        : [];
    }),
    declared: [...(fields?.declared ?? [])],
    // Every key the engine reads to judge a list, so the inspector's
    // judgement of a time of day or a plugin's type is the save's.
    readable: (fields?.readable ?? []).map(shape => ({
      name: shape.name,
      // Named as the offered fields are, so a condition on a field no list
      // filters by reads as the admin calls it.
      label: fieldWordsOf(shape.name, declared.get(shape.name)),
      type: shape.type,
      ...(shape.hasMany === true ? { hasMany: true as const } : {}),
      ...(shape.relationTo === undefined
        ? {}
        : { relationTo: shape.relationTo }),
      ...(shape.timeOnly === true ? { timeOnly: true as const } : {}),
      ...(shape.storage === undefined ? {} : { storage: shape.storage }),
    })),
  };
}

/**
 * Answer one read: the listed collections the caller may read, each once, in
 * registry order. The menu orders them by name; this decides only which.
 */
export async function readLoopCollections(
  reads: LoopCollectionsReads,
  /** The language being edited, which a save judges its lists in. */
  locale?: string
): Promise<LoopCollectionsResponse> {
  const internal = reads.internal();
  const seen = new Set<string>();
  const candidates: Array<{ slug: string; record: Record<string, unknown> }> =
    [];
  for (const value of await reads.collections()) {
    if (typeof value !== "object" || value === null) continue;
    const record = value as Record<string, unknown>;
    const slug = slugOf(record);
    if (slug === undefined || seen.has(slug) || internal.has(slug)) continue;
    if (!schemaIsLive(record) || hiddenInAdmin(record)) continue;
    seen.add(slug);
    candidates.push({ slug, record });
  }
  // Asked together: each is the caller's own permission read, resolved once
  // per request, so one collection's answer never waits on another's.
  const readable = await Promise.all(
    candidates.map(candidate => reads.mayRead(candidate.slug))
  );
  const listed = candidates.filter((_, index) => readable[index] === true);
  const listedSlugs = new Set(listed.map(candidate => candidate.slug));
  const items = await Promise.all(
    listed.map(({ slug, record }) =>
      collectionItem(slug, record, listedSlugs, reads, locale)
    )
  );
  return { items, meta: onePage(items.length) };
}

/** The route's query: the language the fields are judged in, if any. */
const LOOP_COLLECTIONS_QUERY = z.object({
  [LOOP_COLLECTIONS_PARAMS.locale]: optionalText(ENTRIES_LOCALE_MAX),
});

/** The route context this reads: the registry, the plugin's slugs, and who asks. */
interface LoopCollectionsRouteContext extends PageCollectionsContext {
  readonly caller: PluginRouteContext["caller"];
}

/**
 * The plugin's own collections, as resolved, less its Pages; and a component
 * store the host pointed the plugin at.
 */
export function internalCollections(
  ctx: Pick<PageCollectionsContext, "self">,
  store: ComponentStore
): ReadonlySet<string> {
  const pages = ctx.self.collections[PAGES_SLUG] ?? PAGES_SLUG;
  const owned = Object.values(ctx.self.collections).filter(
    (slug): slug is string => slug !== undefined && slug !== pages
  );
  return new Set(
    store.collection === undefined ? owned : [...owned, store.collection]
  );
}

/** The reads the route binds: the registry listing and the caller's permissions. */
function directLoopCollectionsReads(
  ctx: LoopCollectionsRouteContext,
  store: ComponentStore
): LoopCollectionsReads {
  return {
    collections: () => registryRecords(ctx),
    internal: () => internalCollections(ctx, store),
    // No caller is no reader: the route is authenticated, so this is a guard
    // for a caller the dispatcher could not resolve, and it lists nothing.
    mayRead: slug =>
      ctx.caller === null
        ? Promise.resolve(false)
        : ctx.caller.can("read", slug),
    // The anonymous visitor's fields, judged as the published page's
    // bindings are: imported at call time, as the save's reader is, so
    // loading this module costs none of the runtime.
    publicFields: async (slug, locale) => {
      const { bindingFieldShapes } = await import("nextly/runtime");
      return bindingFieldShapes(
        { collection: slug },
        locale === undefined ? {} : { locale }
      );
    },
  };
}

/**
 * The route declaration. Authenticated (no `public: true`) with no
 * permission of its own: it spans collections a permission names one at a
 * time, and each is asked of the caller above.
 */
export function loopCollectionsRoute(
  store: ComponentStore = DEFAULT_COMPONENT_STORE
): {
  method: "GET";
  path: string;
  handler: (req: Request, ctx: PluginRouteContext) => Promise<Response>;
} {
  return {
    method: "GET",
    path: LOOP_COLLECTIONS_ROUTE_PATH,
    handler: async (req, ctx) => {
      const query = parseRouteQuery(
        req.url,
        Object.values(LOOP_COLLECTIONS_PARAMS),
        LOOP_COLLECTIONS_QUERY,
        "loop collections route"
      );
      const answer = await readLoopCollections(
        directLoopCollectionsReads(ctx, store),
        query[LOOP_COLLECTIONS_PARAMS.locale]
      );
      return respondList([...answer.items], answer.meta);
    },
  };
}
