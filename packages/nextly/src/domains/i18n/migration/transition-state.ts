/**
 * Durable record of an entity's localization transition.
 *
 * Turning localization on for an entity that already has content is a data
 * migration, not a schema change: the existing values sit on the main table in
 * one language, and they have to be copied into the companion `_locales` table
 * labelled with that language. Which language that was cannot be recovered
 * afterwards. `defaultLocale` is the current default, not the default at the
 * time the values were written, and it can change; an empty companion says
 * nothing about whether a copy is owed or was attempted and produced nothing.
 * Every physical shape a reader can observe has a counter-example, so the
 * transition records its own progress here and decisions are made from that
 * record.
 *
 * Written before the first statement rather than after, because MySQL commits
 * DDL implicitly: a crash between creating the companion and a post-hoc marker
 * write would leave a companion with no record of why it exists, and the retry
 * would see the table, assume it was always there, and skip the copy forever.
 *
 * Keyed per entity rather than as one map, so two entities transitioning at the
 * same time cannot clobber each other's record through a read-modify-write.
 *
 * @module domains/i18n/migration/transition-state
 */

import { NextlyError } from "../../../errors/nextly-error";
import type { MetaEntry } from "../../meta/services/meta-service";

/**
 * The `nextly_meta` capability this needs, rather than the whole `MetaService`.
 *
 * `MetaService` satisfies it structurally. Naming only the two methods used
 * keeps the unit tests free of a database and of a cast to invent one.
 */
export interface TransitionStateStore {
  getEntry<T = unknown>(key: string): Promise<MetaEntry<T>>;
  set(key: string, value: unknown): Promise<void>;
  delete(key: string): Promise<void>;
}

/**
 * Which kind of entity a slug belongs to.
 *
 * Part of the key because a collection, a single and a field group may all use
 * the same slug, and only one of them may have transitioned.
 */
export type I18nTransitionKind = "collection" | "single" | "fieldGroup";

/** Marker payload version, so a later change can evolve this shape. */
export const I18N_TRANSITION_MARKER_VERSION = 1;

/** `nextly_meta` key prefix, kept in one place so reads and writes cannot drift. */
const KEY_PREFIX = "i18n.transition";

/**
 * No record for this entity.
 *
 * Two situations produce it and they are not the same: an entity that has
 * always been localized never owed a copy, while an entity that transitioned
 * before this record existed owes one that nothing can now describe. Absence is
 * reported as absence rather than resolved to either, because guessing is the
 * thing this module exists to stop.
 */
export interface UntrackedTransition {
  status: "untracked";
}

/**
 * The companion exists and the copy is owed or unfinished.
 *
 * `sourceLocale` is the language the main-table values were in when the
 * transition started, which is what the copy must label them with. Recorded
 * once and never recomputed, so changing `defaultLocale` afterwards cannot
 * relabel content that was written before the change.
 */
export interface EnablingTransition {
  status: "enabling";
  sourceLocale: string;
}

/** The copy finished. Nothing further is owed for this entity. */
export interface SeededTransition {
  status: "seeded";
  sourceLocale: string;
}

/**
 * Localization was turned off again and the companion's values were copied back onto the main
 * table, which is authoritative from that point on.
 *
 * Distinct from having no record at all, and the difference is the whole reason this state exists.
 * Unattended provisioning is additive, so the companion is left standing rather than dropped — and
 * a companion that is present but no longer read goes stale the moment the next edit lands on
 * main. If localization is enabled again, an empty-or-stale companion is exactly what the enable
 * path must NOT trust: it has to overwrite the default locale's rows from main instead of assuming
 * the rows it finds are current.
 *
 * `sourceLocale` is the locale whose values were restored, which is therefore the language the
 * main table now holds. Recorded rather than re-derived because the default locale may change
 * again before localization is re-enabled.
 */
export interface RestoredTransition {
  status: "restored";
  sourceLocale: string;
}

export type I18nTransitionState =
  | UntrackedTransition
  | EnablingTransition
  | SeededTransition
  | RestoredTransition;

/** Stored shape. Separate from the public union so a read can validate it. */
interface StoredMarker {
  version: number;
  status: "enabling" | "seeded" | "restored";
  sourceLocale?: string;
}

/** The stored statuses, in one place so the reader's validation cannot drift from the writers. */
const STORED_STATUSES: ReadonlySet<string> = new Set([
  "enabling",
  "seeded",
  "restored",
]);

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

