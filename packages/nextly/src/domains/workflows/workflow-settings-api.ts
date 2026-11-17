/**
 * What developers read and change of a workflow's settings, through REST and the Direct API: the
 * registered workflows and where each is attached, and for one workflow its stages' default
 * reviewers, labels and colours, which notifications also send an email, and which roles hold each
 * step's own permission.
 *
 * The definition (stages, steps and their rules) is the code's: a write naming any part of it is
 * refused, never stored or ignored. A write is a compare-and-set on the settings' revision, and a
 * change of grants commits in the same transaction as the settings, so the two never disagree.
 * Each committed change is recorded in the activity log under {@link WORKFLOW_SETTINGS_ACTIVITY_COLLECTION}.
 *
 * Who may read or write is asked by the door, before anything here runs.
 *
 * @module domains/workflows/workflow-settings-api
 * @experimental
 */
import type { DrizzleAdapter } from "@nextlyhq/adapter-drizzle";
import type { TransactionContext } from "@nextlyhq/adapter-drizzle/types";

import type { RequestActor } from "../../auth/request-actor";
import { container } from "../../di/container";
import { NextlyError } from "../../errors";
import { getNextlyLogger } from "../../observability/logger";
import { SUPER_ADMIN_SLUG } from "../../services/access/super-admin";
import type { Logger } from "../../services/shared";
import { consoleLogger } from "../../shared/types";
import { recordSettingsActivity } from "../audit/record-settings-activity";
import { entityPermissionSpelling } from "../auth/services/entity-permission-spelling";
import { PermissionService } from "../auth/services/permission-service";
import {
  afterGrantsChanged,
  afterRoleGrantsChanged,
  changingRoleGrants,
} from "../auth/services/role-grants-changed";
import { RolePermissionService } from "../auth/services/role-permission-service";
import { RoleService } from "../auth/services/role-service";

import { holderAnswer } from "./holders";
import { BUILT_IN_ACTIONS, WORKFLOW_PERMISSION_GROUP } from "./permissions";
import { registeredWorkflows, type RegisteredWorkflow } from "./registry";
import type { ReviewAssignee, ReviewStatesDb } from "./review-state-repository";
import { primaryAction } from "./steps";
import type { Workflow, WorkflowStepKind } from "./types";
import {
  readWorkflowSettings,
  writeWorkflowSettings,
  type WorkflowSettings,
} from "./workflow-settings-repository";

/** Error codes a settings write refuses with, each a validation problem's own code. @experimental */
export const WORKFLOW_SETTINGS_ERROR_CODES = {
  /** A write named a part of the definition, which only the code changes. */
  definitionReadOnly: "WORKFLOW_DEFINITION_READ_ONLY",
  /** A default reviewer who cannot take the stage's primary step on every attachment. */
  ineligibleReviewer: "WORKFLOW_INELIGIBLE_REVIEWER",
  unknownStage: "WORKFLOW_UNKNOWN_STAGE",
  unknownStep: "WORKFLOW_UNKNOWN_STEP",
  /** A step that needs only the collection's own permissions has none of its own to grant. */
  stepNotGrantable: "WORKFLOW_STEP_NOT_GRANTABLE",
  /** Two steps sharing one permission were given different roles. */
  conflictingGrants: "WORKFLOW_CONFLICTING_GRANTS",
  unknownRole: "WORKFLOW_UNKNOWN_ROLE",
} as const;

/**
 * The keys that name a part of a workflow's definition. A settings write naming one, at its top
 * level or inside a stage's label entry, is refused.
 *
 * @experimental
 */
export const WORKFLOW_DEFINITION_KEYS: readonly string[] = [
  "stages",
  "steps",
  "from",
  "to",
  "kind",
  "permission",
  "allowsPublish",
  "afterPublish",
  "onEdit",
];

/**
 * The activity-log `collection` a workflow's settings changes are filed under, with the
 * workflow's slug as the entry.
 *
 * @experimental
 */
export const WORKFLOW_SETTINGS_ACTIVITY_COLLECTION = "workflows";

