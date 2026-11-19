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
 * one step along a chain of releases, each sharing a document with the one before. A component
 * still growing after this many is past the bound.
 */
export const COMPONENT_WALK_ROUNDS = 16;

/** The most due releases one component may hold before a walk gives up on it. */
export const COMPONENT_WALK_RELEASES = IDS_PER_LOOKUP;

/** The reads a walk of shared documents makes, satisfied by `ReleasesRepository`. */
export type ComponentReads = Pick<
  ReleasesRepository,
  "scheduledMembersFor" | "listMembersOf"
>;

/**
 * Due releases closed under shared documents, with every member of each, ready to plan; and the
 * documents asked about whose component passed the bound, of which neither list holds anything.
 */
export interface DueComponents {
  releases: DueRelease[];
  members: DrainMemberRow[];
  unbounded: ReleaseRecheckDocument[];
}

/** A document's key in a walk: its scope and entry, any language. */
function walkKeyOf(document: ReleaseRecheckDocument): string {
  return `d${JSON.stringify([document.scopeKind, document.scopeSlug, document.entryId])}`;
}

/** A release's key in a walk, apart from every document's. */
const releaseKeyOf = (releaseId: string): string => `r${releaseId}`;

/**
 * The components a walk has joined so far, as a union-find over documents and releases, with the
 * components it has given up on. A component given up on stays so when it joins another, since
 * what it joins is only larger.
 */
class WalkedComponents {
  private readonly parent = new Map<string, string>();
  private readonly beyond = new Set<string>();

  rootOf(key: string): string {
    let root = key;
    for (let up = this.parent.get(root); up !== undefined && up !== root; ) {
      root = up;
      up = this.parent.get(root);
    }
    this.parent.set(key, root);
    return root;
  }

  join(a: string, b: string): void {
    const ra = this.rootOf(a);
    const rb = this.rootOf(b);
    if (ra === rb) return;
    this.parent.set(ra, rb);
    if (this.beyond.has(ra)) this.beyond.add(rb);
  }

  giveUp(key: string): void {
    this.beyond.add(this.rootOf(key));
  }

  isBeyond(key: string): boolean {
    return this.beyond.has(this.rootOf(key));
  }

  /** Gives up on each component holding more than the bound of these releases. */
  giveUpOversized(releaseIds: Iterable<string>): void {
    const sizes = new Map<string, number>();
    for (const id of releaseIds) {
      const root = this.rootOf(releaseKeyOf(id));
      sizes.set(root, (sizes.get(root) ?? 0) + 1);
    }
    for (const [root, size] of sizes) {
      if (size > COMPONENT_WALK_RELEASES) this.beyond.add(root);
    }
  }
}

/**
 * Every due release of the components holding any of these documents, with all their members:
 * what the run would plan of them, read without reading the whole due backlog.
 *
 * Walked outward from the documents: the due releases holding them, then every document those
 * releases hold, then the due releases holding those, until a round finds no document not
 * already followed. Each component it gathers is closed under shared documents, so planning it
 * gives the component exactly as planning every due release would; a document shared only in
 * another language joins two releases the planner keeps apart, which plans a little more and
 * never less.
 *
 * Bounded PER COMPONENT, since one component can chain through any number of releases while
 * many small ones beside it cost little each: a component holding more than
 * {@link COMPONENT_WALK_RELEASES} due releases, or still growing after
 * {@link COMPONENT_WALK_ROUNDS} rounds, is walked no further, left out of what is returned, and
 * its documents asked about are named `unbounded`, for the caller to decide what an unknown
 * component means for it. Every other component is returned whole. A component given up on is
 * disjoint from every component returned: one returned was closed, so a release sharing any of
 * its documents was found and joined to it. Each round reads its documents and releases in runs
 * of at most {@link IDS_PER_LOOKUP}.
 */
export async function dueComponentsHolding(
  reads: ComponentReads,
  documents: readonly ReleaseRecheckDocument[],
  now: Date
): Promise<DueComponents> {
  const components = new WalkedComponents();
  const followed = new Set<string>();
  let frontier: ReleaseRecheckDocument[] = [];
  const follow = (document: ReleaseRecheckDocument) => {
    const key = walkKeyOf(document);
    if (followed.has(key)) return;
    followed.add(key);
    frontier.push({
      scopeKind: document.scopeKind,
      scopeSlug: document.scopeSlug,
      entryId: document.entryId,
    });
  };
  documents.forEach(follow);
  const releases = new Map<string, DueRelease>();
  const members: DrainMemberRow[] = [];
  for (let round = 0; ; round += 1) {
    frontier = frontier.filter(
      document => !components.isBeyond(walkKeyOf(document))
    );
    if (frontier.length === 0) break;
    if (round === COMPONENT_WALK_ROUNDS) {
      for (const document of frontier) components.giveUp(walkKeyOf(document));
      break;
    }
    const holding = await dueReleasesHolding(reads, frontier, now);
    // Joined to the documents it was found by, every release, a known one too: a release given
    // up on is never read in full, so its edge to a document reached again is how what it joins
    // learns it is past the bound. And joined before members are read, so a component past the
    // bound is known first.
    for (const { release, naming } of holding) {
      for (const document of naming) {
        components.join(releaseKeyOf(release.id), walkKeyOf(document));
      }
    }
    const found = holding.filter(({ release }) => !releases.has(release.id));
    for (const { release } of found) releases.set(release.id, release);
    components.giveUpOversized(releases.keys());
    const added = await reads.listMembersOf(
      found
        .map(({ release }) => release.id)
        .filter(id => !components.isBeyond(releaseKeyOf(id)))
    );
    members.push(...added);
    frontier = [];
    for (const member of added) {
      components.join(releaseKeyOf(member.releaseId), walkKeyOf(member));
      follow(member);
    }
    components.giveUpOversized(releases.keys());
  }
  const whole = (releaseId: string) =>
    !components.isBeyond(releaseKeyOf(releaseId));
  return {
    releases: [...releases.values()].filter(release => whole(release.id)),
    members: members.filter(member => whole(member.releaseId)),
    unbounded: documents.filter(document =>
      components.isBeyond(walkKeyOf(document))
    ),
  };
}

/**
 * The due releases holding these documents, each with the members naming them: one round of a
 * walk's reads of releases.
 */
async function dueReleasesHolding(
  reads: ComponentReads,
  documents: readonly ReleaseRecheckDocument[],
  now: Date
): Promise<
  { release: DueRelease; naming: readonly ReleaseRecheckDocument[] }[]
> {
  return (await reads.scheduledMembersFor({ documents })).flatMap(
    ({ release, members }) =>
      release.scheduledAt !== null && isDueAt(release.scheduledAt, now)
        ? [
            {
              release: {
                id: release.id,
                scheduledAt: release.scheduledAt,
                revision: release.revision,
              },
              naming: members,
            },
          ]
        : []
  );
}