/**
 * The key for one entity.
 *
 * Rejects a slug containing `.` because the key joins its parts with dots: a
 * dotted slug could produce the same key as a different kind-and-slug pair, and
 * two entities sharing one record is the failure this key layout exists to
 * avoid.
 */
function markerKey(kind: I18nTransitionKind, slug: string): string {
  requireIdentifier(slug, "slug");
  if (slug.includes(".")) {
    throw NextlyError.internal({
      logContext: {
        reason: "localization transition slug must not contain a dot",
        slug,
      },
    });
  }
  return `${KEY_PREFIX}.${kind}.${slug}`;
}

/**
 * Read an entity's transition record.
 *
 * An absent row is `untracked`. A row that exists but cannot be read is NOT
 * treated as absent: that would restart a copy that may already have run, or
 * label content with a language nobody recorded, so it refuses instead.
 *
 * Absence is decided by whether the row exists, never by whether its value
 * decodes to `null`. A row holding SQL NULL or the JSON literal `null` is a
 * marker we wrote and can no longer read, which is the corrupt case rather than
 * the untouched one.
 */
export async function readI18nTransitionState(
  store: TransitionStateStore,
  kind: I18nTransitionKind,
  slug: string
): Promise<I18nTransitionState> {
  const key = markerKey(kind, slug);
  const entry = await store.getEntry<unknown>(key);
  if (!entry.present) return { status: "untracked" };

  if (entry.value === null || entry.value === undefined) {
    throw markerCorrupt(key, "marker row exists but carries no value");
  }
  if (!isRecord(entry.value)) {
    throw markerCorrupt(key, "marker is not an object");
  }

  const marker = entry.value as unknown as StoredMarker;

  if (marker.version !== I18N_TRANSITION_MARKER_VERSION) {
    throw markerCorrupt(
      key,
      `marker version ${String(marker.version)} is not supported by this build`
    );
  }
  if (!STORED_STATUSES.has(marker.status)) {
    throw markerCorrupt(key, `unknown marker status ${String(marker.status)}`);
  }
  // The source locale is the whole point of the record: a marker without one
  // cannot say what language the main-table values are in, which leaves the copy
  // no safer than the guesswork this replaces.
  if (
    typeof marker.sourceLocale !== "string" ||
    marker.sourceLocale.length === 0
  ) {
    throw markerCorrupt(key, "marker carries no source locale");
  }

  return { status: marker.status, sourceLocale: marker.sourceLocale };
}

/**
 * Record that a transition is starting. Must be called before the first
 * statement that changes the database.
 *
 * Writing `enabling` for an entity already recorded as `seeded` would re-owe a
 * copy that has run, so that is refused. Re-writing `enabling` over `enabling`
 * is allowed and idempotent: a retry after a failed transition is expected, and
 * the recorded source locale does not change between attempts.
 *
 * `restored` is a legal predecessor, and unlike `enabling` it may name a
 * different source locale. Localization was off in between, so the main table
 * was authoritative and may have been edited under a default locale that has
 * since changed; refusing here would block a legitimate re-enable on the
 * strength of a transition that has already been undone.
 */
export async function beginI18nTransition(
  store: TransitionStateStore,
  args: {
    kind: I18nTransitionKind;
    slug: string;
    sourceLocale: string;
  }
): Promise<void> {
  // The writer holds itself to the reader's rules. Persisting a marker the next
  // read would reject leaves the entity unusable with no way forward, and an
  // empty locale is the easiest way to do that by accident.
  requireIdentifier(args.sourceLocale, "sourceLocale");
  const key = markerKey(args.kind, args.slug);

  const current = await readI18nTransitionState(store, args.kind, args.slug);
  if (current.status === "seeded") {
    throw NextlyError.internal({
      logContext: {
        reason: "localization transition already seeded for this entity",
        key,
      },
    });
  }
  if (
    current.status === "enabling" &&
    current.sourceLocale !== args.sourceLocale
  ) {
    // The first attempt recorded which language the main values are in. A second
    // attempt naming a different one would relabel them, which is the data loss
    // this record exists to prevent.
    throw NextlyError.internal({
      logContext: {
        reason: "localization transition source locale cannot change",
        key,
        recorded: current.sourceLocale,
        received: args.sourceLocale,
      },
    });
  }

  const marker: StoredMarker = {
    version: I18N_TRANSITION_MARKER_VERSION,
    status: "enabling",
    sourceLocale: args.sourceLocale,
  };
  await store.set(key, marker);
}