/** A registered workflow, as a reader of its settings is told it. @experimental */
export interface WorkflowSummary {
  slug: string;
  label: string;
  stages: { name: string; label: string; allowsPublish: boolean }[];
  steps: {
    name: string;
    label: string;
    kind: WorkflowStepKind;
    from: string[];
    to: string;
    primary: boolean;
    /** Whether which roles hold it is a setting: a step naming a permission of its own. */
    grantable: boolean;
  }[];
  collections: string[];
  singles: string[];
}

/** Whether each notification also sends an email. @experimental */
export interface WorkflowEmailSettings {
  assigned: boolean;
  approved: boolean;
  changesRequested: boolean;
}

/** A stage's label and colour shown over the code's. @experimental */
export interface WorkflowStageLabel {
  label?: string;
  colour?: string;
}

/** A workflow's settings, as they read now. @experimental */
export interface WorkflowSettingsView {
  workflow: string;
  /** What a write says it read; 0 for a workflow whose settings were never changed. */
  revision: number;
  /** Each stage's default reviewer, by stage name. */
  defaultReviewers: Record<string, ReviewAssignee>;
  /** Each stage's label and colour overrides, by stage name. */
  labels: Record<string, WorkflowStageLabel>;
  emails: WorkflowEmailSettings;
  /**
   * The roles granted each grantable step's permission directly on every collection and Single
   * the workflow is attached to, by step name. The super-admin role holds every step and is not
   * listed.
   */
  grants: Record<string, string[]>;
}

/**
 * A change to a workflow's settings, made over the revision the caller read. Each part is merged
 * into what is stored: a stage named with `null` loses its default reviewer or labels, and a
 * step named in `grants` is held by exactly the roles listed.
 *
 * @experimental
 */
export interface WorkflowSettingsChange {
  revision: number;
  defaultReviewers?: Record<string, ReviewAssignee | null>;
  labels?: Record<
    string,
    { label?: string | null; colour?: string | null } | null
  >;
  emails?: Partial<WorkflowEmailSettings>;
  grants?: Record<string, string[]>;
}

type Problem = { path: string; code: string; message: string };

const refused = (problems: Problem[]): NextlyError =>
  NextlyError.validation({ errors: problems });

function logger(): Logger {
  return container.has("logger")
    ? container.get<Logger>("logger")
    : consoleLogger;
}

/** The step names whose permission is the workflow's own, each with that action. */
function grantableActions(workflow: Workflow): Map<string, string> {
  const grantable = new Map<string, string>();
  for (const step of workflow.steps) {
    if (step.permission !== null && !BUILT_IN_ACTIONS.has(step.permission)) {
      grantable.set(step.name, step.permission);
    }
  }
  return grantable;
}

const attachedTo = (registered: RegisteredWorkflow): string[] => [
  ...registered.collections,
  ...registered.singles,
];

/** Every registered workflow, with its stages, steps and attachments. @experimental */
export function listWorkflowSummaries(): WorkflowSummary[] {
  return registeredWorkflows().map(({ workflow, collections, singles }) => {
    const grantable = grantableActions(workflow);
    return {
      slug: workflow.slug,
      label: workflow.label,
      stages: workflow.stages.map(stage => ({
        name: stage.name,
        label: stage.label,
        allowsPublish: stage.allowsPublish,
      })),
      steps: workflow.steps.map(step => ({
        name: step.name,
        label: step.label,
        kind: step.kind,
        from: [...step.from],
        to: step.to,
        primary: step.primary,
        grantable: grantable.has(step.name),
      })),
      collections: [...collections],
      singles: [...singles],
    };
  });
}

/** The registered workflow `slug`, or not found. */
function registeredWorkflow(slug: string): RegisteredWorkflow {
  const registered = registeredWorkflows().find(
    entry => entry.workflow.slug === slug
  );
  if (!registered) {
    throw NextlyError.notFound({
      logContext: { reason: "workflow-not-registered", workflow: slug },
    });
  }
  return registered;
}

/**
 * Refuses `input` when it names a part of the definition: at its top level, or inside a stage's
 * label entry. Asked of the raw input, before it is parsed, so a definition key is named as one
 * rather than as an unknown key.
 *
 * @experimental
 */
