/**
 * What a deploy does to review state recorded under an earlier configuration, as it loads: before
 * approvals given under an earlier definition are judged (`approval-follows-content`).
 *
 * - Detached. Review states of a collection or Single no workflow is attached to any more are
 *   removed, all in one transaction or none, with one `workflow-detached` event per document and
 *   the versions workflows pinned for it released, so attaching a workflow again starts afresh
 *   and never revives an approval.
 * - Renamed. A part in the name a stage was `renamedFrom` moves to the stage's name, keeping its
 *   approval, recorded. A rename moves no part from one stage to another, so a state written
 *   under the definition the workflow was renamed from (`definitionHashBeforeRenames`) is pointed
 *   at the current hash and keeps its approval through the judgement that follows.
 * - Removed, with somewhere named. A part in a stage `removedStages` lists moves where it says,
 *   its approval withdrawn as a change of definition withdraws one, recorded.
 * - Removed, with nowhere named. The part is left as it is: it reads as the first stage and is
 *   listed as stranded (`stranded-stages`).
 *
 * Each workflow's moves are one transaction. A boot that finds nothing to move writes nothing,
 * and nothing is read on a database the review states table is not on yet.
 *
 * @module domains/workflows/definition-sweep
 * @experimental
 */
import type { DrizzleAdapter } from "@nextlyhq/adapter-drizzle";
import type { TransactionContext } from "@nextlyhq/adapter-drizzle/types";

import { REVIEW_STATES_TABLE } from "../../schemas/review-states";
import { recordContentEvent } from "../content-events/record";
import { entityRemovedFromCode } from "../dynamic-collections/services/removed-from-code-writes";
import { liveColumnNames } from "../schema/pipeline/diff/introspect-live";
import { lockDocument } from "../versions/history-locks";

import { entersReview } from "./define-workflow";
import { definitionHashBeforeRenames } from "./hash";
import type { RegisteredWorkflow } from "./registry";
import {
  ensureReviewStateEventKinds,
  eventParts,
  REVIEW_STATE_EVENT_KINDS,
} from "./review-state-events";
import {
  deleteDocumentReviewStates,
  readEntityReviewStates,
  readReviewStatesOutside,
  restampReviewStates,
  updateReviewState,
  type ReviewDocument,
  type ReviewState,
} from "./review-state-repository";
import { pinEnteredReview } from "./stranded-stages";
import { workflowPins } from "./workflow-pins";

/** A document's states, keyed by document. */
function byDocument(states: readonly ReviewState[]): ReviewState[][] {
  const groups = new Map<string, ReviewState[]>();
  for (const state of states) {
    const key = JSON.stringify([
      state.scopeKind,
      state.scopeSlug,
      state.entryId,
    ]);
    groups.set(key, [...(groups.get(key) ?? []), state]);
  }
  // Sorted, so every transaction here takes documents' locks in one order.
  return [...groups.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([, group]) => group);
}

const documentOf = (state: ReviewState): ReviewDocument => ({
  scopeKind: state.scopeKind,
  scopeSlug: state.scopeSlug,
  entryId: state.entryId,
});

/** Each collection and Single `registered` is attached to, as a review state's scope. */
function scopesOf(registered: RegisteredWorkflow) {
  return [
    ...registered.collections.map(scopeSlug => ({
      scopeKind: "collection" as const,
      scopeSlug,
    })),
    ...registered.singles.map(scopeSlug => ({
      scopeKind: "single" as const,
      scopeSlug,
    })),
  ];
}

/**
 * Removes one detached document's review state on `tx`, releases what workflows pinned for it,
 * and records it. A collection or Single removed from code keeps its pins: freeing one is refused
 * there, and its teardown removes them with it.
 */
async function detachDocument(
  tx: TransactionContext,
  states: readonly ReviewState[]
): Promise<void> {
  const document = documentOf(states[0]);
  // The document's lock first, the order a save takes it in before it writes review state.
  await lockDocument(tx, document);
  await deleteDocumentReviewStates(tx, document);
  const removedFromCode = await entityRemovedFromCode(
    document.scopeKind,
    document.scopeSlug,
    { executor: tx.getDrizzle() }
  );
  if (!removedFromCode) await workflowPins.releaseAll(tx, document);
  await recordContentEvent(tx, {
    subject: {
      kind: document.scopeKind,
      slug: document.scopeSlug,
      id: document.entryId,
    },
    parts: eventParts(states.map(state => state.part)),
    kind: REVIEW_STATE_EVENT_KINDS.detached.name,
    actor: { kind: "system" },
    payload: { stages: [...new Set(states.map(state => state.stage))].sort() },
  });
}

/** Removes, in one transaction, every review state no registered workflow covers any more. */
async function removeDetachedReviewStates(
  adapter: DrizzleAdapter,
  workflows: readonly RegisteredWorkflow[]
): Promise<void> {
  await adapter.transaction(async tx => {
    const detached = await readReviewStatesOutside(tx, {
      collections: workflows.flatMap(registered => registered.collections),
      singles: workflows.flatMap(registered => registered.singles),
    });
    for (const states of byDocument(detached)) {
      await detachDocument(tx, states);
    }
  });
}

