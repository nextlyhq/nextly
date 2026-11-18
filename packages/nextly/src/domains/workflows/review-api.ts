/**
 * What developers read and move of review state, through REST and the Direct API, with the same
 * rules as the admin: a document's review state per part, what waits for a caller, and steps or
 * assignments over several documents at once.
 *
 * The rules of a step stay where they live (`takeWorkflowStep`, `assignWorkflowParts`): this
 * module reads, and runs those one document at a time. Whether a caller may READ a document is
 * asked by the door through `readable`, the one read check its document routes already make, so
 * review state never shows a document its reader may not see.
 *
 * @module domains/workflows/review-api
 * @experimental
 */
import type { DrizzleAdapter } from "@nextlyhq/adapter-drizzle";

import { decidePermission } from "../../auth/access/decide";
import { NextlyError } from "../../errors";
import { resolveUserRoles } from "../../services/lib/permissions";
import { configuredLocales } from "../i18n/configured-locales";

import { primaryStep } from "./define-workflow";
import { livePartsOf, partStage, pendingPartsOn } from "./implicit-stage";
import { lastMovesOn, type LastMove } from "./last-moves";
import { documentTableOn, partVersionOn } from "./part-versions";
import { partsWaitingFor, type PartWaitingFor } from "./part-waits-for";
import { registeredWorkflows, workflowAttachedTo } from "./registry";
import {
  countAssignedReviewStates,
  readAssignedReviewStates,
  readDocumentReviewStates,
  type ReviewAssignee,
  type ReviewDocument,
  type ReviewState,
} from "./review-state-repository";
import {
  allowsPublish,
  assignWorkflowParts,
  primaryAction,
  stepsTakeableBy,
  takeWorkflowStep,
  workflowCallerActor,
  type Assignment,
  type SeenPart,
  type TakeStepResult,
  type WorkflowCaller,
} from "./steps";
import type { Workflow, WorkflowStepKind } from "./types";

/** Error codes this module refuses with. @experimental */
export const REVIEW_API_ERROR_CODES = {
  /** An approval asked for several documents at once: each is given for the version shown. */
  bulkApproval: "WORKFLOW_BULK_APPROVAL",
} as const;

/** A step a part may take from where it stands. @experimental */
export interface AvailableStep {
  name: string;
  label: string;
  kind: WorkflowStepKind;
  to: string;
  /**
   * Whether the caller may take it on this part, judged by the checks the step makes of who takes
   * it (`stepsTakeableBy`): its permission, a person for an approval or a request for changes,
   * and the self-approval it refuses. True for trusted code but on a step only a person may take.
   * What the step checks of the content (the version seen, a comment) is asked when it is taken.
   *
   * @experimental
   */
  mayTake: boolean;
  /**
   * Whether it is its stage's primary step: the stage's only step out, or the one marked
   * `primary`. Exactly one step out of a stage is.
   *
   * @experimental
   */
  primary: boolean;
}

/** One part's review state, as a reader is told it. @experimental */
export interface PartReview {
  /** A language, or null for the shared part. */
  part: string | null;
  /** The stage it stands in; null for a live part with nothing waiting to go live. */
  stage: string | null;
  stageLabel: string | null;
  /** Whether its stage allows publishing. */
  publishable: boolean;
  enteredAt: Date | null;
  enteredBy: string | null;
  assignee: ReviewAssignee | null;
  dueAt: Date | null;
  /** The approval it holds, given under the definition attached now; null otherwise. */
  approval: { versionNo: number; by: string; at: Date } | null;
  /** Its review-state revision, 0 for a part with none yet: what a step says it saw. */
  revision: number;
  /** The document's version as a reader of this part holds it: what a step says it saw. */
  version: string | null;
  /** The steps that leave from its stage, each with whether the caller may take it. */
  steps: AvailableStep[];
  /**
   * Who it waits for: its assignee; else its stage's default reviewer, where they may take the
   * stage's primary step; else the roles that may. Null in a stage with no step out of it.
   */
  waitingFor: PartWaitingFor | null;
  /** Its latest workflow event other than an assignment; null for a part that never moved. */
  lastMove: LastMove | null;
}

/**
 * A document's review state, part by part. With no workflow attached to its collection or Single,
 * `workflow` is null and `parts` is empty.
 *
 * @experimental
 */
export interface DocumentReview {
  workflow: { slug: string; label: string } | null;
  parts: PartReview[];
}

const stageOf = (workflow: Workflow, name: string | null) =>
  name === null
    ? undefined
    : workflow.stages.find(stage => stage.name === name);

