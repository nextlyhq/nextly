/**
 * Which pending-edit rows this caller may actually be told about.
 *
 * 🔴 The version table is keyed by (scopeKind, scopeSlug, entryId) and carries
 * no access rules of its own, so a read of it bounded only by collection name
 * answers about documents the ordinary read path would refuse. Entity-level
 * access decides whether a collection is IN REACH; a stored `owner-only` or
 * `custom` read rule then narrows which of its rows come back, and that second
 * axis is invisible to a slug filter. Without this pass the dashboard's cards
 * counted one author's documents for another and listed their entry ids and the
 * instants they were edited.
 *
 * Every decision here is delegated. A stored rule can be owner-only or an
 * arbitrary function, and evaluating either is the read path's job — this asks
 * that path about a known set of documents rather than reproducing what it
 * would say, which is the second access implementation this domain exists to
 * avoid.
 *
 * @module domains/versions/pending-edit-visibility
 */

import type { ReadCaller } from "../../services/dashboard/readable-resources";
import { readableDocumentIds } from "../../services/lib/readable-documents";

import type { VersionMeta } from "./versions-repository";

/** Rows grouped by the slug they belong to, preserving their order. */
function bySlug(rows: readonly VersionMeta[]): Map<string, VersionMeta[]> {
  const grouped = new Map<string, VersionMeta[]>();
  for (const row of rows) {
    const existing = grouped.get(row.scopeSlug);
    if (existing) existing.push(row);
    else grouped.set(row.scopeSlug, [row]);
  }
  return grouped;
}

/** The collection rows whose documents survive that collection's read rules. */
async function visibleCollectionRows(
  rows: readonly VersionMeta[],
  caller: ReadCaller
): Promise<Set<VersionMeta>> {
  const visible = new Set<VersionMeta>();
  for (const [slug, slugRows] of bySlug(rows)) {
    const readable = await readableDocumentIds(
      slug,
      slugRows.map(row => row.entryId),
      caller
    );
    for (const row of slugRows) if (readable.has(row.entryId)) visible.add(row);
  }
  return visible;
}

/**
 * The single rows whose document this caller may read, asked once per language.
 *
 * Per LOCALE, because a localized Single is a different document per language
 * and an owner-only or custom rule can answer differently for each — the same
 * reason `SingleAccessSubject` carries a locale at all.
 *
 * `routeAuthorized: false` states the truth: the widget endpoint authorized a
 * WIDGET, not a read of this Single, so the coarse gate has not run for this
 * operation and must not be skipped. Claiming otherwise would hand a caller
 * holding no read grant the existence and edit time of the document.
 */
async function visibleSingleRows(
  rows: readonly VersionMeta[],
  caller: ReadCaller
): Promise<Set<VersionMeta>> {
  const visible = new Set<VersionMeta>();
  if (rows.length === 0) return visible;

  // 🔴 Imported HERE rather than at the top of the module, because the static
  // edge is a cycle: the Singles read path imports this domain (draft overlay,
  // in-transaction capture, snapshot shaping), so a top-level import back into
  // it closes the loop. Rollup already reports that shape elsewhere in this
  // package as producing a circular chunk dependency and a broken execution
  // order, and the failure would land at boot rather than here. Deferring it
  // also means an install whose pending edits are all collections never loads
  // the Singles query service at all.
  const { singleDocumentReadable } = await import(
    "../singles/services/single-document-access"
  );

  const verdicts = new Map<string, Promise<boolean>>();
  for (const row of rows) {
    const key = `${row.scopeSlug} ${row.locale ?? ""}`;
    let verdict = verdicts.get(key);
    if (!verdict) {
      verdict = singleDocumentReadable(row.scopeSlug, {
        user: caller.user,
        ...(caller.authenticatedScope
          ? { actor: caller.authenticatedScope }
          : {}),
        routeAuthorized: false,
        ...(row.locale === null ? {} : { locale: row.locale }),
      });
      verdicts.set(key, verdict);
    }
    if (await verdict) visible.add(row);
  }
  return visible;
}

/**
 * `rows`, in their original order, keeping only what the caller may be told.
 *
 * A row whose `scopeKind` is neither a collection nor a single is DROPPED
 * rather than passed through. Nothing here can decide such a row — there is no
 * read path to ask — and admitting what cannot be judged is the inversion this
 * pass exists to remove. It costs nothing today, since the source's candidate
 * slugs come from the collection and single registries.
 */
export async function visiblePendingEdits(
  rows: readonly VersionMeta[],
  caller: ReadCaller
): Promise<VersionMeta[]> {
  if (rows.length === 0) return [];

  const [collections, singles] = await Promise.all([
    visibleCollectionRows(
      rows.filter(row => row.scopeKind === "collection"),
      caller
    ),
    visibleSingleRows(
      rows.filter(row => row.scopeKind === "single"),
      caller
    ),
  ]);

  return rows.filter(row => collections.has(row) || singles.has(row));
}
