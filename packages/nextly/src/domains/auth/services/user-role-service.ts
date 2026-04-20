import { randomUUID } from "crypto";

import type { DrizzleAdapter } from "@revnixhq/adapter-drizzle";
import { and, eq, inArray } from "drizzle-orm";

import type {
  RBACDatabaseInstance,
  UserRoleInsertData,
  UserRoleSelectResult,
} from "@nextly/types/rbac-operations";

import { getDialectTables } from "../../../database";
import { BaseService } from "../../../services/base-service";
import { invalidatePermissionCache } from "../../../services/lib/permissions";
import type { Logger } from "../../../services/shared";

import { invalidateApiKeyPermissionsCache } from "./api-key-service";

/**
 * UserRoleService handles user-role assignment management.
 *
 * Responsibilities:
 * - Assign roles to users (with optional expiration)
 * - Remove role assignments from users
 * - List all roles assigned to a user
 * - List role names for a user
 *
 * @example
 * ```typescript
 * const service = new UserRoleService(adapter, logger);
 * await service.assignRoleToUser(userId, roleId, { expiresAt: new Date('2025-12-31') });
 * ```
 */
/** Lazily-resolved apiKeys table for the configured dialect. Matches the pattern in services/lib/permissions.ts. */
let _apiKeysTable: ReturnType<typeof getDialectTables>["apiKeys"] | null = null;
function getApiKeysTable() {
  if (!_apiKeysTable) {
    _apiKeysTable = getDialectTables().apiKeys;
  }
  return _apiKeysTable!;
}

export class UserRoleService extends BaseService {
  constructor(adapter: DrizzleAdapter, logger: Logger) {
    super(adapter, logger);
  }

  /**
   * Assign a role to a user.
   *
   * @param userId - User ID to assign role to
   * @param roleId - Role ID to assign
   * @param opts - Optional expiration date
   * @returns Success/failure status
   */
  async assignRoleToUser(
    userId: string,
    roleId: string,
    opts?: { expiresAt?: Date | string }
  ): Promise<{ success: boolean; statusCode: number; message: string }> {
    try {
      const { roles } = this.tables;

      const user = await (
        this.db as RBACDatabaseInstance
      ).query.users.findFirst({
        columns: { id: true },
        where: eq(this.tables.users.id, userId),
      });

      if (!user) {
        return { success: false, statusCode: 404, message: "User not found" };
      }

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const roleRow = await (this.db as any)
        .select({ id: roles.id, slug: roles.slug })
        .from(roles)
        .where(eq(roles.id, roleId))
        .limit(1);

      if (!roleRow || roleRow.length === 0) {
        return { success: false, statusCode: 404, message: "Role not found" };
      }

      const existingUserRole = await (
        this.db as RBACDatabaseInstance
      ).query.userRoles.findFirst({
        where: and(
          eq(this.tables.userRoles.userId, userId),
          eq(this.tables.userRoles.roleId, roleId)
        ),
        columns: { id: true },
      });

      if (existingUserRole) {
        return {
          success: false,
          statusCode: 409,
          message: "Role already assigned to this user",
        };
      }

      const userRoleData: UserRoleInsertData = {
        id: randomUUID(),
        userId,
        roleId,
        expiresAt: opts?.expiresAt ?? null,
      };

      const insert = (this.db as RBACDatabaseInstance)
        .insert(this.tables.userRoles)
        .values(userRoleData);

      if (typeof insert.onConflictDoNothing === "function") {
        await insert.onConflictDoNothing();
      } else {
        await insert;
      }

      invalidatePermissionCache({ userId });

      // Invalidate API key permission caches for this user's read-only and
      // full-access keys — their effective permissions derive from the creator's
      // role set, which just changed.
      await this.invalidateApiKeyCachesForUser(userId);

      return {
        success: true,
        statusCode: 201,
        message: "Role assigned successfully",
      };
    } catch (error) {
      return {
        success: false,
        statusCode: 500,
        message:
          error instanceof Error
            ? error.message
            : "Failed to assign role to user",
      };
    }
  }

