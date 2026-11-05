/**
 * Taking a workflow step, and assigning a part to a reviewer: the one place review state moves.
 *
 * Each call runs in ONE transaction of the adapter it is handed, and hands that transaction to
 * every repository it uses, so a move, its assignment and its event in the record of content
 * events commit or roll back together. Every precondition (the step and the part's stage, the
 * caller's permission, that the caller is a person where the step needs one, self-approval, the
 * comment) is checked before anything is written.
 *
 * Who the caller is, whether a built-in write (update, publish) is allowed on this document by the
 * collection's own gate (`entry-gate.ts`), and whether a person or role may be assigned, are read
 * before the transaction opens, through the auth resolution that answers them everywhere else
 * (`holders.ts`). That
 * resolution reads on the pool, and a read beside an open transaction would run on another
 * connection. Nothing it reads is review state, so reading it first changes no answer.
 *
 * The compare-and-set is on what the caller saw of each part (`seen`): its content version, the
 * `_rev` every read publishes, and its review-state `revision`. A step is refused as stale when
 * either moved. A step into a stage that allows publishing approves the part's newest recorded
 * version, the one the reviewer was shown, with a digest of that version's content
 * (`approvalDigest`), and each step's event names the version concerned.
 *
 * `"all"` parts are a translated collection's every configured language and its shared part, and
 * an untranslated collection's shared part alone: its content and versions belong to no language.
 *
 * Refusals, and what each carries in `publicData`:
 * - an unknown step, a document with no workflow, a missing or too long comment:
 *   `VALIDATION_ERROR`, with `errors` naming the field (`step`, `document`, `comment`) and a
 *   `WORKFLOW_*` code ({@link WORKFLOW_STEP_ERROR_CODES});
 * - a caller without the step's permission: `FORBIDDEN`, `{ reason: "no-permission", permission }`
 *   with the permission as stored (`approve-posts`);
 * - an API key or a trusted caller with no person taking a step of kind approve or
 *   request-changes: `FORBIDDEN` from `NextlyError.personOnly`;
 * - the person accountable for the part's stage approving it where the step refuses that:
 *   `FORBIDDEN`, `{ reason: "self-approval" }`;
 * - a step no named part can take from its stage, or, for `"all"`, that no part can take:
 *   `CONFLICT`, `{ reason: "not-from-stage", left }`;
 * - a part whose review state moved since the caller saw it: `CONFLICT`, `{ reason: "stale",
 *   parts }`, and nothing of the call is kept.
 *
 * @module domains/workflows/steps
 * @experimental
 */
import type { DrizzleAdapter } from "@nextlyhq/adapter-drizzle";
import type { TransactionContext } from "@nextlyhq/adapter-drizzle/types";
import { z } from "zod";

import { systemActor, type Actor } from "../../auth/access/actor";
import { decidePermission } from "../../auth/access/decide";
import {
  actorForKey,
  actorForScope,
  actorForUser,
} from "../../auth/access/resolve-actor";
import type { AuthenticatedScope } from "../../auth/authenticated-scope";
import { isUniqueViolation } from "../../database/errors";
import { NextlyError } from "../../errors";
import type { WorkflowRefusalPublicData } from "../../errors/public-data";
import { permissionSlug } from "../../schemas/_zod/rbac";
import type { ContentEventActor } from "../content-events/actor";
import {
  contentEventKind,
  registerContentEventKind,
  type ContentEventKind,
} from "../content-events/kinds";
import { recordContentEvent } from "../content-events/record";
import { configuredLocales } from "../i18n/configured-locales";
import { readDocumentRevision } from "../versions/stale-version";
import type { VersionRow } from "../versions/versions-repository";

import { approvalDigest } from "./approval-digest";
import { allowsSelfApproval, primaryStep } from "./define-workflow";
import { entryWriteAllowed, isEntryWrite } from "./entry-gate";
import { holderAnswer, readPerson, type HolderAnswer } from "./holders";
import {
  documentTableOf,
  partVersionOn,
  shownVersionOn,
} from "./part-versions";
import { workflowAttachedTo, type RegisteredWorkflow } from "./registry";
import {
  createReviewState,
  readReviewState,
  updateReviewState,
  type ReviewAssignee,
  type ReviewDocument,
  type ReviewPart,
  type ReviewState,
  type ReviewStateChange,
} from "./review-state-repository";
import type { ResolvedWorkflowStep, Workflow, WorkflowStepKind } from "./types";
import { readWorkflowSettings } from "./workflow-settings-repository";

