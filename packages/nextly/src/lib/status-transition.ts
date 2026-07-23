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