/** A step leaving a stage, before whether the caller may take it is judged. */
type StepOut = Omit<AvailableStep, "mayTake">;

/** The steps leaving `stage`, as a reader is told them, its primary step marked. */
function stepsFrom(workflow: Workflow, stage: string | null): StepOut[] {
  if (stage === null) return [];
  const primary = primaryStep(workflow, stage)?.name;
  return workflow.steps
    .filter(step => step.from.includes(stage))
    .map(step => ({
      name: step.name,
      label: step.label,
      kind: step.kind,
      to: step.to,
      primary: step.name === primary,
    }));
}

/**
 * A document's review state, each part where it stands: its review state's stage, or for a part
 * with none, where its content puts it (`partStage`). Read in one transaction, so every part is
 * read as of one moment, its last move included. Who each part waits for, and which steps `caller`
 * may take, are asked after, on the pool, as every question of who holds a permission is. The
 * caller has already been allowed to read the document, so a document with no workflow attached
 * answers as such only to one who may read it.
 *
 * @experimental
 */
export async function reviewStateOf(
  adapter: DrizzleAdapter,
  document: ReviewDocument,
  caller: WorkflowCaller
): Promise<DocumentReview> {
  const registered = workflowAttachedTo(document.scopeKind, document.scopeSlug);
  if (!registered) return { workflow: null, parts: [] };
  const { workflow } = registered;
  const table = await documentTableOn(document);
  const parts: (string | null)[] = table.localized
    ? [...(configuredLocales() ?? []), null]
    : [null];
  const live = await livePartsOf(adapter, document, parts);
  const dialect = adapter.getCapabilities().dialect;
  const read = await adapter.transaction(async tx => {
    const states = await readDocumentReviewStates(tx, document);
    const pending = await pendingPartsOn(tx, document);
    const moves = await lastMovesOn(tx, dialect, document);
    const read: (Omit<PartReview, "waitingFor" | "steps"> & {
      steps: StepOut[];
    })[] = [];
    for (const part of parts) {
      const state = states.find(candidate => candidate.part === part) ?? null;
      const stage = partStage(workflow, state, {
        live: live.get(part) === true,
        pending: pending(part),
      });
      const current =
        state?.approval != null &&
        state.definitionHash === registered.definitionHash;
      read.push({
        part,
        stage,
        stageLabel: stageOf(workflow, stage)?.label ?? null,
        publishable: stage !== null && allowsPublish(workflow, stage),
        enteredAt: state?.enteredAt ?? null,
        enteredBy: state?.enteredBy ?? null,
        assignee: state?.assignee ?? null,
        dueAt: state?.dueAt ?? null,
        approval:
          current && state.approval
            ? {
                versionNo: state.approval.versionNo,
                by: state.approval.by,
                at: state.approval.at,
              }
            : null,
        revision: state?.revision ?? 0,
        version:
          (await partVersionOn(tx, dialect, table, document.entryId, part)) ??
          null,
        steps: stepsFrom(workflow, stage),
        lastMove: moves.get(part) ?? null,
      });
    }
    return read;
  });
  const waiting = await partsWaitingFor(
    adapter,
    registered,
    document.scopeSlug,
    read
  );
  const mayTake = await stepsTakeableBy(
    adapter,
    workflow,
    document,
    caller,
    read.map(part => ({
      part: part.part,
      stage: part.stage,
      enteredBy: part.enteredBy,
    }))
  );
  return {
    workflow: { slug: workflow.slug, label: workflow.label },
    parts: read.map((part, index) => ({
      ...part,
      steps: part.steps.map(step => ({
        ...step,
        mayTake: mayTake(part.part, step.name),
      })),
      waitingFor: waiting[index] ?? null,
    })),
  };
}

/** A part waiting for a caller, as the list names it. @experimental */
export interface WaitingPart {
  document: ReviewDocument;
  part: string | null;
  stage: string;
  stageLabel: string;
  assignee: ReviewAssignee;
  enteredAt: Date;
  dueAt: Date | null;
}

/** What `waitingFor` reads: the caller, a page, and the read checks its door makes. */
export interface WaitingQuery {
  caller: WorkflowCaller & { kind: "user" | "key" };
  limit: number;
  offset: number;
  /** Whether the caller may read anything of a collection or Single, asked once per entity. */
  readsEntity: (
    kind: "collection" | "single",
    slug: string
  ) => Promise<boolean>;
  /** Whether the caller may read one document, asked of each item of the page. */
  readable: (document: ReviewDocument, part: string | null) => Promise<boolean>;
}

