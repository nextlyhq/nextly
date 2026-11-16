import type { DrizzleAdapter } from "@nextlyhq/adapter-drizzle";

import { createSeededRole } from "../../database/seeders/create-seeded-role";
import { serviceContainerFor } from "../../services/service-container-for";
import type { Logger } from "../../services/shared";

import type { CollectedRole } from "./collect-roles";

/**
 * Seed plugin/app-declared role bundles. Idempotent — a role whose slug
 * already exists is skipped (never clobbers an admin's edits). Resolves each
 * role's permission slugs to ids; an unresolvable slug is logged and skipped
 * (the role is still created with its resolvable permissions) so one bad
 * reference can't abort seeding. Roles are `isSystem: false` and never
 * auto-assigned to users.
 *
 * Mirrors the super-admin seeder: builds a `ServiceContainer` from the adapter
 * so it doesn't depend on the DI service graph being fully wired.
 *
 * With `deferIncomplete`, a role naming a permission that does not exist yet is
 * not made at all, and is said: a role is made once and never revisited, so one
 * made without that permission would lack it for good once it exists. A later
 * run makes it whole. `nextly migrate` seeds so, where a permission may still
 * be on its way (one a workflow seeds, at a start that judges the workflows).
 */
export async function seedPluginRoles(
  adapter: DrizzleAdapter,
  collected: CollectedRole[],
  logger: Logger,
  options: { deferIncomplete?: boolean } = {}
): Promise<void> {
  if (collected.length === 0) return;

  // Loaded when roles are seeded, not by importing this module: the container
  // imports every core service.
  const container = await serviceContainerFor(adapter);
  const roleService = container.roles;
  const permissionService = container.permissions;

  // One bulk read → slug → id lookup for permission resolution.
  const all = await permissionService.listPermissions({ limit: 100000 });
  const slugToId = new Map(all.data.map(p => [p.slug, p.id]));

  for (const role of collected) {
    try {
      const existing = await roleService.findRoleIdBySlug(role.slug);
      if (existing) continue; // idempotent

      const permissionIds = permissionIdsOf(
        role,
        slugToId,
        logger,
        options.deferIncomplete === true
      );
      if (permissionIds === undefined) continue;

      await createSeededRole(
        roleService,
        {
          name: role.name,
          slug: role.slug,
          description: role.description,
          level: role.level,
          isSystem: false,
          permissionIds,
        },
        logger
      );
    } catch (error) {
      logger.warn?.(
        `Failed to seed role "${role.slug}" (${role.owner}): ${
          error instanceof Error ? error.message : String(error)
        }`
      );
    }
  }
}

/**
 * The ids of the permissions `role` bundles, an unknown slug said and left out;
 * or, with `deferIncomplete`, `undefined` while any of them does not exist yet,
 * said once, so the role is not made without it.
 */
function permissionIdsOf(
  role: CollectedRole,
  slugToId: ReadonlyMap<string, string>,
  logger: Logger,
  deferIncomplete: boolean
): string[] | undefined {
  const missing = role.permissionSlugs.filter(slug => !slugToId.has(slug));
  if (deferIncomplete && missing.length > 0) {
    logger.warn?.(
      `Role "${role.slug}" (${role.owner}) was not created yet: it bundles permission(s) that do not exist yet (${missing.join(", ")}). It is created once they do.`
    );
    return undefined;
  }
  for (const slug of missing) {
    logger.warn?.(
      `Role "${role.slug}" (${role.owner}) references unknown permission "${slug}" — skipping that permission.`
    );
  }
  return role.permissionSlugs.flatMap(slug => {
    const id = slugToId.get(slug);
    return id === undefined ? [] : [id];
  });
}
