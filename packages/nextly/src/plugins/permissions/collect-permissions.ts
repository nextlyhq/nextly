import type { NextlyServiceConfig } from "../../di/register";
import { isSystemResource } from "../../schemas/_zod/rbac";
import type { PluginPermission } from "../contributions";
import { permissionCollisionError } from "../permission-error";
import type { PluginDefinition } from "../plugin-context";

/** A custom permission resolved to its concrete, seedable shape. */
export interface CollectedPermission {
  action: string;
  resource: string;
  /** `${action}-${resource}` — matches the existing CRUD slug convention. */
  slug: string;
  name: string;
  description?: string;
  /** Declaring plugin name ("app" for app-declared). Persisted on the row. */
  owner: string;
  /**
   * Heading within the owner's section. Defaulted here rather than left
   * undefined, so grouping never has to decide what an absent group means.
   */
  group: string;
  /** True for a permission the admin should warn before granting. */
  danger: boolean;
}

/** Where a permission lands when its plugin does not group its own. */
export const DEFAULT_PERMISSION_GROUP = "General";

// The actions the auto-seeder has always owned for a collection or single slug.
// A plugin declaring one of these on such a slug collides with the seeded row,
// and always would have, so the declaration is an authoring error and is
// rejected.
const CRUD_ACTIONS = new Set(["create", "read", "update", "delete"]);
const SINGLE_ACTIONS = new Set(["read", "update"]);

// Actions the seeder owns as of the publish lifecycle, but which were legal for
// a plugin to declare before it.
//
// These are ADOPTED rather than rejected. The seeder now emits exactly the same
// slug (`publish-posts`), so the declaration is redundant, not conflicting —
// and rejecting it would stop an already-installed app from booting the moment
// it upgraded, on a declaration that was valid when it was written. Dropping it
// here leaves the permission in place, seeded, under the same slug, with grants
// intact because rows are matched on action and resource.
//
// The distinction matters beyond politeness: a plugin-declared row carries an
// `owner`, and `markOrphanedPermissions` only considers owned rows. Letting the
// declaration through would put a permission the seeder depends on at risk of
// being swept the day the plugin is removed.
const ADOPTED_LIFECYCLE_ACTIONS = new Set(["publish", "unpublish"]);

const titleCase = (s: string): string =>
  s
    .split(/[-_\s]+/)
    .filter(Boolean)
    .map(w => w.charAt(0).toUpperCase() + w.slice(1))
    .join(" ");

/**
 * Fold every plugin's `contributes.permissions` into a deduped, collision-
 * validated list of seedable custom permissions. Pure. Runs over ALL
 * plugins incl. disabled ones so declarative permissions stay deterministic
 * across environments (D49 — same policy as the schema fold). Throws
 * `NEXTLY_PERMISSION_COLLISION` on:
 *  - the same (action,resource) declared by two sources (duplicate-permission);
 *  - a resource that is a built-in system resource (system-resource-reserved);
 *  - a CRUD action on a collection slug / read|update on a single slug, which
 *    the auto-seeder already owns (crud-permission-reserved).
 *
 * `publish` and `unpublish` on such a slug are the exception: the seeder owns
 * them too, but only since the publish lifecycle landed, so a declaration is
 * silently dropped instead of rejected. See `ADOPTED_LIFECYCLE_ACTIONS`.
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
    const ownedByEntity =
      collectionSlugs.has(resource) || singleSlugs.has(resource);

    // Redundant with what the seeder now emits, and valid before it did. Drop
    // it and carry on rather than failing the boot of an app that upgraded.
    if (ADOPTED_LIFECYCLE_ACTIONS.has(action) && ownedByEntity) {
      return;
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
      // `group` was accepted and dropped: the interface documented it, the
      // canonical example set it, and nothing ever read it.
      group: perm.group?.trim() || DEFAULT_PERMISSION_GROUP,
      danger: perm.danger === true,
    });
  };

  // App-declared permissions first (owner "app"), then each plugin's.
  for (const perm of config.permissions ?? []) consider(perm, "app");
  for (const plugin of plugins) {
    for (const perm of plugin.contributes?.permissions ?? []) {
      consider(perm, plugin.name);
    }
  }

  return out;
}