/**
 * Who takes a step or assigns a part.
 *
 * - `user`: a signed-in person, whose roles and grants are read as the rest of Nextly reads them.
 * - `key`: an API key as authentication resolved it: its id, its maker, and its scope. Its act is
 *   recorded as the key's, with its maker (`userId`) as the person accountable for it.
 * - `system`: trusted server code acting as no person. It may take no step of kind approve or
 *   request-changes.
 *
 * @experimental
 */
export type WorkflowCaller =
  | { kind: "user"; userId: string }
  | { kind: "key"; keyId: string; userId: string; scope: AuthenticatedScope }
  | { kind: "system" };

/**
 * What the caller was shown of one part: its review-state `revision`, 0 for a part with no review
 * state yet (which reads as the workflow's first stage), and the content version it read.
 *
 * @experimental
 */
export interface SeenPart {
  /** A language, or null for the shared part. */
  part: string | null;
  revision: number;
  /**
   * The document's version (`_rev`) as the caller read it for this part: read in the part's
   * language, or for the shared part as a plain read answers it (the default language).
   */
  version: string;
}

/** @experimental */
export interface TakeStepInput {
  document: ReviewDocument;
  /** The step's name in the workflow attached to the document's collection or Single. */
  step: string;
  /**
   * The parts to move: languages, and null for the shared part. `"all"` is, for a collection that
   * keeps translations, every configured language and the shared part, and for one that does not,
   * the shared part alone; those whose stage the step does not leave from are named in the
   * result's `left`. A language named on its own is taken as named.
   */
  parts: readonly (string | null)[] | "all";
  /** Each part the step moves, as the caller saw it. A part the caller did not see is stale. */
  seen: readonly SeenPart[];
  /** Kept as the event's note. Required for request-changes and where the step says so. */
  comment?: string | null;
  caller: WorkflowCaller;
}

/** A part a step moved. @experimental */
export interface MovedPart {
  part: string | null;
  from: string;
  to: string;
  /** Its review-state revision after the move. */
  revision: number;
}

/** A part a step did not move, and the stage it stays in. @experimental */
export interface LeftPart {
  part: string | null;
  stage: string;
  reason: "not-from-stage";
}

/**
 * Why a person or role may not be assigned a part: they do not exist, the person is deactivated,
 * or they do not hold the stage's primary step.
 *
 * @experimental
 */
export const ASSIGNEE_REFUSAL_CODES = {
  notFound: "WORKFLOW_ASSIGNEE_NOT_FOUND",
  deactivated: "WORKFLOW_ASSIGNEE_DEACTIVATED",
  lacksStep: "WORKFLOW_ASSIGNEE_LACKS_STEP",
} as const;

/** @experimental */
export type AssigneeRefusalCode =
  (typeof ASSIGNEE_REFUSAL_CODES)[keyof typeof ASSIGNEE_REFUSAL_CODES];

/**
 * The validation codes a step's own input is refused with.
 *
 * @experimental
 */
export const WORKFLOW_STEP_ERROR_CODES = {
  notAttached: "WORKFLOW_NOT_ATTACHED",
  unknownStep: "WORKFLOW_UNKNOWN_STEP",
  commentRequired: "WORKFLOW_COMMENT_REQUIRED",
  commentTooLong: "WORKFLOW_COMMENT_TOO_LONG",
  nothingToApprove: "WORKFLOW_NOTHING_TO_APPROVE",
  singlesNotSupported: "WORKFLOW_SINGLES_NOT_SUPPORTED",
} as const;

/** The longest comment a step keeps: the record of content events' note limit. */
export const MAX_STEP_COMMENT_LENGTH = 4000;

/** @experimental */
export interface TakeStepResult {
  step: string;
  moved: MovedPart[];
  left: LeftPart[];
  /**
   * The stage's default reviewer, assigned to every moved part on entering it; null when the
   * stage has none or it was skipped.
   */
  reviewer: ReviewAssignee | null;
  /** The default reviewer skipped as ineligible, and why; also named in the event's payload. */
  skippedReviewer: {
    assignee: ReviewAssignee;
    reason: AssigneeRefusalCode;
  } | null;
}

/** One part to assign. @experimental */
export interface Assignment {
  document: ReviewDocument;
  part: string | null;
  /** The part's review-state revision as the caller saw it; 0 for none. */
  revision: number;
  /** Null clears the assignment. */
  assignee: ReviewAssignee | null;
  /** Null or absent leaves no due date. */
  dueAt?: Date | null;
}

/** @experimental */
export interface AssignInput {
  /** One or many parts, of one or many documents; all are assigned or none is. */
  assignments: readonly Assignment[];
  caller: WorkflowCaller;
}

/** @experimental */
export interface AssignResult {
  assigned: Array<{
    document: ReviewDocument;
    part: string | null;
    revision: number;
  }>;
}

