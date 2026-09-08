/**
 * Which of a batch of content-keyed rows the caller may be told about.
 *
 * 🔴 ONE implementation of that question, for every surface keyed by collection
 * and document id. The pending-edit cards and the activity feed each carried
 * their own, and two implementations of one access decision do not stay equal:
 * per-locale grouping, the registry-kind check, the stale-locale drop, bounded
 * concurrency and resolving a Single's live id before probing it were each
 * present on one side and absent from the other, every one of them a defect on
 * the side that lacked it.
 *
 * Separate from `readable-documents.ts` because the two answer different
 * questions and only one of them is mockable from the other's tests: that
 * module asks the read path which ids of ONE collection survive, and this one
 * decides which collections and languages to ask about at all.
 *
 * The rule is never re-implemented here. A stored rule can be `owner-only` or a
 * `custom` function, and both return a query constraint over the COLLECTION's
 * own fields — which is why it cannot be pushed into a sidecar table's query:
 * `activity_log` and `nextly_versions` do not carry the columns a rule names.
 * Asking the read path which of a known set of ids survive is the one form that
 * works for every rule, including the ones nobody can predict.
 *
 * @module services/lib/document-visibility
 */

import { authorizationGroups } from "../../auth/entity-read-access";
import { container } from "../../di/container";
import type { NextlyServiceConfig } from "../../di/register";
import type { ReadCaller } from "../dashboard/readable-resources";

import { readableDocumentIds } from "./readable-documents";
import { registeredContentSnapshot } from "./registered-content-slugs";

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
   * Which translation, for a localized document. A localized Single is a
   * different document per language and a rule can answer differently for each,
   * so the verdict is per locale rather than per slug.
   */
  locale?: string | null;
}

/**
 * The install-wide facts every batch must be judged against.
 *
 * 🔴 Resolved ONCE by the caller and carried, never re-read per page. Both
 * halves turn a failure into an EMPTY answer on purpose — an unreachable
 * registry contributes no slugs, an unreadable config no languages — and under
 * a per-page read that safety became a defect: a transient failure on one page
 * dropped every row that page held, the pages either side of it kept theirs,
 * and the walk could finish and publish the shortfall as a whole number. A
 * snapshot cannot fail halfway; it is either the basis for the entire answer or
 * the reason there is not one.
 */
export interface DocumentVisibilityScope {
  kinds: ReadonlyMap<string, "collection" | "single">;
  locales: ReadonlySet<string> | null;
  /** True when a registry could not be enumerated, so `kinds` is a floor. */
  degraded: boolean;
}

/**
 * The languages a read can actually be performed in, or `null` when the install
 * configures none.
 *
 * 🔴 Needed because forwarding an unconfigured locale does NOT authorize it:
 * `resolveRequestedLocale` substitutes the configured DEFAULT for any code it
 * does not recognise. A row written under a language later removed from the
 * configuration would be judged by the default language's verdict — a row
 * exposed on a predicate never evaluated for it, which is the same defect as
 * passing no locale at all.
 */
