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
 * caller put in the body, and a payload that names no status (or a non-string
 * one) expresses no transition rather than a move to draft.
 */
export function resolvePublishTransition(
  previousStatus: string | null | undefined,
  nextStatus: unknown
): PublishTransition | null {
  // A write that does not set a string status expresses no transition: an
  // absent status leaves the stored value untouched, it does not move to draft.
  if (typeof nextStatus !== "string") return null;

  const wasPublished = previousStatus === "published";
  const willBePublished = nextStatus === "published";

  if (willBePublished && !wasPublished) return "publish";
  if (wasPublished && !willBePublished) return "unpublish";
  return null;
}
