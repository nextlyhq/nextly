import type { DrizzleAdapter } from "@nextlyhq/adapter-drizzle";

import { ServiceContainer } from "@nextly/services/index";

import { isSystemResource } from "../../schemas/_zod/rbac";
import type { Logger } from "../../services/shared";

/**
 * What a preset is shown a permission alongside, so it can decide without
 * knowing which collections a project happens to have.
 */
export interface PresetContext {
  /** True when the resource is one of the framework's own (users, roles, …). */
  isSystem: boolean;
  /** True when a plugin declared the permission. */
  isPlugin: boolean;
}

/** One permission, as a preset sees it. */
export interface PresetPermission {
  action: string;
  resource: string;
  owner: string | null;
}

/**
 * A named starting point for a role.
 *
 * `grants` is a predicate rather than a list of slugs, and that is the whole
 * point: a project's permissions are not known when this file is written. Add
 * a collection and its permissions exist a boot later; a frozen list would
 * describe the project as it was the day someone typed it out, and every
 * preset would quietly fall behind the content it is supposed to govern.
 */
export interface RolePreset {
  slug: string;
  name: string;
  description: string;
  /** Ordering only; it grants nothing and implies nothing. */
  level: number;
  grants: (permission: PresetPermission, context: PresetContext) => boolean;
}

/** Resources whose write actions hand out access, rather than use it. */
const ESCALATION_RESOURCES = new Set(["roles", "permissions", "users"]);

/** Actions that only ever read. */
const READ_ONLY_ACTIONS = new Set(["read"]);

/**
 * The presets every project starts with.
 *
 * Deliberately few. These are starting points, not an attempt to name every
 * job: anything more specific is a custom role built on one of these, which
 * is what role inheritance is for.
 *
 * Only `admin` picks up a plugin's permissions. A plugin's verb is one this
 * file has never heard of and cannot reason about — it could be exporting a
 * CSV or emptying a bucket — so granting it to `editor` by default would mean
 * installing a plugin silently widened what every editor can do. `viewer` is
 * the exception that proves the rule: it grants a plugin's `read`, because
 * `read` is a verb we do know the meaning of.
 */
export const ROLE_PRESETS: RolePreset[] = [
  {
    slug: "admin",
    name: "Admin",
    description: "Everything except granting access to others",
    level: 90,
    // Everything but escalation. Someone who can edit roles can give
    // themselves anything, so an admin who is not a super admin stops there.
    // Reading them is fine — it is changing them that escalates.
    grants: ({ action, resource }) =>
      !(ESCALATION_RESOURCES.has(resource) && !READ_ONLY_ACTIONS.has(action)),
  },
  {
    slug: "editor",
    name: "Editor",
    description: "Full control of content and media, including publishing",
    level: 50,
    // Content, whatever the project's content turns out to be. A system
    // resource is the framework's own furniture and not an editor's business,
    // with media the exception because content needs images.
    grants: ({ resource }, { isSystem, isPlugin }) =>
      (!isSystem && !isPlugin) || resource === "media",
  },
  {
    slug: "author",
    name: "Author",
    description: "Write content, but not publish or delete it",
    level: 30,
    // The same reach as an editor, minus the two irreversible-in-public
    // actions. `manage` is excluded because it is a superset we cannot see
    // inside, which is exactly what an author should not hold.
    grants: ({ action, resource }, { isSystem, isPlugin }) => {
      if (isPlugin) return false;
      if (isSystem && resource !== "media") return false;
      return !["delete", "publish", "manage"].includes(action);
    },
  },
  {
    slug: "viewer",
    name: "Viewer",
    description: "Read everything, change nothing",
    level: 10,
    grants: ({ action }) => READ_ONLY_ACTIONS.has(action),
  },
];

/** Which permissions a preset resolves to, against the live permission list. */
export function resolvePreset(
  preset: RolePreset,
  permissions: PresetPermission[]
): PresetPermission[] {
  return permissions.filter(permission =>
    preset.grants(permission, {
      isSystem: isSystemResource(permission.resource),
      isPlugin: permission.owner !== null,
    })
  );
}

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
