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
 * Version rows OUTLIVE the things they describe — that is what history is — so a
 * row reaching here may name a document, a language or an entity that no longer
 * exists, or a slug some other entity has since taken over. Each of those is
 * UNDECIDABLE rather than deniable, and every one is dropped: nothing here can
 * judge them, and admitting what cannot be judged is the inversion this pass
 * exists to remove.
 *
 * Every decision that IS made is delegated. A stored rule can be owner-only or
 * an arbitrary function, and evaluating either is the read path's job — this
 * asks that path about a known set of documents rather than reproducing what it
 * would say.
 *
 * @module domains/versions/pending-edit-visibility
 */

import { authorizationGroups } from "../../auth/entity-read-access";
import { container } from "../../di/container";
import type { NextlyServiceConfig } from "../../di/register";
import type { ReadCaller } from "../../services/dashboard/readable-resources";
import { readableDocumentIds } from "../../services/lib/readable-documents";
import { registeredContentKinds } from "../../services/lib/registered-content-slugs";

import type { VersionMeta } from "./versions-repository";

/** What a row must resolve to before any access question can be asked about it. */
interface Subject {
  kind: "collection" | "single";
  slug: string;
  entryId: string;
  locale: string | null;
}

/** One read's worth of rows: a slug, in a language, and what it answers for. */
interface ReadUnit {
  subject: Subject;
  rows: VersionMeta[];
}

/**
 * The languages a read can actually be performed in, or `null` when the install
 * configures none.
 *
 * 🔴 Needed because forwarding an unconfigured locale does NOT authorize it:
 * `resolveRequestedLocale` substitutes the configured DEFAULT for any code it
 * does not recognise. A working draft written under a language later removed
 * from the configuration would therefore be judged by the default language's
 * verdict — a row exposed on a predicate never evaluated for it, which is the
 * same defect as passing no locale at all.
 */
function configuredLocales(): Set<string> | null {
  try {
    if (!container.has("config")) return null;
    const localization =
      container.get<NextlyServiceConfig>("config").localization;
    if (!localization) return null;
    return new Set(localization.locales.map(locale => locale.code));
  } catch {
    // A container that cannot answer leaves every localized row undecidable,
    // which `subjectOf` turns into "dropped" rather than "allowed".
    return null;
  }
}

/**
 * The document a row names, or `null` when nothing here can decide it.
 *
 * Three ways a row is undecidable, each of which has cost a real defect:
 *
 * - Its scope kind disagrees with the registry. Deleting a collection leaves its
 *   history behind, and a Single may later take the freed slug — so a
 *   `collection` row can survive under a name that now belongs to a Single.
 *   Probing the collection read path for it asks about a table that is not
 *   there, which throws and breaks both cards rather than dropping one row.
 * - Its slug is in neither registry, so there is no read path to ask at all.
 * - Its language is no longer configured, so a read cannot be performed IN that
 *   language and would silently answer about the default one instead.
 */
function subjectOf(
  row: VersionMeta,
  kinds: ReadonlyMap<string, "collection" | "single">,
  locales: Set<string> | null
): Subject | null {
  const kind = kinds.get(row.scopeSlug);
  if (!kind || kind !== row.scopeKind) return null;
  if (row.locale !== null && !locales?.has(row.locale)) return null;
  return {
    kind,
    slug: row.scopeSlug,
    entryId: row.entryId,
    locale: row.locale,
  };
}

/** Rows grouped into the units one read can answer for: a slug in a language. */
function readUnits(
  rows: readonly VersionMeta[],
  subjects: ReadonlyMap<VersionMeta, Subject>,
  kind: "collection" | "single"
): Map<string, ReadUnit> {
  const units = new Map<string, ReadUnit>();
  for (const row of rows) {
    const subject = subjects.get(row);
    if (!subject || subject.kind !== kind) continue;
    const key = `${subject.slug} ${subject.locale ?? ""}`;
    const existing = units.get(key);
    if (existing) existing.rows.push(row);
    else units.set(key, { subject, rows: [row] });
  }
  return units;
}

/**
 * Collection rows whose documents survive that collection's read rules.
 *
 * 🔴 Grouped by slug AND language, because a stored rule is a predicate over the
 * collection's own fields and a localized field answers differently per
 * language — `localized-target-predicate.integration.test.ts` pins one row
 * readable in `en` and denied in `de`. One verdict per slug would mark every
 * other language visible on the strength of whichever the read defaulted to.
 *
 * Run with BOUNDED CONCURRENCY rather than one after another. Each unit enters
 * the full collection read path, so a page spanning many collections or
 * languages became that many sequential round trips — enough to time a dashboard
 * out while the connection pool sat idle. `authorizationGroups` is the bound the
 * entity-level decisions already use, and its first group of one is what lets a
 * cold per-user permission cache be filled once rather than missed by everything
 * in the fan-out.
 */
