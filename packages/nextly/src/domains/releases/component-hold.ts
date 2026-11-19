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
  MaterialisationAction,
  planReleaseMaterialisation,
} from "./plan-release-materialisation";

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
