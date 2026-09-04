/**
 * Which of these documents the caller may actually READ, asked of the ordinary
 * read path.
 *
 * 🔴 Entity-level access is one axis short of the question, and its own contract
 * says so: `readableEntities` decides whether a collection is in reach AT ALL,
 * leaving the per-row rules of whatever query follows to decide which documents
 * come back. A collection carrying a stored `owner-only` or `custom` read rule
 * therefore admits every editor at the coarse check while the read path narrows
 * to a subset — so any surface keyed by collection name alone reports one
 * author's documents to another.
 *
 * That is not a hypothetical shape: the dashboard's own statistics once counted
 * rows straight from the physical table and disclosed exactly this, and the
 * repair was to route the numbers through the access-enforced path rather than
 * to reproduce the rule. This module is that repair, made reusable — the
 * pending-edit cards and the activity feed are two surfaces of it, and any later
 * system source keyed by collection and document id is a third.
 *
 * The rule is never re-implemented here. A stored rule can be `owner-only` or a
 * `custom` function, and both return a query constraint expressed over the
 * COLLECTION's own fields — which is why the constraint cannot simply be pushed
 * into a sidecar table's query the way Payload pushes one into its versions
 * collection: `activity_log` and `nextly_versions` do not carry the columns a
 * rule names. Asking the read path which of a known set of ids survive is the
 * one form that works for every rule, including the ones nobody can predict.
 *
 * @module services/lib/readable-documents
 */

import { getNextly } from "../../direct-api/nextly";
import type { ReadCaller } from "../dashboard/readable-resources";

/**
 * Ids per statement. Each id binds one parameter and SQLite's default
 * SQLITE_MAX_VARIABLE_NUMBER is 999 — the lowest across supported dialects — so
 * a set larger than this is asked for in several reads rather than one that the
 * driver refuses. Matches the chunk the versions repository already deletes in.
 */
const ID_CHUNK_SIZE = 500;

/** What a row keyed by content has to name for its document to be authorized. */
export interface DocumentRef {
  /**
   * Which registry owns the slug. A Single is read through its own service, so
   * a row that mislabels one as a collection is not merely slower — it asks a
   * question about a table that does not hold the document.
   */
  kind: "collection" | "single";
  slug: string;
  entryId: string;
  /**
   * Which translation, for a localized Single. A localized Single is a different
   * document per language and a rule can answer differently for each, so the
   * verdict is per locale rather than per slug.
   */
  locale?: string | null;
}

/** `ids` split into statement-sized runs. */
function chunked(ids: readonly string[]): string[][] {
  const chunks: string[][] = [];
  for (let index = 0; index < ids.length; index += ID_CHUNK_SIZE) {
    chunks.push([...ids.slice(index, index + ID_CHUNK_SIZE)]);
  }
  return chunks;
}

/**
 * The subset of `entryIds` this caller may read from `collection`.
 *
 * `overrideAccess: false` with the caller's own identity is what applies the
 * stored rule, and the API key's stamped scope is forwarded so a key is judged
 * on its own grant rather than on the roles of whoever minted it.
 *
 * `status: "all"` because a document with unpublished edits may never have been
 * published: filtering to published rows would drop precisely the documents a
 * pending-edits card exists to name, reporting a caller's own work as
 * unreadable. Access is unaffected by it — the lifecycle decides visibility of
 * a row's STATE, the access rule decides visibility of the row.
 *
 * Only `id` is selected. The caller needs membership, and a projection wide
 * enough to answer that is the narrowest thing that also cannot carry field
 * values into a surface that never asked for them.
 *
 * 🔴 `locale` is part of the QUESTION, not a presentation detail. A stored rule
 * is a predicate over the collection's fields, and a localized field answers
 * differently per language, so a read that names no locale judges whichever
 * translation it defaults to. Asking once per slug and applying that verdict to
 * every language discloses the rows a rule refuses in the others.
 */