/** One stage of one attached collection or Single. */
interface ScopedStage {
  kind: "collection" | "single";
  slug: string;
  stage: string;
  action: string;
}

/** Every stage with a step out of it, of every collection and Single a workflow is attached to. */
function attachedStages(): ScopedStage[] {
  const stages: ScopedStage[] = [];
  for (const registered of registeredWorkflows()) {
    const entities = [
      ...registered.collections.map(slug => ({
        kind: "collection" as const,
        slug,
      })),
      ...registered.singles.map(slug => ({ kind: "single" as const, slug })),
    ];
    for (const entity of entities) {
      for (const stage of registered.workflow.stages) {
        const action = primaryAction(registered.workflow, stage.name);
        if (action !== null)
          stages.push({ ...entity, stage: stage.name, action });
      }
    }
  }
  return stages;
}

/**
 * What waits for a caller: the parts whose next step they may take (they hold the action of the
 * part's stage's primary step on its collection or Single) and that are assigned to them or to one
 * of their roles. Only collections and Singles the caller may read are looked in, filtered and
 * paginated in the database on the assignee index; each document of the page is then asked the
 * document read check, so a document the caller may not read is left out rather than shown.
 *
 * @experimental
 */
export async function waitingFor(
  adapter: DrizzleAdapter,
  query: WaitingQuery
): Promise<{ items: WaitingPart[]; total: number }> {
  const actor = await workflowCallerActor(adapter, query.caller);
  // The stages whose next step the caller may take, in entities they may read.
  const takeable: ScopedStage[] = [];
  const readsCache = new Map<string, boolean>();
  for (const scoped of attachedStages()) {
    const key = `${scoped.kind}:${scoped.slug}`;
    if (!readsCache.has(key)) {
      readsCache.set(key, await query.readsEntity(scoped.kind, scoped.slug));
    }
    if (!readsCache.get(key)) continue;
    if (decidePermission(actor, scoped.action, scoped.slug).allowed) {
      takeable.push(scoped);
    }
  }
  if (takeable.length === 0) return { items: [], total: 0 };
  // The roles the caller holds now, inherited ones included: a part assigned to any of them
  // waits for the caller.
  const { roleIds } = await resolveUserRoles(query.caller.userId);
  const holders: ReviewAssignee[] = [
    { kind: "user", id: query.caller.userId },
    ...[...roleIds].map(id => ({ kind: "role" as const, id })),
  ];
  const within = takeable.map(({ kind, slug, stage }) => ({
    kind,
    slug,
    stage,
  }));
  const rows = await readAssignedReviewStates(
    adapter,
    holders,
    { limit: query.limit, offset: query.offset },
    within
  );
  // Counted on the same filter. A document a row-level read rule hides is left out of its page,
  // and still counted: the count names no document.
  const total = await countAssignedReviewStates(adapter, holders, within);
  const items: WaitingPart[] = [];
  for (const row of rows) {
    const document: ReviewDocument = {
      scopeKind: row.scopeKind,
      scopeSlug: row.scopeSlug,
      entryId: row.entryId,
    };
    if (!row.assignee || !(await query.readable(document, row.part))) continue;
    items.push(waitingItem(row, row.assignee));
  }
  return { items, total };
}

function waitingItem(row: ReviewState, assignee: ReviewAssignee): WaitingPart {
  const workflow = workflowAttachedTo(row.scopeKind, row.scopeSlug)?.workflow;
  return {
    document: {
      scopeKind: row.scopeKind,
      scopeSlug: row.scopeSlug,
      entryId: row.entryId,
    },
    part: row.part,
    stage: row.stage,
    stageLabel: (workflow && stageOf(workflow, row.stage)?.label) ?? row.stage,
    assignee,
    enteredAt: row.enteredAt,
    dueAt: row.dueAt,
  };
}

/** One document of a move over several, with the parts it moves as the caller saw them. */
export interface ManyDocument {
  document: ReviewDocument;
  parts: readonly (string | null)[] | "all";
  seen: readonly SeenPart[];
}

/** A document a move over several refused, and why, as its own move would have said. */
export interface ManyRefusal {
  document: ReviewDocument;
  code: string;
  message: string;
}

/**
 * A step over several documents: each document moves in its own transaction through the one step
 * every door takes (`takeWorkflowStep`), so each is moved if it may be and each refusal is named
 * with its own reason. A document its caller may not read is refused as not found, asked before
 * anything else about it is looked at. A step of kind approve in the workflow of a document the
 * caller may read is refused for the whole request before anything moves: an approval is given
 * from the review of one document, for the version shown.
 *
 * @experimental
 */
