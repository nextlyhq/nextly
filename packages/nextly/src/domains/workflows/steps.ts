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
 *   `WORKFLOW_*` code;
 * - a caller without the step's permission: `FORBIDDEN`, `{ reason: "no-permission", permission }`
 *   with the permission as stored (`approve-posts`);
 * - an API key or a trusted caller with no person taking a step of kind approve or
 *   request-changes: `FORBIDDEN` from `NextlyError.personOnly`;
 * - the person accountable for the part's stage approving it where the step refuses that:
 *   `FORBIDDEN`, `{ reason: "self-approval" }`;
 * - a step no named part can take from its stage, or, for `"all"`, that no part can take:
 *   `CONFLICT`, `{ reason: "not-from-stage", left }`;
 * - a part whose review state moved since the caller saw it: `CONFLICT`, `{ reason: "stale",
 *   parts }`, and nothing of the call is kept;
 * - an approval covering a field that changed since the part was last approved (else since it
 *   was last published) and that a field-level read rule hides from the reviewer: `FORBIDDEN`,
 *   `{ reason: "field-hidden", fields, approvers }`, the approvers being the people who hold the
 *   step and could read every such field.
 *
 * @module domains/workflows/steps
 * @experimental
 */
import type { DrizzleAdapter } from "@nextlyhq/adapter-drizzle";
import type {
  SupportedDialect,
  TransactionContext,
} from "@nextlyhq/adapter-drizzle/types";
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
import {
  resolvedCallerGrants,
  type CallerGrants,
} from "../../shared/lib/field-level-registry";
import type { UserContext } from "../collections/services/collection-types";
import type { ContentEventActor } from "../content-events/actor";
import {
  contentEventKind,
  registerContentEventKind,
  type ContentEventKind,
} from "../content-events/kinds";
import { recordContentEvent } from "../content-events/record";
import type { LiveFieldGroupReadPass } from "../field-groups/live-read-access";
import { configuredLocales } from "../i18n/configured-locales";
import { readDocumentRevision } from "../versions/stale-version";
import {
  VersionsRepository,
  type VersionRow,
} from "../versions/versions-repository";