  /**
   * Remove a role assignment from a user.
   *
   * @param userId - User ID to remove role from
   * @param roleId - Role ID to remove
   * @returns Success/failure status
   */
  async unassignRoleFromUser(
    userId: string,
    roleId: string
  ): Promise<{ success: boolean; statusCode: number; message: string }> {
    try {
      const existingUserRole = await (
        this.db as RBACDatabaseInstance
      ).query.userRoles.findFirst({
        where: and(
          eq(this.tables.userRoles.userId, userId),
          eq(this.tables.userRoles.roleId, roleId)
        ),
        columns: { id: true },
      });

      if (!existingUserRole) {
        return {
          success: false,
          statusCode: 404,
          message: "Role is not assigned to this user",
        };
      }

      await (this.db as RBACDatabaseInstance)
        .delete(this.tables.userRoles)
        .where(
          and(
            eq(this.tables.userRoles.userId, userId),
            eq(this.tables.userRoles.roleId, roleId)
          )
        );

      invalidatePermissionCache({ userId });

      // Invalidate API key permission caches for this user's read-only and
      // full-access keys — their effective permissions derive from the creator's
      // role set, which just changed.
      await this.invalidateApiKeyCachesForUser(userId);

      return {
        success: true,
        statusCode: 200,
        message: "Role unassigned successfully",
      };
    } catch (error) {
      return {
        success: false,
        statusCode: 500,
        message:
          error instanceof Error
            ? error.message
            : "Failed to unassign role from user",
      };
    }
  }

  /**
   * List all role IDs assigned to a user.
   *
   * @param userId - User ID to list roles for
   * @returns Array of role IDs
   */
  async listUserRoles(userId: string): Promise<string[]> {
    const userRoles = await (
      this.db as RBACDatabaseInstance
    ).query.userRoles.findMany({
      where: eq(this.tables.userRoles.userId, userId),
      columns: {
        roleId: true,
      },
    });
    return userRoles.map((ur: UserRoleSelectResult) => String(ur.roleId));
  }

  /**
   * List all role names assigned to a user.
   *
   * @param userId - User ID to list role names for
   * @returns Array of role names
   */
  async listUserRoleNames(userId: string): Promise<string[]> {
    const userRoles = await (
      this.db as RBACDatabaseInstance
    ).query.userRoles.findMany({
      where: eq(this.tables.userRoles.userId, userId),
      with: {
        role: {
          columns: {
            name: true,
          },
        },
      },
    });
    return (userRoles as Array<{ role?: { name?: string } | null }>).map(ur =>
      String(ur.role?.name ?? "")
    );
  }

  /**
   * Invalidate API key permission caches for all active read-only and full-access
   * keys owned by a user.
   *
   * Called after `assignRoleToUser()` and `unassignRoleFromUser()` because those
   * token types resolve permissions from the creator's current role set. When the
   * role set changes, the cached permission slugs must be evicted so the next
   * request re-resolves them from the updated roles.
   *
   * Role-based keys are NOT invalidated here — their cache is keyed to the assigned
   * role, not to the creator, and is invalidated via RolePermissionService instead.
   *
   * @param userId - The user whose read-only and full-access API key caches to evict
   */
  private async invalidateApiKeyCachesForUser(userId: string): Promise<void> {
    try {
      const apiKeysTable = getApiKeysTable();
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const rows = await (this.db as any)
        .select({ id: apiKeysTable.id })
        .from(apiKeysTable)
        .where(
          and(
            eq(apiKeysTable.userId, userId),
            inArray(apiKeysTable.tokenType, ["read-only", "full-access"]),
            eq(apiKeysTable.isActive, true)
          )
        );

      for (const row of rows as Array<{ id: string }>) {
        invalidateApiKeyPermissionsCache(row.id);
      }
    } catch {
      // Cache invalidation failures must never break the mutation path.
      // The 5-minute TTL on the API key cache is the safety net.
    }
  }
}
