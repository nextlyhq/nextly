/**
 * Whether a document may join a release, and why not when it may not.
 *
 * There is no opt-in flag for scheduling. Membership is allowed wherever the
 * action is MEANINGFUL, decided by rules that already exist — which keeps one
 * statement of what is eligible rather than a config switch that could disagree
 * with it.
 *
 * The two actions have different preconditions, and the asymmetry is the point:
 *
 * - **publish** needs a pending edit to publish, so it needs the draft split.
 * - **unpublish** needs only the Draft/Published lifecycle. Taking a live page
 *   down requires nothing pending, so a collection with `status` and no drafts
 *   can be scheduled OFF the site even though it can never be scheduled onto
 *   it.
 *
 * Collapsing those into one rule would silently remove scheduled takedown from
 * every status-only collection, and a check that only exercised publish would
 * stay green while it happened.
 *
 * @module domains/releases/release-eligibility
 */
import type { ReleaseMemberAction } from "../../schemas/releases/types";
import type {
  DraftSplitDisabledReason,
  DraftSplitEligibility,
} from "../versions/draft-split-eligibility";

/**
 * Why a document cannot join a release.
 *
 * The draft-split reasons are reused rather than restated so the admin can
 * explain a refusal with the vocabulary it already renders for the editor; two
 * spellings of one cause is how an explanation and the rule behind it drift.
 */
export type MemberRefusalReason =
  | DraftSplitDisabledReason
  /** The document has no Draft/Published lifecycle, so there is nothing to leave. */
  | "no-lifecycle"
  /**
   * The configuration never asked for pending changes, so there is no working
   * draft for a release to publish.
   *
   * Distinct from `null` on the draft-split side, where "nothing asked for the
   * split" is correctly not a misconfiguration. For a release it IS a refusal,
   * and folding it into `null` would leave the admin saying "cannot schedule,
   * reason: none".
   */
  | "no-pending-changes";

export interface MemberEligibility {
  allowed: boolean;
  reason: MemberRefusalReason | null;
  /** The component behind the reason, when a component carries it. */
  componentSlug: string | null;
}

const ALLOWED: MemberEligibility = {
  allowed: true,
  reason: null,
  componentSlug: null,
};

export interface MemberEligibilityInput {
  action: ReleaseMemberAction;
  /** `collection.status === true` — the Draft/Published lifecycle is enabled. */
  collectionHasStatus: boolean;
  /** The document's draft-split verdict, from `evaluateDraftSplitEligibility`. */
  draftEligibility: DraftSplitEligibility;
}

/** Whether this document may be added to a release under this action. */
export function canScheduleMember(
  input: MemberEligibilityInput
): MemberEligibility {
  if (input.action === "unpublish") {
    // Deliberately does NOT consult the draft split. An unpublish removes a
    // live document; it neither needs nor consumes a pending edit.
    return input.collectionHasStatus ? ALLOWED : refuse("no-lifecycle", null);
  }

  // A publish is exactly as eligible as the draft split is, so the verdict is
  // derived rather than re-derived. `collectionHasStatus` is not read here:
  // the draft rule already requires it and reports `lifecycle-disabled` when
  // it is missing, and asking the same question twice is how two answers
  // start to disagree.
  if (input.draftEligibility.eligible) return ALLOWED;
  return refuse(
    input.draftEligibility.reason ?? "no-pending-changes",
    input.draftEligibility.componentSlug
  );
}

function refuse(
  reason: MemberRefusalReason,
  componentSlug: string | null
): MemberEligibility {
  return { allowed: false, reason, componentSlug };
}
