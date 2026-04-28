import type { DrizzleAdapter } from "@revnixhq/adapter-drizzle";
import { eq } from "drizzle-orm";

import type { RBACDatabaseInstance } from "@nextly/types/rbac-operations";

import { SYSTEM_RESOURCES } from "../../../schemas/rbac";
import { BaseService } from "../../../services/base-service";
import type { Logger } from "../../../services/shared";

import { PermissionService } from "./permission-service";
import { RolePermissionService } from "./role-permission-service";

/**
 * Result from a seeding operation.
 */
export interface SeedResult {
  /** Number of permissions newly created */
  created: number;
  /** Number of permissions that already existed (skipped) */
  skipped: number;
  /** Number of errors encountered */
  errors: number;
  /** Total permissions processed */
  total: number;
  /** IDs of newly created permissions (for super_admin assignment) */
  newPermissionIds: string[];
}

/**
 * Definition for a single system permission.
 */
interface SystemPermissionDef {
  name: string;
  slug: string;
  action: string;
  resource: string;
  description: string;
}

/**
 * System permissions that are always seeded regardless of dynamic collections.
 * These represent core Nextly entity permissions.
 */
const SYSTEM_PERMISSIONS: SystemPermissionDef[] = [
  {
    name: "Create Users",
    slug: "create-users",
    action: "create",
    resource: "users",
    description: "Permission to create users",
  },
  {
    name: "Read Users",
    slug: "read-users",
    action: "read",
    resource: "users",
    description: "Permission to read users",
  },
  {
    name: "Update Users",
    slug: "update-users",
    action: "update",
    resource: "users",
    description: "Permission to update users",
  },
  {
    name: "Delete Users",
    slug: "delete-users",
    action: "delete",
    resource: "users",
    description: "Permission to delete users",
  },
  {
    name: "Create Roles",
    slug: "create-roles",
    action: "create",
    resource: "roles",
    description: "Permission to create roles",
  },
  {
    name: "Read Roles",
    slug: "read-roles",
    action: "read",
    resource: "roles",
    description: "Permission to read roles",
  },
  {
    name: "Update Roles",
    slug: "update-roles",
    action: "update",
    resource: "roles",
    description: "Permission to update roles",
  },
  {
    name: "Delete Roles",
    slug: "delete-roles",
    action: "delete",
    resource: "roles",
    description: "Permission to delete roles",
  },
  {
    name: "Manage Media",
    slug: "manage-media",
    action: "manage",
    resource: "media",
    description: "Permission to upload and manage media files",
  },
  {
    name: "Create Media",
    slug: "create-media",
    action: "create",
    resource: "media",
    description: "Permission to upload media files",
  },
  {
    name: "Read Media",
    slug: "read-media",
    action: "read",
    resource: "media",
    description: "Permission to view media files",
  },
  {
    name: "Delete Media",
    slug: "delete-media",
    action: "delete",
    resource: "media",
    description: "Permission to delete media files",
  },
  {
    name: "Manage Settings",
    slug: "manage-settings",
    action: "manage",
    resource: "settings",
    description: "Permission to manage system settings",
  },
  {
    name: "Read Settings",
    slug: "read-settings",
    action: "read",
    resource: "settings",
    description: "Permission to read system settings",
  },
  {
    name: "Manage Email Providers",
    slug: "manage-email-providers",
    action: "manage",
    resource: "email-providers",
    description: "Permission to manage email providers",
  },
  {
    name: "Create Email Providers",
    slug: "create-email-providers",
    action: "create",
    resource: "email-providers",
    description: "Permission to create email providers",
  },
  {
    name: "Read Email Providers",
    slug: "read-email-providers",
    action: "read",
    resource: "email-providers",
    description: "Permission to read email providers",
  },
  {
    name: "Delete Email Providers",
    slug: "delete-email-providers",
    action: "delete",
    resource: "email-providers",
    description: "Permission to delete email providers",
  },
  {
    name: "Manage Email Templates",
    slug: "manage-email-templates",
    action: "manage",
    resource: "email-templates",
    description: "Permission to manage email templates",
  },
  {
    name: "Create Email Templates",
    slug: "create-email-templates",
    action: "create",
    resource: "email-templates",
    description: "Permission to create email templates",
  },
  {
    name: "Read Email Templates",
    slug: "read-email-templates",
    action: "read",
    resource: "email-templates",
    description: "Permission to read email templates",
  },
  {
    name: "Delete Email Templates",
    slug: "delete-email-templates",
    action: "delete",
    resource: "email-templates",
    description: "Permission to delete email templates",
  },
  {
    name: "Manage API Keys",
    slug: "manage-api-keys",
    action: "update",
    resource: "api-keys",
    description: "Permission to create and manage API keys",
  },
  {
    name: "Create API Keys",
    slug: "create-api-keys",
    action: "create",
    resource: "api-keys",
    description: "Permission to create API keys",
  },
  {
    name: "Read API Keys",
    slug: "read-api-keys",
    action: "read",
    resource: "api-keys",
    description: "Permission to read API keys",
  },
  {
    name: "Delete API Keys",
    slug: "delete-api-keys",
    action: "delete",
    resource: "api-keys",
    description: "Permission to delete API keys",
  },
];

