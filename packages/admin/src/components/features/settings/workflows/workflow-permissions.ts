/**
 * The permissions Settings › Workflows asks, read from the server's own policy
 * so the screen cannot come to ask for one permission while the routes ask for
 * another.
 *
 * @module components/features/settings/workflows/workflow-permissions
 */

import {
  slugsOf,
  SYSTEM_READ_POLICY,
  SYSTEM_WRITE_POLICY,
} from "@admin/lib/permissions/system-policy";

/**
 * Who may open the screens: whoever may read settings or change them, as the
 * workflow settings routes allow, so a grant of the change alone does not open
 * a page that cannot load.
 */
export const WORKFLOW_SETTINGS_READ: readonly string[] = [
  ...slugsOf(SYSTEM_READ_POLICY.settings.read),
  ...slugsOf(SYSTEM_WRITE_POLICY.settings.update),
];

/** Changing a workflow's settings: what the PATCH route asks. */
const WORKFLOW_SETTINGS_UPDATE: readonly string[] = slugsOf(
  SYSTEM_WRITE_POLICY.settings.update
);

/**
 * Changing who holds a step: the settings change and also updating roles, as
 * the PATCH route asks of a change naming `grants`.
 */
const WORKFLOW_GRANTS_UPDATE: readonly string[] = slugsOf(
  SYSTEM_WRITE_POLICY.roles.setPermissions
);

/**
 * Reading the roles a step's holders and a default reviewer are chosen from:
 * what the roles list asks. Without it the list is refused, so no choice of
 * roles is offered rather than an empty one.
 */
const ROLES_READ: readonly string[] = slugsOf(SYSTEM_READ_POLICY.roles.read);

/** What the reader may change, from the permissions they hold. */
export interface WorkflowSettingsAccess {
  /** Labels and colours, and emails. */
  update: boolean;
  /** Who holds each step: needs `update`, updating roles, and reading them. */
  grants: boolean;
  /** Each review stage's default reviewer: needs `update` and reading roles. */
  reviewers: boolean;
}

/** The changes `hasPermission` allows. */
export function workflowSettingsAccess(
  hasPermission: (slug: string) => boolean
): WorkflowSettingsAccess {
  const update = WORKFLOW_SETTINGS_UPDATE.some(hasPermission);
  const readsRoles = ROLES_READ.some(hasPermission);
  return {
    update,
    grants: update && readsRoles && WORKFLOW_GRANTS_UPDATE.some(hasPermission),
    reviewers: update && readsRoles,
  };
}
