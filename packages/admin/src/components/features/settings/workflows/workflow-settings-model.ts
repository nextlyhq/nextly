/**
 * What the workflow settings screen reads off a workflow and its settings:
 * which stages take a default reviewer and which step they must hold, what a
 * stage is labelled, which steps no role holds, who may be offered as a
 * default reviewer, and where a refused change belongs on the screen.
 *
 * Pure, so each answer is tested without rendering, and the sections render
 * what these return rather than each deciding it again.
 *
 * @module components/features/settings/workflows/workflow-settings-model
 */

import type { ValidationIssue } from "@admin/lib/api/parseApiError";
import type { Role } from "@admin/types/entities";
import type { UserApiResponse } from "@admin/types/user";
import type {
  WorkflowAssignee,
  WorkflowSettingsView,
  WorkflowStageSummary,
  WorkflowStepSummary,
  WorkflowSummary,
} from "@admin/types/workflows";

/**
 * A stage's primary step: its only step out, or the one its code marks
 * primary. The step a stage's default reviewer must hold.
 */
export function primaryStepOf(
  workflow: WorkflowSummary,
  stage: string
): WorkflowStepSummary | undefined {
  const outgoing = workflow.steps.filter(step => step.from.includes(stage));
  return outgoing.length === 1
    ? outgoing[0]
    : outgoing.find(step => step.primary);
}

/** The review stages: each with a step of kind approve out of it, in order. */
export function reviewStages(
  workflow: WorkflowSummary
): WorkflowStageSummary[] {
  return workflow.stages.filter(stage =>
    workflow.steps.some(
      step => step.kind === "approve" && step.from.includes(stage.name)
    )
  );
}

/** A stage's label as shown: the one set in settings, else the code's. */
export function stageLabel(
  workflow: WorkflowSummary,
  settings: WorkflowSettingsView | undefined,
  stage: string
): string {
  return (
    settings?.labels[stage]?.label ??
    workflow.stages.find(each => each.name === stage)?.label ??
    stage
  );
}

/** Whether a stage's label or colour differs from what the code gives it. */
export function labelDiffersFromCode(
  stage: WorkflowStageSummary,
  settings: WorkflowSettingsView
): boolean {
  const set = settings.labels[stage.name];
  if (!set) return false;
  return (
    (set.label !== undefined && set.label !== stage.label) ||
    set.colour !== undefined
  );
}

/** The collections and Singles a workflow is attached to, read as a phrase. */
export function attachmentsPhrase(workflow: WorkflowSummary): string {
  return listPhrase([...workflow.collections, ...workflow.singles]);
}

/** Names joined as a sentence lists them: "a", "a and b", "a, b and c". */
export function listPhrase(names: readonly string[]): string {
  if (names.length <= 1) return names[0] ?? "";
  return `${names.slice(0, -1).join(", ")} and ${names[names.length - 1]}`;
}

/**
 * A permission no role holds on every attachment: the steps needing it, by
 * the order the code lists them. The super-admin role holds every step, so
 * these are steps only a super-admin can take.
 */
export interface UnheldPermission {
  permission: string;
  steps: WorkflowStepSummary[];
}

/** Every grantable step's permission that `grants` gives to no role, each once. */
export function unheldPermissions(
  workflow: WorkflowSummary,
  settings: WorkflowSettingsView
): UnheldPermission[] {
  const byPermission = new Map<string, WorkflowStepSummary[]>();
  for (const step of workflow.steps) {
    const grantable = settings.grantableSteps[step.name];
    if (!grantable || (settings.grants[step.name] ?? []).length > 0) continue;
    const steps = byPermission.get(grantable.permission) ?? [];
    steps.push(step);
    byPermission.set(grantable.permission, steps);
  }
  return [...byPermission].map(([permission, steps]) => ({
    permission,
    steps,
  }));
}

/** A permission some roles hold on part of the attachments only. */
export interface PartlyHeldPermission {
  permission: string;
  steps: WorkflowStepSummary[];
  roles: { id: string; name: string | null }[];
}

/**
 * Every grantable step's permission some roles hold on part of the
 * attachments only, each once with the steps needing it. Steps sharing a
 * permission share its holders, so the roles are read off the first.
 */
export function partlyHeldPermissions(
  workflow: WorkflowSummary,
  settings: WorkflowSettingsView
): PartlyHeldPermission[] {
  const byPermission = new Map<string, PartlyHeldPermission>();
  for (const step of workflow.steps) {
    const grantable = settings.grantableSteps[step.name];
    if (!grantable || grantable.partialRoles.length === 0) continue;
    const entry = byPermission.get(grantable.permission) ?? {
      permission: grantable.permission,
      steps: [],
      roles: grantable.partialRoles,
    };
    entry.steps.push(step);
    byPermission.set(grantable.permission, entry);
  }
  return [...byPermission.values()];
}