/**
 * PermissionSeedService auto-generates CRUD permissions for collections,
 * singles, and system resources.
 *
 * All operations are idempotent — permissions are checked for existence
 * before insertion. Newly created permissions are returned so they can
 * be assigned to the super_admin role.
 *
 * @example
 * ```typescript
 * const seedService = new PermissionSeedService(db, tables);
 * const result = await seedService.seedAllCollectionPermissions();
 * await seedService.assignNewPermissionsToSuperAdmin(result.newPermissionIds);
 * ```
 */
export class PermissionSeedService extends BaseService {
  private _permissionService?: PermissionService;
  private _rolePermissionService?: RolePermissionService;

  constructor(adapter: DrizzleAdapter, logger: Logger) {
    super(adapter, logger);
  }

  private get permissionService(): PermissionService {
    if (!this._permissionService) {
      this._permissionService = new PermissionService(
        this.adapter,
        this.logger
      );
    }
    return this._permissionService;
  }

  private get rolePermissionService(): RolePermissionService {
    if (!this._rolePermissionService) {
      this._rolePermissionService = new RolePermissionService(
        this.adapter,
        this.logger
      );
    }
    return this._rolePermissionService;
  }

  /**
   * Seed all system resource permissions.
   *
   * Ensures all permissions from the SYSTEM_PERMISSIONS constant exist.
   * System permissions cover: users, roles, permissions, media, settings,
   * email-providers, email-templates.
   */
  async seedSystemPermissions(): Promise<SeedResult> {
    const result = this.emptySeedResult();

    for (const perm of SYSTEM_PERMISSIONS) {
      result.total++;
      try {
        // PR 4 migration: ensurePermission now returns `{ id, created }`
        // and throws NextlyError on failure instead of the legacy
        // `{success, statusCode, data}` shape.
        const ensureResult = await this.permissionService.ensurePermission(
          perm.action,
          perm.resource,
          perm.name,
          perm.slug,
          perm.description
        );

        if (ensureResult.created) {
          result.created++;
          result.newPermissionIds.push(ensureResult.id);
        } else {
          result.skipped++;
        }
      } catch {
        result.errors++;
      }
    }

    return result;
  }