/**
 * Record that the copy finished.
 *
 * Refuses an entity with no `enabling` record, because there is then no
 * recorded source locale to settle at and nothing established that a copy ran.
 * Settling twice is allowed: the second call writes the same marker.
 */
export async function settleI18nTransition(
  store: TransitionStateStore,
  args: { kind: I18nTransitionKind; slug: string }
): Promise<void> {
  const key = markerKey(args.kind, args.slug);
  const current = await readI18nTransitionState(store, args.kind, args.slug);
  if (current.status === "untracked") {
    throw NextlyError.internal({
      logContext: {
        reason: "cannot settle a localization transition that never began",
        key,
      },
    });
  }

  const marker: StoredMarker = {
    version: I18N_TRANSITION_MARKER_VERSION,
    status: "seeded",
    sourceLocale: current.sourceLocale,
  };
  await store.set(key, marker);
}

/**
 * Record that the companion's values have been copied back onto the main table and localization is
 * off for this entity.
 *
 * Written AFTER the copy, which is the opposite of {@link beginI18nTransition} and for the mirrored
 * reason. Nothing is created here, so a crash mid-restore leaves the companion intact and the
 * record still saying the companion is authoritative — the next pass simply restores again, which
 * is idempotent. Recording first would instead declare main authoritative while it still held stale
 * values, and every later pass would believe it.
 *
 * Overwrites `enabling` as readily as `seeded`: disabling localization part-way through a
 * transition is legitimate, and what matters afterwards is which locale main now holds, not how
 * far the abandoned copy had got. Refuses only when nothing was ever recorded, because then there
 * is no evidence this entity's companion was ever the authority and the restore did not come from
 * a transition this system performed.
 */
export async function recordI18nRestore(
  store: TransitionStateStore,
  args: {
    kind: I18nTransitionKind;
    slug: string;
    sourceLocale: string;
  }
): Promise<void> {
  requireIdentifier(args.sourceLocale, "sourceLocale");
  const key = markerKey(args.kind, args.slug);
  const current = await readI18nTransitionState(store, args.kind, args.slug);
  if (current.status === "untracked") {
    throw NextlyError.internal({
      logContext: {
        reason: "cannot restore a localization transition that never began",
        key,
      },
    });
  }

  const marker: StoredMarker = {
    version: I18N_TRANSITION_MARKER_VERSION,
    status: "restored",
    sourceLocale: args.sourceLocale,
  };
  await store.set(key, marker);
}

// Mirrors the non-empty check the read applies, so the two cannot drift into a
// writer that produces markers its own reader refuses.
function requireIdentifier(value: string, field: string): void {
  if (typeof value === "string" && value.length > 0) return;
  throw NextlyError.internal({
    logContext: {
      reason: "localization transition identifier must be a non-empty string",
      field,
    },
  });
}

// A marker that exists but cannot be read is refused rather than ignored:
// treating it as absent would re-run a copy that may have happened, or label
// content with a language nobody recorded. Serving is unsafe until an operator
// looks, hence 503 rather than a programmer-error code.
function markerCorrupt(key: string, reason: string): NextlyError {
  return NextlyError.serviceUnavailable({
    logMessage: `localization transition marker is unreadable: ${reason}`,
    logContext: { key, reason },
  });
}

/**
 * Forget an entity's transition entirely.
 *
 * The record is keyed by kind and slug, which a later entity can reuse. Two moments make the old
 * record actively harmful rather than merely stale:
 *
 * - The entity is deleted. A new one created under the same slug would inherit a predecessor's
 *   source locale, and `beginI18nTransition` would refuse its real one — after its companion had
 *   already been created and seeded.
 * - Localization is disabled. The companion is gone and the values are back on main, so the
 *   transition it describes no longer exists. If the default locale changes before localization is
 *   enabled again, main holds content in the new default while the record still names the old one,
 *   and the refusal that protects a live transition instead blocks a legitimate one.
 *
 * Deleting is right for both. What the record protects is a transition in progress; once there is
 * no companion there is nothing to protect, and the next enable should record what is true then.
 *
 * Absent is the state this produces, so removing a record that was never there is not an error.
 */
export async function forgetI18nTransition(
  store: TransitionStateStore,
  kind: I18nTransitionKind,
  slug: string
): Promise<void> {
  await store.delete(markerKey(kind, slug));
}