export async function readableDocumentIds(
  collection: string,
  entryIds: readonly string[],
  caller: ReadCaller,
  locale?: string | null
): Promise<Set<string>> {
  const readable = new Set<string>();
  if (entryIds.length === 0) return readable;

  for (const chunk of chunked(entryIds)) {
    const result = await getNextly().find({
      collection,
      where: { id: { in: chunk } },
      select: { id: true },
      // The whole chunk can legitimately come back; a smaller page would report
      // the remainder as unreadable.
      limit: chunk.length,
      status: "all",
      ...(locale === null || locale === undefined ? {} : { locale }),
      overrideAccess: false,
      user: caller.user,
      ...(caller.authenticatedScope
        ? { actor: caller.authenticatedScope }
        : {}),
    });
    for (const item of result.items ?? []) {
      const id = (item as { id?: unknown }).id;
      if (typeof id === "string") readable.add(id);
    }
  }
  return readable;
}

/** Items grouped by the slug their document belongs to, order preserved. */
function bySlug<T>(
  items: readonly T[],
  ref: (item: T) => DocumentRef
): Map<string, T[]> {
  const grouped = new Map<string, T[]>();
  for (const item of items) {
    const slug = ref(item).slug;
    const existing = grouped.get(slug);
    if (existing) existing.push(item);
    else grouped.set(slug, [item]);
  }
  return grouped;
}

/** The collection items whose documents survive that collection's read rules. */
async function visibleCollectionItems<T>(
  items: readonly T[],
  ref: (item: T) => DocumentRef,
  caller: ReadCaller
): Promise<Set<T>> {
  const visible = new Set<T>();
  for (const [slug, slugItems] of bySlug(items, ref)) {
    const readable = await readableDocumentIds(
      slug,
      slugItems.map(item => ref(item).entryId),
      caller
    );
    for (const item of slugItems) {
      if (readable.has(ref(item).entryId)) visible.add(item);
    }
  }
  return visible;
}

/**
 * The single items whose document this caller may read, asked once per language.
 *
 * `routeAuthorized: false` states the truth: the surface asking this authorized
 * a dashboard read, not a read of this Single, so the coarse gate has not run
 * for that operation and must not be skipped. Claiming otherwise would hand a
 * caller holding no read grant the existence and edit time of the document.
 */
async function visibleSingleItems<T>(
  items: readonly T[],
  ref: (item: T) => DocumentRef,
  caller: ReadCaller
): Promise<Set<T>> {
  const visible = new Set<T>();
  if (items.length === 0) return visible;

  // 🔴 Imported HERE rather than at the top of the module, because the static
  // edge is a cycle: the Singles read path imports the versions domain, which
  // is one of this module's callers. Rollup already reports that shape
  // elsewhere in this package as producing a circular chunk dependency and a
  // broken execution order, and the failure would land at boot rather than
  // here. Deferring it also means a caller whose rows are all collections never
  // loads the Singles query service at all.
  const { singleDocumentReadable } = await import(
    "../../domains/singles/services/single-document-access"
  );

  const verdicts = new Map<string, Promise<boolean>>();
  for (const item of items) {
    const { slug, locale } = ref(item);
    const key = `${slug} ${locale ?? ""}`;
    let verdict = verdicts.get(key);
    if (!verdict) {
      verdict = singleDocumentReadable(slug, {
        user: caller.user,
        ...(caller.authenticatedScope
          ? { actor: caller.authenticatedScope }
          : {}),
        routeAuthorized: false,
        ...(locale === null || locale === undefined ? {} : { locale }),
      });
      verdicts.set(key, verdict);
    }
    if (await verdict) visible.add(item);
  }
  return visible;
}

/**
 * `items`, in their original order, keeping only those whose document the
 * caller may be told about.
 *
 * The two kinds are decided by different paths because they are different
 * questions: a collection document is one row among many and is asked for by
 * id, while a Single is one document per language read through its own service.
 * A caller that collapsed them would ask about a table that does not hold the
 * document and read the refusal as a denial.
 */
export async function visibleDocuments<T>(
  items: readonly T[],
  ref: (item: T) => DocumentRef,
  caller: ReadCaller
): Promise<T[]> {
  if (items.length === 0) return [];

  const [collections, singles] = await Promise.all([
    visibleCollectionItems(
      items.filter(item => ref(item).kind === "collection"),
      ref,
      caller
    ),
    visibleSingleItems(
      items.filter(item => ref(item).kind === "single"),
      ref,
      caller
    ),
  ]);

  return items.filter(item => collections.has(item) || singles.has(item));
}