/** A step's payload: its name, a key's owner, and a default reviewer it skipped. */
const stepPayload = z
  .object({
    step: z.string().min(1),
    ownerId: z.string().min(1).optional(),
    skippedReviewer: z
      .object({
        kind: z.enum(["user", "role"]),
        id: z.string().min(1),
        reason: z.string().min(1),
      })
      .strict()
      .optional(),
  })
  .strict();

/** An assignment's payload: who it went to, until when, and a key's owner. */
const assignPayload = z
  .object({
    assignee: z
      .object({ kind: z.enum(["user", "role"]), id: z.string().min(1) })
      .strict()
      .nullable(),
    dueAt: z.string().datetime().nullable(),
    ownerId: z.string().min(1).optional(),
  })
  .strict();

/**
 * The content event kinds workflows record: one per step kind, keyed by it, and one for an
 * assignment. Named with a `workflow-` prefix because kind names are shared by every producer.
 *
 * @experimental
 */
export const WORKFLOW_CONTENT_EVENT_KINDS = {
  submit: {
    name: "workflow-submit",
    label: "Submitted by {actor}",
    payload: stepPayload,
  },
  approve: {
    name: "workflow-approve",
    label: "Approved by {actor}",
    payload: stepPayload,
  },
  "request-changes": {
    name: "workflow-request-changes",
    label: "Changes requested by {actor}",
    payload: stepPayload,
  },
  move: {
    name: "workflow-move",
    label: "Moved by {actor}",
    payload: stepPayload,
  },
  assign: {
    name: "workflow-assign",
    label: "Assigned by {actor}",
    payload: assignPayload,
  },
} as const satisfies Record<WorkflowStepKind | "assign", ContentEventKind>;

/** Registers each workflow kind not registered yet; safe on every write. */
function ensureWorkflowContentEventKinds(): void {
  for (const kind of Object.values(WORKFLOW_CONTENT_EVENT_KINDS)) {
    if (!contentEventKind(kind.name)) registerContentEventKind(kind);
  }
}

/**
 * The content event kind a step of `kind`, or an assignment, is recorded as: `workflow-` and the
 * kind (`workflow-request-changes`, `workflow-assign`). Kind names are kebab-case, so the prefix
 * is joined with a hyphen.
 *
 * @experimental
 */
export function workflowEventKind(kind: WorkflowStepKind | "assign"): string {
  return WORKFLOW_CONTENT_EVENT_KINDS[kind].name;
}

/** Whether `stage` allows publishing. */
function allowsPublish(workflow: Workflow, stage: string): boolean {
  return workflow.stages.some(
    candidate => candidate.name === stage && candidate.allowsPublish
  );
}

/**
 * The action a step needs: the one it names, else `publish` into a stage that allows publishing,
 * else `update`. Kept as the action, since a permission's slug cannot be split back into its
 * action and resource (a resource may itself hold a hyphen).
 */
function stepAction(workflow: Workflow, step: ResolvedWorkflowStep): string {
  if (step.permission !== null) return step.permission;
  return allowsPublish(workflow, step.to) ? "publish" : "update";
}

/**
 * The permission, as stored, a caller needs to take `step` on the collection or Single `slug`:
 * the step's named action (`approve` → `approve-posts`); with none, `publish-<slug>` when the
 * step moves into a stage that allows publishing, and `update-<slug>` otherwise.
 *
 * @experimental
 */
export function stepPermission(
  workflow: Workflow,
  step: ResolvedWorkflowStep,
  slug: string
): string {
  return permissionSlug(stepAction(workflow, step), slug);
}

/**
 * Whether only a signed-in person may take `step`: a step of kind approve or request-changes,
 * whatever it is named.
 *
 * @experimental
 */
export function stepNeedsPerson(step: ResolvedWorkflowStep): boolean {
  return step.kind === "approve" || step.kind === "request-changes";
}

/** The action of `stage`'s primary step, or null for a stage with no step out of it. */
function primaryAction(workflow: Workflow, stage: string): string | null {
  const primary = primaryStep(workflow, stage);
  return primary ? stepAction(workflow, primary) : null;
}

/** The actions any one of which lets a caller assign in `stage`, each once. */
function assignerActions(workflow: Workflow, stage: string): string[] {
  const primary = primaryAction(workflow, stage);
  return [...new Set(primary === null ? ["update"] : ["update", primary])];
}

/**
 * The permission, as stored, a person or role must hold to be assigned a part in `stage`: that of
 * the stage's primary step. Null for a stage with no step out of it.
 *
 * @experimental
 */
export function assigneePermission(
  workflow: Workflow,
  stage: string,
  slug: string
): string | null {
  const action = primaryAction(workflow, stage);
  return action === null ? null : permissionSlug(action, slug);
}

