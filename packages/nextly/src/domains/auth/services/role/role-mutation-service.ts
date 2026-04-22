import { randomUUID } from "crypto";

import type { DrizzleAdapter } from "@revnixhq/adapter-drizzle";
import { eq, inArray } from "drizzle-orm";

import { mapDbErrorToServiceError } from "@nextly/services/lib/db-error";
import { invalidatePermissionCache } from "@nextly/services/lib/permissions";
import type {
  RBACDatabaseInstance,
  RoleInsertData,
} from "@nextly/types/rbac-operations";

import { BaseService } from "../../../../services/base-service";
import type { Logger } from "../../../../services/shared";

import { toDialectBool, validateRoleId } from "./utils";

/**
 * RoleMutationService handles all role create/update/delete operations.
 *
 * Responsibilities:
 * - Create roles with permissions and child roles
 * - Update roles
 * - Delete roles with cascade
 * - Ensure system roles exist
 *
 * @example
 * ```typescript
 * const mutationService = new RoleMutationService(adapter, logger);
 * const result = await mutationService.createRole({ name: 'Editor', ... });
 * ```
 */
export class RoleMutationService extends BaseService {
  /**
   * Creates a new RoleMutationService instance.
   *
   * @param adapter - Database adapter
   * @param logger - Logger instance
   */
  constructor(adapter: DrizzleAdapter, logger: Logger) {
    super(adapter, logger);
  }

  /**
   * Find role ID by slug (internal helper).
   *
   * @param slug - The role slug to search for
   * @returns Role ID or null if not found
   */
  private async findRoleIdBySlug(slug: string): Promise<{ id: string } | null> {
    const { roles } = this.tables;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const role = await (this.db as any)
      .selectDistinct({ id: roles.id })
      .from(roles)
      .where(eq(roles.slug, slug))
      .limit(1);
    return role && role.length > 0 ? { id: String(role[0].id) } : null;
  }

  /**
   * Ensure super admin role exists (idempotent).
   *
   * @returns Role ID and whether it was newly created
   */
  async ensureSuperAdminRole(): Promise<{ id: string; created: boolean }> {
    // Ensure a system role with slug 'super-admin' exists; it may have zero permissions
    const existing = await this.findRoleIdBySlug("super-admin");
    if (existing) return { id: existing.id, created: false };

    const id = randomUUID();
    const roleData: RoleInsertData = {
      id,
      name: "Super Admin",
      slug: "super-admin",
      description: "Grants implicit access to all permissions",
      level: 1000,
      isSystem: toDialectBool(true),
    };
    const insert = (this.db as RBACDatabaseInstance)
      .insert(this.tables.roles)
      .values(roleData);
    if (typeof insert.onConflictDoNothing === "function") {
      await insert.onConflictDoNothing();
    } else {
      await insert;
    }
    return { id, created: true };
  }

