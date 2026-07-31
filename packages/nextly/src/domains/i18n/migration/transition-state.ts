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

import { randomUUID } from "crypto";

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
  /**
   * Write only if the key has no row yet. What makes the first record of a
   * transition a claim rather than a suggestion — see
   * {@link beginI18nTransition}.
   */
  insertIfAbsent(key: string, value: unknown): Promise<void>;
  /**
   * Move a key only if it still holds `expected`. What makes taking over an
   * existing record a claim too — see {@link beginI18nTransition}.
   */
  compareAndSet(
    key: string,
    expected: unknown,
    next: unknown
  ): Promise<boolean>;
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
  /** See {@link StoredMarker.owner}. Absent on a marker written before tokens existed. */
  owner?: string;
}

/** The copy finished. Nothing further is owed for this entity. */
export interface SeededTransition {
  status: "seeded";
  sourceLocale: string;
  /** See {@link StoredMarker.owner}. */
  owner?: string;
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
  /** See {@link StoredMarker.owner}. */
  owner?: string;
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
  /**
   * Which caller holds this transition. Unique per claim attempt.
   *
   * Agreeing about the source locale is not the same as owning the transition, and only the
   * second one authorises the work. Two processes re-enabling the same entity from one
   * configuration necessarily agree about the locale, so a loser that checked only the locale
   * would see the winner's record, accept it as its own, and go on to run the same destructive
   * refresh a second time — after the winner had settled and a translator had edited what it
   * seeded.
   *
   * Optional because it is not in markers written before the token existed. A marker without one
   * is claimable by whoever moves it first, which is what the compare-and-set already decides.
   */
  owner?: string;
}

/**
 * Rebuild a stored marker exactly as it sits in the row.
 *
 * A compare-and-set names the value it expects by its serialised form, so the reconstruction has
 * to agree with the original key for key — including leaving `owner` out entirely for a marker
 * written before tokens existed, rather than writing it as null or undefined.
 */
function storedMarker(state: {
  status: StoredMarker["status"];
  sourceLocale: string;
  owner?: string;
}): StoredMarker {
  return {
    version: I18N_TRANSITION_MARKER_VERSION,
    status: state.status,
    sourceLocale: state.sourceLocale,
    ...(state.owner === undefined ? {} : { owner: state.owner }),
  };
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

  // The token is carried through unvalidated beyond its type: an unreadable one is not a reason to
  // refuse service, it only means nobody can prove ownership and the compare-and-set decides.
  return {
    status: marker.status,
    sourceLocale: marker.sourceLocale,
    ...(typeof marker.owner === "string" && marker.owner.length > 0
      ? { owner: marker.owner }
      : {}),
  };
}

/**
 * Record that a transition is starting. Must be called before the first
 * statement that changes the database.
 *
 * Returns the claim token, which the settlement has to name. Holding the transition and finishing
 * it are the same claim, and a settlement that did not have to prove which one it was could close
 * somebody else's.
 *
 * Writing `enabling` for an entity already recorded as `seeded` would re-owe a copy that has run,
 * so that is refused. Taking over an `enabling` marker is allowed, and is how a transition
 * abandoned by a crashed run gets finished; what makes it safe is that the settlement names the
 * claim, so the displaced holder cannot close the new one.
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
): Promise<string> {
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

  // Fresh on every attempt, including one that takes an `enabling` transition over from a holder
  // that never finished.
  //
  // Taking over is how recovery works, and nothing in the row can tell an abandoned claim from an
  // active one — a wall-clock lease cannot either, since a copy over a large table can outlast any
  // timeout and leave the "expired" holder still running. So the answer is not to refuse the
  // takeover but to make it harmless: the token identifies the CLAIM, and the settlement has to
  // name the one it closes, so a displaced holder finishing later cannot declare the copy done on
  // behalf of the claim that displaced it.
  const owner = randomUUID();
  const marker = storedMarker({
    status: "enabling",
    sourceLocale: args.sourceLocale,
    owner,
  });

  // Taking over an existing record is a claim too, not a write.
  //
  // `restored` is where it matters most: two processes re-enabling the same entity during a
  // default-locale rollout both read `restored`, and an unconditional write would let each proceed
  // under its own locale — labelling one main table's content as two languages, with the marker
  // recording whichever landed last.
  //
  // A conditional move settles it in the database. Losing means the row has gone somewhere else,
  // so the loser re-reads and validates below rather than assuming.
  if (current.status !== "untracked") {
    const claimed = await store.compareAndSet(
      key,
      storedMarker(current),
      marker
    );
    if (!claimed) await confirmClaim(store, args, key, owner);
    return owner;
  }

  // Recording the FIRST transition is a claim, not a write. Two processes provisioning the same
  // entity — a `db:sync` and a dev server, or two dev servers — both read `untracked`, and a plain
  // write would let the one that loses the companion CREATE still record the language. The record
  // would then name a locale the seed never used, which defeats the only fact this whole mechanism
  // exists to keep.
  await store.insertIfAbsent(key, marker);
  await confirmClaim(store, args, key, owner);
  return owner;
}

/**
 * Check what actually landed after a claim this caller may not have won.
 *
 * Whoever holds the row decides, and the token is the only thing that says so. Agreement about the
 * source locale is not evidence: two processes acting on one configuration necessarily agree, so a
 * loser reading the winner's record finds its own locale looking back and would take that as
 * permission to do the work a second time. When the work is the destructive refresh a re-enable
 * runs over a companion that outlived a disable, the second pass lands after the winner has
 * settled and copies stale main-table values over translations written since.
 *
 * Failing here is the point. The loser has nothing to do — the winner is doing it — and stopping
 * with an explanation is better than the alternatives it used to reach: a duplicate-key collision
 * from two concurrent seeds, or a silent second overwrite.
 */