/**
 * The permissions, as stored, any one of which lets a caller assign a part in `stage`:
 * `update-<slug>`, and the permission of the stage's primary step where it is another.
 *
 * @experimental
 */
export function assignerPermissions(
  workflow: Workflow,
  stage: string,
  slug: string
): string[] {
  return assignerActions(workflow, stage).map(action =>
    permissionSlug(action, slug)
  );
}

/** The caller as the decision, the accountable person and the record each need them. */
interface ResolvedCaller {
  actor: Actor;
  /** Whom the act counts as: the person, a key's owner, or nobody for trusted code. */
  accountable: string | null;
  event: ContentEventActor;
  /** A key's owner, named in the event's payload. */
  ownerId: string | null;
}

async function resolveCaller(
  adapter: DrizzleAdapter,
  caller: WorkflowCaller
): Promise<ResolvedCaller> {
  switch (caller.kind) {
    case "user": {
      const [actor, person] = await Promise.all([
        actorForUser(caller.userId),
        readPerson(adapter, caller.userId),
      ]);
      return {
        actor,
        accountable: caller.userId,
        event: {
          kind: "person",
          id: caller.userId,
          name: person?.name ?? null,
        },
        ownerId: null,
      };
    }
    case "key": {
      // A key whose id is not known could not be named in the record.
      if (caller.keyId === "") {
        throw NextlyError.internal({
          logContext: { reason: "workflow-step-key-without-id" },
        });
      }
      // The key's actor as a gate builds it from the scope, named with the key's id.
      const scoped = actorForScope(caller.scope, { id: caller.userId });
      return {
        actor: actorForKey({
          keyId: caller.keyId,
          userId: caller.userId,
          grants: scoped.permissions,
          roles: scoped.roles,
          superAdmin: scoped.superAdmin,
        }),
        accountable: caller.userId,
        event: { kind: "apiKey", id: caller.keyId, name: null },
        ownerId: caller.userId,
      };
    }
    case "system":
      return {
        actor: systemActor(),
        accountable: null,
        event: { kind: "system" },
        ownerId: null,
      };
  }
}

/** The workflow attached to the document's collection or Single, or a refusal. */
function attachedWorkflow(document: ReviewDocument): RegisteredWorkflow {
  const registered = workflowAttachedTo(document.scopeKind, document.scopeSlug);
  if (!registered) {
    throw NextlyError.validation({
      errors: [
        {
          path: "document",
          code: WORKFLOW_STEP_ERROR_CODES.notAttached,
          message: `No workflow is attached to the ${document.scopeKind} "${document.scopeSlug}".`,
        },
      ],
    });
  }
  return registered;
}

const ASSIGNEE_CODE_OF: Record<
  Exclude<HolderAnswer, "holds">,
  AssigneeRefusalCode
> = {
  lacks: ASSIGNEE_REFUSAL_CODES.lacksStep,
  "not-found": ASSIGNEE_REFUSAL_CODES.notFound,
  deactivated: ASSIGNEE_REFUSAL_CODES.deactivated,
};

/** Why `assignee` may not be given work needing `action` on `slug`, or null when they may. */
async function assigneeRefusal(
  adapter: DrizzleAdapter,
  assignee: ReviewAssignee,
  action: string | null,
  slug: string
): Promise<AssigneeRefusalCode | null> {
  // A stage with no step out of it has no work to assign.
  if (action === null) return ASSIGNEE_REFUSAL_CODES.lacksStep;
  const answer = await holderAnswer(adapter, assignee, action, slug);
  return answer === "holds" ? null : ASSIGNEE_CODE_OF[answer];
}

/** The default reviewer of the stage a step enters, judged before the transaction opens. */
async function defaultReviewer(
  adapter: DrizzleAdapter,
  registered: RegisteredWorkflow,
  step: ResolvedWorkflowStep,
  slug: string
): Promise<Pick<TakeStepResult, "reviewer" | "skippedReviewer">> {
  const stored = await readWorkflowSettings(adapter, registered.workflow.slug);
  const assignee = stored?.settings.defaultReviewers?.[step.to];
  if (!assignee) return { reviewer: null, skippedReviewer: null };
  const refusal = await assigneeRefusal(
    adapter,
    assignee,
    primaryAction(registered.workflow, step.to),
    slug
  );
  // An ineligible default reviewer is skipped, not a reason to refuse the step.
  return refusal === null
    ? { reviewer: assignee, skippedReviewer: null }
    : { reviewer: null, skippedReviewer: { assignee, reason: refusal } };
}

