/**
 * Stranded review states: parts recorded in a stage their workflow no longer has, and that the
 * definition names nowhere for (no `removedStages` entry, no stage `renamedFrom` it).
 *
 * Such a part reads as the workflow's first stage, and waits in Needs attention ("Stage 'Legal
 * check' no longer exists") until a person moves it. Which stages strand a part is decided once,
 * by {@link strandedStageShape}: the list here, and the `_strandedStage` list filter built from
 * the same shape, so a count and the list it links to cannot disagree.
 *
 * @module domains/workflows/stranded-stages
 * @experimental
 */
import type { DrizzleAdapter } from "@nextlyhq/adapter-drizzle";
import type {
  TransactionContext,
  WhereCondition,
} from "@nextlyhq/adapter-drizzle/types";

import { NextlyError } from "../../errors";
import { recordContentEvent } from "../content-events/record";
import { lockDocument } from "../versions/history-locks";

import { entersReview } from "./define-workflow";
import { shownVersionOn } from "./part-versions";
import { registeredWorkflows, type RegisteredWorkflow } from "./registry";
import {
  ensureReviewStateEventKinds,
  eventParts,
  REVIEW_STATE_EVENT_KINDS,
} from "./review-state-events";
import {
  readEntityReviewStates,
  updateReviewState,
  type ReviewDocument,
  type ReviewState,
  type ReviewStatesDb,
} from "./review-state-repository";
import type { Workflow } from "./types";
import { enteredReviewSlot, pinPart } from "./workflow-pins";

/** The longest comment a move keeps: the record of content events' note limit. */
const MAX_MOVE_COMMENT_LENGTH = 4000;

/** Why a move of stranded parts was refused, each the code of the error at its place. */
const MOVE_STRANDED_ERROR_CODES = {
  notAttached: "WORKFLOW_NOT_ATTACHED",
  unknownStage: "WORKFLOW_UNKNOWN_STAGE",
  stageAllowsPublish: "WORKFLOW_STAGE_ALLOWS_PUBLISH",
  personNotFound: "WORKFLOW_PERSON_NOT_FOUND",
  personDeactivated: "WORKFLOW_PERSON_DEACTIVATED",
  commentRequired: "WORKFLOW_COMMENT_REQUIRED",
  commentTooLong: "WORKFLOW_COMMENT_TOO_LONG",
} as const;

/**
 * Every stage name the definition knows what to do with: its stages, the stages it lists as
 * removed (a deploy moves their parts where it names), and the names its stages were renamed from
 * (a deploy moves their parts to the stage's new name).
 */
function knownStageNames(workflow: Workflow): string[] {
  return [
    ...workflow.stages.map(stage => stage.name),
    ...Object.keys(workflow.removedStages),
    ...workflow.stages.flatMap(stage =>
      stage.renamedFrom === undefined ? [] : [stage.renamedFrom]
    ),
  ];
}

/**
 * The condition a review state of a document `workflow` is attached to meets when it is
 * stranded, on the review states table: its stage is none the definition knows. The one
 * statement of it, read by the list here and by the `_strandedStage` filter.
 *
 * @experimental
 */
export function strandedStageShape(
  workflow: Workflow
): readonly WhereCondition[] {
  return [{ column: "stage", op: "NOT IN", value: knownStageNames(workflow) }];
}

/**
 * A stranded part, with its workflow and what Needs attention says of it.
 *
 * @experimental
 */
export interface StrandedReviewState extends ReviewState {
  /** The slug of the workflow attached to its collection or Single. */
  workflow: string;
  /** "Stage 'legal' no longer exists". */
  message: string;
}

/** What Needs attention says of a part in `stage`. */
function strandedMessage(stage: string): string {
  return `Stage '${stage}' no longer exists`;
}