export function refuseDefinitionKeys(input: unknown): void {
  if (!isObject(input)) return;
  const named: string[] = Object.keys(input).filter(key =>
    WORKFLOW_DEFINITION_KEYS.includes(key)
  );
  const labels = input.labels;
  if (isObject(labels)) {
    for (const [stage, entry] of Object.entries(labels)) {
      if (!isObject(entry)) continue;
      for (const key of Object.keys(entry)) {
        if (WORKFLOW_DEFINITION_KEYS.includes(key)) {
          named.push(`labels.${stage}.${key}`);
        }
      }
    }
  }
  if (named.length === 0) return;
  throw refused(
    named.map(path => ({
      path,
      code: WORKFLOW_SETTINGS_ERROR_CODES.definitionReadOnly,
      message: `\`${path}\` is part of the workflow's definition, which only its code changes.`,
    }))
  );
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** The super-admin role's id, which holds every step whatever it is granted. */
async function superAdminRoleId(
  adapter: DrizzleAdapter
): Promise<string | null> {
  return (
    (
      await new RoleService(adapter, logger()).findRoleIdBySlug(
        SUPER_ADMIN_SLUG
      )
    )?.id ?? null
  );
}

/** The stored permission ids of `action` on each of `slugs`, by slug; a missing one is absent. */
async function permissionIdsOf(
  adapter: DrizzleAdapter,
  action: string,
  slugs: readonly string[]
): Promise<Map<string, string>> {
  const rows = await adapter.select<{ id: unknown; resource: unknown }>(
    "permissions",
    {
      columns: ["id", "resource"],
      where: {
        and: [
          { column: "action", op: "=", value: action },
          { column: "resource", op: "IN", value: [...slugs] },
        ],
      },
    }
  );
  return new Map(rows.map(row => [String(row.resource), String(row.id)]));
}

/** The role ids holding each of `permissionIds` directly, by permission id. */
async function directHolders(
  db: Pick<DrizzleAdapter, "select"> | TransactionContext,
  permissionIds: readonly string[]
): Promise<Map<string, Set<string>>> {
  const held = new Map<string, Set<string>>();
  if (permissionIds.length === 0) return held;
  const rows = await db.select<{ roleId: unknown; permissionId: unknown }>(
    "role_permissions",
    {
      columns: ["roleId", "permissionId"],
      where: {
        and: [{ column: "permissionId", op: "IN", value: [...permissionIds] }],
      },
    }
  );
  for (const row of rows) {
    const roleId = String(row.roleId);
    const set = held.get(roleId) ?? new Set<string>();
    set.add(String(row.permissionId));
    held.set(roleId, set);
  }
  return held;
}

/** The roles granted `action` directly on every one of `slugs`, sorted, super-admin left out. */
async function rolesGrantedEverywhere(
  adapter: DrizzleAdapter,
  action: string,
  slugs: readonly string[],
  superAdmin: string | null
): Promise<string[]> {
  const ids = await permissionIdsOf(adapter, action, slugs);
  if (ids.size < slugs.length) return [];
  const holders = await directHolders(adapter, [...ids.values()]);
  return [...holders]
    .filter(([roleId, held]) => roleId !== superAdmin && held.size === ids.size)
    .map(([roleId]) => roleId)
    .sort();
}

const DEFAULT_EMAILS: WorkflowEmailSettings = {
  assigned: true,
  approved: true,
  changesRequested: true,
};

/** The settings as a reader is told them, from what is stored and the grants in force. */
async function viewOf(
  adapter: DrizzleAdapter,
  registered: RegisteredWorkflow,
  stored: { settings: WorkflowSettings; revision: number } | null
): Promise<WorkflowSettingsView> {
  const settings = stored?.settings ?? {};
  const slugs = attachedTo(registered);
  const superAdmin = await superAdminRoleId(adapter);
  const byAction = new Map<string, string[]>();
  const grants: Record<string, string[]> = {};
  for (const [step, action] of grantableActions(registered.workflow)) {
    if (!byAction.has(action)) {
      byAction.set(
        action,
        await rolesGrantedEverywhere(adapter, action, slugs, superAdmin)
      );
    }
    grants[step] = [...(byAction.get(action) ?? [])];
  }
  return {
    workflow: registered.workflow.slug,
    revision: stored?.revision ?? 0,
    defaultReviewers: { ...settings.defaultReviewers },
    labels: { ...settings.stages },
    emails: { ...DEFAULT_EMAILS, ...settings.emails },
    grants,
  };
}

/** A workflow's settings, as they read now. @experimental */
export async function readWorkflowSettingsView(
  adapter: DrizzleAdapter,
  slug: string
): Promise<WorkflowSettingsView> {
  const registered = registeredWorkflow(slug);
  return viewOf(
    adapter,
    registered,
    await readWorkflowSettings(adapter, registered.workflow.slug)
  );
}

const stageLabel = (workflow: Workflow, name: string): string =>
  workflow.stages.find(stage => stage.name === name)?.label ?? name;

const hasStage = (workflow: Workflow, name: string): boolean =>
  workflow.stages.some(stage => stage.name === name);

const unknownStage = (path: string, stage: string): Problem => ({
  path,
  code: WORKFLOW_SETTINGS_ERROR_CODES.unknownStage,
  message: `The workflow has no stage named \`${stage}\`.`,
});

/**
 * Why each default reviewer named may not be one: a stage the workflow lacks, or a reviewer who
 * cannot take the stage's primary step on every collection and Single the workflow is attached to.
 */
async function reviewerProblems(
  adapter: DrizzleAdapter,
  registered: RegisteredWorkflow,
  reviewers: NonNullable<WorkflowSettingsChange["defaultReviewers"]>
): Promise<Problem[]> {
  const { workflow } = registered;
  const problems: Problem[] = [];
  for (const [stage, reviewer] of Object.entries(reviewers)) {
    const path = `defaultReviewers.${stage}`;
    if (!hasStage(workflow, stage)) {
      problems.push(unknownStage(path, stage));
      continue;
    }
    if (reviewer === null) continue;
    const action = primaryAction(workflow, stage);
    let lacking: string | null = null;
    if (action === null) {
      lacking = "it has no step out of it";
    } else {
      for (const slug of attachedTo(registered)) {
        const answer = await holderAnswer(adapter, reviewer, action, slug);
        if (answer !== "holds") {
          lacking = `they cannot take its primary step on \`${slug}\` (${answer})`;
          break;
        }
      }
    }
    if (lacking !== null) {
      problems.push({
        path,
        code: WORKFLOW_SETTINGS_ERROR_CODES.ineligibleReviewer,
        message: `This ${reviewer.kind} cannot be the default reviewer of the stage "${stageLabel(workflow, stage)}" (\`${stage}\`): ${lacking}.`,
      });
    }
  }
  return problems;
}

/** The roles each grant names, by action, once each; or the problems with them. */
async function plannedGrants(
  adapter: DrizzleAdapter,
  registered: RegisteredWorkflow,
  grants: NonNullable<WorkflowSettingsChange["grants"]>
): Promise<{ byAction: Map<string, Set<string>>; problems: Problem[] }> {
  const grantable = grantableActions(registered.workflow);
  const byAction = new Map<string, Set<string>>();
  const problems: Problem[] = [];
  for (const [step, roles] of Object.entries(grants)) {
    const path = `grants.${step}`;
    if (!registered.workflow.steps.some(each => each.name === step)) {
      problems.push({
        path,
        code: WORKFLOW_SETTINGS_ERROR_CODES.unknownStep,
        message: `The workflow has no step named \`${step}\`.`,
      });
      continue;
    }
    const action = grantable.get(step);
    if (action === undefined) {
      problems.push({
        path,
        code: WORKFLOW_SETTINGS_ERROR_CODES.stepNotGrantable,
        message: `The step \`${step}\` needs only the collection's own permissions, granted on its roles: it has none of its own.`,
      });
      continue;
    }
    const wanted = new Set(roles);
    const earlier = byAction.get(action);
    if (
      earlier &&
      (earlier.size !== wanted.size || [...wanted].some(r => !earlier.has(r)))
    ) {
      problems.push({
        path,
        code: WORKFLOW_SETTINGS_ERROR_CODES.conflictingGrants,
        message: `The step \`${step}\` shares the permission \`${action}\` with another step named here, given other roles.`,
      });
      continue;
    }
    byAction.set(action, wanted);
  }
  const roles = new RoleService(adapter, logger());
  const named = new Set([...byAction.values()].flatMap(set => [...set]));
  for (const roleId of named) {
    try {
      await roles.getRoleById(roleId);
    } catch (error) {
      if (!NextlyError.isNotFound(error) && !NextlyError.isValidation(error)) {
        throw error;
      }
      problems.push({
        path: "grants",
        code: WORKFLOW_SETTINGS_ERROR_CODES.unknownRole,
        message: `No role has the id \`${roleId}\`.`,
      });
    }
  }
  return { byAction, problems };
}

/** Problems with the labels named: a stage the workflow lacks. */
function labelProblems(
  workflow: Workflow,
  labels: NonNullable<WorkflowSettingsChange["labels"]>
): Problem[] {
  return Object.keys(labels)
    .filter(stage => !hasStage(workflow, stage))
    .map(stage => unknownStage(`labels.${stage}`, stage));
}

/** The stored settings with `change` merged in. */
function merged(
  stored: WorkflowSettings,
  change: WorkflowSettingsChange
): WorkflowSettings {
  const defaultReviewers = { ...stored.defaultReviewers };
  for (const [stage, reviewer] of Object.entries(
    change.defaultReviewers ?? {}
  )) {
    if (reviewer === null) delete defaultReviewers[stage];
    else defaultReviewers[stage] = { kind: reviewer.kind, id: reviewer.id };
  }
  const stages = { ...stored.stages };
  for (const [stage, entry] of Object.entries(change.labels ?? {})) {
    const next: WorkflowStageLabel = entry === null ? {} : { ...stages[stage] };
    if (entry !== null) {
      for (const key of ["label", "colour"] as const) {
        const value = entry[key];
        if (value === null) delete next[key];
        else if (value !== undefined) next[key] = value;
      }
    }
    if (Object.keys(next).length === 0) delete stages[stage];
    else stages[stage] = next;
  }
  const emails = { ...stored.emails, ...change.emails };
  return {
    ...(Object.keys(defaultReviewers).length > 0 ? { defaultReviewers } : {}),
    ...(Object.keys(stages).length > 0 ? { stages } : {}),
    ...(Object.keys(emails).length > 0 ? { emails } : {}),
  };
}

/** The setting names a change moved: `defaultReviewers.<stage>`, `labels.<stage>`, `emails.<name>`. */
function changedSettings(
  before: WorkflowSettings,
  after: WorkflowSettings
): string[] {
  const changed: string[] = [];
  const compare = (
    prefix: string,
    a: Record<string, unknown>,
    b: Record<string, unknown>
  ) => {
    for (const key of new Set([...Object.keys(a), ...Object.keys(b)])) {
      if (JSON.stringify(a[key]) !== JSON.stringify(b[key])) {
        changed.push(`${prefix}.${key}`);
      }
    }
  };
  compare(
    "defaultReviewers",
    before.defaultReviewers ?? {},
    after.defaultReviewers ?? {}
  );
  compare("labels", before.stages ?? {}, after.stages ?? {});
  // Compared as they read, so an email switched on where it was on by default moved nothing.
  compare(
    "emails",
    { ...DEFAULT_EMAILS, ...before.emails },
    { ...DEFAULT_EMAILS, ...after.emails }
  );
  return changed;
}

/** For each action being set, the permission ids on every attachment, made where missing. */
async function permissionsToSet(
  adapter: DrizzleAdapter,
  registered: RegisteredWorkflow,
  actions: readonly string[]
): Promise<Map<string, string[]>> {
  const slugs = attachedTo(registered);
  const permissions = new PermissionService(adapter, logger());
  const ids = new Map<string, string[]>();
  for (const action of actions) {
    const found = await permissionIdsOf(adapter, action, slugs);
    for (const slug of slugs) {
      if (found.has(slug)) continue;
      // Made as the workflow's own seeding makes it, so it reads as one wherever it is shown.
      const spelling = entityPermissionSpelling(action, slug);
      const made = await permissions.ensurePermission(
        action,
        slug,
        spelling.name,
        spelling.slug,
        spelling.description,
        { group: WORKFLOW_PERMISSION_GROUP }
      );
      found.set(slug, made.id);
    }
    ids.set(action, [...found.values()]);
  }
  return ids;
}

/** Who gained and who lost a step's permission, by role id. */
interface GrantMoves {
  granted: string[];
  revoked: string[];
}

/**
 * Sets, on transaction `tx`, which roles hold each action's permissions: exactly those wanted,
 * super-admin left as it is. Each role's own other grants are kept. Returns the roles changed and
 * the moves of each action.
 */
async function setGrantsOn(
  tx: TransactionContext,
  adapter: DrizzleAdapter,
  wanted: Map<string, Set<string>>,
  permissionIds: Map<string, string[]>,
  superAdmin: string | null
): Promise<{ changed: Set<string>; moves: Map<string, GrantMoves> }> {
  const all = [...permissionIds.values()].flat();
  const holders = await directHolders(tx, all);
  const roles = new Set([
    ...holders.keys(),
    ...[...wanted.values()].flatMap(set => [...set]),
  ]);
  if (superAdmin !== null) roles.delete(superAdmin);
  const moves = new Map<string, GrantMoves>();
  const service = new RolePermissionService(adapter, logger());
  const changed = new Set<string>();
  for (const roleId of [...roles].sort()) {
    const held = new Set(
      (
        await tx.select<{ permissionId: unknown }>("role_permissions", {
          columns: ["permissionId"],
          where: { and: [{ column: "roleId", op: "=", value: roleId }] },
        })
      ).map(row => String(row.permissionId))
    );
    const desired = new Set(held);
    for (const [action, ids] of permissionIds) {
      const wants = wanted.get(action)?.has(roleId) === true;
      const heldAll = ids.every(id => held.has(id));
      const heldAny = ids.some(id => held.has(id));
      const move = moves.get(action) ?? { granted: [], revoked: [] };
      if (wants && !heldAll) move.granted.push(roleId);
      if (!wants && heldAny) move.revoked.push(roleId);
      moves.set(action, move);
      for (const id of ids) {
        if (wants) desired.add(id);
        else desired.delete(id);
      }
    }
    if (desired.size !== held.size || [...desired].some(id => !held.has(id))) {
      await service.replaceRolePermissionsOn(tx, roleId, [...desired]);
      changed.add(roleId);
    }
  }
  return { changed, moves };
}

const staleSettings = (workflow: string): NextlyError =>
  NextlyError.conflict({
    reason: "version",
    logContext: { refusal: "workflow-settings-stale", workflow },
  });

/**
 * Changes a workflow's settings over the revision the caller read, and answers them as they then
 * read. Refuses, changing nothing: a stage or step the workflow lacks, a default reviewer who
 * cannot take the stage's primary step on every attachment, a role that does not exist, and a
 * revision that is no longer the stored one. The settings and the grants commit together.
 *
 * @throws NextlyError `VALIDATION_ERROR` naming each problem; `CONFLICT` for a stale revision;
 *   `NOT_FOUND` for a workflow no one registered
 * @experimental
 */
export async function updateWorkflowSettings(
  adapter: DrizzleAdapter,
  slug: string,
  change: WorkflowSettingsChange,
  actor: RequestActor | null
): Promise<WorkflowSettingsView> {
  const registered = registeredWorkflow(slug);
  const { workflow } = registered;
  const planned = change.grants
    ? await plannedGrants(adapter, registered, change.grants)
    : null;
  const problems = [
    ...(change.defaultReviewers
      ? await reviewerProblems(adapter, registered, change.defaultReviewers)
      : []),
    ...(change.labels ? labelProblems(workflow, change.labels) : []),
    ...(planned?.problems ?? []),
  ];
  if (problems.length > 0) throw refused(problems);

  const stored = await readWorkflowSettings(adapter, workflow.slug);
  // Refused before any grant is touched; the write below asks again, atomically.
  if ((stored?.revision ?? 0) !== change.revision) {
    throw staleSettings(workflow.slug);
  }
  const before = stored?.settings ?? {};
  const after = merged(before, change);
  const expected = change.revision === 0 ? null : change.revision;
  const updatedBy = actor?.type === "user" ? (actor.id ?? null) : null;

  const writeSettings = async (tx: TransactionContext) => {
    // The transaction is the repository's database: its reads and writes are the same calls.
    const db = tx as unknown as ReviewStatesDb;
    if (
      !(await writeWorkflowSettings(
        db,
        workflow.slug,
        after,
        expected,
        updatedBy
      ))
    ) {
      throw staleSettings(workflow.slug);
    }
  };

  let moves = new Map<string, GrantMoves>();
  try {
    if (planned && planned.byAction.size > 0) {
      const superAdmin = await superAdminRoleId(adapter);
      const permissionIds = await permissionsToSet(adapter, registered, [
        ...planned.byAction.keys(),
      ]);
      moves = await changingRoleGrants(async () => {
        let outcome = {
          changed: new Set<string>(),
          moves: new Map<string, GrantMoves>(),
        };
        await adapter.transaction(async tx => {
          await writeSettings(tx);
          outcome = await setGrantsOn(
            tx,
            adapter,
            planned.byAction,
            permissionIds,
            superAdmin
          );
        });
        // Announced once committed: each changed role's cached answers retired, then the
        // scheduled releases checked once.
        for (const roleId of outcome.changed) {
          await afterRoleGrantsChanged(roleId, { recheckReleases: false });
        }
        if (outcome.changed.size > 0) await afterGrantsChanged();
        return outcome.moves;
      });
    } else {
      await adapter.transaction(writeSettings);
    }
  } catch (error) {
    // A concurrent first write is refused by the unique index rather than the revision: read
    // again, and a revision that moved is the stale write it is.
    if (!NextlyError.is(error)) {
      const now = await readWorkflowSettings(adapter, workflow.slug);
      if ((now?.revision ?? 0) !== change.revision) {
        throw staleSettings(workflow.slug);
      }
    }
    throw error;
  }

  await recordChange(registered, change, before, after, moves, actor);
  return readWorkflowSettingsView(adapter, workflow.slug);
}

/**
 * Records a committed change in the activity log: the settings it moved, by name, and for each
 * step named in `grants` the roles that gained and lost its permission. Never throws: the change
 * has happened, and a trail that could not be written is logged instead.
 */
async function recordChange(
  registered: RegisteredWorkflow,
  change: WorkflowSettingsChange,
  before: WorkflowSettings,
  after: WorkflowSettings,
  moves: Map<string, GrantMoves>,
  actor: RequestActor | null
): Promise<void> {
  const grantable = grantableActions(registered.workflow);
  const grants: Record<string, GrantMoves> = {};
  for (const step of Object.keys(change.grants ?? {})) {
    const move = moves.get(grantable.get(step) ?? "");
    if (move && (move.granted.length > 0 || move.revoked.length > 0)) {
      grants[step] = { granted: [...move.granted], revoked: [...move.revoked] };
    }
  }
  const changedFields = [
    ...changedSettings(before, after),
    ...Object.keys(grants).map(step => `grants.${step}`),
  ];
  try {
    await recordSettingsActivity({
      action: "update",
      collection: WORKFLOW_SETTINGS_ACTIVITY_COLLECTION,
      entityId: registered.workflow.slug,
      entityTitle: registered.workflow.label,
      changedFields,
      metadata: {
        workflow: registered.workflow.slug,
        ...(Object.keys(grants).length > 0 ? { grants } : {}),
      },
      actor,
    });
  } catch (error) {
    getNextlyLogger().warn({
      kind: "workflow-settings-activity-failed",
      workflow: registered.workflow.slug,
      message: error instanceof Error ? error.message : String(error),
    });
  }
}