function configuredLocales(): ReadonlySet<string> | null {
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

/** One resolution of the registry and the configured languages. */
export async function resolveDocumentVisibilityScope(): Promise<DocumentVisibilityScope> {
  const snapshot = await registeredContentSnapshot();
  return {
    kinds: snapshot.kinds,
    locales: configuredLocales(),
    degraded: snapshot.degraded,
  };
}

/** A ref that survived every check nothing here can decide. */
interface Subject {
  kind: "collection" | "single";
  slug: string;
  entryId: string;
  locale: string | null;
}

/**
 * The document a ref names, or `null` when nothing here can decide it.
 *
 * Three ways a ref is undecidable, each of which has cost a real defect:
 *
 * - Its recorded kind disagrees with the registry. Deleting a collection leaves
 *   its history and its activity behind, and a Single may later take the freed
 *   slug — so a `collection` row can survive under a name that now belongs to a
 *   Single. Probing the collection read path for it asks about a table that is
 *   not there, which throws and breaks the whole surface rather than dropping
 *   one row.
 * - Its slug is in neither registry, so there is no read path to ask at all.
 *   The activity log makes that ordinary rather than exotic: it files settings
 *   mutations under namespaces that are neither a collection nor a single.
 * - Its language is no longer configured, so a read cannot be performed IN that
 *   language and would silently answer about the default one instead.
 *
 * Every one is DROPPED. Nothing here can judge them, and admitting what cannot
 * be judged is the inversion this module exists to remove.
 */
function subjectOf(
  ref: DocumentRef,
  scope: DocumentVisibilityScope
): Subject | null {
  const kind = scope.kinds.get(ref.slug);
  if (!kind || kind !== ref.kind) return null;
  const locale = ref.locale ?? null;
  if (locale !== null && !scope.locales?.has(locale)) return null;
  return { kind, slug: ref.slug, entryId: ref.entryId, locale };
}

/** One read's worth of items: a slug, in a language, and what it answers for. */
interface ReadUnit<T> {
  subject: Subject;
  entries: { item: T; entryId: string }[];
}

/** Items grouped into the units one read can answer for: a slug in a language. */
function readUnits<T>(
  items: readonly T[],
  subjects: ReadonlyMap<T, Subject>,
  kind: "collection" | "single"
): Map<string, ReadUnit<T>> {
  const units = new Map<string, ReadUnit<T>>();
  for (const item of items) {
    const subject = subjects.get(item);
    if (!subject || subject.kind !== kind) continue;
    const key = `${subject.slug} ${subject.locale ?? ""}`;
    const entry = { item, entryId: subject.entryId };
    const existing = units.get(key);
    if (existing) existing.entries.push(entry);
    else units.set(key, { subject, entries: [entry] });
  }
  return units;
}

/**
 * Run `decide` over every unit with BOUNDED CONCURRENCY, keeping what it admits.
 *
 * 🔴 One implementation of the fail-closed rule, because both kinds need it and
 * a copy of it would be a second place for "the read failed" to start meaning
 * "the caller may see this". A rejected decision has told us nothing, and
 * nothing must not read as visible — the direction `readableEntities` also
 * takes.
 *
 * Bounded rather than unbounded: each unit enters a full read path, so a batch
 * spanning many collections or languages became that many sequential round
 * trips one way and an unbounded fan-out the other. `authorizationGroups` is
 * the bound the entity-level decisions already use, and its first group of one
 * is what lets a cold per-user permission cache be filled once rather than
 * missed by everything behind it.
 */
async function admittedPerUnit<T>(
  units: ReadonlyMap<string, ReadUnit<T>>,
  decide: (unit: ReadUnit<T>) => Promise<readonly T[]>
): Promise<Set<T>> {
  const visible = new Set<T>();
  for (const group of authorizationGroups([...units.keys()])) {
    const settled = await Promise.allSettled(
      group.map(key => decide(units.get(key) as ReadUnit<T>))
    );
    for (const outcome of settled) {
      if (outcome.status !== "fulfilled") continue;
      for (const item of outcome.value) visible.add(item);
    }
  }
  return visible;
}

/**
 * Collection items whose documents survive that collection's read rules.
 *
 * 🔴 Grouped by slug AND language, because a stored rule is a predicate over the
 * collection's own fields and a localized field answers differently per
 * language — `localized-target-predicate.integration.test.ts` pins one row
 * readable in `en` and denied in `de`. One verdict per slug would mark every
 * other language visible on the strength of whichever the read defaulted to.
 *
 * Run with BOUNDED CONCURRENCY rather than one after another. Each unit enters
 * the full collection read path, so a batch spanning many collections or
 * languages became that many sequential round trips — enough to time a dashboard
 * out while the connection pool sat idle. `authorizationGroups` is the bound the
 * entity-level decisions already use, and its first group of one is what lets a
 * cold per-user permission cache be filled once rather than missed by everything
 * in the fan-out.
 */
async function visibleCollectionItems<T>(
  units: ReadonlyMap<string, ReadUnit<T>>,
  caller: ReadCaller
): Promise<Set<T>> {
  return admittedPerUnit(units, async unit => {
    const readable = await readableDocumentIds(
      unit.subject.slug,
      unit.entries.map(entry => entry.entryId),
      caller,
      unit.subject.locale
    );
    return unit.entries
      .filter(entry => readable.has(entry.entryId))
      .map(entry => entry.item);
  });
}

/**
 * Single items whose document this caller may read, asked once per language.
 *
 * The live document's id is resolved FIRST, and without materializing anything.
 * A row can outlive the document it describes, so a Single deleted and recreated
 * leaves rows naming its predecessor — and the probe reads through
 * `SingleEntryService`, which AUTO-CREATES a missing Single, so asking it first
 * would make loading a dashboard perform a write.
 *
 * `routeAuthorized: false` states the truth: the surface asking this authorized
 * a dashboard read, not a read of this Single, so the coarse gate has not run
 * for that operation and must not be skipped.
 */
async function visibleSingleItems<T>(
  units: ReadonlyMap<string, ReadUnit<T>>,
  caller: ReadCaller
): Promise<Set<T>> {
  if (units.size === 0) return new Set<T>();

  // 🔴 Imported HERE rather than at the top of the module, because the static
  // edge is a cycle: the Singles read path imports the versions domain, which
  // is one of this module's callers. Rollup already reports that shape
  // elsewhere in this package as producing a broken execution order, and the
  // failure would land at boot rather than here. Deferring it also means a
  // caller whose rows are all collections never loads the Singles service.
  const { singleDocumentReadable, resolveSingleDocumentId } = await import(
    "../../domains/singles/services/single-document-access"
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

  return admittedPerUnit(units, async unit => {
    // 🔴 The live id is resolved FIRST, and the probe skipped entirely when no
    // entry names it. A row outlives the document it describes, so a Single
    // deleted and recreated leaves rows naming its predecessor — and the probe
    // reads through `SingleEntryService`, which AUTO-CREATES a missing Single,
    // so asking it first would make loading a dashboard perform a write.
    const liveId = await liveIdOf(unit.subject.slug);
    if (liveId === null) return [];
    const live = unit.entries.filter(entry => entry.entryId === liveId);
    if (live.length === 0) return [];

    // `routeAuthorized: false` states the truth: the surface asking this
    // authorized a dashboard read, not a read of this Single, so the coarse
    // gate has not run for that operation and must not be skipped.
    const allowed = await singleDocumentReadable(unit.subject.slug, {
      user: caller.user,
      ...(caller.authenticatedScope
        ? { actor: caller.authenticatedScope }
        : {}),
      routeAuthorized: false,
      ...(unit.subject.locale === null ? {} : { locale: unit.subject.locale }),
    });
    return allowed ? live.map(entry => entry.item) : [];
  });
}

/**
 * `items`, in their original order, keeping only those whose document the
 * caller may be told about.
 *
 * 🔴 ONE implementation of that question, for every surface keyed by collection
 * and document id. The pending-edit cards and the activity feed each had their
 * own, and two implementations of one access decision do not stay equal: the
 * per-locale grouping, the registry-kind check, the stale-locale drop and the
 * live-Single resolution were all found on one side while the other went on
 * answering without them.
 *
 * The two kinds are decided by different paths because they are different
 * questions: a collection document is one row among many and is asked for by
 * id, while a Single is one document per language read through its own service.
 * A caller that collapsed them would ask about a table that does not hold the
 * document and read the refusal as a denial.
 */
export async function visibleDocuments<T>(
  items: readonly T[],
  ref: (item: T) => DocumentRef | null,
  caller: ReadCaller,
  scope: DocumentVisibilityScope
): Promise<T[]> {
  if (items.length === 0) return [];

  const subjects = new Map<T, Subject>();
  for (const item of items) {
    const named = ref(item);
    if (!named) continue;
    const subject = subjectOf(named, scope);
    if (subject) subjects.set(item, subject);
  }
  if (subjects.size === 0) return [];

  const [collections, singles] = await Promise.all([
    visibleCollectionItems(readUnits(items, subjects, "collection"), caller),
    visibleSingleItems(readUnits(items, subjects, "single"), caller),
  ]);

  return items.filter(item => collections.has(item) || singles.has(item));
}