/** One kind of move a deploy makes: from the names it lists, to where each goes. */
interface DeployMove {
  targets: ReadonlyMap<string, string>;
  /** Whether the move withdraws the approval a part holds. */
  withdraws: boolean;
  kind: (typeof REVIEW_STATE_EVENT_KINDS)["stageRenamed" | "stageRemoved"];
}

/** The renames and the mapped removals `registered`'s definition names. */
function deployMovesOf(registered: RegisteredWorkflow): DeployMove[] {
  const { workflow } = registered;
  return [
    {
      targets: new Map(
        workflow.stages.flatMap(stage =>
          stage.renamedFrom === undefined
            ? []
            : [[stage.renamedFrom, stage.name] as const]
        )
      ),
      withdraws: false,
      kind: REVIEW_STATE_EVENT_KINDS.stageRenamed,
    },
    {
      targets: new Map(Object.entries(workflow.removedStages)),
      withdraws: true,
      kind: REVIEW_STATE_EVENT_KINDS.stageRemoved,
    },
  ];
}

/**
 * The hash a moved state carries: the current one for a removal, which is the new definition's
 * act; for a rename, the current one only where the state was written under the definition it
 * was renamed from, so a state under any other earlier one is still judged as such.
 */
function hashAfterMove(
  registered: RegisteredWorkflow,
  move: DeployMove,
  state: ReviewState,
  beforeRenames: string
): string {
  if (move.withdraws || state.definitionHash === beforeRenames) {
    return registered.definitionHash;
  }
  return state.definitionHash;
}

/** Moves one part as `move` says, on `tx`. Answers whether it held an approval it lost. */
async function movePart(
  tx: TransactionContext,
  registered: RegisteredWorkflow,
  move: DeployMove,
  state: ReviewState,
  beforeRenames: string
): Promise<boolean> {
  const to = move.targets.get(state.stage) ?? state.stage;
  await updateReviewState(tx, state, state.revision, {
    stage: to,
    definitionHash: hashAfterMove(registered, move, state, beforeRenames),
    ...(move.withdraws ? { approval: null, enteredAt: new Date() } : {}),
  });
  const { workflow } = registered;
  // A removed stage read as the first stage, so its part enters review as though from there.
  if (move.withdraws && entersReview(workflow, workflow.firstStage, to)) {
    await pinEnteredReview(tx, documentOf(state), state.part);
  }
  return move.withdraws && state.approval !== null;
}

/** Moves one document's parts as `move` says, on `tx`, and records one event per stage left. */
async function moveDocument(
  tx: TransactionContext,
  registered: RegisteredWorkflow,
  move: DeployMove,
  states: readonly ReviewState[],
  beforeRenames: string
): Promise<void> {
  const document = documentOf(states[0]);
  await lockDocument(tx, document);
  for (const from of [...new Set(states.map(state => state.stage))].sort()) {
    const group = states.filter(state => state.stage === from);
    let withdrawn = false;
    for (const state of group) {
      if (await movePart(tx, registered, move, state, beforeRenames)) {
        withdrawn = true;
      }
    }
    await recordContentEvent(tx, {
      subject: {
        kind: document.scopeKind,
        slug: document.scopeSlug,
        id: document.entryId,
      },
      parts: eventParts(group.map(state => state.part)),
      kind: move.kind.name,
      actor: { kind: "system" },
      fromState: from,
      toState: move.targets.get(from) ?? from,
      ...(move.withdraws ? { payload: { approvalWithdrawn: withdrawn } } : {}),
      definitionHash: registered.definitionHash,
    });
  }
}

/** Every move `registered`'s definition names, and the restamp a rename allows, on `tx`. */
async function followWorkflow(
  tx: TransactionContext,
  registered: RegisteredWorkflow
): Promise<void> {
  const beforeRenames = definitionHashBeforeRenames(registered.workflow);
  for (const scope of scopesOf(registered)) {
    for (const move of deployMovesOf(registered)) {
      if (move.targets.size === 0) continue;
      const states = await readEntityReviewStates(tx, scope, [
        { column: "stage", op: "IN", value: [...move.targets.keys()] },
      ]);
      for (const group of byDocument(states)) {
        await moveDocument(tx, registered, move, group, beforeRenames);
      }
    }
    // A rename alone is no change of definition: the states written under the definition before
    // it are this one's, approvals and all.
    if (beforeRenames !== registered.definitionHash) {
      await restampReviewStates(
        tx,
        scope,
        beforeRenames,
        registered.definitionHash
      );
    }
  }
}

/**
 * Brings the review state recorded under an earlier configuration into line with the workflows
 * this boot registered, as the module describes: detached states removed, renamed and mapped
 * stages followed. Run at boot, after the migrations and before approvals given under an earlier
 * definition are judged.
 *
 * @experimental
 */
export async function followWorkflowDefinitions(
  adapter: DrizzleAdapter,
  workflows: Iterable<RegisteredWorkflow>
): Promise<void> {
  const live = await liveColumnNames(
    adapter.getDrizzle(),
    adapter.getCapabilities().dialect,
    [REVIEW_STATES_TABLE]
  );
  if (!live.has(REVIEW_STATES_TABLE)) return;
  ensureReviewStateEventKinds();
  const registered = [...workflows];
  await removeDetachedReviewStates(adapter, registered);
  for (const each of registered) {
    await adapter.transaction(tx => followWorkflow(tx, each));
  }
}