export async function stepMany(
  adapter: DrizzleAdapter,
  input: {
    documents: readonly ManyDocument[];
    step: string;
    comment?: string | null;
    caller: WorkflowCaller;
    /** Whether the caller may read the document in each of the parts a move names. */
    readable: (
      document: ReviewDocument,
      parts: ManyDocument["parts"]
    ) => Promise<boolean>;
  }
): Promise<{
  moved: { document: ReviewDocument; result: TakeStepResult }[];
  refused: ManyRefusal[];
}> {
  // Each document's read asked first, before anything about it is looked at: a document its
  // caller may not read is refused as not found, and its workflow and steps are never inspected,
  // so no answer tells the caller how it is configured.
  const readable: boolean[] = [];
  for (const entry of input.documents) {
    readable.push(await input.readable(entry.document, entry.parts));
  }
  // Then refused whole, before any moves, where the step is an approval in the workflow of any
  // document the caller may read.
  for (const [index, { document }] of input.documents.entries()) {
    if (!readable[index]) continue;
    const registered = workflowAttachedTo(
      document.scopeKind,
      document.scopeSlug
    );
    const step = registered?.workflow.steps.find(
      candidate => candidate.name === input.step
    );
    if (step?.kind === "approve") {
      throw NextlyError.validation({
        errors: [
          {
            path: "step",
            code: REVIEW_API_ERROR_CODES.bulkApproval,
            message:
              "Approvals are given one document at a time, for the version the reviewer was shown.",
          },
        ],
      });
    }
  }
  const moved: { document: ReviewDocument; result: TakeStepResult }[] = [];
  const refused: ManyRefusal[] = [];
  for (const [index, entry] of input.documents.entries()) {
    const outcome = await oneOfMany(
      entry.document,
      () => Promise.resolve(readable[index] === true),
      () =>
        takeWorkflowStep(adapter, {
          document: entry.document,
          step: input.step,
          parts: entry.parts,
          seen: entry.seen,
          comment: input.comment,
          caller: input.caller,
        })
    );
    if ("refused" in outcome) refused.push(outcome.refused);
    else moved.push({ document: entry.document, result: outcome.result });
  }
  return { moved, refused };
}

/**
 * Assignments over several documents: each document's assignments are made in their own
 * transaction through the one assignment every door makes, so each is made if it may be and each
 * refusal is named with its own reason.
 *
 * @experimental
 */
export async function assignMany(
  adapter: DrizzleAdapter,
  input: {
    assignments: readonly Assignment[];
    caller: WorkflowCaller;
    /** Whether the caller may read the document in each of the parts its assignments name. */
    readable: (
      document: ReviewDocument,
      parts: readonly (string | null)[]
    ) => Promise<boolean>;
  }
): Promise<{ assigned: ReviewDocument[]; refused: ManyRefusal[] }> {
  const byDocument = new Map<string, Assignment[]>();
  for (const assignment of input.assignments) {
    const key = JSON.stringify([
      assignment.document.scopeKind,
      assignment.document.scopeSlug,
      assignment.document.entryId,
    ]);
    byDocument.set(key, [...(byDocument.get(key) ?? []), assignment]);
  }
  const assigned: ReviewDocument[] = [];
  const refused: ManyRefusal[] = [];
  for (const assignments of byDocument.values()) {
    const document = assignments[0].document;
    const outcome = await oneOfMany(
      document,
      () =>
        input.readable(
          document,
          assignments.map(assignment => assignment.part)
        ),
      () => assignWorkflowParts(adapter, { assignments, caller: input.caller })
    );
    if ("refused" in outcome) refused.push(outcome.refused);
    else assigned.push(document);
  }
  return { assigned, refused };
}

/**
 * One document of a move over several: refused as not found where the caller may not read it, so
 * a refusal never tells them it exists; otherwise moved, or refused with its own reason.
 */
async function oneOfMany<T>(
  document: ReviewDocument,
  readable: () => Promise<boolean>,
  move: () => Promise<T>
): Promise<{ result: T } | { refused: ManyRefusal }> {
  if (!(await readable())) {
    return {
      refused: { document, code: "NOT_FOUND", message: "Not found." },
    };
  }
  try {
    return { result: await move() };
  } catch (error) {
    if (!NextlyError.is(error)) throw error;
    return {
      refused: {
        document,
        code: error.code,
        message: error.publicMessage,
      },
    };
  }
}
