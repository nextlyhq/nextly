import type { NextlyServiceConfig } from "../../di/register";
import { isSystemResource } from "../../schemas/_zod/rbac";
import type { PluginPermission } from "../contributions";
import { permissionCollisionError } from "../permission-error";
import type { PluginDefinition } from "../plugin-context";

/** A custom permission resolved to its concrete, seedable shape (D36). */
export interface CollectedPermission {
  action: string;
  resource: string;
  /** `${action}-${resource}` — matches the existing CRUD slug convention. */
  slug: string;
  name: string;
  description?: string;
  /** Declaring plugin name — provenance for logs (not persisted in P3a). */
  owner: string;
}

const CRUD_ACTIONS = new Set(["create", "read", "update", "delete"]);
const SINGLE_ACTIONS = new Set(["read", "update"]);

const titleCase = (s: string): string =>
  s
    .split(/[-_\s]+/)
    .filter(Boolean)
    .map(w => w.charAt(0).toUpperCase() + w.slice(1))
    .join(" ");

/**
 * Fold every plugin's `contributes.permissions` into a deduped, collision-
 * validated list of seedable custom permissions (D36). Pure. Runs over ALL
 * plugins incl. disabled ones so declarative permissions stay deterministic
 * across environments (D49 — same policy as the schema fold). Throws
 * `NEXTLY_PERMISSION_COLLISION` on:
 *  - the same (action,resource) declared by two sources (duplicate-permission);
 *  - a resource that is a built-in system resource (system-resource-reserved);
 *  - a CRUD action on a collection slug / read|update on a single slug, which
 *    the auto-seeder already owns (crud-permission-reserved).
 */
export function collectCustomPermissions(
  config: NextlyServiceConfig,
  plugins: PluginDefinition[]
): CollectedPermission[] {
  const collectionSlugs = new Set((config.collections ?? []).map(c => c.slug));
  const singleSlugs = new Set((config.singles ?? []).map(s => s.slug));
  const seen = new Map<string, string>(); // `${action}:${resource}` -> first owner
  const out: CollectedPermission[] = [];

  // One declared custom permission from a given owner ("app" or a plugin name).
  // Shared by the app and plugin passes so both validate + collide identically.
  const consider = (perm: PluginPermission, owner: string): void => {
    const { action, resource } = perm;
    const key = `${action}:${resource}`;

    const prev = seen.get(key);
    if (prev !== undefined) {
      throw permissionCollisionError(
        action,
        resource,
        [prev, owner],
        "duplicate-permission"
      );
    }
    if (isSystemResource(resource)) {
      throw permissionCollisionError(
        action,
        resource,
        [owner],
        "system-resource-reserved"
      );
    }
    if (
      (CRUD_ACTIONS.has(action) && collectionSlugs.has(resource)) ||
      (SINGLE_ACTIONS.has(action) && singleSlugs.has(resource))
    ) {
      throw permissionCollisionError(
        action,
        resource,
        [owner],
        "crud-permission-reserved"
      );
    }

    seen.set(key, owner);
    out.push({
      action,
      resource,
      slug: `${action}-${resource}`,
      name: perm.label ?? `${titleCase(action)} ${titleCase(resource)}`,
      description: perm.description,
      owner,
    });
  };

  // App-declared permissions first (owner "app"), then each plugin's (D36).
  for (const perm of config.permissions ?? []) consider(perm, "app");
  for (const plugin of plugins) {
    for (const perm of plugin.contributes?.permissions ?? []) {
      consider(perm, plugin.name);
    }
  }

  return out;
}
