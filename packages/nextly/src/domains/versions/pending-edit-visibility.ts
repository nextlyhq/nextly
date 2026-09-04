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

/**
 * Rows grouped by the slug AND locale they belong to, order preserved.
 *
 * 🔴 Locale is part of the key, not a detail. A stored read rule is a predicate
 * over the collection's own fields, and a localized field answers differently
 * per language — `localized-target-predicate.integration.test.ts` pins exactly
 * that, with one row readable in `en` and denied in `de`. Authorizing a slug
 * once therefore judges whichever translation the read defaults to and marks
 * every locale row visible on the strength of it, disclosing the entry id,
 * language and edit time of a translation the rule refuses.
 */
function byReadUnit(
  rows: readonly VersionMeta[]
): Map<string, { slug: string; locale: string | null; rows: VersionMeta[] }> {
  const grouped = new Map<
    string,
    { slug: string; locale: string | null; rows: VersionMeta[] }
  >();
  for (const row of rows) {
    // NUL-joined for the reason the version key is: a slug may contain any
    // delimiter that reads as safe.
    const key = `${row.scopeSlug}\u0000${row.locale ?? ""}`;
    const existing = grouped.get(key);
    if (existing) existing.rows.push(row);
    else
      grouped.set(key, {
        slug: row.scopeSlug,
        locale: row.locale,
        rows: [row],
      });
  }
  return grouped;
}

/** The collection rows whose documents survive that collection's read rules. */
async function visibleCollectionRows(
  rows: readonly VersionMeta[],
  caller: ReadCaller
): Promise<Set<VersionMeta>> {
  const visible = new Set<VersionMeta>();
  for (const unit of byReadUnit(rows).values()) {
    const readable = await readableDocumentIds(
      unit.slug,
      unit.rows.map(row => row.entryId),
      caller,
      unit.locale
    );
    for (const row of unit.rows) {
      if (readable.has(row.entryId)) visible.add(row);
    }
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
  const { singleDocumentReadable, resolveSingleDocumentId } = await import(
    "../singles/services/single-document-access"
  );

  // 🔴 Resolved BEFORE the probe, and without materializing anything. A version
  // row outlives the document it describes, so a Single that was deleted and
  // recreated leaves rows naming the predecessor -- and judging those by the
  // replacement's verdict exposes the old entry id and edit time. The probe
  // itself cannot be asked first either: it reads through `SingleEntryService`,
  // which AUTO-CREATES a missing Single, so loading a dashboard would perform a
  // write. `resolveSingleDocumentId` exists for exactly this and reads the
  // backing row directly; `canReadLiveSingle` compares the id the same way.
  const liveIds = new Map<string, Promise<string | null>>();
  const liveIdOf = (slug: string): Promise<string | null> => {
    let pending = liveIds.get(slug);
    if (!pending) {
      pending = resolveSingleDocumentId(slug);
      liveIds.set(slug, pending);
    }
    return pending;
  };

  const verdicts = new Map<string, Promise<boolean>>();
  for (const row of rows) {
    // An unmaterialized Single, or a row belonging to a predecessor document.
    if ((await liveIdOf(row.scopeSlug)) !== row.entryId) continue;
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
