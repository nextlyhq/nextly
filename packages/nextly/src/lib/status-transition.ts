/**
 * Classifying a status change as a publish-lifecycle transition.
 *
 * Publishing is an ordinary write that sets `status: "published"`, so the
 * authorization for it cannot key on a method name — it has to compare the
 * status a write is about to produce against the one the document already has.
 * This is the single place that comparison is made, shared by every write path
 * (collections, singles, single-entry, batch, create) so they cannot disagree
 * about what counts as a publish.
 *
 * @module lib/status-transition
 */

/** The publish-lifecycle operation a status change amounts to. */
export type PublishTransition = "publish" | "unpublish";

/**
 * The two values the draft/published lifecycle admits.
 *
 * Stated once because two callers need to REJECT anything else, and a rejection
 * written from memory is a second answer to this question. Note the asymmetry
 * with {@link resolvePublishTransition}, which is deliberately permissive: it
 * treats every non-`"published"` value as an unpublish so a coerced `0`/`false`
 * cannot slip a takedown past the gate. That is the right reading for a gate
 * deciding which permission a write needs, and the wrong one for a caller
 * deciding whether a write is well formed at all.
 */
export const LIFECYCLE_STATUSES = ["draft", "published"] as const;

/** Whether a value is one the lifecycle can actually hold. */
export function isLifecycleStatus(
  value: unknown
): value is (typeof LIFECYCLE_STATUSES)[number] {
  return (LIFECYCLE_STATUSES as readonly unknown[]).includes(value);
}

/**
 * The publish-lifecycle operation a status change amounts to, or `null` when
 * the change is an ordinary update.
 *
 * A move INTO published is a `publish`; a move OUT of published is an
 * `unpublish`. A change that touches neither side of published — draft to
 * draft, published to published, or a write that sets no string status at all —
 * is an ordinary update and returns `null`.
 *
 * `previousStatus` is `null` for a create. Creating a document directly as
 * published is therefore a `publish`, because `null` is not `"published"`.
 *
 * The next status is read as `unknown` on purpose: a write carries whatever the
 * caller put in the body. An ABSENT status (`undefined`) names no move and
 * leaves the stored value untouched. But any other explicitly-provided value —
 * including a non-string one, which some dialects coerce into the text column —
 * IS a write to the status, so from a published row it counts as leaving
 * published (an unpublish). Only `"published"` (a string) can be a move INTO
 * published, since a non-string can never equal it.
 */
export function resolvePublishTransition(
  previousStatus: string | null | undefined,
  nextStatus: unknown
): PublishTransition | null {
  // Status not named in the write: no move.
  if (nextStatus === undefined) return null;

  const wasPublished = previousStatus === "published";
  // Only the exact string qualifies; a coerced number/boolean is not published.
  const willBePublished = nextStatus === "published";

  if (willBePublished && !wasPublished) return "publish";
  // Any explicit non-published value written over a published row leaves it
  // published — including a malformed non-string that would be coerced in.
  if (wasPublished && !willBePublished) return "unpublish";
  return null;
}

/**
 * Drop an explicit `status: undefined` own-property from a write payload.
 *
 * `resolvePublishTransition` treats an undefined next status as "no move", so the
 * gate reads such a write as an ordinary update. But a write that KEEPS
 * `status: undefined` in its payload can be sanitized to SQL `NULL` by some
 * adapters (notably SQLite via the raw parameter list), which moves a published
 * row OUT of published — an unpublish that never went through the
 * `unpublish-<slug>` gate. Direct API / server callers and hooks can produce an
 * own `status: undefined` (`{ status: maybeStatus }`), even though JSON REST
 * cannot express it. Removing the key makes the write match the gate: an
 * explicit undefined status leaves the stored value untouched, exactly like an
 * omitted one. Mutates in place and returns the same object for convenience.
 */
export function stripUndefinedStatus<T extends Record<string, unknown>>(
  data: T
): T {
  if ("status" in data && data.status === undefined) {
    delete data.status;
  }
  return data;
}