  /**
   * Seed CRUD permissions for a single collection.
   *
   * Creates 4 permissions: create, read, update, delete for the given slug.
   *
   * @param collectionSlug - The collection slug (e.g., "posts", "products")
   */
  async seedCollectionPermissions(collectionSlug: string): Promise<SeedResult> {
    const result = this.emptySeedResult();
    const label = this.slugToLabel(collectionSlug);
    const actions = ["create", "read", "update", "delete"] as const;

    for (const action of actions) {
      const actionLabel = action.charAt(0).toUpperCase() + action.slice(1);
      const name = `${actionLabel} ${label}`;
      const slug = `${action}-${collectionSlug}`;
      const description = `Permission to ${action} ${label.toLowerCase()}`;

      result.total++;
      try {
        const ensureResult = await this.permissionService.ensurePermission(
          action,
          collectionSlug,
          name,
          slug,
          description
        );

        if (ensureResult.created) {
          result.created++;
          result.newPermissionIds.push(ensureResult.id);
        } else {
          result.skipped++;
        }
      } catch {
        result.errors++;
      }
    }

    return result;
  }

  /**
   * Seed read/update permissions for a single (global document).
   *
   * Singles have no create/delete lifecycle — they are auto-created on first
   * access and cannot be deleted. Only read and update permissions are generated.
   *
   * @param singleSlug - The single slug (e.g., "site-settings", "header")
   */
  async seedSinglePermissions(singleSlug: string): Promise<SeedResult> {
    const result = this.emptySeedResult();
    const label = this.slugToLabel(singleSlug);
    const actions = ["read", "update"] as const;

    for (const action of actions) {
      const actionLabel = action.charAt(0).toUpperCase() + action.slice(1);
      const name = `${actionLabel} ${label}`;
      const slug = `${action}-${singleSlug}`;
      const description = `Permission to ${action} ${label.toLowerCase()}`;

      result.total++;
      try {
        const ensureResult = await this.permissionService.ensurePermission(
          action,
          singleSlug,
          name,
          slug,
          description
        );

        if (ensureResult.created) {
          result.created++;
          result.newPermissionIds.push(ensureResult.id);
        } else {
          result.skipped++;
        }
      } catch {
        result.errors++;
      }
    }

    return result;
  }

  /**
   * Seed permissions for ALL dynamic collections.
   *
   * Reads all collection slugs from the `dynamic_collections` table
   * (including plugin-registered collections) and seeds 4 CRUD permissions
   * for each.
   */
  async seedAllCollectionPermissions(): Promise<SeedResult> {
    const result = this.emptySeedResult();

    try {
      const slugs = await this.getAllCollectionSlugs();

      for (const slug of slugs) {
        // Skip system resources — they have their own permissions via seedSystemPermissions()
        if ((SYSTEM_RESOURCES as readonly string[]).includes(slug)) {
          continue;
        }

        const collectionResult = await this.seedCollectionPermissions(slug);
        this.mergeSeedResult(result, collectionResult);
      }
    } catch {
      // Table may not exist yet (fresh DB). Return empty result.
      this.logger.warn(
        "Could not read dynamic_collections table — skipping collection permission seeding."
      );
    }

    return result;
  }

  /**
   * Seed permissions for ALL registered singles.
   *
   * Reads all single slugs from the `dynamic_singles` table and seeds
   * read/update permissions for each.
   */
  async seedAllSinglePermissions(): Promise<SeedResult> {
    const result = this.emptySeedResult();

    try {
      const slugs = await this.getAllSingleSlugs();

      for (const slug of slugs) {
        const singleResult = await this.seedSinglePermissions(slug);
        this.mergeSeedResult(result, singleResult);
      }
    } catch {
      // Table may not exist yet (fresh DB). Return empty result.
      this.logger.warn(
        "Could not read dynamic_singles table — skipping single permission seeding."
      );
    }

    return result;
  }

