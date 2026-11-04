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
 * Two questions, each asked of the one place that answers it:
 *
 * - Which fields hold something an author could mean to order by: top-level
 *   fields holding one scalar value, judged by the engine's binding
 *   vocabulary (`bindingKindOf`), the one place a field type's kind of value
 *   is named: text, a URL, a number, a yes-or-no, a date or a choice. Never
 *   a container, a list, a relation, rich text or a password. Then the
 *   timestamps every collection keeps, unless it turned them off.
 * - Which of those this caller may sort by: core's, asked by sorting a read
 *   by all of them as the caller, with unknown keys refused rather than
 *   dropped. Core refuses before it reads, naming every key it will not order
 *   by (a field with a read rule this caller fails, a withheld column, a
 *   password), and those are left out. The registry's records cannot answer
 *   this: a code-first collection's read rules are functions, which the
 *   records do not carry.
 *
 * That read is the smallest core judges: one row, its id alone, so it costs
 * one ordered lookup per collection, more only while core still refuses
 * keys. A large collection sorted by an unindexed field pays for that order
 * here as the page's own read would.
 *
 * A field offered here is not a promise: the loop's read on a published page
 * asks core again as whoever views it, and a sort core refuses there lists
 * in id order (see `core/collection-loop`).
 *
 * @module loop-collections-route
 */
import {
  bindingKindOf,
  STORAGE_PRIMITIVE_AS_FIELD_TYPE,
  type BindingValueKind,
  type FieldStoragePrimitive,
} from "@nextlyhq/blocks-engine";
import { NextlyError, type PluginRouteContext } from "@nextlyhq/plugin-sdk";
import { respondList, type PaginationMeta } from "nextly";
import { humanizeFieldName } from "nextly/field-label";

import { PAGES_SLUG } from "./collections/pages";
import { findAsCaller } from "./entry-reads";
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
}

/** Whether a declared storage primitive is one the engine knows. */
function isStoragePrimitive(value: unknown): value is FieldStoragePrimitive {
  return (
    typeof value === "string" &&
    Object.prototype.hasOwnProperty.call(STORAGE_PRIMITIVE_AS_FIELD_TYPE, value)
  );
}

/** A declared field with a name and a type, holding one value. */
type NamedSingleField = DeclaredField & { name: string; type: string };

/** Whether a declared field has a name and a type and holds one value. */
function isNamedSingleField(value: unknown): value is NamedSingleField {
  if (typeof value !== "object" || value === null) return false;
  const { name, type, hasMany } = value as DeclaredField;
  // A field holding many values orders by nothing one row shows.
  return (
    typeof name === "string" &&
    name !== "" &&
    typeof type === "string" &&
    hasMany !== true
  );
}

/**
 * The kind of value a field holds, when it is one a list can be ordered by.
 * A plugin's own field type is judged by the storage primitive it declares,
 * read against the engine's table of them rather than a list kept here.
 */
function sortKindOf(
  type: string,
  storage: unknown
): BindingValueKind | undefined {
  const kind = bindingKindOf({
    type,
    ...(isStoragePrimitive(storage) ? { storage } : {}),
  });
  return kind !== null && SORTABLE_KINDS.has(kind) ? kind : undefined;
}

/** What an author calls a field: its label, or its name in words. */
function fieldWordsOf(name: string, label: unknown): string {
  return typeof label === "string" && label.trim() !== ""
    ? label
    : humanizeFieldName(name);
}

/** A field a loop can sort by, or `undefined` for one it cannot. */
function sortFieldOf(value: unknown): LoopSortFieldItem | undefined {
  if (!isNamedSingleField(value)) return undefined;
  const kind = sortKindOf(value.type, value.storage);
  if (kind === undefined) return undefined;
  return {
    name: value.name,
    label: fieldWordsOf(value.name, value.label),
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
  /**
   * One read of the collection AS THE CALLER, sorted by `keys`, refusing
   * every key core will not sort by; resolves when core accepts them all.
   */
  sortedRead(slug: string, keys: readonly string[]): Promise<void>;
}

/** The key one problem of a refusal names, when it is a sort key refused. */
function refusedSortKey(problem: unknown): string | undefined {
  const { code, path } = (problem ?? {}) as { code?: unknown; path?: unknown };
  return code === "FIELD_NOT_SORTABLE" &&
    typeof path === "string" &&
    path.startsWith("sort.")
    ? path.slice("sort.".length)
    : undefined;
}

/**
 * The fields core refused to sort by, when `error` is that refusal and
 * nothing else: every problem it names is a sort key. `undefined` for any
 * other failure.
 */
function refusedSortKeys(error: unknown): ReadonlySet<string> | undefined {
  if (!NextlyError.isCode(error, "VALIDATION_ERROR")) return undefined;
  const problems = (error.publicData as { errors?: unknown } | undefined)
    ?.errors;
  if (!Array.isArray(problems) || problems.length === 0) return undefined;
  const keys = problems.map(refusedSortKey);
  return keys.every(key => key !== undefined) ? new Set(keys) : undefined;
}

/**
 * The keys of `candidates` core lets this caller sort `slug` by.
 *
 * Asked with all of them, then again without each key core named, until it
 * accepts the rest: core refuses in stages (passwords, then fields it does
 * not know or withholds, then fields the caller may not read), naming every
 * key of a stage at once, so this ends within a few reads. Any other failure
 * offers no field rather than one core might refuse.
 */
export async function sortableKeys(
  slug: string,
  candidates: readonly string[],
  reads: Pick<LoopCollectionsReads, "sortedRead">
): Promise<ReadonlySet<string>> {
  let keys = [...candidates];
  while (keys.length > 0) {
    try {
      await reads.sortedRead(slug, keys);
      return new Set(keys);
    } catch (error) {
      const refused = refusedSortKeys(error);
      const left =
        refused === undefined ? [] : keys.filter(key => !refused.has(key));
      // A refusal that names none of the keys asked would ask the same
      // question forever: it is a failure like any other.
      if (left.length === keys.length) return new Set();
      keys = left;
    }
  }
  return new Set();
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
  const items: LoopCollectionItem[] = await Promise.all(
    candidates
      .filter((_, index) => readable[index] === true)
      .map(async ({ slug, record }) => {
        const offered = sortFieldsOf(record);
        const sortable = await sortableKeys(
          slug,
          offered.map(field => field.name),
          reads
        );
        return {
          slug,
          label: pluralLabelOf(record).pluralLabel ?? labelOf(record, slug),
          sortFields: offered.filter(field => sortable.has(field.name)),
        };
      })
  );
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
    // The shared as-caller read, so core judges the sort for exactly the
    // caller every other editor read is judged for.
    sortedRead: async (slug, keys) => {
      await findAsCaller(ctx, {
        collection: slug,
        select: { id: true },
        sort: keys,
        limit: 1,
        unknownSort: "refuse",
      });
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
    handler: async (_req, ctx) => {
      const answer = await readLoopCollections(
        directLoopCollectionsReads(ctx, store)
      );
      return respondList([...answer.items], answer.meta);
    },
  };
}
