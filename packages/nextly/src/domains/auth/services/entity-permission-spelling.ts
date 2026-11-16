/**
 * How a permission the framework creates for a collection or Single is
 * spelled: its slug, name and description, from its action and the entity's
 * slug.
 *
 * One function, read by the seeder that creates these permissions when an
 * entity is created and by the rename that moves them to an entity's new
 * slug, so a renamed entity's permissions read exactly as if it had been
 * created under the new name. Two spellings would drift, and a drifted slug is
 * a permission no check can find.
 *
 * @module domains/auth/services/entity-permission-spelling
 */

import { permissionSlug } from "../../../schemas/_zod/rbac";
import {
  WORKFLOW_PERMISSION_GROUP,
  workflowPermissionActions,
} from "../../workflows/permissions";
import type { Workflow } from "../../workflows/types";

/** The stored spelling of one per-entity permission. */
export interface EntityPermissionSpelling {
  slug: string;
  name: string;
  description: string;
}

/**
 * The actions the framework creates a permission for on every collection,
 * and on every Single. Stated once: the seeder creates them, the check that
 * decides whether a plugin may claim a permission reads them, and a migration
 * snapshot records them.
 */
export const COLLECTION_SEEDED_ACTIONS = [
  "create",
  "read",
  "update",
  "delete",
  "publish",
  "unpublish",
] as const;

export const SINGLE_SEEDED_ACTIONS = [
  "read",
  "update",
  "publish",
  "unpublish",
] as const;

/** One permission the framework creates for an entity, as it is stored. */
export interface EntityPermission extends EntityPermissionSpelling {
  action: string;
  resource: string;
  /** Null for a built-in one; the workflow group for one a workflow adds. */
  group: string | null;
}

/** The permissions the framework creates for every collection, or every Single, `slug`. */
export function builtInEntityPermissions(
  kind: "collection" | "single",
  slug: string
): EntityPermission[] {
  const actions =
    kind === "collection" ? COLLECTION_SEEDED_ACTIONS : SINGLE_SEEDED_ACTIONS;
  return actions.map(action => ({
    action,
    resource: slug,
    group: null,
    ...entityPermissionSpelling(action, slug),
  }));
}

/**
 * The permissions `workflow` adds to the entity `slug` it is attached to
 * (`workflowPermissionActions`), stored under the workflow group, which is
 * how the presets tell a workflow's from any other.
 */
export function workflowEntityPermissions(
  slug: string,
  workflow: Workflow
): EntityPermission[] {
  return workflowPermissionActions(workflow).map(action => ({
    action,
    resource: slug,
    group: WORKFLOW_PERMISSION_GROUP,
    ...entityPermissionSpelling(action, slug),
  }));
}

/** `blog-posts` reads `Blog Posts`. */
function slugToLabel(slug: string): string {
  return slug
    .split("-")
    .map(word => word.charAt(0).toUpperCase() + word.slice(1))
    .join(" ");
}

/** The slug, name and description of `action` on the entity `resource`. */
export function entityPermissionSpelling(
  action: string,
  resource: string
): EntityPermissionSpelling {
  const label = slugToLabel(resource);
  // Read as words, so an action of several (`publish-without-review`) is named like one of one.
  const actionLabel = slugToLabel(action);
  return {
    slug: permissionSlug(action, resource),
    name: `${actionLabel} ${label}`,
    description: `Permission to ${action.replace(/-/g, " ")} ${label.toLowerCase()}`,
  };
}