/**
 * The parts a step names: each once. For `"all"`, every configured language and the shared part
 * of a collection that keeps translations; the shared part alone of one that does not, whose
 * content and versions belong to no language.
 */
function namedParts(
  parts: TakeStepInput["parts"],
  localized: boolean
): (string | null)[] {
  if (parts !== "all") return [...new Set(parts)];
  if (!localized) return [null];
  return [...(configuredLocales() ?? []), null];
}

const partOf = (document: ReviewDocument, part: string | null): ReviewPart => ({
  ...document,
  part,
});

const seenRevision = (
  seen: readonly SeenPart[],
  part: string | null
): number | undefined => seen.find(entry => entry.part === part)?.revision;

function staleRefusal(parts: (string | null)[]): NextlyError {
  const data: WorkflowRefusalPublicData = { reason: "stale", parts };
  return NextlyError.conflict({
    reason: "state",
    data,
    logContext: { refusal: "workflow-stale", parts },
  });
}

function notFromStageRefusal(left: LeftPart[]): NextlyError {
  return NextlyError.conflict({
    message: "This step can't be taken from the stage this content is in.",
    data: { reason: "not-from-stage", left },
    logContext: { refusal: "workflow-not-from-stage" },
  });
}

/** Refuses a comment the step requires and was not given, or one too long to keep. */
function checkComment(
  step: ResolvedWorkflowStep,
  comment: string | null
): void {
  if (step.commentRequired && (comment === null || comment.trim() === "")) {
    throw NextlyError.validation({
      errors: [
        {
          path: "comment",
          code: WORKFLOW_STEP_ERROR_CODES.commentRequired,
          message: `"${step.label}" needs a comment saying why.`,
        },
      ],
    });
  }
  if (comment !== null && comment.length > MAX_STEP_COMMENT_LENGTH) {
    throw NextlyError.validation({
      errors: [
        {
          path: "comment",
          code: WORKFLOW_STEP_ERROR_CODES.commentTooLong,
          message: `A comment may be at most ${MAX_STEP_COMMENT_LENGTH} characters.`,
        },
      ],
    });
  }
}

/**
 * Writes `change` to a part over the revision the caller saw, on `tx`: a first state where the
 * caller saw none, else the compare-and-set. Answers the new revision, or null when the part moved
 * since it was seen, having written nothing.
 */
async function writeOverSeen(
  tx: TransactionContext,
  dialect: Parameters<typeof isUniqueViolation>[0],
  part: ReviewPart,
  current: ReviewState | null,
  seen: number | undefined,
  first: Pick<ReviewState, "stage" | "enteredAt" | "definitionHash">,
  change: ReviewStateChange
): Promise<number | null> {
  if (seen === undefined) return null;
  if (seen === 0) {
    // Not attempted over an existing row: on PostgreSQL a refused insert ends the transaction.
    if (current) return null;
    try {
      await createReviewState(tx, part, { ...first, ...change });
    } catch (error) {
      // Someone gave the part its first state since it was read: the same race as a moved one.
      if (isUniqueViolation(dialect, error)) throw staleRefusal([part.part]);
      throw error;
    }
    return 1;
  }
  return (await updateReviewState(tx, part, seen, change)) ? seen + 1 : null;
}

/**
 * Takes `input.step` on the named parts of a document, in one transaction of `adapter`: checks
 * every precondition, moves each part over the revision it was seen at, assigns the entered
 * stage's default reviewer where eligible, and records one `workflow-<step kind>` event per stage
 * the parts left, with the parts, from and to, the actor, the comment as its note and the
 * definition hash. Refused as the module describes, keeping nothing.
 *
 * The event's payload carries `step` (the step's name); for a key, `ownerId` (the key's maker);
 * and, where the stage's default reviewer was skipped, `skippedReviewer: { kind, id, reason }`.
 * A part moved records the caller as `enteredBy`, a key's owner for a key. A part leaving a
 * stage that allows publishing loses its approval.
 *
 * @experimental
 */
