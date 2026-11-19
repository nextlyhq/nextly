/**
 * Whether a component of due releases may go live: the one answer the run and a reader share.
 *
 * A component is the set of due releases that share a document (the planner's
 * `overlappingReleases`). The run asks this before its first write and writes none of the
 * component when it is held, so what holds one document it would publish back holds every action
 * of the component, and a read of a document the component decides must project the same answer,
 * or a reader is shown a document the run never writes and sees it snap back once the release
 * stops.
 *
 * What it guarantees is bounded by when it is asked: a hold present before the component's first
 * write leaves none of it live. The writes themselves are one per document, each in its own
 * transaction, so an approval withdrawn after the question and before a later document's write
 * is caught by that write's own publish gate instead, and the documents written before it stay
 * live. Making the question and the writes one atomic step is not attempted here.
 *
 * @module domains/releases/component-hold
 */
import type { GoingLiveDocument } from "./going-live-hold";
import type {
  DueRelease,
  MaterialisationAction,
  planReleaseMaterialisation,
} from "./plan-release-materialisation";
import { isDueAt } from "./release-due";
import type { ReleaseRecheckDocument } from "./release-recheck";
import {
  IDS_PER_LOOKUP,
  memberAppliedFor,
  type DrainMemberRow,
  type ReleasesRepository,
} from "./releases-repository";

/** Asks which of the documents going live are held back, by their ids. */
export type AskHeld = (
  documents: readonly GoingLiveDocument[]
) => Promise<ReadonlySet<string>>;

/**
 * Why a component may not go live now: some of the documents it would publish are held back by
 * what governs publishing beyond the release's own checks, or asking failed.
 */
export type ComponentHold =
  | { failure: "NOT_APPROVED"; held: ReadonlySet<string> }
  | { failure: "APPROVAL_CHECK_FAILED"; detail: string };

/** A plan's actions grouped by component, in the planner's component order. */
export function actionsByComponent(
  plan: Pick<
    ReturnType<typeof planReleaseMaterialisation>,
    "actions" | "overlappingReleases"
  >
): MaterialisationAction[][] {
  const componentOf = new Map<string, number>();
  plan.overlappingReleases.forEach((group, index) => {
    for (const id of group) componentOf.set(id, index);
  });
  const grouped = plan.overlappingReleases.map(
    (): MaterialisationAction[] => []
  );
  for (const action of plan.actions) {
    grouped[componentOf.get(action.releaseId) ?? -1]?.push(action);
  }
  return grouped;
}

/**
 * Whether a component may go live, asked once for every document it would publish; null when
 * none is held. Only a publish not yet applied is asked: a document coming down is never held,
 * and one an earlier pass already wrote is live whatever the answer.
 *
 * Never a rejection: a question that fails is a hold of its own (`APPROVAL_CHECK_FAILED`), not
 * evidence either way, so the run writes nothing of the component and asks again next pass, and
 * a read projects nothing of it meanwhile.
 */
export async function componentHold(
  ask: AskHeld,
  actions: readonly MaterialisationAction[]
): Promise<ComponentHold | null> {
  const going = actions.filter(
    action => action.effect === "publish" && !action.applied
  );
  if (going.length === 0) return null;
  try {
    const answered = await ask(
      going.map(action => ({
        id: action.memberId,
        scopeKind: action.ref.scopeKind,
        scopeSlug: action.ref.scopeSlug,
        entryId: action.ref.entryId,
      }))
    );
    const held = new Set(
      going.map(action => action.memberId).filter(id => answered.has(id))
    );
    return held.size === 0 ? null : { failure: "NOT_APPROVED", held };
  } catch (error) {
    return {
      failure: "APPROVAL_CHECK_FAILED",
      detail: error instanceof Error ? error.message : String(error),
    };
  }
}

/**
 * The releases of each component an earlier pass already wrote part of: a component holding any
 * member with a receipt for its release's current revision.
 *
 * Read from every member, not from the plan's actions: the planner keeps one winning action per
 * document, so a document an earlier pass published and a later release now takes down appears
 * only as the takedown, and the receipt that says the component began would be lost with the
 * losing publish. A begun component is never stopped for a hold, by the run or by an early stop,
 * since stopping would leave what it wrote live for good; it waits, scheduled, for the approval.
 */
