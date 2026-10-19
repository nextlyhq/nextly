import { randomUUID } from "crypto";

import type { DrizzleAdapter } from "@nextlyhq/adapter-drizzle";
import { and, eq, inArray, not } from "drizzle-orm";

import type {
  RBACDatabaseInstance,
  UserRoleInsertData,
} from "@nextly/types/rbac-operations";

import { getDialectTables } from "../../../database";
import { toDbError } from "../../../database/errors";
import { NextlyError } from "../../../errors";
import { BaseService } from "../../../services/base-service";
import { invalidatePermissionCache } from "../../../services/lib/permissions";
import {
  roleAssignmentInForce,
  userRoleAssignmentsInForce,
} from "../../../services/lib/role-assignments";
import type { Logger } from "../../../services/shared";
import { requireFilterValue } from "../../../shared/lib/require-filter-value";
import { serializeOnSqlite } from "../../../shared/lib/run-adapter-transaction";
import {
  refuseRemovingLastSuperAdmin,
  type LastSuperAdminTx,
} from "../../users/services/last-super-admin";

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
  return _apiKeysTable;
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
        where: { id: requireFilterValue(userId, "userId") },
      });

      if (!user) {
        return { success: false, statusCode: 404, message: "User not found" };
      }

      const roleRow = await this.db
        .select({ id: roles.id, slug: roles.slug })
        .from(roles)
        .where(eq(roles.id, roleId))
        .limit(1);

      if (!roleRow || roleRow.length === 0) {
        return { success: false, statusCode: 404, message: "Role not found" };
      }

      // "Already assigned" means held now. An assignment that has lapsed grants
      // nothing, so answering 409 for it left the role impossible to give
      // again while every check refused it.
      const { userRoles } = this.tables;
      // One moment for the check and the replacement below, so the row this
      // request found lapsed is the row it replaces.
      const now = new Date();
      const held = await this.db
        .select({ id: userRoles.id })
        .from(userRoles)
        .where(
          and(
            userRoleAssignmentsInForce(userRoles, userId, now),
            eq(userRoles.roleId, roleId)
          )
        )
        .limit(1);

      if (held.length > 0) {
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

      // Through the adapter on SQLite, as the removal below is: a plain insert
      // made while another request's transaction is open would run inside it
      // and be undone by its rollback.
      await serializeOnSqlite(this.adapter, async () => {
        // A lapsed assignment of this role is replaced rather than kept beside
        // the new one, since one pair holds one row. Only a lapsed one: the
        // check above is a read, and on PostgreSQL and MySQL another request
        // can grant the role between it and this delete. Deleting every row
        // for the pair removed that completed grant and put this request's
        // expiry in its place; now it stands, and the pair's unique index
        // keeps the insert below from adding a second row beside it.
        await (this.db as RBACDatabaseInstance)
          .delete(userRoles)
          .where(
            and(
              eq(userRoles.userId, userId),
              eq(userRoles.roleId, roleId),
              not(roleAssignmentInForce(userRoles, now))
            )
          );
        const insert = (this.db as RBACDatabaseInstance)
          .insert(this.tables.userRoles)
          .values(userRoleData);

        if (typeof insert.onConflictDoNothing === "function") {
          await insert.onConflictDoNothing();
        } else {
          await insert;
        }
      });

      await this.invalidateRoleCaches(userId);

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
        where: { userId: userId, roleId: roleId },
        columns: { id: true },
      });

      if (!existingUserRole) {
        return {
          success: false,
          statusCode: 404,
          message: "Role is not assigned to this user",
        };
      }

      // In a transaction of its own, which on SQLite goes through the adapter:
      // a plain delete made while another request's transaction is open runs
      // inside it, and that transaction's rollback would hand the user back
      // the role just taken away. The last active super-admin keeps the role,
      // asked under the lock every removal of one takes, before the delete.
      await this.withTransaction(async tx => {
        await refuseRemovingLastSuperAdmin(
          tx as LastSuperAdminTx,
          this.tables,
          this.dialect,
          userId,
          { kind: "unassignRole", roleId }
        );
        await (tx as RBACDatabaseInstance)
          .delete(this.tables.userRoles)
          .where(
            and(
              eq(this.tables.userRoles.userId, userId),
              eq(this.tables.userRoles.roleId, roleId)
            )
          );
      });

      await this.invalidateRoleCaches(userId);

      return {
        success: true,
        statusCode: 200,
        message: "Role unassigned successfully",
      };
    } catch (error) {
      // Thrown, not reported as a failed result: the dispatcher answers any
      // result as a success, so a refusal, or a failed read that rolled the
      // removal back, would tell the caller the role was taken when it was
      // not. A refusal keeps its own status and message; a database failure
      // gets the typed error every other write reports.
      if (NextlyError.is(error)) throw error;
      throw NextlyError.fromDatabaseError(toDbError(this.dialect, error));
    }
  }

  /**
   * Replace the roles a user holds with `roleIds`, inside the caller's
   * transaction `tx`, so the removal and the re-assignment commit or roll
   * back together. Ids that name no role are skipped. Leaves the caches to
   * the caller, which flushes them with {@link invalidateRoleCaches} once the
   * transaction has committed.
   *
   * @returns Whether the user's roles changed.
   */
  async replaceUserRoles(
    userId: string,
    roleIds: readonly string[],
    tx: unknown
  ): Promise<boolean> {
    const db = tx as typeof this.db;
    const { roles, userRoles } = this.tables;
    // Compared against the roles held now. A lapsed assignment counted as
    // held made re-granting that role look like no change, so nothing was
    // written and the role stayed lapsed while the caller believed it given.
    const current = await db
      .select({ roleId: userRoles.roleId })
      .from(userRoles)
      .where(userRoleAssignmentsInForce(userRoles, userId, new Date()));
    const requested = new Set(roleIds);
    const held = new Set(
      (current as Array<{ roleId: unknown }>).map(row => String(row.roleId))
    );
    if (
      held.size === requested.size &&
      [...held].every(id => requested.has(id))
    ) {
      return false;
    }
    const existing =
      requested.size > 0
        ? ((await db
            .select({ id: roles.id })
            .from(roles)
            .where(inArray(roles.id, [...requested]))) as Array<{
            id: unknown;
          }>)
        : [];
    await db.delete(userRoles).where(eq(userRoles.userId, userId));
    if (existing.length > 0) {
      const rows: UserRoleInsertData[] = existing.map(role => ({
        id: randomUUID(),
        userId,
        roleId: String(role.id),
        expiresAt: null,
      }));
      await (db as RBACDatabaseInstance).insert(userRoles).values(rows);
    }
    return true;
  }

  /**
   * Evict what is cached from a user's roles: their permissions, and those of
   * their read-only and full-access API keys, which resolve from the creator's
   * role set.
   */
  async invalidateRoleCaches(userId: string): Promise<void> {
    await invalidatePermissionCache({ userId });
    await this.invalidateApiKeyCachesForUser(userId);
  }

  /**
   * List the role IDs a user holds now: assignments with no expiry, or one
   * still ahead. A lapsed assignment grants nothing, so listing it would say
   * the user holds a role that no check gives them.
   *
   * @param userId - User ID to list roles for
   * @returns Array of role IDs
   */
  async listUserRoles(userId: string): Promise<string[]> {
    const { userRoles } = this.tables;
    const rows = await this.db
      .select({ roleId: userRoles.roleId })
      .from(userRoles)
      .where(userRoleAssignmentsInForce(userRoles, userId, new Date()));
    return (rows as Array<{ roleId: unknown }>).map(row => String(row.roleId));
  }

  /**
   * List the names of the roles a user holds now, on the same terms as
   * {@link listUserRoles}.
   *
   * @param userId - User ID to list role names for
   * @returns Array of role names
   */
  async listUserRoleNames(userId: string): Promise<string[]> {
    const { roles, userRoles } = this.tables;
    const rows = await this.db
      .select({ name: roles.name })
      .from(userRoles)
      .innerJoin(roles, eq(userRoles.roleId, roles.id))
      .where(userRoleAssignmentsInForce(userRoles, userId, new Date()));
    return (rows as Array<{ name: string | null }>).map(row => row.name ?? "");
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
      const rows = await this.db
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
