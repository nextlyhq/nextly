/**
 * The permissions a workflow adds to each collection and Single it is attached to: each action its
 * steps name beyond the built-in ones (`approve` on Posts is held as `approve-posts`), and
 * `publish-without-review`, which publishes past the workflow and which no API key may hold.
 *
 * @module domains/workflows/permissions
 */
import { PermissionActionSchema } from "../../schemas/_zod/rbac";

import type { Workflow } from "./types";

/** The action a person needs to publish a document directly, past the workflow, with a reason. */
export const PUBLISH_WITHOUT_REVIEW = "publish-without-review";

/** The actions every collection or Single is seeded with already; a step naming one uses it. */
export const BUILT_IN_ACTIONS: ReadonlySet<string> = new Set(
  PermissionActionSchema.options
);

/**
 * The actions `workflow` adds to each collection and Single it is attached to, each once: its
 * steps' own actions, then `publish-without-review`.
 */
export function workflowPermissionActions(workflow: Workflow): string[] {
  const named = workflow.steps.flatMap(step =>
    step.permission !== null && !BUILT_IN_ACTIONS.has(step.permission)
      ? [step.permission]
      : []
  );
  return [...new Set([...named, PUBLISH_WITHOUT_REVIEW])];
}

/**
 * Whether a stored permission is a `publish-without-review` one, by its action or, as a second
 * reading of the same row, its slug: a row whose action was stored another way still names itself
 * by the slug it was seeded under.
 */
export function isPublishWithoutReview(permission: {
  action?: string | null;
  slug?: string | null;
}): boolean {
  return (
    permission.action?.toLowerCase() === PUBLISH_WITHOUT_REVIEW ||
    (permission.slug ?? "")
      .toLowerCase()
      .startsWith(`${PUBLISH_WITHOUT_REVIEW}-`)
  );
}

/** The group a workflow's seeded permissions are stored under, which marks where they came from. */
export const WORKFLOW_PERMISSION_GROUP = "workflow";

/**
 * Whether a stored permission row is one a workflow seeded: owned by no app or plugin, and stored
 * under the workflow group. Read from the row itself, so a row a workflow seeded stays one after
 * the workflow is detached or its step's action is renamed, when the registry no longer names it,
 * while a permission an admin created with an action of their own is not one.
 */
export function isWorkflowSeededRow(permission: {
  owner: string | null;
  group: string | null;
}): boolean {
  return (
    permission.owner === null && permission.group === WORKFLOW_PERMISSION_GROUP
  );
}

/**
 * Whether a permission is one the attached workflows seed (`workflowPermissionActions` on each of
 * their collections and Singles), matched without regard to case as permissions are.
 */
export function workflowSeededPermissions(
  attachments: readonly {
    workflow: Workflow;
    collections: readonly string[];
    singles: readonly string[];
  }[]
): (permission: { action: string; resource: string }) => boolean {
  const seeded = new Set(
    attachments.flatMap(({ workflow, collections, singles }) =>
      workflowPermissionActions(workflow).flatMap(action =>
        [...collections, ...singles].map(
          slug => `${action.toLowerCase()}|${slug.toLowerCase()}`
        )
      )
    )
  );
  return ({ action, resource }) =>
    seeded.has(`${action.toLowerCase()}|${resource.toLowerCase()}`);
}
