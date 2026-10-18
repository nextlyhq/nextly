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

/**
 * What a release is. An ordinary `release` holds up to `RELEASE_MEMBER_LIMIT`
 * documents (200); a `single` one is a document scheduled on its own, and
 * holds exactly that one.
 *
 * Stored rather than inferred: a release with one member may be an ordinary
 * release still being assembled, and a title can be renamed, so neither tells
 * the two apart. Set when the release is made and never changed.
 */
export type ReleaseKind = "release" | "single";

/** The release kinds, the ordinary one first: it is the default. */
export const RELEASE_KINDS: readonly ReleaseKind[] = ["release", "single"];

/** Runtime guard: true iff `v` is one of the release kinds. */
export function isReleaseKind(v: unknown): v is ReleaseKind {
  return (
    typeof v === "string" && (RELEASE_KINDS as readonly string[]).includes(v)
  );
}

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
 * `scheduled` is included so an instant can be corrected. `published` and
 * `cancelled` are excluded: both are FINAL, the record of what happened to a
 * launch. Re-scheduling a published release would make the drain re-apply its
 * members against documents that have changed since, and a cancelled one is
 * retried by making a new release, so the list of finished releases stays true.
 */
export const RELEASE_SCHEDULABLE_FROM: readonly ReleaseState[] = [
  "draft",
  "scheduled",
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
  // Not `cancelled`: a cancelled release is final, like a published one, and
  // changing what it held would rewrite the record of a launch called off.
  // Editable BECAUSE it is blocked: the fix is usually to remove the member
  // whose author is gone, and a release nobody can edit cannot be unblocked.
  "blocked",
];

/**
 * The states Publish now runs a release from.
 *
 * Only a release that has not run and is not stopped. A stopped release is
 * fixed and then scheduled again, so the fix is checked before it goes out; a
 * published or cancelled one is final and is never run again.
 *
 * @experimental
 */
export const RELEASE_PUBLISHABLE_NOW_FROM: readonly ReleaseState[] = [
  "draft",
  "scheduled",
];

/**
 * The FINAL states: a release in one of them has run or was called off, and
 * takes no further change. To try again, a new release is made.
 *
 * @experimental
 */
export const RELEASE_FINAL_STATES: readonly ReleaseState[] = [
  "published",
  "cancelled",
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

/**
 * What a caller may do to one release, as the server sees it.
 *
 * Declared beside the lifecycle vocabulary and published through
 * `nextly/schemas`, so the admin renders its controls from this type rather
 * than a copy of it: a capability added here reaches the admin's type at once.
 *
 * Sent WITH the release rather than derived by the reader. Payload computes the
 * same thing per document for its edit view, and Sanity gates each release
 * action by its own permission id so scheduling can be granted without
 * publishing — in both, the answer depends on authority the client does not
 * hold, so a client that computed it would be guessing.
 */
export interface ReleaseCapabilities {
  /** Set or move this release's instant. */
  schedule: boolean;
  /** Call it off — which is also how an unwanted draft is abandoned. */
  cancel: boolean;
  /** Put a document in it. Necessary, not sufficient: see `capabilities`. */
  addMember: boolean;
  /** Take a document out of it. Necessary, not sufficient. */
  removeMember: boolean;
  /**
   * Run it now. True only for a draft or scheduled release: a stopped one is
   * fixed and scheduled again, and a published or cancelled one is final.
   *
   * @experimental
   */
  publishNow: boolean;
}

/**
 * The most documents one release holds.
 *
 * Sized so a full release publishes within one pass of the job that runs
 * releases, on every dialect: a release is settled all together, so one
 * that no pass can finish holds its documents back. The bound is per
 * release. Releases due together that share a document are settled as one
 * piece, which takes as long as all of their documents. A release made before
 * the limit and holding more keeps running and can shrink, but takes no new
 * document.
 */
export const RELEASE_MEMBER_LIMIT = 200;