export async function takeWorkflowStep(
  adapter: DrizzleAdapter,
  input: TakeStepInput
): Promise<TakeStepResult> {
  const registered = attachedWorkflow(input.document);
  const { workflow, definitionHash } = registered;
  const step = workflow.steps.find(candidate => candidate.name === input.step);
  if (!step) {
    throw NextlyError.validation({
      errors: [
        {
          path: "step",
          code: WORKFLOW_STEP_ERROR_CODES.unknownStep,
          message: `"${input.step}" is not a step of the workflow "${workflow.slug}".`,
        },
      ],
    });
  }
  const slug = input.document.scopeSlug;
  const comment = input.comment ?? null;
  const caller = await resolveCaller(adapter, input.caller);
  const reviewer = await defaultReviewer(adapter, registered, step, slug);
  const dialect = adapter.getCapabilities().dialect;
  const table = await documentTableOf(input.document);
  // A built-in write (update, publish) is judged by the collection's own gate for this document,
  // rule and filter included, as the write itself would be; a workflow's own action has no
  // collection rule, so its permission answers. The gate reads on the pool, so it is asked here and
  // its answer applied in its place below.
  const action = stepAction(workflow, step);
  const permitted = isEntryWrite(action)
    ? await entryWriteAllowed(input.document, action, input.caller)
    : decidePermission(caller.actor, action, slug).allowed;
  ensureWorkflowContentEventKinds();

  return adapter.transaction(async tx => {
    // 0. The document's own row, locked before anything is read. Every save takes this lock before
    // it writes, so a save in flight is waited for, and the version read below is the one it
    // committed rather than the one it is replacing.
    await readDocumentRevision(tx, {
      dialect,
      table: table.table,
      id: input.document.entryId,
      forUpdate: true,
    });

    // 1. Each part's stage, read on the transaction; a part with no state is in the first stage.
    const parts: Array<{
      part: string | null;
      state: ReviewState | null;
      stage: string;
    }> = [];
    for (const part of namedParts(input.parts, table.localized)) {
      const state = await readReviewState(tx, partOf(input.document, part));
      parts.push({ part, state, stage: state?.stage ?? workflow.firstStage });
    }
    const movable = parts.filter(entry => step.from.includes(entry.stage));
    const left: LeftPart[] = parts
      .filter(entry => !step.from.includes(entry.stage))
      .map(entry => ({
        part: entry.part,
        stage: entry.stage,
        reason: "not-from-stage" as const,
      }));
    if (input.parts !== "all" && left.length > 0) {
      // A part the caller saw at another revision was judged from a stage it has since left, so
      // what is wrong is the caller's view, not the step.
      const moved = parts.filter(entry => {
        const seen = seenRevision(input.seen, entry.part);
        return (
          !step.from.includes(entry.stage) &&
          seen !== undefined &&
          seen !== (entry.state?.revision ?? 0)
        );
      });
      if (moved.length > 0) throw staleRefusal(moved.map(entry => entry.part));
      throw notFromStageRefusal(left);
    }
    if (movable.length === 0) throw notFromStageRefusal(left);

    // 2. The step's permission.
    if (!permitted) {
      throw NextlyError.forbidden({
        publicData: {
          reason: "no-permission",
          permission: permissionSlug(action, slug),
        },
        logContext: { refusal: "workflow-step-permission", step: step.name },
      });
    }

    // 3. Approvals and requests for changes come only from a signed-in person.
    if (stepNeedsPerson(step) && input.caller.kind !== "user") {
      throw NextlyError.personOnly({
        doing: "approve or request changes",
        logContext: { refusal: "workflow-person-only", step: step.name },
      });
    }

    // 4. The person accountable for a part's stage may not take a step that refuses it.
    if (
      !allowsSelfApproval(step) &&
      caller.accountable !== null &&
      movable.some(entry => entry.state?.enteredBy === caller.accountable)
    ) {
      throw NextlyError.forbidden({
        publicData: { reason: "self-approval" },
        logContext: { refusal: "workflow-self-approval", step: step.name },
      });
    }

    // 5. The comment.
    checkComment(step, comment);

    // 6. Each part's newest recorded version: what a reviewer is shown of it, and what a step
    // into a stage that allows publishing approves. A part with none has nothing to approve.
    const recorded = new Map<string | null, VersionRow | undefined>();
    for (const entry of movable) {
      recorded.set(
        entry.part,
        await shownVersionOn(tx, input.document, entry.part)
      );
    }
    const approves = allowsPublish(workflow, step.to);
    const unrecorded = movable.filter(entry => !recorded.get(entry.part));
    if (approves && unrecorded.length > 0) {
      throw NextlyError.validation({
        errors: unrecorded.map(entry => ({
          path: "parts",
          code: WORKFLOW_STEP_ERROR_CODES.nothingToApprove,
          message: `${entry.part === null ? "The shared part" : `"${entry.part}"`} has no saved version to approve.`,
        })),
      });
    }

    // 7. The move, over what each part was seen at: its content version and its review-state
    // revision. Every part is tried, so a refusal names all that moved; any refusal rolls back
    // the parts already written.
    const now = new Date();
    const stale: (string | null)[] = [];
    const moved: MovedPart[] = [];
    for (const entry of movable) {
      const seen = input.seen.find(candidate => candidate.part === entry.part);
      const version = await partVersionOn(
        tx,
        dialect,
        table,
        input.document.entryId,
        entry.part
      );
      // The content changed since the caller was shown it, or the caller never saw this part.
      if (
        seen === undefined ||
        version === undefined ||
        version !== seen.version
      ) {
        stale.push(entry.part);
        continue;
      }
      const shown = recorded.get(entry.part);
      const change: ReviewStateChange = {
        stage: step.to,
        enteredAt: now,
        definitionHash,
        // A move by trusted code keeps the accountable person the part had.
        ...(caller.accountable !== null
          ? { enteredBy: caller.accountable }
          : {}),
        // Leaving a stage that allows publishing withdraws the approval it held.
        ...(allowsPublish(workflow, entry.stage) ? { approval: null } : {}),
        // Entering one approves the version shown, by a person (approvals come from no one else).
        ...(approves && shown?.versionNo != null && caller.accountable !== null
          ? {
              approval: {
                versionNo: shown.versionNo,
                digest: approvalDigest(shown.snapshot, "collection"),
                by: caller.accountable,
                at: now,
              },
            }
          : {}),
        ...(reviewer.reviewer ? { assignee: reviewer.reviewer } : {}),
      };
      const revision = await writeOverSeen(
        tx,
        dialect,
        partOf(input.document, entry.part),
        entry.state,
        seen.revision,
        { stage: step.to, enteredAt: now, definitionHash },
        change
      );
      if (revision === null) stale.push(entry.part);
      else
        moved.push({
          part: entry.part,
          from: entry.stage,
          to: step.to,
          revision,
        });
    }
    if (stale.length > 0) throw staleRefusal(stale);

    // 8. One event per stage the parts left, on the same transaction, naming the newest version
    // of the parts it moved.
    const skipped = reviewer.skippedReviewer;
    for (const from of [...new Set(moved.map(entry => entry.from))]) {
      const group = moved.filter(entry => entry.from === from);
      const versionNos = group.flatMap(entry => {
        const no = recorded.get(entry.part)?.versionNo;
        return typeof no === "number" ? [no] : [];
      });
      await recordContentEvent(tx, {
        subject: {
          kind: input.document.scopeKind,
          slug,
          id: input.document.entryId,
        },
        parts: {
          locales: group.flatMap(entry =>
            entry.part === null ? [] : [entry.part]
          ),
          shared: group.some(entry => entry.part === null),
        },
        kind: workflowEventKind(step.kind),
        actor: caller.event,
        fromState: from,
        toState: step.to,
        note: comment !== null && comment.trim() !== "" ? comment : null,
        versionNo: versionNos.length > 0 ? Math.max(...versionNos) : null,
        payload: {
          step: step.name,
          ...(caller.ownerId !== null ? { ownerId: caller.ownerId } : {}),
          ...(skipped
            ? {
                skippedReviewer: {
                  kind: skipped.assignee.kind,
                  id: skipped.assignee.id,
                  reason: skipped.reason,
                },
              }
            : {}),
        },
        definitionHash,
      });
    }

    return { step: step.name, moved, left, ...reviewer };
  });
}