/** Each collection and Single `registered` is attached to, as a review state's scope. */
function scopesOf(
  registered: RegisteredWorkflow
): Array<Pick<ReviewDocument, "scopeKind" | "scopeSlug">> {
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

/** The workflows to read, narrowed to the one attached to `collection` when it is named. */
function workflowsFor(
  workflows: Iterable<RegisteredWorkflow>,
  collection: string | undefined
): RegisteredWorkflow[] {
  const all = [...workflows];
  if (collection === undefined) return all;
  const attached = all.find(registered =>
    registered.collections.includes(collection)
  );
  if (!attached) {
    throw NextlyError.validation({
      errors: [
        {
          path: "collection",
          code: MOVE_STRANDED_ERROR_CODES.notAttached,
          message: `No workflow is attached to the collection "${collection}".`,
        },
      ],
    });
  }
  return [{ ...attached, collections: [collection], singles: [] }];
}

/** Which stranded parts to read: of these workflows' documents, or one collection's. */
interface StrandedScope {
  /** The install's registered workflows by default. */
  workflows?: Iterable<RegisteredWorkflow>;
  collection?: string;
}

/**
 * Every stranded part of the documents `scope.workflows` are attached to, or of one collection's
 * when `scope.collection` is named, ordered by document and part: one read per collection or
 * Single, on a transaction of its own, since the review states surface is a transaction's.
 *
 * @experimental
 */
export function strandedReviewStates(
  adapter: DrizzleAdapter,
  scope: StrandedScope = {}
): Promise<StrandedReviewState[]> {
  const workflows = workflowsFor(
    scope.workflows ?? registeredWorkflows(),
    scope.collection
  );
  return adapter.transaction(tx => readStranded(tx, workflows));
}

/** The stranded parts of `workflows`' documents, read on `db`. */
async function readStranded(
  db: ReviewStatesDb,
  workflows: readonly RegisteredWorkflow[]
): Promise<StrandedReviewState[]> {
  const found: StrandedReviewState[] = [];
  for (const registered of workflows) {
    for (const scope of scopesOf(registered)) {
      const states = await readEntityReviewStates(
        db,
        scope,
        strandedStageShape(registered.workflow)
      );
      for (const state of states) {
        found.push({
          ...state,
          workflow: registered.workflow.slug,
          message: strandedMessage(state.stage),
        });
      }
    }
  }
  return found.sort(byDocumentAndPart);
}

/** Orders review states by document, then part, the shared part first. */
function byDocumentAndPart(a: ReviewState, b: ReviewState): number {
  const key = (state: ReviewState) =>
    JSON.stringify([
      state.scopeKind,
      state.scopeSlug,
      state.entryId,
      state.part ?? "",
    ]);
  return key(a).localeCompare(key(b));
}

/** A person a move is recorded as. */
interface Mover {
  id: string;
  name: string | null;
}

/**
 * The active person with `email`, read on the pool before the move's transaction opens, or a
 * refusal naming why there is none. Emails are kept lowercased, as sign-in compares them.
 */
async function moverByEmail(
  adapter: DrizzleAdapter,
  email: string
): Promise<Mover> {
  const [row] = await adapter.select<{
    id: string;
    name: string | null;
    isActive: boolean | number | null;
  }>("users", {
    columns: ["id", "name", "isActive"],
    where: {
      and: [{ column: "email", op: "=", value: email.trim().toLowerCase() }],
    },
    limit: 1,
  });
  if (!row) {
    throw NextlyError.validation({
      errors: [
        {
          path: "as",
          code: MOVE_STRANDED_ERROR_CODES.personNotFound,
          message: `No person has the email "${email}".`,
        },
      ],
    });
  }
  // SQLite stores a boolean as 0 or 1.
  if (!row.isActive) {
    throw NextlyError.validation({
      errors: [
        {
          path: "as",
          code: MOVE_STRANDED_ERROR_CODES.personDeactivated,
          message: `"${email}" is deactivated, so moves cannot be recorded as theirs.`,
        },
      ],
    });
  }
  return { id: row.id, name: row.name ?? null };
}

/** Refuses a missing comment, or one too long to keep. */
function checkMoveComment(comment: string): void {
  if (comment.trim() === "") {
    throw NextlyError.validation({
      errors: [
        {
          path: "comment",
          code: MOVE_STRANDED_ERROR_CODES.commentRequired,
          message: "Say why the documents are moved.",
        },
      ],
    });
  }
  if (comment.length > MAX_MOVE_COMMENT_LENGTH) {
    throw NextlyError.validation({
      errors: [
        {
          path: "comment",
          code: MOVE_STRANDED_ERROR_CODES.commentTooLong,
          message: `A comment may be at most ${MAX_MOVE_COMMENT_LENGTH} characters.`,
        },
      ],
    });
  }
}

/**
 * Refuses `to` unless it is a stage of every workflow whose parts move, and one that does not
 * allow publishing: a move by no step must not hand out an approval nobody gave.
 */
function checkTarget(workflows: readonly RegisteredWorkflow[], to: string) {
  for (const { workflow } of workflows) {
    const stage = workflow.stages.find(each => each.name === to);
    if (!stage) {
      throw NextlyError.validation({
        errors: [
          {
            path: "to",
            code: MOVE_STRANDED_ERROR_CODES.unknownStage,
            message: `"${to}" is not a stage of the workflow "${workflow.slug}". Known stages: ${workflow.stages.map(each => each.name).join(", ")}.`,
          },
        ],
      });
    }
    if (stage.allowsPublish) {
      throw NextlyError.validation({
        errors: [
          {
            path: "to",
            code: MOVE_STRANDED_ERROR_CODES.stageAllowsPublish,
            message: `"${to}" allows publishing, so a move into it would approve content nobody approved. Name a stage before review.`,
          },
        ],
      });
    }
  }
}

/** What a move of stranded parts names. */
interface MoveStrandedInput {
  /** The workflows whose stranded parts move: the install's registered ones by default. */
  workflows?: Iterable<RegisteredWorkflow>;
  /** Only this collection's documents. */
  collection?: string;
  /** The stage they move to: a stage of each workflow, one that does not allow publishing. */
  to: string;
  /** The email of the person the moves are recorded as: an active person. */
  as: string;
  /** Why, kept as each event's note. */
  comment: string;
}

/** One document a move of stranded parts moved. */
interface MovedStranded {
  document: ReviewDocument;
  parts: (string | null)[];
  from: string[];
}

/**
 * Moves every stranded part (of one collection's documents, when named) to `to`, in one
 * transaction of `adapter`, and records one `workflow-stranded-moved` event per document, as the
 * person `as` names, with the comment as its note and the stages the parts left. Each part leaves
 * its approval behind, since the stage it was given in is gone, and enters `to` as though from
 * the first stage, which is how it read while stranded. Refused, moving nothing, for a person
 * unknown or deactivated, a stage missing from a workflow whose parts it moves or one that allows
 * publishing, and a missing comment. Answers the documents moved.
 *
 * @experimental
 */
export async function moveStrandedReviewStates(
  adapter: DrizzleAdapter,
  input: MoveStrandedInput
): Promise<MovedStranded[]> {
  const workflows = workflowsFor(
    input.workflows ?? registeredWorkflows(),
    input.collection
  );
  checkMoveComment(input.comment);
  const mover = await moverByEmail(adapter, input.as);
  ensureReviewStateEventKinds();

  return adapter.transaction(async tx => {
    // Each workflow's stranded parts, read before anything is written: the stage is judged only
    // by the workflows whose parts it moves, so one with nothing stranded has no say in it.
    const strandedOf: Array<{
      registered: RegisteredWorkflow;
      stranded: StrandedReviewState[];
    }> = [];
    for (const registered of workflows) {
      const stranded = await readStranded(tx, [registered]);
      if (stranded.length > 0) strandedOf.push({ registered, stranded });
    }
    checkTarget(
      strandedOf.map(each => each.registered),
      input.to
    );
    const moved: MovedStranded[] = [];
    for (const { registered, stranded } of strandedOf) {
      for (const states of byDocument(stranded)) {
        moved.push(
          await moveDocument(tx, registered, states, {
            to: input.to,
            mover,
            comment: input.comment,
          })
        );
      }
    }
    return moved;
  });
}

/** Review states grouped by their document, each group in its parts' order. */
function byDocument<T extends ReviewState>(states: readonly T[]): T[][] {
  const groups = new Map<string, T[]>();
  for (const state of states) {
    const key = JSON.stringify([
      state.scopeKind,
      state.scopeSlug,
      state.entryId,
    ]);
    groups.set(key, [...(groups.get(key) ?? []), state]);
  }
  return [...groups.values()];
}

/**
 * Moves one document's stranded parts to `move.to` on `tx`, under the document's lock, and
 * records the move as one event.
 */
async function moveDocument(
  tx: TransactionContext,
  registered: RegisteredWorkflow,
  states: readonly StrandedReviewState[],
  move: { to: string; mover: Mover; comment: string }
): Promise<MovedStranded> {
  const { workflow, definitionHash } = registered;
  const document: ReviewDocument = {
    scopeKind: states[0].scopeKind,
    scopeSlug: states[0].scopeSlug,
    entryId: states[0].entryId,
  };
  // The document's lock first, the order a save takes it in before it writes review state.
  await lockDocument(tx, document);
  const now = new Date();
  for (const state of states) {
    const written = await updateReviewState(tx, state, state.revision, {
      stage: move.to,
      enteredAt: now,
      enteredBy: move.mover.id,
      approval: null,
      definitionHash,
    });
    // Under the lock nothing else writes the row; a miss is a fault, not a race to retry.
    if (!written) {
      throw NextlyError.conflict({
        reason: "state",
        logContext: { refusal: "workflow-move-stranded-moved" },
      });
    }
    // A stranded part read as the first stage, so it enters review as though from there.
    if (entersReview(workflow, workflow.firstStage, move.to)) {
      await pinEnteredReview(tx, document, state.part);
    }
  }
  const parts = states.map(state => state.part);
  const from = [...new Set(states.map(state => state.stage))].sort();
  await recordContentEvent(tx, {
    subject: {
      kind: document.scopeKind,
      slug: document.scopeSlug,
      id: document.entryId,
    },
    parts: eventParts(parts),
    kind: REVIEW_STATE_EVENT_KINDS.strandedMoved.name,
    actor: { kind: "person", id: move.mover.id, name: move.mover.name },
    fromState: from.length === 1 ? from[0] : null,
    toState: move.to,
    note: move.comment,
    payload: { from },
    definitionHash,
  });
  return { document, parts, from };
}

/**
 * Pins the version a part holds now as the one it entered review at, on `tx`: a part entering
 * review opens a cycle there. A part never saved has no version to pin.
 */
export async function pinEnteredReview(
  tx: TransactionContext,
  document: ReviewDocument,
  part: string | null
): Promise<void> {
  const shown = await shownVersionOn(tx, document, part);
  if (typeof shown?.versionNo === "number") {
    await pinPart(tx, document, enteredReviewSlot(part), shown.versionNo);
  }
}