  /**
   * Assign newly created permissions to the super_admin role.
   *
   * Ensures the super_admin role retains full access when new permissions
   * are generated. Only assigns permissions that aren't already assigned.
   *
   * @param permissionIds - IDs of newly created permissions to assign
   */
  async assignNewPermissionsToSuperAdmin(
    permissionIds: string[]
  ): Promise<void> {
    if (permissionIds.length === 0) return;

    try {
      const { roles } = this.tables;

      const superAdminRole = await this.db
        .select({ id: roles.id })
        .from(roles)
        .where(eq(roles.slug, "super-admin"))
        .limit(1)
        .then(
          (rows: unknown[]) => (rows[0] as { id: unknown } | undefined) ?? null
        );

      if (!superAdminRole) {
        // On a fresh database the super-admin role is created during the
        // first-time onboarding flow (seedSuperAdmin), not during permission
        // sync. Log at debug level instead of warn so a clean dev boot
        // doesn't look like something broke.
        this.logger.debug(
          "super-admin role not found yet — permissions will be assigned during onboarding."
        );
        return;
      }

      const roleId = String(superAdminRole.id);

      for (const permissionId of permissionIds) {
        const existing = await (
          this.db as RBACDatabaseInstance
        ).query.rolePermissions.findFirst({
          // Required by Drizzle ORM: relational query `where` callback is not
          // narrowly typed without importing internal Drizzle helper types.
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          where: (rp: any, { and: andFn, eq: eqFn }: any) =>
            andFn(eqFn(rp.roleId, roleId), eqFn(rp.permissionId, permissionId)),
          columns: { id: true },
        });

        if (!existing) {
          // PR 4 migration: getPermissionById now returns the data directly
          // and throws NextlyError(NOT_FOUND) for missing/hidden permissions.
          // Wrap in try/catch so a missing permission silently skips the
          // assignment (preserves the legacy "no-op on miss" behavior).
          try {
            const perm =
              await this.permissionService.getPermissionById(permissionId);

            await this.rolePermissionService.addPermissionToRole(roleId, {
              action: perm.action,
              resource: perm.resource,
              name: perm.name,
              slug: perm.slug,
            });
          } catch {
            // Permission missing or hidden — skip without error, matching
            // the legacy `if (permResult.success && permResult.data)` guard.
          }
        }
      }

      this.logger.info?.(
        `Assigned ${permissionIds.length} new permission(s) to super-admin role.`
      );
    } catch (error) {
      this.logger.warn(
        `Failed to assign permissions to super-admin: ${error instanceof Error ? error.message : String(error)}`
      );
    }
  }

  /**
   * Delete all permissions for a specific collection or single.
   *
   * Removes all permissions where the resource matches the given slug.
   * First removes the permissions from all roles, then deletes the permissions.
   * This is typically called when a collection or single is deleted.
   *
   * @param resourceSlug - The collection or single slug (e.g., "posts", "site-settings")
   * @returns Result with count of deleted permissions
   */
  async deletePermissionsForResource(
    resourceSlug: string
  ): Promise<SeedResult> {
    const result = this.emptySeedResult();

    try {
      // PR 4 migration: listPermissions now returns `{data, meta}` directly
      // and throws on DB errors instead of wrapping in `{success, data}`.
      const allPerms = await this.permissionService.listPermissions({
        page: 1,
        pageSize: 10000,
      });

      const { rolePermissions, permissions } = this.tables;

      for (const perm of allPerms.data) {
        if (perm.resource === resourceSlug) {
          result.total++;

          try {
            await this.db
              .delete(rolePermissions)
              .where(eq(rolePermissions.permissionId, perm.id));

            // Delete the permission itself directly (bypass the role check)

            await this.db
              .delete(permissions)
              .where(eq(permissions.id, perm.id));

            result.created++;
            this.logger.info?.(
              `Deleted permission "${perm.slug}" for resource "${resourceSlug}"`
            );
          } catch (error) {
            result.skipped++;
            this.logger.warn?.(
              `Error deleting permission "${perm.slug}": ${error instanceof Error ? error.message : String(error)}`
            );
          }
        }
      }

      if (result.created > 0) {
        this.logger.info?.(
          `Deleted ${result.created} permission(s) for resource "${resourceSlug}"`
        );
      }
    } catch (error) {
      this.logger.warn(
        `Failed to delete permissions for resource "${resourceSlug}": ${error instanceof Error ? error.message : String(error)}`
      );
      result.errors++;
    }

    return result;
  }

