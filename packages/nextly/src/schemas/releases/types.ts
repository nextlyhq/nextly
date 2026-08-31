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
 * has already been materialised into the live rows, `cancelled` was called off,
 * and `blocked` cannot proceed — so a read consults exactly one state and the
 * other four cost nothing.
 *
 * `blocked` is a release the drain will never be able to apply, for a reason
 * retrying cannot fix: a member with no author, an author who has been deleted
 * or deactivated, or a locale-scoped member the engine does not support. It
 * exists because leaving such a release `scheduled` makes it retry every tick
 * forever while looking exactly like a healthy one — and the operator learns
 * nothing until the launch does not happen.
 *
 * A TRANSIENT failure — a lookup that errored, a re-read that errored — does
 * NOT block. Those are documented as retry-worthy where they are raised, and
 * blocking on one would let a momentary database blip permanently stop a launch
 * that the next pass would have completed.
 */
export type ReleaseState =
  | "draft"
  | "scheduled"
  | "published"
  | "cancelled"
  | "blocked";

/** What a member does to its document when the release takes effect. */
export type ReleaseMemberAction = "publish" | "unpublish";

/** The release states, in lifecycle order. */
export const RELEASE_STATES: readonly ReleaseState[] = [
  "draft",
  "scheduled",
  "published",
  "cancelled",
  "blocked",
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

/**
 * Why a release cannot be applied, in the vocabulary a CLIENT renders.
 *
 * Declared beside the states rather than in the service, so the admin can
 * `import type` it from the same leaf module it takes `ReleaseState` from. Two
 * spellings of this union is how a core addition compiles everywhere and then
 * renders `undefined` in the one screen that maps it to a sentence.
 *
 * Deliberately NOT the drain's `MaterialisationFailure`. That names what went
 * wrong during one pass, transient causes included; this names what is still
 * true of a stored member and therefore what somebody has to fix.
 */
export type ReleaseBlockerReason =
  /** The member carries no author, so the drain has nobody to act as. */
  | "NO_AUTHOR"
  /** The recorded author has been deleted or deactivated. */
  | "AUTHOR_GONE"
  /** The member names one locale, which the engine cannot materialise. */
  | "LOCALE_SCOPED";

/**
 * Which states each lifecycle move may START from.
 *
 * Declared once, here, because three separate places need the same answer and
 * they cannot be allowed to disagree: the repository's conditional UPDATEs use
 * these as their fence, and the admin uses them to decide which controls to
 * OFFER. A UI matrix written alongside the fence is the failure this prevents —
 * it silently narrows what the product can do (an editor unable to move a
 * schedule they already set) while reading as a safety measure, and it can even
 * state the opposite of the rule in prose the fence never checks.
 *
 * They live in this module because it has no imports at all, so a client can
 * consume them without pulling the schema graph in behind them.
 */

/**
 * Scheduling is a MOVE TO an instant, not a one-time commitment.
 *
 * `scheduled` is included so an instant can be corrected, and `cancelled` so a
 * launch called off can be reinstated. `published` is excluded because the drain
 * would re-apply the members against documents that have changed since.
 */
export const RELEASE_SCHEDULABLE_FROM: readonly ReleaseState[] = [
  "draft",
  "scheduled",
  "cancelled",
  // A blocked release is fixed and then rescheduled. Excluding it would leave
  // the operator who has just removed the offending member with nothing to do.
  "blocked",
];

/**
 * Cancelling is also how an unwanted DRAFT is abandoned.
 *
 * There is no delete route, so excluding `draft` here would leave a release
 * created by mistake with no way out of the list.
 */
export const RELEASE_CANCELLABLE_FROM: readonly ReleaseState[] = [
  "draft",
  "scheduled",
  // Abandoning a blocked release is the other way out of it.
  "blocked",
];

/**
 * Membership changes needing only the assembling authority.
 *
 * `scheduled` is deliberately absent: changing what is in a committed launch is
 * a publisher's decision, and is listed separately below.
 */
export const RELEASE_ASSEMBLABLE_FROM: readonly ReleaseState[] = [
  "draft",
  "cancelled",
  // Editable BECAUSE it is blocked: the fix is usually to remove the member
  // whose author is gone, and a release nobody can edit cannot be unblocked.
  "blocked",
];

/**
 * Membership changes that additionally require the publishing authority.
 *
 * The drain reads membership AT the instant rather than at scheduling time, so
 * editing a scheduled release changes what a publisher already committed to.
 */
export const RELEASE_ASSEMBLABLE_WITH_PUBLISH_FROM: readonly ReleaseState[] = [
  "scheduled",
];

/**
 * Which release states a CONTENT read must honour.
 *
 * Only `scheduled`. A release projects its effect onto what a visitor sees the
 * moment its instant passes and before anything is written, so this list is
 * what decides whether an unpublished document is already public. `blocked` is
 * absent for exactly that reason and it is the whole point of the state: a
 * release that stopped must stop projecting, or "stopped" would mean nothing to
 * a reader.
 */
export const RELEASE_STATES_AFFECTING_CONTENT: readonly ReleaseState[] = [
  "scheduled",
];

/**
 * Which release states a DOCUMENT'S EDITOR must be told about.
 *
 * Deliberately WIDER than {@link RELEASE_STATES_AFFECTING_CONTENT}, and the two
 * are declared together so the difference is a decision somebody made rather
 * than a discrepancy nobody noticed. That is not hypothetical: these two
 * filters lived in separate layers once, the narrow one ran first, and the
 * banner's own widening could never be reached.
 *
 * `scheduled` because it is about to happen, and `blocked` because it was going
 * to and now will not — both are facts about this document that nothing else on
 * the editor's screen carries. A blocked release changes no content, which is
 * precisely why the editor has to be told: nothing else on the page will
 * differ, and a banner that vanished would read as resolved.
 *
 * Every other state is finished. A published release already did its work and a
 * cancelled one was called off on purpose, and reporting either would be
 * telling an editor about history.
 */
export const RELEASE_STATES_SHOWN_ON_A_DOCUMENT: readonly ReleaseState[] = [
  "scheduled",
  "blocked",
];

/**
 * The schedulable states EXCEPT the one that needs repairing first.
 *
 * DERIVED from {@link RELEASE_SCHEDULABLE_FROM} rather than spelled again, so a
 * state added there cannot be silently omitted here.
 *
 * This exists because scheduling a blocked release is a different operation
 * from scheduling any other: it is a recovery, and it is only valid once
 * nothing is blocking the release any more. That verdict is formed from a read,
 * and a release can move between that read and the write — so the write fences
 * on the state the verdict was formed against. A caller that saw a release NOT
 * blocked uses this list, and is refused if the drain blocked it in the
 * meantime; a caller that saw it blocked, and checked, fences on `blocked`
 * alone. Without the split, a release blocked between the two would be
 * rescheduled with its blockers never examined, and would stop again.
 */
export const RELEASE_SCHEDULABLE_FROM_UNBLOCKED: readonly ReleaseState[] =
  RELEASE_SCHEDULABLE_FROM.filter(state => state !== "blocked");

/** The recovery transition's fence: a blocked release, and nothing else. */
export const RELEASE_SCHEDULABLE_FROM_BLOCKED: readonly ReleaseState[] = [
  "blocked",
];