  /**
   * Create a new role with permissions and child roles.
   *
   * This method wraps all database mutations in a transaction to ensure atomicity.
   * If any operation fails, all changes are rolled back.
   *
   * KNOWN LIMITATIONS:
   * 1. SQLite Transactions: For SQLite, transaction support is limited due to
   *    synchronous callback requirements. Falls back to sequential execution.
   *
   * 2. Cross-Service Dependencies: This method has tight coupling with:
   *    - PermissionService (permission validation)
   *    - RolePermissionService (permission assignments)
   *    - RoleInheritanceService (child role relationships)
   *
   * Future work: Extract to orchestrator service with proper transaction context.
   *
   * @param input - Role data including permissions and child roles
   * @returns Created role data
   */
  async createRole(input: {
    name: string;
    slug: string;
    description?: string;
    level?: number;
    isSystem?: boolean;
    permissionIds: string[];
    childRoleIds?: string[];
  }): Promise<{
    success: boolean;
    statusCode: number;
    message: string;
    data: {
      id: string;
      name: string;
      slug: string;
      description: string | null;
      level: number;
      isSystem: boolean;
      permissionIds: string[];
      childRoleIds: string[];
    } | null;
  }> {
    // NOTE: This method temporarily includes logic from other services
    // Will be refactored to use RolePermissionService and RoleInheritanceService
    try {
      // Deduplicate permission IDs (silently handle duplicates)
      const uniqueIds = input.permissionIds
        ? Array.from(new Set(input.permissionIds.map(String)))
        : [];

      // Deduplicate child role IDs
      const uniqueChildRoleIds = input.childRoleIds
        ? Array.from(new Set(input.childRoleIds.map(String)))
        : [];

      // Validate permissions and child roles according to the rules:
      // - If 0 child roles: At least 1 permission required
      // - If 1 child role: At least 1 permission required
      // - If ≥2 child roles: No permission required (but permissions are allowed)
      const childRoleCount = uniqueChildRoleIds.length;
      const permissionCount = uniqueIds.length;

      if (childRoleCount === 0 && permissionCount === 0) {
        return {
          success: false,
          statusCode: 400,
          message: "At least one permission is required to create a role",
          data: null,
        };
      }

      if (childRoleCount === 1 && permissionCount === 0) {
        return {
          success: false,
          statusCode: 400,
          message:
            "When a role has only one child role, at least one permission is required",
          data: null,
        };
      }

      const { roles } = this.tables;
      // Check if role with same name already exists
      const existing = await this.db.query.roles.findFirst({
        where: eq(roles.name, input.name),
        columns: { id: true, name: true },
      });

      if (existing) {
        return {
          success: false,
          statusCode: 409, // Conflict
          message: "A role with this name already exists",
          data: null,
        };
      }

      // Check if role with same slug already exists
      const existingSlug = await this.db.query.roles.findFirst({
        where: eq(roles.slug, input.slug),
        columns: { id: true, slug: true },
      });

      if (existingSlug) {
        return {
          success: false,
          statusCode: 409, // Conflict
          message: "A role with this slug already exists",
          data: null,
        };
      }

      const id = randomUUID();
      const roleData: RoleInsertData = {
        id,
        name: input.name,
        slug: input.slug,
        description: input.description ?? null,
        level: input.level ?? 0,
        isSystem: toDialectBool(Boolean(input.isSystem ?? false)),
      };

      // Verify all permissions exist before creating the role
      const existingPermissions = await (
        this.db as RBACDatabaseInstance
      ).query.permissions.findMany({
        where: inArray(this.tables.permissions.id, uniqueIds),
        columns: { id: true },
      });

      const existingPermissionIds = new Set(
        existingPermissions.map(p => String(p.id))
      );

      // Find invalid permission IDs
      const invalidPermissionIds = uniqueIds.filter(
        id => !existingPermissionIds.has(id)
      );

      if (invalidPermissionIds.length > 0) {
        return {
          success: false,
          statusCode: 400,
          message: `Invalid permission IDs: ${invalidPermissionIds.join(", ")}`,
          data: null,
        };
      }

      // Verify all child roles exist before creating the role
      if (uniqueChildRoleIds.length > 0) {
        const existingChildRoles = await (
          this.db as RBACDatabaseInstance
        ).query.roles.findMany({
          where: inArray(this.tables.roles.id, uniqueChildRoleIds),
          columns: { id: true },
        });

        const existingChildRoleIds = new Set(
          existingChildRoles.map(r => String(r.id))
        );

        const invalidChildRoleIds = uniqueChildRoleIds.filter(
          id => !existingChildRoleIds.has(id)
        );

        if (invalidChildRoleIds.length > 0) {
          return {
            success: false,
            statusCode: 400,
            message: `Invalid child role IDs: ${invalidChildRoleIds.join(", ")}`,
            data: null,
          };
        }
      }

      // Wrap mutations in a transaction when the underlying driver allows
      // async callbacks (postgres, mysql). better-sqlite3 is synchronous and
      // rejects promise-returning callbacks with "Transaction function cannot
      // return a promise" — for SQLite we fall back to sequential execution
      // on the base connection. The method's comment block at the top of
      // the file already documents this constraint; the fix is to honor it.
      try {
        const isSqlite = this.dialect === "sqlite";

        const runMutations = async (
          // eslint-disable-next-line @typescript-eslint/no-explicit-any -- dialect-specific Drizzle typing
          executor: any
        ): Promise<{
          assignedPermIds: string[];
          assignedChildRoleIds: string[];
        }> => {
          await executor.insert(this.tables.roles).values(roleData);

          if (uniqueIds.length > 0) {
            const rolePermissionData = uniqueIds.map(permissionId => ({
              id: randomUUID(),
              roleId: id,
              permissionId,
            }));
            await executor
              .insert(this.tables.rolePermissions)
              .values(rolePermissionData);
          }

          if (uniqueChildRoleIds.length > 0) {
            const roleInheritanceData = uniqueChildRoleIds.map(childRoleId => ({
              id: randomUUID(),
              parentRoleId: id,
              childRoleId,
            }));
            await executor
              .insert(this.tables.roleInherits)
              .values(roleInheritanceData);
          }

          const rolePermRows = await executor.query.rolePermissions.findMany({
            where: eq(this.tables.rolePermissions.roleId, id),
          });
          const assignedPermIds = (
            rolePermRows as Array<{ permissionId: unknown }>
          ).map(rp => String(rp.permissionId));

          const childRows = await executor
            .select({ childRoleId: this.tables.roleInherits.childRoleId })
            .from(this.tables.roleInherits)
            .where(eq(this.tables.roleInherits.parentRoleId, id));
          const assignedChildRoleIds = (
            childRows as Array<{ childRoleId: unknown }>
          ).map(r => String(r.childRoleId));

          return { assignedPermIds, assignedChildRoleIds };
        };

        const result = isSqlite
          ? await runMutations(this.db)
          : // eslint-disable-next-line @typescript-eslint/no-explicit-any -- Drizzle transaction callback type varies by dialect
            await this.db.transaction(async (tx: any) => runMutations(tx));

        // Invalidate cache after successful transaction. `void` marks the
        // promise as intentionally unawaited - cache invalidation is
        // fire-and-forget and must not block the create response.
        void invalidatePermissionCache({ roleId: id });

        return {
          success: true,
          statusCode: 201,
          message: "Role created successfully",
          data: {
            id,
            name: input.name,
            slug: input.slug,
            description: input.description ?? null,
            level: input.level ?? 0,
            isSystem: Boolean(input.isSystem ?? false),
            permissionIds: result.assignedPermIds,
            childRoleIds: result.assignedChildRoleIds,
          },
        };
      } catch (e: unknown) {
        // Log the raw error so developers can see the true cause. The mapped
        // message returned to callers is intentionally generic for safety,
        // but silently swallowing the original error made "Failed to create
        // role" undebuggable (no stack, no DB code, no SQL). Surface the
        // full error at WARN so it appears in dev terminals without needing
        // verbose logging turned on.
        this.logger.warn(
          `createRole transaction failed: ${e instanceof Error ? e.message : String(e)}`,
          { error: e instanceof Error ? { name: e.name, stack: e.stack } : e }
        );
        return mapDbErrorToServiceError(e, {
          defaultMessage: "Failed to create role",
          "unique-violation": "A role with this slug or name already exists",
          constraint: "A role with this slug or name already exists",
        });
      }
    } catch (e: unknown) {
      // Same rationale as the inner catch: log the raw error so the
      // developer sees the actual cause (e.g. a validation query failing
      // because a referenced table is missing). The outer catch covers
      // errors thrown before the transaction begins.
      this.logger.warn(
        `createRole failed before transaction: ${e instanceof Error ? e.message : String(e)}`,
        { error: e instanceof Error ? { name: e.name, stack: e.stack } : e }
      );
      return mapDbErrorToServiceError(e, {
        defaultMessage: "Failed to create role",
        "unique-violation": "A role with this slug or name already exists",
        constraint: "A role with this slug or name already exists",
      });
    }
  }