async function confirmClaim(
  store: TransitionStateStore,
  args: { kind: I18nTransitionKind; slug: string; sourceLocale: string },
  key: string,
  owner: string
): Promise<void> {
  const claimed = await readI18nTransitionState(store, args.kind, args.slug);
  // The STATUS has to be `enabling`, not just the locale. A conditional write can fail to match
  // for reasons other than a competing claim, and a competitor can claim and settle before this
  // re-read — in both cases the locale still agrees, and accepting that would let this caller run
  // the copy with no `enabling` record for `settleI18nTransition` to settle afterwards, which is
  // the failure the claim exists to prevent.
  if (
    claimed.status !== "enabling" ||
    claimed.sourceLocale !== args.sourceLocale ||
    claimed.owner !== owner
  ) {
    throw NextlyError.internal({
      logContext: {
        reason: "localization transition is held by another process",
        key,
        recordedStatus: claimed.status,
        recorded:
          claimed.status === "untracked" ? undefined : claimed.sourceLocale,
        received: args.sourceLocale,
        // Named rather than compared in the message: what matters to whoever reads this is that
        // the row is somebody else's, not which token won.
        heldByAnother:
          claimed.status !== "untracked" && claimed.owner !== owner,
      },
    });
  }
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
  args: {
    kind: I18nTransitionKind;
    slug: string;
    /**
     * The token {@link beginI18nTransition} returned for the claim this settles.
     *
     * Required, so a caller cannot settle by simply being the one that got here. Whoever holds the
     * transition is the only one who can say its copy finished, and a settlement that closed the
     * marker it happened to find would close a claim taken over in the meantime — telling the next
     * enable that a copy it never saw had completed.
     *
     * Undefined only for a claim taken over from a marker that predates tokens, where there is
     * nothing to prove.
     */
    token: string | undefined;
  }
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

  // Only ever from `enabling`, and only via a conditional write.
  //
  // A settlement describes a copy that ran under a claim, so `enabling` is the only state it can
  // truthfully follow. Reading the state here and settling from whatever it happens to be would
  // let an intervening disable be buried: it restores the content to main and records `restored`
  // while the copy is still finishing, and a `restored -> seeded` move would then tell the next
  // enable that the companion is authoritative — reverting every edit made on main while
  // localization was off.
  //
  // Anything else means the entity moved on under someone else's claim, which is not an error and
  // not this caller's to correct. The conditional write covers the same race happening between
  // this read and the write.
  if (current.status !== "enabling") return;
  // Not ours. Someone took the transition over while this copy ran, and their claim is the one
  // that gets to say when it finished.
  if (current.owner !== args.token) return;

  // The token travels with the settlement, so the record keeps saying which claim produced it.
  await store.compareAndSet(
    key,
    storedMarker(current),
    storedMarker({ ...current, status: "seeded" })
  );
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
    /**
     * The state observed BEFORE the copy this call completes.
     *
     * Passed in rather than re-read, because a re-read happens after the copy and would let this
     * write succeed from a state some other transition established in the meantime. A re-enable
     * that claimed `enabling` while the restore was copying owns the entity now, and overwriting
     * its claim would leave its copy with nothing to settle.
     */
    expect?: {
      status: "enabling" | "seeded" | "restored";
      sourceLocale: string;
      /** Carried so the comparison names the row exactly as it was observed. */
      owner?: string;
    };
  }
): Promise<boolean> {
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

  // Conditional against the state the copy was based on, not the one visible now: re-reading here
  // would accept whatever another transition established while the copy ran. Losing means the
  // entity moved on under someone else's claim, which is not an error.
  const expected = args.expect ?? current;
  // Reported, not discarded. Losing means another transition established something while the copy
  // ran, and the copy has ALREADY written main — so a caller that treated this as done would
  // publish a non-localized configuration over a record that says otherwise, and the next enable
  // would trust a companion that no longer describes the main table.
  return store.compareAndSet(
    key,
    storedMarker(expected),
    // The restore ends the transition rather than continuing it, so the completed claim's token
    // does not travel onto the new record: whoever enables localization again is starting
    // something of their own and claims it then.
    storedMarker({ status: "restored", sourceLocale: args.sourceLocale })
  );
}

/**
 * The `nextly_meta` row a claim holds, as a condition a statement can carry.
 *
 * For the one statement whose damage cannot be undone by losing a race afterwards: the refresh a
 * re-enable runs over a companion that outlived a disable overwrites its default-locale rows from
 * main. Checking ownership in JavaScript first leaves a window — the check passes, the claim moves,
 * the statement runs — and no amount of narrowing closes it, because the two are separate round
 * trips.
 *
 * Handing the caller the key and the exact serialised value lets the database evaluate both in one
 * statement, so a claim that has moved on makes the update match nothing. Serialised here rather
 * than at the call site because the byte-for-byte form is this module's own, and a guard built from
 * a near-miss would silently never match.
 */
export function claimGuardCondition(args: {
  kind: I18nTransitionKind;
  slug: string;
  sourceLocale: string;
  token: string | undefined;
}): { key: string; value: string } {
  return {
    key: markerKey(args.kind, args.slug),
    value: JSON.stringify(
      storedMarker({
        status: "enabling",
        sourceLocale: args.sourceLocale,
        owner: args.token,
      })
    ),
  };
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
