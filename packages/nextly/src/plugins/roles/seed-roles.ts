import type { DrizzleAdapter } from "@nextlyhq/adapter-drizzle";

import { ServiceContainer } from "../../services/index";
import type { Logger } from "../../services/shared";

import type { CollectedRole } from "./collect-roles";

/**
 * Seed plugin/app-declared role bundles (D67). Idempotent — a role whose slug
 * already exists is skipped (never clobbers an admin's edits). Resolves each
 * role's permission slugs to ids; an unresolvable slug is logged and skipped
 * (the role is still created with its resolvable permissions) so one bad
 * reference can't abort seeding. Roles are `isSystem: false` and never
 * auto-assigned to users.
 *
 * Mirrors the super-admin seeder: builds a `ServiceContainer` from the adapter
 * so it doesn't depend on the DI service graph being fully wired.
 */
export async function seedPluginRoles(
  adapter: DrizzleAdapter,
  collected: CollectedRole[],
  logger: Logger
): Promise<void> {
  if (collected.length === 0) return;

  const container = new ServiceContainer(adapter);
  const roleService = container.roles;
  const permissionService = container.permissions;

  // One bulk read → slug → id lookup for permission resolution.
  const all = await permissionService.listPermissions({ limit: 100000 });
  const slugToId = new Map(all.data.map(p => [p.slug, p.id]));

  for (const role of collected) {
    try {
      const existing = await roleService.findRoleIdBySlug(role.slug);
      if (existing) continue; // idempotent

      const permissionIds: string[] = [];
      for (const slug of role.permissionSlugs) {
        const id = slugToId.get(slug);
        if (!id) {
          logger.warn?.(
            `Role "${role.slug}" (${role.owner}) references unknown permission "${slug}" — skipping that permission.`
          );
          continue;
        }
        permissionIds.push(id);
      }

      await roleService.createRole({
        name: role.name,
        slug: role.slug,
        description: role.description,
        level: role.level,
        isSystem: false,
        permissionIds,
      });
    } catch (error) {
      logger.warn?.(
        `Failed to seed role "${role.slug}" (${role.owner}): ${
          error instanceof Error ? error.message : String(error)
        }`
      );
    }
  }
}
