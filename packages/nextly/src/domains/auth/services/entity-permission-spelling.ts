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

/** The stored spelling of one per-entity permission. */
export interface EntityPermissionSpelling {
  slug: string;
  name: string;
  description: string;
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
  const actionLabel = action.charAt(0).toUpperCase() + action.slice(1);
  return {
    slug: permissionSlug(action, resource),
    name: `${actionLabel} ${label}`,
    description: `Permission to ${action} ${label.toLowerCase()}`,
  };
}