  /**
   * Update an existing role.
   *
   * This method wraps all database mutations in a transaction to ensure atomicity.
   * If any operation fails, all changes are rolled back.
   *
   * Note: System roles cannot be modified.
   * This method temporarily includes permission/child role management.
   * Will be refactored to use RolePermissionService and RoleInheritanceService.
   *
   * @param roleId - The role ID to update
   * @param changes - Fields to update
   * @returns Success/failure status
   */
  async updateRole(
    roleId: string,
    changes: {
      name?: string;
      slug?: string;
      description?: string;
      level?: number;
      permissionIds?: string[];
      childRoleIds?: string[];
    }
  ): Promise<{
    success: boolean;
    statusCode: number;
    message: string;
    data: null;
  }> {
    // NOTE: This method temporarily includes logic from other services
    // Will be refactored to use RolePermissionService and RoleInheritanceService
    try {
      // Validate input
      validateRoleId(roleId);

      // Fetch the current role
      const { roles } = this.tables;

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const roleResult = await (this.db as any)
        .select({
          id: roles.id,
          isSystem: roles.isSystem,
        })
        .from(roles)
        .where(eq(roles.id, roleId))
        .limit(1);

      if (!roleResult || roleResult.length === 0) {
        return {
          success: false,
          statusCode: 404,
          message: "Role not found",
          data: null,
        };
      }

      const currentRole = roleResult[0];
      const isSystemRole = Boolean(currentRole.isSystem);

      // Prevent modifying system roles
      if (isSystemRole) {
        return {
          success: false,
          statusCode: 403,
          message: "Cannot modify system roles",
          data: null,
        };
      }

      // Build update data
      const updateData: Record<string, unknown> = {};
      if (changes.name !== undefined) updateData.name = changes.name;
      if (changes.slug !== undefined) updateData.slug = changes.slug;
      if (changes.description !== undefined)
        updateData.description = changes.description;
      if (changes.level !== undefined) updateData.level = changes.level;

      // Handle permission updates - validate before transaction
      let uniquePermissionIds: string[] = [];
      if (changes.permissionIds !== undefined) {
        uniquePermissionIds = Array.from(
          new Set(changes.permissionIds.map(String))
        );

        // Verify all permissions exist
        if (uniquePermissionIds.length > 0) {
          const existingPermissions = await (
            this.db as RBACDatabaseInstance
          ).query.permissions.findMany({
            where: inArray(this.tables.permissions.id, uniquePermissionIds),
            columns: { id: true },
          });

          const existingPermissionIds = new Set(
            existingPermissions.map(p => String(p.id))
          );

          const invalidPermissionIds = uniquePermissionIds.filter(
            id => !existingPermissionIds.has(id)
          );

          if (invalidPermissionIds.length > 0) {
            return {
              success: false,
              statusCode: 400,
              message: `Invalid permission IDs: ${invalidPermissionIds.join(", ")}`,
              data: null,
            };
          }
        }
      }

      // Handle child role updates - validate before transaction
      let uniqueChildRoleIds: string[] = [];
      if (changes.childRoleIds !== undefined) {
        uniqueChildRoleIds = Array.from(
          new Set(changes.childRoleIds.map(String))
        );

        // Verify all child roles exist
        if (uniqueChildRoleIds.length > 0) {
          const existingChildRoles = await (
            this.db as RBACDatabaseInstance
          ).query.roles.findMany({
            where: inArray(this.tables.roles.id, uniqueChildRoleIds),
            columns: { id: true },
          });

          const existingChildRoleIds = new Set(
            existingChildRoles.map(r => String(r.id))
          );

          const invalidChildRoleIds = uniqueChildRoleIds.filter(
            id => !existingChildRoleIds.has(id)
          );

          if (invalidChildRoleIds.length > 0) {
            return {
              success: false,
              statusCode: 400,
              message: `Invalid child role IDs: ${invalidChildRoleIds.join(", ")}`,
              data: null,
            };
          }
        }
      }

      // Wrap all database mutations in a transaction for atomicity
      try {
        // Required by Drizzle ORM: transaction callback type varies by dialect.
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        await this.db.transaction(async (tx: any) => {
          // Update role basic fields if any provided
          if (Object.keys(updateData).length > 0) {
            await tx
              .update(this.tables.roles)
              .set(updateData)
              .where(eq(this.tables.roles.id, roleId));
          }

          // Handle permission updates
          // TODO: Use RolePermissionService once it's created
          if (changes.permissionIds !== undefined) {
            // Delete all existing role-permission mappings
            await tx
              .delete(this.tables.rolePermissions)
              .where(eq(this.tables.rolePermissions.roleId, roleId));

            // Insert new role-permission mappings
            if (uniquePermissionIds.length > 0) {
              const rolePermissionData = uniquePermissionIds.map(
                permissionId => ({
                  id: randomUUID(),
                  roleId,
                  permissionId,
                })
              );

              await tx
                .insert(this.tables.rolePermissions)
                .values(rolePermissionData);
            }
          }

          // Handle child role updates
          // TODO: Use RoleInheritanceService once it's created
          if (changes.childRoleIds !== undefined) {
            // Delete all existing role inheritance relationships for this parent
            await tx
              .delete(this.tables.roleInherits)
              .where(eq(this.tables.roleInherits.parentRoleId, roleId));

            // Insert new role inheritance relationships
            if (uniqueChildRoleIds.length > 0) {
              const roleInheritanceData = uniqueChildRoleIds.map(
                childRoleId => ({
                  id: randomUUID(),
                  parentRoleId: roleId,
                  childRoleId,
                })
              );

              await tx
                .insert(this.tables.roleInherits)
                .values(roleInheritanceData);
            }
          }
        });

        // Invalidate cache after successful transaction
        if (
          changes.permissionIds !== undefined ||
          changes.childRoleIds !== undefined
        ) {
          void invalidatePermissionCache({ roleId });
        }

        return {
          success: true,
          statusCode: 200,
          message: "Role updated successfully",
          data: null,
        };
      } catch (e: unknown) {
        return mapDbErrorToServiceError(e, {
          defaultMessage: "Failed to update role",
          "unique-violation": "A role with this slug or name already exists",
          constraint: "A role with this slug or name already exists",
        });
      }
    } catch (e: unknown) {
      return mapDbErrorToServiceError(e, {
        defaultMessage: "Failed to update role",
        "unique-violation": "A role with this slug or name already exists",
        constraint: "A role with this slug or name already exists",
      });
    }
  }

