/**
 * What a release says a document should look like right now.
 *
 * The read-side source of truth for scheduled content. Materialisation applies
 * the SAME function to the same members, so a scheduled change cannot mean one
 * thing to a read and another to the write that later persists it — the class
 * of divergence that produced two defects in the pending-changes work, each
 * time because a read carried an exclusion the write had dropped.
 *
 * ## Why this is NOT the working-draft overlay
 *
 * `resolveDraftOverlay` gates on whether the caller may EDIT the document: a
 * working draft is one author's unpublished work and is shown only to someone
 * entitled to see it. A release whose time has passed is PUBLISHED, and must be
 * shown to everyone — an anonymous visitor included.
 *
 * So the two rules answer different questions and only look alike. Widening the
 * draft overlay to serve both would leak unpublished work to the public; that
 * is why this is a sibling with its own predicate rather than a parameter on
 * the existing one.
 *
 * ## Why the ordering is total
 *
 * A document may belong to several releases — "publish on the 1st" and
 * "unpublish on the 20th" is the ordinary case, not an edge one — so from the
 * 20th onwards two members are due at once and the later must win. Ordering on
 * the scheduled instant alone is not enough: two releases can name the same
 * instant, and then the answer would depend on the order the driver returned
 * rows in, which differs by dialect and by query plan. Falling through to the
 * creation time and finally to the id makes the order total, so every request
 * on every dialect resolves the same way.
 *
 * @module domains/releases/resolve-release-effect
 */
import type { ReleaseMemberAction } from "../../schemas/releases/types";

/** One release membership that could affect a document, as stored. */
export interface DueMember {
  memberId: string;
  releaseId: string;
  action: ReleaseMemberAction;
  /** When the owning release takes effect. */
  scheduledAt: Date;
  /** When the member was added, the first tie-break. */
  createdAt: Date;
}

/** `none` leaves the document exactly as the ordinary read would return it. */
export type ReleaseEffect = "none" | "publish" | "unpublish";

export interface ReleaseEffectDecision {
  effect: ReleaseEffect;
  /** The member that decided it, for reporting and for materialisation. */
  memberId: string | null;
  releaseId: string | null;
}

const NO_EFFECT: ReleaseEffectDecision = {
  effect: "none",
  memberId: null,
  releaseId: null,
};

/**
 * The winning member for one document, or no effect.
 *
 * `members` are the memberships for a SINGLE document; the caller batches the
 * lookup across a result set and calls this once per document.
 */
export function resolveReleaseEffect(input: {
  members: DueMember[];
  now: Date;
}): ReleaseEffectDecision {
  const nowMs = input.now.getTime();
  let winner: DueMember | null = null;

  for (const candidate of input.members) {
    // Inclusive: a release scheduled for 09:00 is in effect AT 09:00, not from
    // the first request after it.
    if (candidate.scheduledAt.getTime() > nowMs) continue;
    if (winner === null || isLater(candidate, winner)) winner = candidate;
  }

  if (winner === null) return NO_EFFECT;
  return {
    effect: winner.action,
    memberId: winner.memberId,
    releaseId: winner.releaseId,
  };
}

/**
 * A total order over due members: scheduled instant, then creation time, then
 * id. Every term is needed — see the module note on why the instant alone
 * leaves the answer up to the driver.
 */
function isLater(a: DueMember, b: DueMember): boolean {
  const byScheduled = a.scheduledAt.getTime() - b.scheduledAt.getTime();
  if (byScheduled !== 0) return byScheduled > 0;
  const byCreated = a.createdAt.getTime() - b.createdAt.getTime();
  if (byCreated !== 0) return byCreated > 0;
  return a.memberId > b.memberId;
}
