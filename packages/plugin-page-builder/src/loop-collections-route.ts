/**
 * The read behind a collection loop's inspector: the collections it can
 * repeat over, each with the fields its entries can be ordered by, as
 * `{ slug, label, sortFields }`.
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
 * decides no read: the page's own read of the loop's entries is core's, as
 * whoever views the page.
 *
 * ## Which fields it offers to sort by
 *
 * Top-level fields holding one scalar value, judged by the engine's binding
 * vocabulary (`bindingKindOf`), the one place a field type's kind of value is
 * named: text, a URL, a number, a yes-or-no, a date or a choice. Never a
 * container, a list, a relation, rich text or a password, which hold nothing
 * an author could mean to order by, nor a field with a read rule of its own,
 * which core refuses to order a reader by when they may not read it. Then the
 * timestamps every collection keeps, unless it turned them off.
 *
 * A field offered here is not a promise: the loop's read still asks core, and
 * a sort core refuses lists in id order (see `core/collection-loop`).
 *
 * @module loop-collections-route
 */
import {
  bindingKindOf,
  STORAGE_PRIMITIVE_AS_FIELD_TYPE,
  type BindingValueKind,
  type FieldStoragePrimitive,
} from "@nextlyhq/blocks-engine";
import type { PluginRouteContext } from "@nextlyhq/plugin-sdk";
import { respondList, type PaginationMeta } from "nextly";
import { humanizeFieldName } from "nextly/field-label";

import { PAGES_SLUG } from "./collections/pages";
import { DEFAULT_COMPONENT_STORE, type ComponentStore } from "./library-route";
import {
  LOOP_COLLECTIONS_ROUTE_PATH,
  type LoopCollectionItem,
  type LoopCollectionsResponse,
  type LoopSortFieldItem,
} from "./loop-collections-contract";
import {
  labelOf,
  pluralLabelOf,
  registryRecords,
  schemaIsLive,
  slugOf,
  type PageCollectionsContext,
} from "./pages-search-route";

/** The kinds of value a list can be ordered by. */
const SORTABLE_KINDS: ReadonlySet<BindingValueKind> = new Set<BindingValueKind>(
  ["text", "url", "number", "boolean", "date", "option"]
);

/**
 * The timestamps a collection keeps unless it turns them off, named as the
 * admin's entry list heads their columns.
 */
const TIMESTAMPS: readonly LoopSortFieldItem[] = [
  { name: "createdAt", label: "Created", date: true },
  { name: "updatedAt", label: "Updated", date: true },
];

/** A top-level field as a registry record declares it, as far as sorting cares. */
interface DeclaredField {
  readonly name?: unknown;
  readonly type?: unknown;
  readonly label?: unknown;
  readonly hasMany?: unknown;
  readonly storage?: unknown;
  readonly access?: unknown;
}

/** Whether a field declares a read rule of its own. */
function hasReadRule(field: DeclaredField): boolean {
  const access = field.access;
  return (
    typeof access === "object" &&
    access !== null &&
    (access as { read?: unknown }).read !== undefined
  );
}

/** Whether a declared storage primitive is one the engine knows. */
function isStoragePrimitive(value: unknown): value is FieldStoragePrimitive {
  return (
    typeof value === "string" &&
    Object.prototype.hasOwnProperty.call(STORAGE_PRIMITIVE_AS_FIELD_TYPE, value)
  );
}

/** A field a loop can sort by, or `undefined` for one it cannot. */
function sortFieldOf(value: unknown): LoopSortFieldItem | undefined {
  if (typeof value !== "object" || value === null) return undefined;
  const field = value as DeclaredField;
  if (typeof field.name !== "string" || field.name === "") return undefined;
  if (typeof field.type !== "string") return undefined;
  if (field.hasMany === true || hasReadRule(field)) return undefined;
  // A plugin's own field type is judged by the storage primitive it declares,
  // read against the engine's table of them rather than a list kept here.
  const kind = bindingKindOf({
    type: field.type,
    ...(isStoragePrimitive(field.storage) ? { storage: field.storage } : {}),
  });
  if (kind === null || !SORTABLE_KINDS.has(kind)) return undefined;
  return {
    name: field.name,
    label:
      typeof field.label === "string" && field.label.trim() !== ""
        ? field.label
        : humanizeFieldName(field.name),
    date: kind === "date",
  };
}

/** A record's sortable fields, its own first, then the timestamps it keeps. */
function sortFieldsOf(record: Record<string, unknown>): LoopSortFieldItem[] {
  const declared = (Array.isArray(record.fields) ? record.fields : []).flatMap(
    value => {
      const field = sortFieldOf(value);
      return field === undefined ? [] : [field];
    }
  );
  const names = new Set(declared.map(field => field.name));
  const stamps =
    record.timestamps === false
      ? []
      : TIMESTAMPS.filter(stamp => !names.has(stamp.name));
  return [...declared, ...stamps];
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

/**
 * Answer one read: the listed collections the caller may read, each once, in
 * registry order. The menu orders them by name; this decides only which.
 */
export async function readLoopCollections(
  reads: LoopCollectionsReads
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
  const items: LoopCollectionItem[] = candidates
    .filter((_, index) => readable[index] === true)
    .map(({ slug, record }) => ({
      slug,
      label: pluralLabelOf(record).pluralLabel ?? labelOf(record, slug),
      sortFields: sortFieldsOf(record),
    }));
  return { items, meta: onePage(items.length) };
}

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
    handler: async (_req, ctx) => {
      const answer = await readLoopCollections(
        directLoopCollectionsReads(ctx, store)
      );
      return respondList([...answer.items], answer.meta);
    },
  };
}