  /**
   * Remove permissions for dynamic resources that no longer exist.
   *
   * This is NOT auto-run — it must be called explicitly to prevent
   * accidental permission loss. Removes permissions whose resource is not
   * a system resource and not found in dynamic_collections,
   * dynamic_singles, or dynamic_components.
   * First removes permissions from all roles, then deletes the permissions.
   */
  async cleanupOrphanedPermissions(): Promise<SeedResult> {
    const result = this.emptySeedResult();

    try {
      const collectionSlugs = await this.getAllCollectionSlugs();
      const singleSlugs = await this.getAllSingleSlugs();
      const componentSlugs = await this.getAllComponentSlugs();
      const knownResources = new Set([
        ...(SYSTEM_RESOURCES as readonly string[]),
        ...collectionSlugs,
        ...singleSlugs,
        ...componentSlugs,
      ]);

      // PR 4 migration: listPermissions now returns `{data, meta}` directly
      // and throws on DB errors. Failures bubble up to the outer catch
      // below, matching the legacy "if (!allPerms.data) return result"
      // graceful-degradation behavior.
      const allPerms = await this.permissionService.listPermissions({
        page: 1,
        pageSize: 10000,
      });

      const { rolePermissions, permissions } = this.tables;

      for (const perm of allPerms.data) {
        if (!knownResources.has(perm.resource)) {
          result.total++;

          try {
            await this.db
              .delete(rolePermissions)
              .where(eq(rolePermissions.permissionId, perm.id));

            // Delete the permission itself directly (bypass the role check)

            await this.db
              .delete(permissions)
              .where(eq(permissions.id, perm.id));

            result.created++;
            this.logger.info?.(
              `Cleaned up orphaned permission "${perm.slug}" (resource: ${perm.resource})`
            );
          } catch (error) {
            result.skipped++;
            this.logger.warn?.(
              `Error cleaning up permission "${perm.slug}": ${error instanceof Error ? error.message : String(error)}`
            );
          }
        }
      }

      if (result.created > 0) {
        this.logger.info?.(
          `Cleaned up ${result.created} orphaned permission(s)`
        );
      }
    } catch (error) {
      this.logger.warn(
        `Failed to cleanup orphaned permissions: ${error instanceof Error ? error.message : String(error)}`
      );
      result.errors++;
    }

    return result;
  }

  private async getAllCollectionSlugs(): Promise<string[]> {
    if (!this.tables?.dynamicCollections) return [];

    const rows = await this.db
      .select({ slug: this.tables.dynamicCollections.slug })
      .from(this.tables.dynamicCollections);

    return rows.map((row: { slug: string }) => String(row.slug));
  }

  private async getAllSingleSlugs(): Promise<string[]> {
    if (!this.tables?.dynamicSingles) return [];

    const rows = await this.db
      .select({ slug: this.tables.dynamicSingles.slug })
      .from(this.tables.dynamicSingles);

    return rows.map((row: { slug: string }) => String(row.slug));
  }

  private async getAllComponentSlugs(): Promise<string[]> {
    if (!this.tables?.dynamicComponents) return [];

    const rows = await this.db
      .select({ slug: this.tables.dynamicComponents.slug })
      .from(this.tables.dynamicComponents);

    return rows.map((row: { slug: string }) => String(row.slug));
  }

  private slugToLabel(slug: string): string {
    return slug
      .split("-")
      .map(word => word.charAt(0).toUpperCase() + word.slice(1))
      .join(" ");
  }

  private emptySeedResult(): SeedResult {
    return {
      created: 0,
      skipped: 0,
      errors: 0,
      total: 0,
      newPermissionIds: [],
    };
  }

  private mergeSeedResult(parent: SeedResult, child: SeedResult): void {
    parent.created += child.created;
    parent.skipped += child.skipped;
    parent.errors += child.errors;
    parent.total += child.total;
    parent.newPermissionIds.push(...child.newPermissionIds);
  }
}

export { SYSTEM_PERMISSIONS };
