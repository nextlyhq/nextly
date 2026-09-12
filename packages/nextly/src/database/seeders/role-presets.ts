/**
 * Applying the built-in role presets to a database.
 *
 * The presets THEMSELVES — what "Editor" means — are declared in
 * `auth/role-presets`, which takes no I/O and so can be read by callers that
 * only need to ask a predicate what it would grant. This module is the one use
 * of them that needs an adapter.
 *
 * They are re-exported here so every existing importer of this path keeps
 * working, and because a seeder is where most readers will look for them.
 *
 * @module database/seeders/role-presets
 */

import type { DrizzleAdapter } from "@nextlyhq/adapter-drizzle";

import { ServiceContainer } from "@nextly/services/index";

import {
  ROLE_PRESETS,
  resolvePreset,
  type PresetContext,
  type PresetPermission,
  type RolePreset,
} from "../../auth/role-presets";
import type { Logger } from "../../services/shared";

export {
  ROLE_PRESETS,
  resolvePreset,
  type PresetContext,
  type PresetPermission,
  type RolePreset,
};

/**
 * Create the preset roles, and bring existing ones back in line with what
 * their predicate now resolves to.
 *
 * Re-synced on every boot, not created once. A preset that was right when it
 * was written goes stale the moment a collection is added: the role would
 * still exist, still be assigned, and quietly not cover the new content.
 * Super Admin already works this way — it re-ensures every permission on each
 * boot — and a preset is the same promise narrowed.
 *
 * The cost is that edits to a preset do not survive, which is why they are
 * system roles: they are the framework's, and an admin who wants a variant
 * builds a custom role on top of one rather than editing it underneath. That
 * keeps "Editor means Editor" true across every project, and leaves the
 * variant visible as its own role instead of hidden as a drifted copy.
 *
 * Presets are never assigned to anyone. Defining a role is not granting it.
 */
export async function seedRolePresets(
  adapter: DrizzleAdapter,
  logger: Logger
): Promise<void> {
  const container = new ServiceContainer(adapter);
  const roleService = container.roles;
  const permissionService = container.permissions;
  const rolePermissionService = container.rolePermissions;

  const all = await permissionService.listPermissions({ limit: 100000 });
  const permissions = all.data.map(p => ({
    id: String(p.id),
    action: String(p.action),
    resource: String(p.resource),
    owner: p.owner ?? null,
  }));

  for (const preset of ROLE_PRESETS) {
    try {
      const matched = resolvePreset(preset, permissions);
      const permissionIds = permissions
        .filter(p => matched.includes(p))
        .map(p => p.id);

      // Returns the row, not the id, despite the name.
      const existing = await roleService.findRoleIdBySlug(preset.slug);

      if (!existing) {
        await roleService.createRole({
          name: preset.name,
          slug: preset.slug,
          description: preset.description,
          level: preset.level,
          isSystem: true,
          permissionIds,
        });
        continue;
      }

      await rolePermissionService.setRolePermissions(
        String(existing.id),
        permissionIds
      );
    } catch (error) {
      // One bad preset must not stop the rest, and must never stop boot.
      logger.warn?.(
        `Failed to seed role preset "${preset.slug}": ${
          error instanceof Error ? error.message : String(error)
        }`
      );
    }
  }
}