  /**
   * Delete a role and cascade delete related data.
   *
   * This method wraps all database mutations in a transaction to ensure atomicity.
   * If any operation fails, all changes are rolled back.
   *
   * Note: System roles cannot be deleted.
   *
   * @param roleId - The role ID to delete
   * @returns Success/failure status
   */
  async deleteRole(roleId: string): Promise<{
    success: boolean;
    statusCode: number;
    message: string;
    data: null;
  }> {
    try {
      // Validate input
      validateRoleId(roleId);

      const { roles } = this.tables;

      // Fetch the role
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const roleResult = await (this.db as any)
        .select({
          id: roles.id,
          isSystem: roles.isSystem,
        })
        .from(roles)
        .where(eq(roles.id, roleId))
        .limit(1);

      if (!roleResult || roleResult.length === 0) {
        return {
          success: false,
          statusCode: 404,
          message: "Role not found",
          data: null,
        };
      }

      const role = roleResult[0];
      const isSystemRole = Boolean(role.isSystem);

      // Prevent deleting system roles
      if (isSystemRole) {
        return {
          success: false,
          statusCode: 403,
          message: "Cannot delete system roles",
          data: null,
        };
      }

      // Wrap all database mutations in a transaction for atomicity
      // Required by Drizzle ORM: transaction callback type varies by dialect.
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      await this.db.transaction(async (tx: any) => {
        // Delete cascade: role-permissions, user-roles, role-inheritance
        await tx
          .delete(this.tables.rolePermissions)
          .where(eq(this.tables.rolePermissions.roleId, roleId));

        await tx
          .delete(this.tables.userRoles)
          .where(eq(this.tables.userRoles.roleId, roleId));

        await tx
          .delete(this.tables.roleInherits)
          .where(eq(this.tables.roleInherits.parentRoleId, roleId));

        await tx
          .delete(this.tables.roleInherits)
          .where(eq(this.tables.roleInherits.childRoleId, roleId));

        // Delete the role itself
        await tx
          .delete(this.tables.roles)
          .where(eq(this.tables.roles.id, roleId));
      });

      // Invalidate cache after successful transaction (fire-and-forget).
      void invalidatePermissionCache({ roleId });

      return {
        success: true,
        statusCode: 200,
        message: "Role deleted successfully",
        data: null,
      };
    } catch (e: unknown) {
      return mapDbErrorToServiceError(e, {
        defaultMessage: "Failed to delete role",
      });
    }
  }
}