import { approvalDigest } from "./approval-digest";
import {
  allowsSelfApproval,
  entersReview,
  primaryStep,
} from "./define-workflow";
import { entryWriteAllowed, isEntryWrite } from "./entry-gate";
import {
  changedFields,
  hiddenFrom,
  possibleApprovers,
  readerOf,
} from "./hidden-changes";
import { holderAnswer, readPerson, type HolderAnswer } from "./holders";
import { livePartsOf, partStage, pendingPartsOn } from "./implicit-stage";
import {
  documentTableOf,
  fieldGroupReadPassOf,
  partVersionOn,
  shownContentOn,
  type DocumentTable,
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
import { recordStageChanged, webhookActorOfEvent } from "./stage-changed";
// Shared with the request for changes' notice, which keeps the comment the step accepted.
import { MAX_STEP_COMMENT_LENGTH } from "./step-comment";
import type { ResolvedWorkflowStep, Workflow, WorkflowStepKind } from "./types";
import {
  prepareNoticeTelling,
  tellNamedPeople,
  type NamedNotice,
  type NoticeTelling,
} from "./workflow-notice-recording";
import {
  approvedSlot,
  enteredReviewSlot,
  pinPart,
  workflowPins,
} from "./workflow-pins";
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
 */
const ASSIGNEE_REFUSAL_CODES = {
  notFound: "WORKFLOW_ASSIGNEE_NOT_FOUND",
  deactivated: "WORKFLOW_ASSIGNEE_DEACTIVATED",
  lacksStep: "WORKFLOW_ASSIGNEE_LACKS_STEP",
} as const;

/** @experimental */
export type AssigneeRefusalCode =
  (typeof ASSIGNEE_REFUSAL_CODES)[keyof typeof ASSIGNEE_REFUSAL_CODES];

/**
 * The validation codes a step's own input is refused with.
 */
const WORKFLOW_STEP_ERROR_CODES = {
  notAttached: "WORKFLOW_NOT_ATTACHED",
  unknownStep: "WORKFLOW_UNKNOWN_STEP",
  commentRequired: "WORKFLOW_COMMENT_REQUIRED",
  commentTooLong: "WORKFLOW_COMMENT_TOO_LONG",
  nothingToApprove: "WORKFLOW_NOTHING_TO_APPROVE",
  // A part with nothing unpublished: published content stays live, with no review to open.
  nothingToReview: "WORKFLOW_NOTHING_TO_REVIEW",
  singlesNotSupported: "WORKFLOW_SINGLES_NOT_SUPPORTED",
} as const;

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
 */
const WORKFLOW_CONTENT_EVENT_KINDS = {
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

/** What a step reads before its transaction opens, and carries into it. */
interface StepContext {
  input: TakeStepInput;
  workflow: Workflow;
  definitionHash: string;
  step: ResolvedWorkflowStep;
  slug: string;
  comment: string | null;
  caller: ResolvedCaller;
  reviewer: Pick<TakeStepResult, "reviewer" | "skippedReviewer">;
  dialect: SupportedDialect;
  table: DocumentTable;
  action: string;
  /** Whether the caller may take the step's action on a part, as decided before the transaction. */
  allowedOn: (part: string | null) => boolean;
  /** Whether each named part is live, read before the transaction: where a part stands without review state. */
  liveOn: ReadonlyMap<string | null, boolean>;
  /** Whether the step enters a stage that allows publishing, which approves what it moves. */
  approves: boolean;
  /**
   * The person approving, with their grants resolved before the transaction opens, so judging
   * which fields they can read reads nothing beside it. Null for any step that approves nothing,
   * and for a caller that is no person (refused as such inside).
   */
  approver: StepApprover | null;
  /** What telling the people the step names needs from the pool; null where no one can be told. */
  telling: NoticeTelling | null;
  /**
   * The field-group read pass a read of the collection makes, built before the transaction, for
   * judging what an approval covers; undefined for a step that approves nothing, or where no field
   * group declares a read rule.
   */
  fieldGroupPass: LiveFieldGroupReadPass | undefined;
}

/** A person approving, as the hidden-field check reads them. */
interface StepApprover {
  id: string;
  name: string | null;
  /** The person as a document read hands them to access rules (`readerOf`). */
  user: UserContext;
  grants: () => Promise<CallerGrants>;
}

/** What a step's transaction answers: the step taken, or an approval refused for hidden fields. */
type StepOutcome = { taken: TakeStepResult } | { hidden: HiddenRefusal };

/** The changed fields an approval would cover that the reviewer cannot read, and what decides who could. */
interface HiddenRefusal {
  fields: string[];
  parts: Array<{ part: string | null; shown: unknown; changed: string[] }>;
  excluded: string[];
}

/**
 * A part as a step reads it on its transaction: its review state, and the stage that gives (null
 * for a part with nothing unpublished, which has none).
 */
interface PartRead {
  part: string | null;
  state: ReviewState | null;
  stage: string | null;
}

/** A part a step can judge: one in a stage. */
interface ReadPart extends PartRead {
  stage: string;
}

/** The step named `name` of `workflow`, or a refusal naming it. */
function findStep(workflow: Workflow, name: string): ResolvedWorkflowStep {
  const step = workflow.steps.find(candidate => candidate.name === name);
  if (!step) {
    throw NextlyError.validation({
      errors: [
        {
          path: "step",
          code: WORKFLOW_STEP_ERROR_CODES.unknownStep,
          message: `"${name}" is not a step of the workflow "${workflow.slug}".`,
        },
      ],
    });
  }
  return step;
}

/**
 * Whether the caller may take `action` on each of `parts`, decided before the transaction opens.
 * A built-in write (update, publish) is judged by the collection's own gate for this document,
 * rule and filter included, and in each language part's own language, as the write itself would
 * be (`entry-gate.ts`); it reads on the pool, so it is asked here and applied in its place inside.
 * A workflow's own action has no collection rule, so its permission answers for every part.
 */
async function partsAllowed(
  input: TakeStepInput,
  parts: readonly (string | null)[],
  action: string,
  caller: ResolvedCaller,
  slug: string
): Promise<(part: string | null) => boolean> {
  if (!isEntryWrite(action)) {
    const allowed = decidePermission(caller.actor, action, slug).allowed;
    return () => allowed;
  }
  const answers = new Map<string | null, boolean>();
  for (const part of parts) {
    answers.set(
      part,
      await entryWriteAllowed(input.document, part, action, input.caller)
    );
  }
  return part => answers.get(part) === true;
}

/** Everything a step reads on the pool, before its transaction opens. */
async function prepareStep(
  adapter: DrizzleAdapter,
  input: TakeStepInput,
  registered: RegisteredWorkflow,
  step: ResolvedWorkflowStep
): Promise<StepContext> {
  const { workflow, definitionHash } = registered;
  const slug = input.document.scopeSlug;
  const caller = await resolveCaller(adapter, input.caller);
  const reviewer = await defaultReviewer(adapter, registered, step, slug);
  const table = await documentTableOf(input.document);
  const action = stepAction(workflow, step);
  const parts = namedParts(input.parts, table.localized);
  return {
    input,
    workflow,
    definitionHash,
    step,
    slug,
    comment: input.comment ?? null,
    caller,
    reviewer,
    dialect: adapter.getCapabilities().dialect,
    table,
    action,
    allowedOn: await partsAllowed(input, parts, action, caller, slug),
    liveOn: await livePartsOf(adapter, input.document, parts),
    approves: allowsPublish(workflow, step.to),
    approver: await approverOf(
      adapter,
      input,
      caller,
      allowsPublish(workflow, step.to)
    ),
    fieldGroupPass: allowsPublish(workflow, step.to)
      ? await fieldGroupReadPassOf(table)
      : undefined,
    telling: await prepareNoticeTelling(
      adapter,
      [{ workflow: workflow.slug, slug }],
      caller
    ),
  };
}

/** The person approving, with their grants resolved, or null where the step approves nothing. */
async function approverOf(
  adapter: DrizzleAdapter,
  input: TakeStepInput,
  caller: ResolvedCaller,
  approves: boolean
): Promise<StepApprover | null> {
  if (!approves || input.caller.kind !== "user") return null;
  const user = await readerOf(adapter, input.caller.userId);
  // A person the canonical resolver cannot act as (gone, or deactivated) approves nothing:
  // judging them by a thinner copy of who they are could read fields a real read withholds.
  if (user === null) {
    throw NextlyError.forbidden({
      logContext: { refusal: "workflow-approver-unresolvable" },
    });
  }
  return {
    id: input.caller.userId,
    name: caller.event.kind === "person" ? caller.event.name : null,
    user,
    grants: await resolvedCallerGrants(user),
  };
}

/**
 * The document's own row, locked before anything is read. Every save takes this lock before it
 * writes, so a save in flight is waited for, and the version a step reads after it is the one it
 * committed rather than the one it is replacing.
 */
async function lockDocument(
  tx: TransactionContext,
  c: StepContext
): Promise<void> {
  await readDocumentRevision(tx, {
    dialect: c.dialect,
    table: c.table.table,
    id: c.input.document.entryId,
    forUpdate: true,
  });
}

/**
 * Each named part's review state, read on the transaction, and the stage it puts the part in; a
 * part with none stands where its content puts it (`partStage`).
 */
async function readParts(
  tx: TransactionContext,
  c: StepContext
): Promise<PartRead[]> {
  const pending = await pendingPartsOn(tx, c.input.document);
  const parts: PartRead[] = [];
  for (const part of namedParts(c.input.parts, c.table.localized)) {
    const state = await readReviewState(tx, partOf(c.input.document, part));
    const content = {
      live: c.liveOn.get(part) === true,
      pending: pending(part),
    };
    parts.push({ part, state, stage: partStage(c.workflow, state, content) });
  }
  return parts;
}

/** The refusal of a step or an assignment on parts with nothing unpublished to review. */
function nothingToReviewRefusal(
  parts: readonly (string | null)[],
  path: (index: number) => string
): NextlyError {
  return NextlyError.validation({
    errors: parts.map((part, index) => ({
      path: path(index),
      code: WORKFLOW_STEP_ERROR_CODES.nothingToReview,
      message: `${partName(part)} has nothing unpublished to review.`,
    })),
  });
}

/** Whether a part read is in a stage. */
const staged = (entry: PartRead): entry is ReadPart => entry.stage !== null;

/**
 * The parts in a stage. A part named on its own with nothing unpublished refuses the step; `"all"`
 * passes over such parts, as having nothing to move.
 */
function stagedParts(c: StepContext, parts: readonly PartRead[]): ReadPart[] {
  const idle = parts.filter(entry => !staged(entry));
  if (c.input.parts !== "all" && idle.length > 0) {
    throw nothingToReviewRefusal(
      idle.map(entry => entry.part),
      () => "parts"
    );
  }
  return parts.filter(staged);
}

/**
 * Whether the caller saw `entry` at another revision than it holds, from a stage the step does not
 * leave: then what is wrong is the caller's view, not the step.
 */
function seenElsewhere(c: StepContext, entry: ReadPart): boolean {
  const seen = seenRevision(c.input.seen, entry.part);
  return (
    !c.step.from.includes(entry.stage) &&
    seen !== undefined &&
    seen !== (entry.state?.revision ?? 0)
  );
}

/** The refusal of a step some named part cannot take from its stage. */
function namedPartsRefusal(
  c: StepContext,
  parts: readonly ReadPart[],
  left: LeftPart[]
): NextlyError {
  const moved = parts.filter(entry => seenElsewhere(c, entry));
  return moved.length > 0
    ? staleRefusal(moved.map(entry => entry.part))
    : notFromStageRefusal(left);
}

/**
 * The parts the step moves and those it leaves. Named parts must all leave from a stage the step
 * leaves; `"all"` leaves the others, and is refused only when none can move: as having nothing to
 * review when no part has anything unpublished.
 */
function splitParts(
  c: StepContext,
  read: readonly PartRead[]
): { movable: ReadPart[]; left: LeftPart[] } {
  const parts = stagedParts(c, read);
  if (parts.length === 0) {
    throw nothingToReviewRefusal(
      read.map(entry => entry.part),
      () => "parts"
    );
  }
  const movable = parts.filter(entry => c.step.from.includes(entry.stage));
  const left: LeftPart[] = parts
    .filter(entry => !c.step.from.includes(entry.stage))
    .map(entry => ({
      part: entry.part,
      stage: entry.stage,
      reason: "not-from-stage" as const,
    }));
  if (c.input.parts !== "all" && left.length > 0) {
    throw namedPartsRefusal(c, parts, left);
  }
  if (movable.length === 0) throw notFromStageRefusal(left);
  return { movable, left };
}

/** The step's permission, for every part it moves. */
function checkPermission(c: StepContext, movable: readonly ReadPart[]): void {
  if (!movable.every(entry => c.allowedOn(entry.part))) {
    throw NextlyError.forbidden({
      publicData: {
        reason: "no-permission",
        permission: permissionSlug(c.action, c.slug),
      },
      logContext: { refusal: "workflow-step-permission", step: c.step.name },
    });
  }
}

/** Approvals and requests for changes come only from a signed-in person. */
function checkPerson(c: StepContext): void {
  if (stepNeedsPerson(c.step) && c.input.caller.kind !== "user") {
    throw NextlyError.personOnly({
      doing: "approve or request changes",
      logContext: { refusal: "workflow-person-only", step: c.step.name },
    });
  }
}

/** The person accountable for a part's stage may not take a step that refuses it. */
function checkSelfApproval(c: StepContext, movable: readonly ReadPart[]): void {
  const accountable = c.caller.accountable;
  if (
    !allowsSelfApproval(c.step) &&
    accountable !== null &&
    movable.some(entry => entry.state?.enteredBy === accountable)
  ) {
    throw NextlyError.forbidden({
      publicData: { reason: "self-approval" },
      logContext: { refusal: "workflow-self-approval", step: c.step.name },
    });
  }
}

/** How a refusal names a part. */
function partName(part: string | null): string {
  return part === null ? "The shared part" : `"${part}"`;
}

/**
 * Each moving part's newest recorded version: what a reviewer is shown of it, and what a step into
 * a stage that allows publishing approves. A part with none has nothing to approve.
 */
async function readRecorded(
  tx: TransactionContext,
  c: StepContext,
  movable: readonly ReadPart[]
): Promise<Map<string | null, VersionRow | undefined>> {
  const recorded = new Map<string | null, VersionRow | undefined>();
  for (const entry of movable) {
    // What the part shows now, shared values written since through another language included:
    // the content the hidden-field check judges and the approval's digest covers, so both match
    // what a later save is compared with.
    recorded.set(
      entry.part,
      await shownContentOn(tx, c.input.document, c.table, entry.part)
    );
  }
  const unrecorded = movable.filter(entry => !recorded.get(entry.part));
  if (c.approves && unrecorded.length > 0) {
    throw NextlyError.validation({
      errors: unrecorded.map(entry => ({
        path: "parts",
        code: WORKFLOW_STEP_ERROR_CODES.nothingToApprove,
        message: `${partName(entry.part)} has no saved version to approve.`,
      })),
    });
  }
  return recorded;
}

/** Entering a stage that allows publishing approves the version shown, by a person. */
function approvalChange(
  c: StepContext,
  shown: VersionRow | undefined,
  now: Date
): ReviewStateChange {
  const by = c.caller.accountable;
  if (!c.approves || shown?.versionNo == null || by === null) return {};
  return {
    approval: {
      versionNo: shown.versionNo,
      // Without the fields an edit may change while an approval stands, so a save compared with
      // it leaves out the same ones.
      digest: approvalDigest(
        shown.snapshot,
        "collection",
        c.workflow.onEdit.exemptFields
      ),
      by,
      at: now,
    },
  };
}

/** What a step changes on one part. */
function stepChange(
  c: StepContext,
  entry: ReadPart,
  shown: VersionRow | undefined,
  now: Date
): ReviewStateChange {
  return {
    stage: c.step.to,
    enteredAt: now,
    definitionHash: c.definitionHash,
    // A move by trusted code keeps the accountable person the part had.
    ...(c.caller.accountable !== null
      ? { enteredBy: c.caller.accountable }
      : {}),
    // Leaving a stage that allows publishing withdraws the approval it held.
    ...(allowsPublish(c.workflow, entry.stage) ? { approval: null } : {}),
    ...approvalChange(c, shown, now),
    ...(c.reviewer.reviewer ? { assignee: c.reviewer.reviewer } : {}),
  };
}

/**
 * Moves one part over what the caller saw of it: its content version and its review-state
 * revision. Its new revision, or null when either moved since, having written nothing.
 */
async function movePart(
  tx: TransactionContext,
  c: StepContext,
  entry: ReadPart,
  shown: VersionRow | undefined,
  now: Date
): Promise<number | null> {
  const seen = c.input.seen.find(candidate => candidate.part === entry.part);
  const version = await partVersionOn(
    tx,
    c.dialect,
    c.table,
    c.input.document.entryId,
    entry.part
  );
  // The content changed since the caller was shown it, or the caller never saw this part.
  if (seen === undefined || version === undefined || version !== seen.version) {
    return null;
  }
  return writeOverSeen(
    tx,
    c.dialect,
    partOf(c.input.document, entry.part),
    entry.state,
    seen.revision,
    { stage: c.step.to, enteredAt: now, definitionHash: c.definitionHash },
    stepChange(c, entry, shown, now)
  );
}

/**
 * The move of every part. Every part is tried, so a refusal names all that moved since they were
 * seen; any refusal rolls back the parts already written.
 */
async function moveParts(
  tx: TransactionContext,
  c: StepContext,
  movable: readonly ReadPart[],
  recorded: ReadonlyMap<string | null, VersionRow | undefined>
): Promise<MovedPart[]> {
  const now = new Date();
  const stale: (string | null)[] = [];
  const moved: MovedPart[] = [];
  for (const entry of movable) {
    const revision = await movePart(
      tx,
      c,
      entry,
      recorded.get(entry.part),
      now
    );
    if (revision === null) stale.push(entry.part);
    else {
      moved.push({
        part: entry.part,
        from: entry.stage,
        to: c.step.to,
        revision,
      });
      await pinMoved(tx, c, entry, recorded.get(entry.part));
      await recordStepStageChange(tx, c, entry);
    }
  }
  if (stale.length > 0) throw staleRefusal(stale);
  return moved;
}

/**
 * The part's move as an outbox event, on the step's transaction and right after its write, so a
 * part refused later in the same step rolls the event back with the move. Leaving a stage that
 * allows publishing withdraws the approval the part held there (`stepChange`).
 */
function recordStepStageChange(
  tx: TransactionContext,
  c: StepContext,
  entry: ReadPart
): Promise<void> {
  return recordStageChanged(tx, {
    document: c.input.document,
    part: entry.part,
    from: entry.stage,
    to: c.step.to,
    cause: "step",
    approvalWithdrawn:
      Boolean(entry.state?.approval) && allowsPublish(c.workflow, entry.stage),
    definitionHash: c.definitionHash,
    actor: webhookActorOfEvent(c.caller.event),
  });
}

/**
 * The versions a move asks retention to keep: the one approved, which stays pinned after a
 * withdrawal until a new approval or a publish moves it, and the one the part entered review at,
 * until it enters again or a publish closes the cycle.
 */
async function pinMoved(
  tx: TransactionContext,
  c: StepContext,
  entry: ReadPart,
  shown: VersionRow | undefined
): Promise<void> {
  const versionNo = shown?.versionNo;
  if (typeof versionNo !== "number") return;
  const ref = c.input.document;
  if (c.approves && c.caller.accountable !== null) {
    await pinPart(tx, ref, approvedSlot(entry.part), versionNo);
  }
  if (entersReview(c.workflow, entry.stage, c.step.to)) {
    await pinPart(tx, ref, enteredReviewSlot(entry.part), versionNo);
  }
}

/**
 * The version a part's last approval named: kept by the workflows pin after a withdrawal, else the
 * one its current approval names. Undefined for a part never approved.
 */
async function lastApprovedNo(
  tx: TransactionContext,
  document: ReviewDocument,
  entry: ReadPart
): Promise<number | undefined> {
  const pins = await workflowPins.list(tx, document);
  const pinned = pins.find(pin => pin.slot === approvedSlot(entry.part));
  return pinned?.versionNo ?? entry.state?.approval?.versionNo;
}

/**
 * The version a review of one part compares with: the one its last approval named, else the
 * newest it published (of any language for the shared part, as its shown version is of any).
 * Undefined when it was never approved or published.
 */
async function reviewBaselineOn(
  tx: TransactionContext,
  document: ReviewDocument,
  entry: ReadPart
): Promise<VersionRow | undefined> {
  const repo = new VersionsRepository(tx);
  const approvedNo = await lastApprovedNo(tx, document, entry);
  const approved =
    approvedNo === undefined
      ? undefined
      : await repo.findByVersionNo(document, approvedNo);
  return (
    approved ?? repo.findNewestPublished(document, entry.part ?? undefined)
  );
}

/** The changed fields of one part the approver cannot read, with what changed in it. */
async function hiddenInPart(
  tx: TransactionContext,
  c: StepContext,
  approver: StepApprover,
  entry: ReadPart,
  shown: VersionRow
): Promise<{ changed: string[]; hidden: string[] }> {
  const baseline = await reviewBaselineOn(tx, c.input.document, entry);
  const changed = changedFields(
    c.input.document,
    shown.snapshot,
    baseline?.snapshot,
    c.workflow.onEdit.exemptFields
  );
  const hidden = await hiddenFrom(
    c.input.document,
    entry.part,
    shown.snapshot,
    changed,
    approver.user,
    approver.grants,
    c.fieldGroupPass
  );
  return { changed, hidden };
}

/** Who may not approve in the refused reviewer's place: them, and whom the step refuses. */
function excludedApprovers(
  c: StepContext,
  approver: StepApprover,
  movable: readonly ReadPart[]
): string[] {
  if (allowsSelfApproval(c.step)) return [approver.id];
  return [
    approver.id,
    ...movable.flatMap(entry =>
      entry.state?.enteredBy ? [entry.state.enteredBy] : []
    ),
  ];
}

/**
 * An approval covers what changed since the part was last approved, or else published: a changed
 * field the approver cannot read is one they cannot approve. Null when nothing is hidden, or when
 * the step approves nothing. Asked before anything is written, so a refusal keeps nothing.
 */
async function hiddenFieldRefusal(
  tx: TransactionContext,
  c: StepContext,
  movable: readonly ReadPart[],
  recorded: ReadonlyMap<string | null, VersionRow | undefined>
): Promise<HiddenRefusal | null> {
  const approver = c.approver;
  if (approver === null) return null;
  const fields = new Set<string>();
  const parts: HiddenRefusal["parts"] = [];
  for (const entry of movable) {
    const shown = recorded.get(entry.part);
    if (!shown) continue;
    const { changed, hidden } = await hiddenInPart(
      tx,
      c,
      approver,
      entry,
      shown
    );
    parts.push({ part: entry.part, shown: shown.snapshot, changed });
    for (const name of hidden) fields.add(name);
  }
  if (fields.size === 0) return null;
  return {
    fields: [...fields].sort(),
    parts,
    excluded: excludedApprovers(c, approver, movable),
  };
}

/** The newest recorded version among `group`'s parts, the version an event names. */
function newestVersionNo(
  group: readonly MovedPart[],
  recorded: ReadonlyMap<string | null, VersionRow | undefined>
): number | null {
  const versionNos = group.flatMap(entry => {
    const no = recorded.get(entry.part)?.versionNo;
    return typeof no === "number" ? [no] : [];
  });
  return versionNos.length > 0 ? Math.max(...versionNos) : null;
}

/** A comment as the event's note: none for an empty one. */
function noteOf(comment: string | null): string | null {
  return comment !== null && comment.trim() !== "" ? comment : null;
}

/** A step event's payload: the step, a key's owner, and a default reviewer skipped. */
function stepEventPayload(c: StepContext): Record<string, unknown> {
  const skipped = c.reviewer.skippedReviewer;
  return {
    step: c.step.name,
    ...(c.caller.ownerId !== null ? { ownerId: c.caller.ownerId } : {}),
    ...(skipped
      ? {
          skippedReviewer: {
            kind: skipped.assignee.kind,
            id: skipped.assignee.id,
            reason: skipped.reason,
          },
        }
      : {}),
  };
}

/** Each part of `group` as the record names it: its languages, and whether the shared part. */
function eventParts(group: readonly MovedPart[]): {
  locales: string[];
  shared: boolean;
} {
  return {
    locales: group.flatMap(entry => (entry.part === null ? [] : [entry.part])),
    shared: group.some(entry => entry.part === null),
  };
}

/** One event per stage the parts left, on the same transaction, naming the newest version moved. */
async function recordStepEvents(
  tx: TransactionContext,
  c: StepContext,
  moved: readonly MovedPart[],
  recorded: ReadonlyMap<string | null, VersionRow | undefined>
): Promise<void> {
  for (const from of new Set(moved.map(entry => entry.from))) {
    const group = moved.filter(entry => entry.from === from);
    await recordContentEvent(tx, {
      subject: {
        kind: c.input.document.scopeKind,
        slug: c.slug,
        id: c.input.document.entryId,
      },
      parts: eventParts(group),
      kind: workflowEventKind(c.step.kind),
      actor: c.caller.event,
      fromState: from,
      toState: c.step.to,
      note: noteOf(c.comment),
      versionNo: newestVersionNo(group, recorded),
      payload: stepEventPayload(c),
      definitionHash: c.definitionHash,
    });
  }
}

/** What an approval or a request for changes tells the person accountable for the stage left. */
const ACCOUNTABLE_TRIGGER: Partial<
  Record<WorkflowStepKind, "approved" | "changesRequested">
> = { approve: "approved", "request-changes": "changesRequested" };

/** One moved part as a notice names it: its document, part, new revision and content. */
function movedNotice(
  c: StepContext,
  entry: MovedPart,
  recorded: ReadonlyMap<string | null, VersionRow | undefined>
): Omit<NamedNotice, "trigger" | "userId" | "step"> {
  return {
    document: c.input.document,
    workflow: c.workflow.slug,
    part: entry.part,
    revision: entry.revision,
    snapshot: recorded.get(entry.part)?.snapshot,
  };
}

/**
 * The person accountable for the stage a part left, told it was approved or sent back: whoever
 * brought it into that stage, by a step or an edit, as its state named them before the move. None
 * for any other step, or a part no one was accountable for.
 */
function accountableNotices(
  c: StepContext,
  movable: readonly ReadPart[],
  moved: readonly MovedPart[],
  recorded: ReadonlyMap<string | null, VersionRow | undefined>
): NamedNotice[] {
  const trigger = ACCOUNTABLE_TRIGGER[c.step.kind];
  if (trigger === undefined) return [];
  const before = new Map(movable.map(entry => [entry.part, entry.state]));
  return moved.flatMap(entry => {
    const userId = before.get(entry.part)?.enteredBy;
    if (!userId) return [];
    const notice = movedNotice(c, entry, recorded);
    return [
      {
        ...notice,
        trigger,
        userId,
        step: c.step.label,
        ...commentFor(c, trigger),
      },
    ];
  });
}

/**
 * The step's comment, for the notice of a request for changes alone: what the writer is to change.
 * The step requires it of that kind, so it is always there to keep.
 */
function commentFor(
  c: StepContext,
  trigger: NamedNotice["trigger"]
): { comment?: string } {
  return trigger === "changesRequested" && c.comment !== null
    ? { comment: c.comment }
    : {};
}

/**
 * The entered stage's default reviewer, where a person, told each moved part was assigned to
 * them, for the work of that stage's primary step. A role is told nothing.
 */
function reviewerNotices(
  c: StepContext,
  moved: readonly MovedPart[],
  recorded: ReadonlyMap<string | null, VersionRow | undefined>
): NamedNotice[] {
  const reviewer = c.reviewer.reviewer;
  if (reviewer?.kind !== "user") return [];
  const step = primaryStep(c.workflow, c.step.to)?.label ?? null;
  return moved.map(entry => ({
    ...movedNotice(c, entry, recorded),
    trigger: "assigned" as const,
    userId: reviewer.id,
    step,
  }));
}

/** Everyone a step names by name, for each part it moved. */
function stepNotices(
  c: StepContext,
  movable: readonly ReadPart[],
  moved: readonly MovedPart[],
  recorded: ReadonlyMap<string | null, VersionRow | undefined>
): NamedNotice[] {
  return [
    ...accountableNotices(c, movable, moved, recorded),
    ...reviewerNotices(c, moved, recorded),
  ];
}

/** A step inside its transaction: the lock first, then every precondition in order, then the move. */
async function runStep(
  tx: TransactionContext,
  c: StepContext
): Promise<StepOutcome> {
  await lockDocument(tx, c);
  const { movable, left } = splitParts(c, await readParts(tx, c));
  checkPermission(c, movable);
  checkPerson(c);
  checkSelfApproval(c, movable);
  checkComment(c.step, c.comment);
  const recorded = await readRecorded(tx, c, movable);
  // Nothing is written before this, so answering the refusal out of the transaction keeps nothing.
  const hidden = await hiddenFieldRefusal(tx, c, movable, recorded);
  if (hidden !== null) return { hidden };
  const moved = await moveParts(tx, c, movable, recorded);
  await recordStepEvents(tx, c, moved, recorded);
  await tellNamedPeople(
    tx,
    c.telling,
    stepNotices(c, movable, moved, recorded)
  );
  return { taken: { step: c.step.name, moved, left, ...c.reviewer } };
}

/**
 * The refusal of an approval covering fields the reviewer cannot read, naming who could approve
 * instead: read on the pool, once the step's transaction has ended.
 */
async function hiddenFieldsForbidden(
  adapter: DrizzleAdapter,
  c: StepContext,
  hidden: HiddenRefusal
): Promise<NextlyError> {
  const data: WorkflowRefusalPublicData = {
    reason: "field-hidden",
    fields: hidden.fields,
    approvers: await possibleApprovers(adapter, {
      document: c.input.document,
      action: c.action,
      parts: hidden.parts,
      excluded: new Set(hidden.excluded),
      fieldGroupPass: c.fieldGroupPass,
    }),
  };
  return NextlyError.forbidden({
    publicData: data,
    logContext: { refusal: "workflow-field-hidden", step: c.step.name },
  });
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
 * stage that allows publishing loses its approval. An approval pins the version it names
 * (`approved:<part>`), and a step that enters review pins the version the part entered it at
 * (`entered-review:<part>`), so retention keeps both for the comparisons a review shows.
 *
 * @experimental
 */
export async function takeWorkflowStep(
  adapter: DrizzleAdapter,
  input: TakeStepInput
): Promise<TakeStepResult> {
  const registered = attachedWorkflow(input.document);
  const step = findStep(registered.workflow, input.step);
  const context = await prepareStep(adapter, input, registered, step);
  ensureWorkflowContentEventKinds();
  const outcome = await adapter.transaction(tx => runStep(tx, context));
  if ("taken" in outcome) return outcome.taken;
  throw await hiddenFieldsForbidden(adapter, context, outcome.hidden);
}

/** One assignment, with the workflow of its document. */
interface AssignmentEntry {
  assignment: Assignment;
  registered: RegisteredWorkflow;
}

/**
 * One assignment as read on the transaction: its part's review state and stage, null for a part
 * with nothing unpublished.
 */
interface AssignedRead extends AssignmentEntry {
  index: number;
  state: ReviewState | null;
  stage: string | null;
}

/** An assignment whose part is in a stage. */
interface AssignedPart extends AssignedRead {
  stage: string;
}

/** What an assignment reads before its transaction opens, and carries into it. */
interface AssignContext {
  entries: AssignmentEntry[];
  caller: ResolvedCaller;
  /** Why each assignee may not be given work needing each action, by {@link eligibilityKey}. */
  eligibility: ReadonlyMap<string, AssigneeRefusalCode | null>;
  /** Whether the caller may make each built-in write to each part, by {@link gatedKey}. */
  gated: ReadonlyMap<string, boolean>;
  /** Whether each assignment's part is live, by its index, read before the transaction. */
  live: readonly boolean[];
  dialect: SupportedDialect;
  /** What telling each assignee needs from the pool; null where no one can be told. */
  telling: NoticeTelling | null;
}

const eligibilityKey = (
  assignee: ReviewAssignee,
  action: string | null,
  slug: string
) => JSON.stringify([assignee.kind, assignee.id, action, slug]);

const gatedKey = (index: number, action: string) =>
  JSON.stringify([index, action]);

/**
 * Whether each assignee may be given work in each stage, answered before the transaction opens:
 * which stage a part is in is read inside it.
 */
async function assigneeEligibility(
  adapter: DrizzleAdapter,
  entries: readonly AssignmentEntry[]
): Promise<Map<string, AssigneeRefusalCode | null>> {
  const eligibility = new Map<string, AssigneeRefusalCode | null>();
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
  return eligibility;
}

/** Every action an assigner of `workflow`'s parts may hold, each once. */
function everyAssignerAction(workflow: Workflow): Set<string> {
  return new Set(
    workflow.stages.flatMap(stage => assignerActions(workflow, stage.name))
  );
}

/**
 * Whether the caller may make each built-in write an assigner may hold, to each part, asked of the
 * collection's own gate in the part's language before the transaction opens, as a step asks it.
 */
async function assignerGates(
  entries: readonly AssignmentEntry[],
  caller: WorkflowCaller
): Promise<Map<string, boolean>> {
  const gated = new Map<string, boolean>();
  for (const [index, { assignment, registered }] of entries.entries()) {
    for (const action of everyAssignerAction(registered.workflow)) {
      if (isEntryWrite(action)) {
        gated.set(
          gatedKey(index, action),
          await entryWriteAllowed(
            assignment.document,
            assignment.part,
            action,
            caller
          )
        );
      }
    }
  }
  return gated;
}

/**
 * Each assignment's part read on the transaction, and the stage it puts the part in; a part with
 * none stands where its content puts it (`partStage`). Each document's pending parts are read
 * once, however many of its parts are assigned.
 */
async function readAssignedParts(
  tx: TransactionContext,
  c: AssignContext
): Promise<AssignedRead[]> {
  const pendingOf = new Map<string, (part: string | null) => boolean>();
  const parts: AssignedRead[] = [];
  for (const [index, entry] of c.entries.entries()) {
    const { document, part } = entry.assignment;
    const key = JSON.stringify([
      document.scopeKind,
      document.scopeSlug,
      document.entryId,
    ]);
    const pending = pendingOf.get(key) ?? (await pendingPartsOn(tx, document));
    pendingOf.set(key, pending);
    const state = await readReviewState(tx, partOf(document, part));
    const content = { live: c.live[index] === true, pending: pending(part) };
    const stage = partStage(entry.registered.workflow, state, content);
    parts.push({ ...entry, index, state, stage });
  }
  return parts;
}

/** The assignments, each part in a stage; refused, naming each, where a part has nothing to review. */
function assignableParts(parts: readonly AssignedRead[]): AssignedPart[] {
  const idle = parts.filter(part => part.stage === null);
  if (idle.length > 0) {
    throw nothingToReviewRefusal(
      idle.map(part => part.assignment.part),
      index => `assignments[${idle[index]?.index ?? index}].part`
    );
  }
  return parts.filter((part): part is AssignedPart => part.stage !== null);
}

/** Whether each assignment's part is live, by its index, read on the pool. */
async function assignedLiveness(
  adapter: DrizzleAdapter,
  entries: readonly AssignmentEntry[]
): Promise<boolean[]> {
  const live: boolean[] = [];
  for (const { assignment } of entries) {
    const parts = await livePartsOf(adapter, assignment.document, [
      assignment.part,
    ]);
    live.push(parts.get(assignment.part) === true);
  }
  return live;
}

/** The refusal of one assigner, where it may neither edit nor take the stage's primary step. */
function assignerRefusal(
  c: AssignContext,
  part: AssignedPart
): Array<{ index: number; anyOf: string[] }> {
  const slug = part.assignment.document.scopeSlug;
  const anyOf = assignerActions(part.registered.workflow, part.stage);
  const may = (action: string) =>
    isEntryWrite(action)
      ? c.gated.get(gatedKey(part.index, action)) === true
      : decidePermission(c.caller.actor, action, slug).allowed;
  return anyOf.some(may)
    ? []
    : [
        {
          index: part.index,
          anyOf: anyOf.map(action => permissionSlug(action, slug)),
        },
      ];
}

/** Who may assign: the right to edit, or the primary step of the part's stage. */
function checkAssigners(
  c: AssignContext,
  parts: readonly AssignedPart[]
): void {
  const refused = parts.flatMap(part => assignerRefusal(c, part));
  if (refused.length > 0) {
    throw NextlyError.forbidden({
      publicData: { reason: "no-permission", refused },
      logContext: { refusal: "workflow-assign-permission" },
    });
  }
}

/** Why one assignee may not be given the part's work, as a validation error, or none. */
function assigneeError(
  c: AssignContext,
  part: AssignedPart
): Array<{ path: string; code: string; message: string }> {
  const { assignee } = part.assignment;
  if (!assignee) return [];
  const code = c.eligibility.get(
    eligibilityKey(
      assignee,
      primaryAction(part.registered.workflow, part.stage),
      part.assignment.document.scopeSlug
    )
  );
  return code
    ? [
        {
          path: `assignments[${part.index}].assignee`,
          code,
          message: `The ${assignee.kind} "${assignee.id}" cannot be assigned work in "${part.stage}".`,
        },
      ]
    : [];
}

/** Who may be assigned: whoever holds the primary step of the part's stage. */
function checkAssignees(
  c: AssignContext,
  parts: readonly AssignedPart[]
): void {
  const errors = parts.flatMap(part => assigneeError(c, part));
  if (errors.length > 0) throw NextlyError.validation({ errors });
}

/** Writes each assignment over the revision it was seen at; nothing is kept if any moved. */
async function writeAssignments(
  tx: TransactionContext,
  c: AssignContext,
  parts: readonly AssignedPart[]
): Promise<AssignResult["assigned"]> {
  const now = new Date();
  const stale: (string | null)[] = [];
  const assigned: AssignResult["assigned"] = [];
  for (const part of parts) {
    const { assignment, registered } = part;
    const revision = await writeOverSeen(
      tx,
      c.dialect,
      partOf(assignment.document, assignment.part),
      part.state,
      assignment.revision,
      {
        // Where the part stands without review state: its first state starts it there.
        stage: part.stage,
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
  return assigned;
}

/** One assignment's event: who it went to, until when, and a key's owner. */
async function recordAssignment(
  tx: TransactionContext,
  c: AssignContext,
  { assignment, registered }: AssignmentEntry
): Promise<void> {
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
    actor: c.caller.event,
    payload: {
      assignee: assignment.assignee,
      dueAt: assignment.dueAt ? assignment.dueAt.toISOString() : null,
      ...(c.caller.ownerId !== null ? { ownerId: c.caller.ownerId } : {}),
    },
    definitionHash: registered.definitionHash,
  });
}

/**
 * Each person an assignment names, told the part was assigned to them for the work of its stage's
 * primary step. A role, and a cleared assignment, tell no one. `assigned` answers `parts` in order,
 * each with the part's new revision.
 */
function assignmentNotices(
  parts: readonly AssignedPart[],
  assigned: AssignResult["assigned"]
): NamedNotice[] {
  return parts.flatMap((part, index) => {
    const { assignee, document } = part.assignment;
    const revision = assigned[index]?.revision;
    if (assignee?.kind !== "user" || revision === undefined) return [];
    const workflow = part.registered.workflow;
    return [
      {
        trigger: "assigned" as const,
        userId: assignee.id,
        document,
        workflow: workflow.slug,
        part: part.assignment.part,
        revision,
        step: primaryStep(workflow, part.stage)?.label ?? null,
      },
    ];
  });
}

/** An assignment inside its transaction: who may assign, who may be assigned, then the writes. */
async function runAssignment(
  tx: TransactionContext,
  c: AssignContext
): Promise<AssignResult> {
  const parts = assignableParts(await readAssignedParts(tx, c));
  checkAssigners(c, parts);
  checkAssignees(c, parts);
  const assigned = await writeAssignments(tx, c, parts);
  for (const entry of c.entries) await recordAssignment(tx, c, entry);
  await tellNamedPeople(tx, c.telling, assignmentNotices(parts, assigned));
  return { assigned };
}

/**
 * Assigns each part to a person or a role, with an optional due date, in one transaction of
 * `adapter`, over the revision each was seen at, and records a `workflow-assign` event per part.
 *
 * The caller needs, for each part, the collection's or Single's `update-<slug>` or the permission
 * of the primary step of the part's stage; else `FORBIDDEN`, `{ reason: "no-permission",
 * refused: [{ index, anyOf }] }`. A built-in write among them is judged by the collection's own
 * gate in the part's language. Each assignee must hold that primary step: a person through their
 * roles in force, never when deactivated; a role through its own grants, the roles it inherits,
 * or super-admin. Else `VALIDATION_ERROR`, one error per refused assignment
 * (`assignments[<i>].assignee`, an assignee refusal code). Nothing is assigned unless everything
 * is; a stale revision is `CONFLICT`, `{ reason: "stale" }`.
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
  const context: AssignContext = {
    entries,
    caller,
    eligibility: await assigneeEligibility(adapter, entries),
    gated: await assignerGates(entries, input.caller),
    live: await assignedLiveness(adapter, entries),
    dialect: adapter.getCapabilities().dialect,
    telling: await prepareNoticeTelling(
      adapter,
      entries.map(({ assignment, registered }) => ({
        workflow: registered.workflow.slug,
        slug: assignment.document.scopeSlug,
      })),
      caller
    ),
  };
  ensureWorkflowContentEventKinds();
  return adapter.transaction(tx => runAssignment(tx, context));
}