/**
 * The value a write should record as a document's first publication, or
 * `undefined` when it should record nothing.
 *
 * Three conditions have to hold, and the reason this is one function rather than
 * a condition repeated at each write seam is that there are many seams: create,
 * update, the transaction-scoped variants behind `createMany` and batch writes,
 * publish-all-locales, and the single-entry writer. Every one of them can move a
 * document into published, so every one of them has to agree. Restating the rule
 * per seam is how three of them came to disagree — one stamping a document that
 * was already public, others not stamping at all.
 *
 *   1. The entity has a draft/publish lifecycle. Without one there is no
 *      transition to record, and its rows are public from the moment they save.
 *   2. The write actually moves the document INTO published, judged by
 *      `resolvePublishTransition` so "what counts as publishing" is decided in
 *      exactly one place. A no-op publish of an already-published row records
 *      nothing — which matters most for rows published before this column
 *      existed, whose marker is null precisely because their history was never
 *      recorded. Dating those today would report a publication that never
 *      happened.
 *   3. Nothing is recorded yet. This dates the FIRST publication, so a republish
 *      after an unpublish must not move it.
 *
 * `existingMarker` is read as `unknown` because callers pass a column straight
 * off a database row, where its type varies by dialect and driver — a `Date` on
 * PostgreSQL, an integer on SQLite. Only its absence is examined, and `== null`
 * covers both null and undefined; a row read that omitted the column entirely is
 * therefore treated as "nothing recorded", which is the safe reading for a
 * column that starts null.
 *
 * The caller supplies `now` so the marker can be the same instant as the
 * `updated_at` written beside it, rather than a few microseconds later.
 *
 * Callers must read `existingMarker` under whatever lock guards the write. Two
 * concurrent publishes that both observe an absent marker would both stamp, and
 * the later would win — the row lock the write already takes is what prevents
 * that interleaving, not this function.
 */
/**
 * The status pair that describes what a write does to a document's PUBLIC visibility.
 *
 * A localized collection can go public in two different places. A write for the default locale
 * (or a non-localized one) moves the main row's `status`. A write for any other locale has its
 * status stripped from the main payload and carried on that locale's companion row instead, so
 * the main row's status shows no movement at all even though a translation just went live.
 *
 * The first-publication marker is a property of the DOCUMENT — "has this ever been public in any
 * language" — because the address it protects is shared across locales. Reading the main row's
 * status for a non-default-locale write therefore sees no transition and records nothing, and the
 * marker would later be dated from whenever the default locale happened to publish: after the
 * document was already reachable.
 *
 * Returned as a pair rather than decided inline at the write seam so it can be tested directly:
 * the branch only executes for an access-controlled write to a non-default locale, which needs a
 * caller holding a real publish grant.
 */
export function selectPublicationTransition(args: {
  /** True when this write's status lands on a locale companion, not the main row. */
  writesStatusToCompanion: boolean;
  /** The main row's committed status. */
  mainPreviousStatus: string | null | undefined;
  /** The status this write assigns to the main row. */
  mainNextStatus: unknown;
  /** The write locale's committed companion status. */
  companionPreviousStatus: string | null | undefined;
  /** The status this write assigns to the companion. */
  companionNextStatus: unknown;
  /**
   * Whether the document is ALREADY reachable by some route this write does not touch — its main
   * row, or any other locale.
   *
   * It stops one part of a document going live from being read as the whole document becoming
   * public, and it applies to EVERY write, not only a per-locale one: a default-locale publish of
   * a draft main row can equally be the second way a document goes public, if a translation has
   * been live since before the marker column existed. Those rows carry a null marker because
   * their history was never recorded rather than because they were never public, so stamping
   * would replace an unknown past with today.
   */
  documentAlreadyPublic?: boolean;
}): { previousStatus: string | null | undefined; nextStatus: unknown } {
  const nextStatus = args.writesStatusToCompanion
    ? args.companionNextStatus
    : args.mainNextStatus;
  // Reported as an already-published previous state rather than as a separate veto, so the one
  // rule that decides what a publication is stays the only place that decides it.
  if (args.documentAlreadyPublic) {
    return { previousStatus: "published", nextStatus };
  }
  return {
    previousStatus: args.writesStatusToCompanion
      ? args.companionPreviousStatus
      : args.mainPreviousStatus,
    nextStatus,
  };
}

export function resolveFirstPublishedStamp(args: {
  /** Whether the collection or single has the draft/publish lifecycle enabled. */
  hasStatus: boolean;
  /** The document's committed status before this write; `null` for a create. */
  previousStatus: string | null | undefined;
  /** The status this write assigns, exactly as the caller supplied it. */
  nextStatus: unknown;
  /** The marker already stored on the row, read under the write's lock. */
  existingMarker: unknown;
  /** The instant to record, shared with the write's other timestamps. */
  now: Date;
}): Date | undefined {
  if (!args.hasStatus) return undefined;
  if (args.existingMarker != null) return undefined;
  if (
    resolvePublishTransition(args.previousStatus, args.nextStatus) !== "publish"
  ) {
    return undefined;
  }
  return args.now;
}