async function visibleCollectionRows(
  units: ReadonlyMap<string, ReadUnit>,
  caller: ReadCaller
): Promise<Set<VersionMeta>> {
  const visible = new Set<VersionMeta>();

  for (const group of authorizationGroups([...units.keys()])) {
    const settled = await Promise.allSettled(
      group.map(async key => {
        const unit = units.get(key) as ReadUnit;
        const readable = await readableDocumentIds(
          unit.subject.slug,
          unit.rows.map(row => row.entryId),
          caller,
          unit.subject.locale
        );
        return { unit, readable };
      })
    );
    for (const outcome of settled) {
      // A rejected read has told us nothing, and "nothing" must not read as
      // "visible" -- the fail-closed direction `readableEntities` also takes.
      if (outcome.status !== "fulfilled") continue;
      const { unit, readable } = outcome.value;
      for (const row of unit.rows) {
        if (readable.has(row.entryId)) visible.add(row);
      }
    }
  }
  return visible;
}

/**
 * Single rows whose document this caller may read, asked once per language.
 *
 * The live document's id is resolved FIRST, and without materializing anything.
 * A version row outlives the document it describes, so a Single deleted and
 * recreated leaves rows naming its predecessor — and the probe reads through
 * `SingleEntryService`, which auto-creates a missing Single, so asking it first
 * would make loading a dashboard perform a write.
 *
 * `routeAuthorized: false` states the truth: the surface asking this authorized
 * a widget, not a read of this Single, so the coarse gate has not run for that
 * operation and must not be skipped.
 */
async function visibleSingleRows(
  units: ReadonlyMap<string, ReadUnit>,
  caller: ReadCaller
): Promise<Set<VersionMeta>> {
  const visible = new Set<VersionMeta>();
  if (units.size === 0) return visible;

  // 🔴 Imported HERE rather than at the top of the module, because the static
  // edge is a cycle: the Singles read path imports this domain, so a top-level
  // import back into it closes the loop. Rollup already reports that shape
  // elsewhere in this package as producing a broken execution order, and the
  // failure would land at boot rather than here.
  const { singleDocumentReadable, resolveSingleDocumentId } = await import(
    "../singles/services/single-document-access"
  );

  const liveIds = new Map<string, Promise<string | null>>();
  const liveIdOf = (slug: string): Promise<string | null> => {
    let pending = liveIds.get(slug);
    if (!pending) {
      pending = resolveSingleDocumentId(slug);
      liveIds.set(slug, pending);
    }
    return pending;
  };

  /**
   * One unit's rows that name the LIVE document, or none.
   *
   * 🔴 The probe is skipped entirely when nothing here names it — the Single is
   * unmaterialized, or every row is a predecessor's. It reads through a path
   * that AUTO-CREATES a missing Single, so asking about one that is not there
   * turns a dashboard read into a write; and asking about a live document on
   * behalf of rows that do not name it spends a read whose verdict cannot admit
   * any of them.
   */
  const liveRowsOf = async (unit: ReadUnit): Promise<VersionMeta[]> => {
    const liveId = await liveIdOf(unit.subject.slug);
    if (liveId === null) return [];
    return unit.rows.filter(row => row.entryId === liveId);
  };

  for (const group of authorizationGroups([...units.keys()])) {
    const settled = await Promise.allSettled(
      group.map(async key => {
        const unit = units.get(key) as ReadUnit;
        const live = await liveRowsOf(unit);
        if (live.length === 0) return [];
        const allowed = await singleDocumentReadable(unit.subject.slug, {
          user: caller.user,
          ...(caller.authenticatedScope
            ? { actor: caller.authenticatedScope }
            : {}),
          routeAuthorized: false,
          ...(unit.subject.locale === null
            ? {}
            : { locale: unit.subject.locale }),
        });
        return allowed ? live : [];
      })
    );
    for (const outcome of settled) {
      // A rejected read has told us nothing, and "nothing" must not read as
      // "visible" -- the fail-closed direction `readableEntities` also takes.
      if (outcome.status !== "fulfilled") continue;
      for (const row of outcome.value) visible.add(row);
    }
  }
  return visible;
}

/** `rows`, in their original order, keeping only what the caller may be told. */
export async function visiblePendingEdits(
  rows: readonly VersionMeta[],
  caller: ReadCaller
): Promise<VersionMeta[]> {
  if (rows.length === 0) return [];

  const kinds = await registeredContentKinds();
  const locales = configuredLocales();

  const subjects = new Map<VersionMeta, Subject>();
  for (const row of rows) {
    const subject = subjectOf(row, kinds, locales);
    if (subject) subjects.set(row, subject);
  }
  if (subjects.size === 0) return [];

  const [collections, singles] = await Promise.all([
    visibleCollectionRows(readUnits(rows, subjects, "collection"), caller),
    visibleSingleRows(readUnits(rows, subjects, "single"), caller),
  ]);

  return rows.filter(row => collections.has(row) || singles.has(row));
}
