/**
 * What materialising the due releases should DO, decided before anything is
 * written.
 *
 * ## Why this is planned across releases rather than per release
 *
 * A document can belong to several releases — "publish on the 1st",
 * "unpublish on the 20th" is the ordinary case. Applying one release at a time
 * makes the final state depend on the ORDER the drain happens to reach them in:
 * a runner that fell behind and finds both due would leave the document
 * published or unpublished according to which release it looped over last.
 *
 * So every due member is collected first, grouped per document, and reduced to
 * ONE winning effect by `resolveReleaseEffect` — the same pure rule the read
 * path uses. That is what makes a read taken just before materialisation and a
 * read taken just after agree: they are answering with the same function, not
 * with two implementations that are supposed to match.
 *
 * ## Why the plan carries the member, not just the effect
 *
 * Each action is attributed to the member that won it, because the write is
 * performed AS THAT MEMBER'S AUTHOR and not as a system principal. Losing the
 * winner here would leave the caller with an effect and nobody to apply it as,
 * and the only available fallback would be exactly the privileged principal
 * this design refuses.
 *
 * @module domains/releases/plan-release-materialisation
 */

import type { DocumentRef, ReleaseMemberRow } from "./releases-repository";
import { documentRefKey } from "./releases-repository";
import { resolveReleaseEffect } from "./resolve-release-effect";
import type { DueMember } from "./resolve-release-effect";

/** A release whose instant has arrived, as the planner needs it. */
export interface DueRelease {
  id: string;
  scheduledAt: Date;
}

/** One document to change, and who to change it as. */
export interface MaterialisationAction {
  ref: DocumentRef;
  /** Never `"none"`: a document the rule leaves alone is not in the plan. */
  effect: "publish" | "unpublish";
  /** The member that won, for attribution and for reporting. */
  memberId: string;
  releaseId: string;
  /**
   * The instant that release was scheduled for WHEN THIS PLAN WAS BUILT.
   *
   * Carried so the write can fence on it. A release POSTPONED after the pass
   * loaded it is still `scheduled`, so a check that reads only the state sees
   * nothing wrong and the stale plan applies immediately — publishing content
   * at the moment somebody moved it away from.
   */
  scheduledAt: Date;
  /**
   * The user this write runs as — the winning member's author.
   *
   * `null` is a member whose author was never recorded. It is carried rather
   * than resolved here so the caller decides what an unattributable change
   * means; this module has no business inventing an actor.
   */
  createdBy: string | null;
}

export interface MaterialisationPlan {
  actions: MaterialisationAction[];
  /** The releases this plan discharges, whether or not they contributed a winner. */
  releaseIds: string[];
  /**
   * Releases that must be discharged TOGETHER, because they touch a document in
   * common.
   *
   * Discharging one of an overlapping pair alone reverses work. Consider an
   * earlier release publishing a document and a later one withdrawing it, both
   * due: the later wins and the document is withdrawn. If the later is then
   * marked published while the earlier is held open by an unrelated member's
   * failure, the NEXT pass no longer loads the later release at all — so the
   * earlier one becomes the winner for that document and republishes what was
   * correctly withdrawn.
   *
   * Each entry is a set of release ids reachable from one another through
   * shared documents. A release touching nothing else appears in a set of one.
   */
  overlappingReleases: string[][];
}

/**
 * Reduce every due member to at most one action per document.
 *
 * `members` may include members of releases that are NOT due — pass them
 * anyway. `resolveReleaseEffect` ignores a member whose instant has not
 * arrived, and filtering them out beforehand would be the second place that
 * judgement lives.
 */
export function planReleaseMaterialisation(input: {
  releases: DueRelease[];
  members: ReleaseMemberRow[];
  now: Date;
}): MaterialisationPlan {
  const scheduledAt = new Map(input.releases.map(r => [r.id, r.scheduledAt]));

  const grouped = new Map<string, { ref: DocumentRef; due: DueMember[] }>();
  for (const member of input.members) {
    const at = scheduledAt.get(member.releaseId);
    // A member whose release is not in this pass decides nothing. It is not an
    // error: the same document may sit in a release scheduled for next month.
    if (at === undefined) continue;
    const key = documentRefKey(member);
    const bucket = grouped.get(key) ?? { ref: refOf(member), due: [] };
    bucket.due.push({
      memberId: member.id,
      releaseId: member.releaseId,
      action: member.action,
      scheduledAt: at,
      createdAt: member.createdAt,
    });
    grouped.set(key, bucket);
  }

  const authorOf = new Map(input.members.map(m => [m.id, m.createdBy]));
  const actions: MaterialisationAction[] = [];
  for (const { ref, due } of grouped.values()) {
    const decision = resolveReleaseEffect({ members: due, now: input.now });
    if (decision.effect === "none") continue;
    // `resolveReleaseEffect` returns a member id whenever the effect is not
    // "none", so these cannot be null here — but reading them defensively
    // costs nothing and keeps the plan's own invariant local.
    if (decision.memberId === null || decision.releaseId === null) continue;
    const winnerScheduledAt = scheduledAt.get(decision.releaseId);
    if (winnerScheduledAt === undefined) continue;
    actions.push({
      ref,
      effect: decision.effect,
      memberId: decision.memberId,
      releaseId: decision.releaseId,
      scheduledAt: winnerScheduledAt,
      createdBy: authorOf.get(decision.memberId) ?? null,
    });
  }

  return {
    actions,
    releaseIds: input.releases.map(r => r.id),
    overlappingReleases: groupBySharedDocument(grouped, input.releases),
  };
}

/**
 * Partition the due releases into sets that share at least one document,
 * transitively.
 *
 * Union-find over documents: each document unions every release that has a
 * member for it, so A-shares-with-B and B-shares-with-C puts all three in one
 * set. Transitivity matters — discharging A while C is held open reverses work
 * through B just as directly as a two-release overlap does.
 */
function groupBySharedDocument(
  grouped: Map<string, { ref: DocumentRef; due: DueMember[] }>,
  releases: DueRelease[]
): string[][] {
  const parent = new Map<string, string>();
  const find = (id: string): string => {
    let root = parent.get(id) ?? id;
    while (root !== (parent.get(root) ?? root)) root = parent.get(root) ?? root;
    parent.set(id, root);
    return root;
  };
  const union = (a: string, b: string): void => {
    const ra = find(a);
    const rb = find(b);
    if (ra !== rb) parent.set(ra, rb);
  };

  for (const release of releases) parent.set(release.id, release.id);
  for (const { due } of grouped.values()) {
    for (let i = 1; i < due.length; i++) {
      union(due[0].releaseId, due[i].releaseId);
    }
  }

  const sets = new Map<string, string[]>();
  for (const release of releases) {
    const root = find(release.id);
    const set = sets.get(root) ?? [];
    set.push(release.id);
    sets.set(root, set);
  }
  return [...sets.values()];
}

function refOf(member: ReleaseMemberRow): DocumentRef {
  return {
    scopeKind: member.scopeKind,
    scopeSlug: member.scopeSlug,
    entryId: member.entryId,
    locale: member.locale,
  };
}