/**
 * Assigns each part to a person or a role, with an optional due date, in one transaction of
 * `adapter`, over the revision each was seen at, and records a `workflow-assign` event per part.
 *
 * The caller needs, for each part, the collection's or Single's `update-<slug>` or the permission
 * of the primary step of the part's stage; else `FORBIDDEN`, `{ reason: "no-permission",
 * refused: [{ index, anyOf }] }`. Each assignee must hold that primary step: a person through
 * their roles in force, never when deactivated; a role through its own grants, the roles it
 * inherits, or super-admin. Else `VALIDATION_ERROR`, one error per refused assignment
 * (`assignments[<i>].assignee`, an {@link ASSIGNEE_REFUSAL_CODES} code). Nothing is assigned
 * unless everything is; a stale revision is `CONFLICT`, `{ reason: "stale" }`.
 *
 * @experimental
 */
export async function assignWorkflowParts(
  adapter: DrizzleAdapter,
  input: AssignInput
): Promise<AssignResult> {
  const caller = await resolveCaller(adapter, input.caller);
  const entries = input.assignments.map(assignment => ({
    assignment,
    registered: attachedWorkflow(assignment.document),
  }));
  // Whether each assignee may be given work in each stage, answered before the transaction opens:
  // which stage a part is in is read inside it.
  const eligibility = new Map<string, AssigneeRefusalCode | null>();
  const eligibilityKey = (
    assignee: ReviewAssignee,
    action: string | null,
    slug: string
  ) => JSON.stringify([assignee.kind, assignee.id, action, slug]);
  for (const { assignment, registered } of entries) {
    const { assignee } = assignment;
    if (!assignee) continue;
    const slug = assignment.document.scopeSlug;
    for (const stage of registered.workflow.stages) {
      const action = primaryAction(registered.workflow, stage.name);
      const key = eligibilityKey(assignee, action, slug);
      if (!eligibility.has(key)) {
        eligibility.set(
          key,
          await assigneeRefusal(adapter, assignee, action, slug)
        );
      }
    }
  }
  // Whether the caller may make each built-in write an assigner may hold, for each document, asked
  // of the collection's own gate before the transaction opens, as a step asks it.
  const gated = new Map<string, boolean>();
  const gatedKey = (index: number, action: string) =>
    JSON.stringify([index, action]);
  for (const [index, { assignment, registered }] of entries.entries()) {
    const actions = new Set(
      registered.workflow.stages.flatMap(stage =>
        assignerActions(registered.workflow, stage.name)
      )
    );
    for (const action of actions) {
      if (isEntryWrite(action)) {
        gated.set(
          gatedKey(index, action),
          await entryWriteAllowed(assignment.document, action, input.caller)
        );
      }
    }
  }
  const dialect = adapter.getCapabilities().dialect;
  ensureWorkflowContentEventKinds();

  return adapter.transaction(async tx => {
    const read: Array<{ state: ReviewState | null; stage: string }> = [];
    for (const { assignment, registered } of entries) {
      const state = await readReviewState(
        tx,
        partOf(assignment.document, assignment.part)
      );
      read.push({
        state,
        stage: state?.stage ?? registered.workflow.firstStage,
      });
    }

    // Who may assign: the right to edit, or the primary step of the part's stage.
    const refused: Array<{ index: number; anyOf: string[] }> = [];
    entries.forEach(({ assignment, registered }, index) => {
      const slug = assignment.document.scopeSlug;
      const stage = read[index]?.stage ?? registered.workflow.firstStage;
      const anyOf = assignerActions(registered.workflow, stage);
      const may = (action: string) =>
        isEntryWrite(action)
          ? gated.get(gatedKey(index, action)) === true
          : decidePermission(caller.actor, action, slug).allowed;
      if (!anyOf.some(may)) {
        refused.push({
          index,
          anyOf: anyOf.map(action => permissionSlug(action, slug)),
        });
      }
    });
    if (refused.length > 0) {
      throw NextlyError.forbidden({
        publicData: { reason: "no-permission", refused },
        logContext: { refusal: "workflow-assign-permission" },
      });
    }

    // Who may be assigned: whoever holds the primary step of the part's stage.
    const errors: Array<{ path: string; code: string; message: string }> = [];
    entries.forEach(({ assignment, registered }, index) => {
      const { assignee } = assignment;
      if (!assignee) return;
      const slug = assignment.document.scopeSlug;
      const stage = read[index]?.stage ?? registered.workflow.firstStage;
      const code = eligibility.get(
        eligibilityKey(
          assignee,
          primaryAction(registered.workflow, stage),
          slug
        )
      );
      if (code) {
        errors.push({
          path: `assignments[${index}].assignee`,
          code,
          message: `The ${assignee.kind} "${assignee.id}" cannot be assigned work in "${stage}".`,
        });
      }
    });
    if (errors.length > 0) throw NextlyError.validation({ errors });

    const now = new Date();
    const stale: (string | null)[] = [];
    const assigned: AssignResult["assigned"] = [];
    for (const [index, { assignment, registered }] of entries.entries()) {
      const revision = await writeOverSeen(
        tx,
        dialect,
        partOf(assignment.document, assignment.part),
        read[index]?.state ?? null,
        assignment.revision,
        {
          stage: registered.workflow.firstStage,
          enteredAt: now,
          definitionHash: registered.definitionHash,
        },
        { assignee: assignment.assignee, dueAt: assignment.dueAt ?? null }
      );
      if (revision === null) stale.push(assignment.part);
      else {
        assigned.push({
          document: assignment.document,
          part: assignment.part,
          revision,
        });
      }
    }
    if (stale.length > 0) throw staleRefusal(stale);

    for (const { assignment, registered } of entries) {
      await recordContentEvent(tx, {
        subject: {
          kind: assignment.document.scopeKind,
          slug: assignment.document.scopeSlug,
          id: assignment.document.entryId,
        },
        parts:
          assignment.part === null
            ? { shared: true }
            : { locales: [assignment.part] },
        kind: workflowEventKind("assign"),
        actor: caller.event,
        payload: {
          assignee: assignment.assignee,
          dueAt: assignment.dueAt ? assignment.dueAt.toISOString() : null,
          ...(caller.ownerId !== null ? { ownerId: caller.ownerId } : {}),
        },
        definitionHash: registered.definitionHash,
      });
    }

    return { assigned };
  });
}