export function begunReleases(
  plan: Pick<
    ReturnType<typeof planReleaseMaterialisation>,
    "overlappingReleases"
  >,
  members: readonly Pick<DrainMemberRow, "releaseId" | "appliedRevision">[],
  releases: readonly { id: string; revision: number }[]
): Set<string> {
  const revisionOf = new Map(
    releases.map(release => [release.id, release.revision])
  );
  const receipted = new Set(
    members
      .filter(member => {
        const revision = revisionOf.get(member.releaseId);
        return revision !== undefined && memberAppliedFor(member, revision);
      })
      .map(member => member.releaseId)
  );
  const begun = new Set<string>();
  for (const group of plan.overlappingReleases) {
    if (group.some(id => receipted.has(id))) {
      for (const id of group) begun.add(id);
    }
  }
  return begun;
}

/**
 * The most rounds a walk of shared documents takes ({@link dueComponentsHolding}): each round is
 * one step along a chain of releases, each sharing a document with the one before.
 */
export const COMPONENT_WALK_ROUNDS = 16;

/** The most due releases a walk of shared documents gathers before it gives up. */
export const COMPONENT_WALK_RELEASES = IDS_PER_LOOKUP;

/** The reads a walk of shared documents makes, satisfied by `ReleasesRepository`. */
export type ComponentReads = Pick<
  ReleasesRepository,
  "scheduledMembersFor" | "listMembersOf"
>;

/** Due releases closed under shared documents, with every member of each, ready to plan. */
export interface DueComponents {
  releases: DueRelease[];
  members: DrainMemberRow[];
}

/**
 * Every due release of the components holding any of these documents, with all their members:
 * what the run would plan of them, read without reading the whole due backlog.
 *
 * Walked outward from the documents: the due releases holding them, then every document those
 * releases hold, then the due releases holding those, until a round finds no document not
 * already followed. What it gathers is closed under shared documents, so planning it gives each
 * of its components exactly as planning every due release would; a document shared only in
 * another language joins two releases the planner keeps apart, which plans a little more and
 * never less.
 *
 * Bounded, since a component can chain through any number of releases: past
 * {@link COMPONENT_WALK_ROUNDS} rounds or {@link COMPONENT_WALK_RELEASES} releases the answer is
 * null, and the caller decides what an unknown component means for it. Each round reads its
 * documents and releases in runs of at most {@link IDS_PER_LOOKUP}.
 */
export async function dueComponentsHolding(
  reads: ComponentReads,
  documents: readonly ReleaseRecheckDocument[],
  now: Date
): Promise<DueComponents | null> {
  const keyOf = (document: ReleaseRecheckDocument) =>
    JSON.stringify([document.scopeKind, document.scopeSlug, document.entryId]);
  const followed = new Set<string>();
  let frontier: ReleaseRecheckDocument[] = [];
  const follow = (document: ReleaseRecheckDocument) => {
    if (followed.has(keyOf(document))) return;
    followed.add(keyOf(document));
    frontier.push({
      scopeKind: document.scopeKind,
      scopeSlug: document.scopeSlug,
      entryId: document.entryId,
    });
  };
  documents.forEach(follow);
  const releases = new Map<string, DueRelease>();
  const members: DrainMemberRow[] = [];
  for (let round = 0; frontier.length > 0; round += 1) {
    if (round === COMPONENT_WALK_ROUNDS) return null;
    const found = (
      await reads.scheduledMembersFor({ documents: frontier })
    ).flatMap(({ release }) =>
      release.scheduledAt !== null &&
      isDueAt(release.scheduledAt, now) &&
      !releases.has(release.id)
        ? [
            {
              id: release.id,
              scheduledAt: release.scheduledAt,
              revision: release.revision,
            },
          ]
        : []
    );
    if (releases.size + found.length > COMPONENT_WALK_RELEASES) return null;
    for (const release of found) releases.set(release.id, release);
    const added = await reads.listMembersOf(found.map(release => release.id));
    members.push(...added);
    frontier = [];
    added.forEach(follow);
  }
  return { releases: [...releases.values()], members };
}