/** The super-admin role, which holds every step whatever it is granted. */
function superAdminOf(roles: readonly Role[]): Role | undefined {
  return roles.find(role => role.builtIn === "super-admin");
}

/**
 * The roles that hold a stage's primary step everywhere, as the grants read:
 * the roles granted it and the super-admin role. `null` where the grants
 * cannot tell: a stage with no primary step, or one whose step needs only the
 * collections' own permissions, which no workflow setting grants.
 */
export function rolesHoldingPrimary(
  workflow: WorkflowSummary,
  settings: WorkflowSettingsView,
  roles: readonly Role[],
  stage: string
): Set<string> | null {
  const primary = primaryStepOf(workflow, stage);
  if (!primary || !settings.grantableSteps[primary.name]) return null;
  const holding = new Set(settings.grants[primary.name] ?? []);
  const superAdmin = superAdminOf(roles);
  if (superAdmin) holding.add(superAdmin.id);
  return holding;
}

/** A default reviewer's option: a role, or a person. */
export interface ReviewerOption {
  assignee: WorkflowAssignee;
  label: string;
}

/**
 * Whom a stage's default reviewer may be chosen from: roles and people holding
 * its primary step, as {@link rolesHoldingPrimary} reads the grants; a person
 * holds it through any role they have. Where the grants cannot tell, every
 * role that can be given to someone, and every person, is offered, and the
 * server judges the choice when it is saved.
 */
export function reviewerOptions(
  workflow: WorkflowSummary,
  settings: WorkflowSettingsView,
  roles: readonly Role[],
  users: readonly UserApiResponse[],
  stage: string
): ReviewerOption[] {
  const holding = rolesHoldingPrimary(workflow, settings, roles, stage);
  const eligibleRoles = roles.filter(role =>
    holding === null ? role.assignable !== false : holding.has(role.id)
  );
  const eligibleUsers = users.filter(
    user =>
      holding === null || user.roles.some(role => holding.has(String(role.id)))
  );
  return [
    ...eligibleRoles.map(role => ({
      assignee: { kind: "role" as const, id: role.id },
      label: `${role.roleName || role.name} (the whole role)`,
    })),
    ...eligibleUsers.map(user => ({
      assignee: { kind: "user" as const, id: user.id },
      label: user.name || user.email,
    })),
  ];
}

/**
 * Whether a stage's default reviewer no longer holds its primary step, as far
 * as the grants tell: a role neither granted it nor super-admin. `null` where
 * they cannot tell: a person, or a step the grants do not cover.
 */
export function reviewerStillHolds(
  workflow: WorkflowSummary,
  settings: WorkflowSettingsView,
  roles: readonly Role[],
  stage: string
): boolean | null {
  const reviewer = settings.defaultReviewers[stage];
  if (!reviewer || reviewer.kind !== "role") return null;
  const holding = rolesHoldingPrimary(workflow, settings, roles, stage);
  return holding === null ? null : holding.has(reviewer.id);
}

/** The key two assignees share when they are the same person or role. */
export const assigneeKey = (assignee: WorkflowAssignee): string =>
  `${assignee.kind}:${assignee.id}`;

/**
 * Where on the screen a refused change belongs: the setting its path names,
 * `grants.<step>`, `defaultReviewers.<stage>` or `labels.<stage>`, whatever
 * part of it the server named after that.
 */
export function issueField(issue: ValidationIssue): string | null {
  if (!issue.path) return null;
  const [section, name] = issue.path.split(".");
  if (!section || !name) return null;
  return `${section}.${name}`;
}

/** Each refused setting's message, by the field {@link issueField} names. */
export function issuesByField(
  issues: readonly ValidationIssue[]
): Record<string, string> {
  const byField: Record<string, string> = {};
  for (const issue of issues) {
    const field = issueField(issue);
    if (field === null || !issue.message) continue;
    byField[field] = byField[field]
      ? `${byField[field]} ${issue.message}`
      : issue.message;
  }
  return byField;
}

/**
 * The workflow told as sentences, one per stage in order: what may be done
 * with a document there and where each step out of it leads. The diagram's
 * label for a screen reader, and its list.
 */
export function diagramSentences(
  workflow: WorkflowSummary,
  labelOf: (stage: string) => string
): string[] {
  return workflow.stages.map(stage => {
    const name = `${labelOf(stage.name)}${stage.allowsPublish ? " (may be published)" : ""}`;
    const outgoing = workflow.steps.filter(step =>
      step.from.includes(stage.name)
    );
    if (outgoing.length === 0) return `${name}: no step leads out of it.`;
    const steps = outgoing.map(
      step => `${step.label} moves it to ${labelOf(step.to)}`
    );
    return `${name}: ${steps.join("; ")}.`;
  });
}
