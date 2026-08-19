/**
 * Dialect-agnostic types for the content-release tables.
 *
 * A release is a set of content changes that take effect together at one
 * instant. Its members POINT AT documents rather than carrying copies of them:
 * the pending edit already lives in `nextly_versions` as a working draft, and a
 * second copy would be a second thing to keep in step.
 *
 * @module schemas/releases/types
 */

/**
 * Lifecycle of a release.
 *
 * Only `scheduled` affects reads. `draft` is still being assembled, `published`
 * has already been materialised into the live rows, and `cancelled` was called
 * off — so a read consults exactly one state and the other three cost nothing.
 */
export type ReleaseState = "draft" | "scheduled" | "published" | "cancelled";

/** What a member does to its document when the release takes effect. */
export type ReleaseMemberAction = "publish" | "unpublish";

/** The release states, in lifecycle order. */
export const RELEASE_STATES: readonly ReleaseState[] = [
  "draft",
  "scheduled",
  "published",
  "cancelled",
];

/** The member actions, in the order the admin offers them. */
export const RELEASE_MEMBER_ACTIONS: readonly ReleaseMemberAction[] = [
  "publish",
  "unpublish",
];

/** Runtime guard: true iff `v` is one of the release states. */
export function isReleaseState(v: unknown): v is ReleaseState {
  return (
    typeof v === "string" && (RELEASE_STATES as readonly string[]).includes(v)
  );
}

/** Runtime guard: true iff `v` is one of the member actions. */
export function isReleaseMemberAction(v: unknown): v is ReleaseMemberAction {
  return (
    typeof v === "string" &&
    (RELEASE_MEMBER_ACTIONS as readonly string[]).includes(v)
  );
}
