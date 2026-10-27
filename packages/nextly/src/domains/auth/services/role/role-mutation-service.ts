import { randomUUID } from "crypto";

import type { DrizzleAdapter } from "@nextlyhq/adapter-drizzle";
import { and, eq, or, sql } from "drizzle-orm";

import { invalidatePermissionCache } from "@nextly/services/lib/permissions";
import type {
  RBACDatabaseInstance,
  RoleInsertData,
} from "@nextly/types/rbac-operations";

// PR 4 migration: replaced legacy result-shape returns and
// mapDbErrorToServiceError calls with throw-based NextlyError.
import { toDbError } from "../../../../database/errors";
import { resolveRelations } from "../../../../database/resolve-relations";
import { NextlyError } from "../../../../errors/nextly-error";
import { BaseService } from "../../../../services/base-service";
import type { Logger } from "../../../../services/shared";
import { requireFilterValue } from "../../../../shared/lib/require-filter-value";
import { isUniqueViolation } from "../../../../shared/lib/unique-violation";
import {
  refuseRemovingLastSuperAdmin,
  type LastSuperAdminTx,
} from "../../../users/services/last-super-admin";
import { PUBLIC_ROLE_SLUG, refuseLinkingPublicRole } from "../public-role";
import { afterRoleGrantsChanged } from "../role-grants-changed";
import { refuseGrantingSuperAdmin } from "../super-admin-grant";

import { toDialectBool, validateRoleId } from "./utils";

/** How a caller of `createRole` handles its failures. */
export interface CreateRoleOptions {
  /**
   * The caller expects the role may already exist and reports a name or slug
   * conflict itself, so one is logged at debug rather than warn.
   */
  quietOnConflict?: boolean;
}

/**
 * Whether a failure to create a role was its name or slug already being held:
 * the check `createRole` makes before inserting, or the database's unique key
 * when another writer got there between that check and the insert.
 */
export function isRoleConflict(error: unknown): boolean {
  return (
    (NextlyError.is(error) && error.code === "DUPLICATE") ||
    isUniqueViolation(error)
  );
}

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
    const role = await this.db
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
  ensureSuperAdminRole(): Promise<{ id: string; created: boolean }> {
    // A system role with slug 'super-admin'; it may have zero permissions.
    return this.ensureBuiltInRole({
      name: "Super Admin",
      slug: "super-admin",
      description: "Grants implicit access to all permissions",
      level: 1000,
    });
  }

  /**
   * Ensure the Public role exists (idempotent): the built-in role every
   * visitor is judged by, created holding nothing. Only its permissions may
   * change after that, so it is never brought back to a set of its own.
   *
   * `declaredNames` are names roles the app or its plugins declare go by,
   * which the built-in role leaves to them even where those roles are not
   * made yet.
   *
   * @returns Role ID and whether it was newly created
   */
  async ensurePublicRole(
    declaredNames: readonly string[] = []
  ): Promise<{ id: string; created: boolean }> {
    const existing = await this.findRoleIdBySlug(PUBLIC_ROLE_SLUG);
    if (existing) return { id: existing.id, created: false };
    return this.ensureBuiltInRole({
      name: await this.firstFreeRoleName("Public", declaredNames),
      slug: PUBLIC_ROLE_SLUG,
      description: "What anyone may do without signing in",
      level: 0,
    });
  }

  /**
   * `base`, or where a role already has that name (names are unique), the
   * first of `<base> built-in`, `<base> built-in 2`, … no role has: names the
   * admin's role form accepts, so the role can still be saved there. A site's
   * own role keeps its name, as does one in `reserved`; the built-in role
   * takes another. Compared without case, as a database may compare them.
   */
  private async firstFreeRoleName(
    base: string,
    reserved: readonly string[]
  ): Promise<string> {
    const held = new Set(reserved.map(name => name.toLowerCase()));
    const { roles } = this.tables;
    for (let n = 1; ; n++) {
      const name =
        n === 1
          ? base
          : n === 2
            ? `${base} built-in`
            : `${base} built-in ${n - 1}`;
      if (held.has(name.toLowerCase())) continue;
      const taken = await this.db
        .select({ id: roles.id })
        .from(roles)
        .where(eq(roles.name, name))
        .limit(1);
      if (taken.length === 0) return name;
    }
  }

  /**
   * Removes every inheritance link the Public role is part of, either way,
   * and clears what is cached from the grants of each role it joined. Its
   * own refusals keep such a link from being made, but an instance still
   * running code from before them can make one; read on each boot, a link
   * made so does not last past the next.
   */
  async unlinkPublicRole(publicRoleId: string): Promise<void> {
    const { roleInherits } = this.tables;
    const touching = or(
      eq(roleInherits.parentRoleId, publicRoleId),
      eq(roleInherits.childRoleId, publicRoleId)
    );
    const links = await this.db
      .select({
        parentRoleId: roleInherits.parentRoleId,
        childRoleId: roleInherits.childRoleId,
      })
      .from(roleInherits)
      .where(touching);
    if (links.length === 0) return;
    await this.db.delete(roleInherits).where(touching);
    const roles = new Set<string>();
    for (const { parentRoleId, childRoleId } of links) {
      roles.add(String(parentRoleId));
      roles.add(String(childRoleId));
    }
    for (const id of roles) await afterRoleGrantsChanged(id);
  }

  /**
   * The role holding the Public role's slug, and whether it is built in, or
   * `null` where none does.
   */
  async publicSlugHolder(): Promise<{ id: string; builtIn: boolean } | null> {
    const { roles } = this.tables;
    const [row] = await this.db
      .select({ id: roles.id, isSystem: roles.isSystem })
      .from(roles)
      .where(eq(roles.slug, PUBLIC_ROLE_SLUG))
      .limit(1);
    return row ? { id: String(row.id), builtIn: Boolean(row.isSystem) } : null;
  }

  /**
   * Moves role `id` off the Public role's slug where it still holds it, to
   * the first of `public-1`, `public-2`, … no role holds, changing the slug
   * alone: its name, holders, permissions and inheritance stay as they are.
   * What is cached from the role's grants is then cleared, as any change to a
   * role's slug clears it, since a code rule reading role slugs now answers
   * its holders differently. Cleared even where the role had already moved,
   * so a move whose clearing was cut short is finished by running it again.
   *
   * @returns The slug the role now has, or `null` where there is no such role
   */
  async moveRoleOffPublicSlug(id: string): Promise<string | null> {
    const { roles } = this.tables;
    const [role] = await this.db
      .select({ slug: roles.slug })
      .from(roles)
      .where(eq(roles.id, id))
      .limit(1);
    if (!role) return null;
    let slug = String(role.slug);
    // The slug in any case: MySQL's collation finds a role whose slug is
    // `Public` when asked for `public`, so that one holds it there too.
    for (let n = 1; slug.toLowerCase() === PUBLIC_ROLE_SLUG; n++) {
      const free = `${PUBLIC_ROLE_SLUG}-${n}`;
      if (await this.findRoleIdBySlug(free)) continue;
      // Only while the role still has the slug it was read with: a rename
      // another instance made meanwhile stands, and is read back below.
      try {
        await this.db
          .update(roles)
          .set({ slug: free })
          .where(and(eq(roles.id, id), eq(roles.slug, slug)));
      } catch (error) {
        // Another role took the free slug in the meantime: try the next.
        if (await this.findRoleIdBySlug(free)) continue;
        throw error;
      }
      const [now] = await this.db
        .select({ slug: roles.slug })
        .from(roles)
        .where(eq(roles.id, id))
        .limit(1);
      if (!now) return null;
      slug = String(now.slug);
    }
    await afterRoleGrantsChanged(id);
    return slug;
  }

  /**
   * Ensure a built-in role exists with this slug (idempotent), created with
   * no permissions.
   *
   * @returns Role ID and whether it was newly created
   */
  private async ensureBuiltInRole(role: {
    name: string;
    slug: string;
    description: string;
    level: number;
  }): Promise<{ id: string; created: boolean }> {
    const existing = await this.findRoleIdBySlug(role.slug);
    if (existing) return { id: existing.id, created: false };

    const id = randomUUID();
    const roleData: RoleInsertData = {
      id,
      ...role,
      isSystem: toDialectBool(true),
    };
    const insert = (this.db as RBACDatabaseInstance)
      .insert(this.tables.roles)
      .values(roleData);
    // Two callers can find no role and insert at once (two accounts
    // provisioned together on an empty install), so the insert yields to the
    // one already there on every dialect: MySQL has no ON CONFLICT DO
    // NOTHING, and a plain insert there failed the second caller with a
    // duplicate. MySQL's update fires on ANY unique key, the role name's
    // included, so it writes the row's own id back and changes nothing: a
    // role that merely holds the name keeps its slug, rather than becoming
    // the built-in role for everyone who holds it, and the lookup below then
    // finds no built-in role, as on the other dialects.
    if (typeof insert.onConflictDoNothing === "function") {
      await insert.onConflictDoNothing();
    } else if (typeof insert.onDuplicateKeyUpdate === "function") {
      await insert.onDuplicateKeyUpdate({
        set: { id: sql`${this.tables.roles.id}` },
      });
    } else {
      await insert;
    }
    // The stored row's id, not this call's: when another caller won the
    // insert, the id generated here was never written.
    const settled = await this.findRoleIdBySlug(role.slug);
    if (!settled) {
      throw NextlyError.internal({
        logContext: {
          reason: "built-in-role-missing-after-insert",
          slug: role.slug,
        },
      });
    }
    return { id: settled.id, created: settled.id === id };
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
  async createRole(
    input: {
      name: string;
      slug: string;
      description?: string;
      level?: number;
      isSystem?: boolean;
      permissionIds: string[];
      childRoleIds?: string[];
    },
    options: CreateRoleOptions = {}
  ): Promise<{
    id: string;
    name: string;
    slug: string;
    description: string | null;
    level: number;
    isSystem: boolean;
    permissionIds: string[];
    childRoleIds: string[];
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
      // The Public role is never inherited: a role reaching it would hand
      // its holders visitors' grants as their own.
      await refuseLinkingPublicRole(
        this.db as LastSuperAdminTx,
        this.dialect,
        uniqueChildRoleIds,
        "inherit",
        { slug: input.slug }
      );

      // Validate permissions and child roles according to the rules:
      // - If 0 child roles: At least 1 permission required
      // - If 1 child role: At least 1 permission required
      // - If ≥2 child roles: No permission required (but permissions are allowed)
      const childRoleCount = uniqueChildRoleIds.length;
      const permissionCount = uniqueIds.length;

      if (childRoleCount === 0 && permissionCount === 0) {
        // Validation: empty role definition. Per §13.8, the per-error message
        // names the field but never the value.
        throw NextlyError.validation({
          errors: [
            {
              path: "permissionIds",
              code: "REQUIRED",
              message: "At least one permission is required to create a role.",
            },
          ],
        });
      }

      if (childRoleCount === 1 && permissionCount === 0) {
        throw NextlyError.validation({
          errors: [
            {
              path: "permissionIds",
              code: "REQUIRED",
              message:
                "When a role has only one child role, at least one permission is required.",
            },
          ],
        });
      }

      // Check if role with same name already exists
      const existing = await this.db.query.roles.findFirst({
        where: { name: input.name },
        columns: { id: true, name: true },
      });

      if (existing) {
        // Generic "Resource already exists." from the factory; the
        // attempted name moves to logContext (operator only).
        throw NextlyError.duplicate({
          logContext: { reason: "role-name-conflict", name: input.name },
        });
      }

      // Check if role with same slug already exists
      const existingSlug = await this.db.query.roles.findFirst({
        where: { slug: requireFilterValue(input.slug, "slug") },
        columns: { id: true, slug: true },
      });

      if (existingSlug) {
        throw NextlyError.duplicate({
          logContext: { reason: "role-slug-conflict", slug: input.slug },
        });
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
        where: { id: { in: uniqueIds } },
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
        // Per §13.8 the public message names the field but never the
        // rejected values. Identifiers move to logContext.
        throw NextlyError.validation({
          errors: [
            {
              path: "permissionIds",
              code: "INVALID",
              message:
                "One or more permission IDs do not reference an existing permission.",
            },
          ],
          logContext: { invalidPermissionIds },
        });
      }

      // Verify all child roles exist before creating the role
      if (uniqueChildRoleIds.length > 0) {
        const existingChildRoles = await (
          this.db as RBACDatabaseInstance
        ).query.roles.findMany({
          where: { id: { in: uniqueChildRoleIds } },
          columns: { id: true },
        });

        const existingChildRoleIds = new Set(
          existingChildRoles.map(r => String(r.id))
        );

        const invalidChildRoleIds = uniqueChildRoleIds.filter(
          id => !existingChildRoleIds.has(id)
        );

        if (invalidChildRoleIds.length > 0) {
          throw NextlyError.validation({
            errors: [
              {
                path: "childRoleIds",
                code: "INVALID",
                message:
                  "One or more child role IDs do not reference an existing role.",
              },
            ],
            logContext: { invalidChildRoleIds },
          });
        }
      }

      // Every mutation in one transaction. better-sqlite3 rejects an async
      // callback in Drizzle's own transaction, so `withTransaction` runs it
      // through the adapter on SQLite and natively elsewhere.
      try {
        const runMutations = async (
          // eslint-disable-next-line @typescript-eslint/no-explicit-any -- dialect-specific Drizzle typing
          executor: any
        ): Promise<{
          assignedPermIds: string[];
          assignedChildRoleIds: string[];
        }> => {
          // Before any write, in the same transaction: a role that inherits
          // one conferring super-admin gives super-admin to whoever holds it.
          await refuseGrantingSuperAdmin(
            executor as LastSuperAdminTx,
            this.dialect,
            uniqueChildRoleIds,
            { roleSlug: input.slug }
          );
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
            where: { roleId: id },
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

        // A transaction on every dialect: on SQLite it runs through the
        // adapter, so the decision above and these writes are not split by
        // another request's.
        const result = await this.withTransaction(tx => runMutations(tx));

        // Awaited, and the ordering is the invariant rather than a preference:
        // a runtime that freezes after responding can abandon an unawaited
        // shared write, leaving every other instance on the old epoch with no
        // sign anything went wrong.
        await invalidatePermissionCache({ roleId: id });

        return {
          id,
          name: input.name,
          slug: input.slug,
          description: input.description ?? null,
          level: input.level ?? 0,
          isSystem: Boolean(input.isSystem ?? false),
          permissionIds: result.assignedPermIds,
          childRoleIds: result.assignedChildRoleIds,
        };
      } catch (e: unknown) {
        // Log the raw error so developers can see the true cause. The mapped
        // message thrown at the boundary is intentionally generic for safety,
        // but silently swallowing the original error made "Failed to create
        // role" undebuggable (no stack, no DB code, no SQL). Surface the
        // full error at WARN so it appears in dev terminals without needing
        // verbose logging turned on.
        this.logCreateFailure("createRole transaction failed", e, options);
        // Re-throw NextlyErrors unchanged (e.g. our validation/duplicate
        // throws above). Map raw DB errors via fromDatabaseError; the legacy
        // override "A role with this slug or name already exists" is dropped
        // because the factory's generic "Resource already exists." matches
        // §13.8 and the duplicate branches above already cover the common case.
        if (NextlyError.is(e)) throw e;
        // Normalise raw driver errors so unique/fk/etc. produce the right
        // kind instead of collapsing to INTERNAL_ERROR.
        throw NextlyError.fromDatabaseError(toDbError(this.dialect, e));
      }
    } catch (e: unknown) {
      // Same rationale as the inner catch: log the raw error so the
      // developer sees the actual cause (e.g. a validation query failing
      // because a referenced table is missing). The outer catch covers
      // errors thrown before the transaction begins.
      this.logCreateFailure("createRole failed before transaction", e, options);
      if (NextlyError.is(e)) throw e;
      // Normalise raw driver errors so the kind is preserved.
      throw NextlyError.fromDatabaseError(toDbError(this.dialect, e));
    }
  }

  /**
   * Log why a role was not created: at warn, so the cause shows in a dev
   * terminal, except a name or slug another role already holds when the
   * caller said it expects one. That caller reports the conflict itself, and
   * a warning here would announce a race the caller settles as success.
   */
  private logCreateFailure(
    stage: string,
    e: unknown,
    options: CreateRoleOptions
  ): void {
    const message = `${stage}: ${e instanceof Error ? e.message : String(e)}`;
    const context = {
      error: e instanceof Error ? { name: e.name, stack: e.stack } : e,
    };
    if (options.quietOnConflict && isRoleConflict(e)) {
      this.logger.debug(message, context);
    } else {
      this.logger.warn(message, context);
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
  ): Promise<void> {
    // NOTE: This method temporarily includes logic from other services
    // Will be refactored to use RolePermissionService and RoleInheritanceService
    try {
      // Validate input
      validateRoleId(roleId);

      // Fetch the current role
      const { roles } = this.tables;

      const roleResult = await this.db
        .select({
          id: roles.id,
          name: roles.name,
          slug: roles.slug,
          description: roles.description,
          level: roles.level,
          isSystem: roles.isSystem,
        })
        .from(roles)
        .where(eq(roles.id, roleId))
        .limit(1);

      if (!roleResult || roleResult.length === 0) {
        throw NextlyError.notFound({ logContext: { roleId } });
      }

      const currentRole = roleResult[0];
      // Written as the role's row spells its id. MySQL matches ids
      // case-insensitively, so the request's spelling can differ from the
      // row's own, and the rows written below are read back by comparing ids.
      const storedRoleId = String(currentRole.id);
      const isSystemRole = Boolean(currentRole.isSystem);
      // The Public role is the one built-in role whose permissions an owner
      // sets, so a change to its permissions alone goes through. It never
      // inherits another role, which would hand visitors that role's grants.
      const isPublicRole =
        isSystemRole && String(currentRole.slug) === PUBLIC_ROLE_SLUG;
      if (isPublicRole && (changes.childRoleIds?.length ?? 0) > 0) {
        throw NextlyError.builtIn({
          thing: "role",
          change: "inherit",
          logContext: { reason: "public-role-inherit-refused", roleId },
        });
      }
      // A role editor sends the whole form, the role's own name, slug,
      // description, level and (none) child roles included: a field sent as
      // it stands is no change to it.
      const unchanged = (sent: unknown, stored: unknown) =>
        sent === undefined || (sent || null) === (stored || null);
      const permissionsOnly =
        unchanged(changes.name, currentRole.name) &&
        unchanged(changes.slug, currentRole.slug) &&
        unchanged(changes.description, currentRole.description) &&
        (changes.level === undefined ||
          Number(changes.level) === Number(currentRole.level));

      // Prevent modifying system roles. The caller is told the role is built
      // in, a fact about the role and not about their permissions (which
      // §13.8 keeps generic); the reason goes to logContext.
      if (isSystemRole && !(isPublicRole && permissionsOnly)) {
        throw NextlyError.builtIn({
          thing: "role",
          change: "change",
          logContext: {
            reason: "system-role-immutable",
            roleId,
          },
        });
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
            where: { id: { in: uniquePermissionIds } },
            columns: { id: true },
          });

          const existingPermissionIds = new Set(
            existingPermissions.map(p => String(p.id))
          );

          const invalidPermissionIds = uniquePermissionIds.filter(
            id => !existingPermissionIds.has(id)
          );

          if (invalidPermissionIds.length > 0) {
            throw NextlyError.validation({
              errors: [
                {
                  path: "permissionIds",
                  code: "INVALID",
                  message:
                    "One or more permission IDs do not reference an existing permission.",
                },
              ],
              logContext: { invalidPermissionIds },
            });
          }
        }
      }

      // Handle child role updates - validate before transaction
      let uniqueChildRoleIds: string[] = [];
      if (changes.childRoleIds !== undefined) {
        uniqueChildRoleIds = Array.from(
          new Set(changes.childRoleIds.map(String))
        );
        // The Public role is never inherited (see createRole).
        await refuseLinkingPublicRole(
          this.db as LastSuperAdminTx,
          this.dialect,
          uniqueChildRoleIds,
          "inherit",
          { roleId: storedRoleId }
        );

        // Verify all child roles exist
        if (uniqueChildRoleIds.length > 0) {
          const existingChildRoles = await (
            this.db as RBACDatabaseInstance
          ).query.roles.findMany({
            where: { id: { in: uniqueChildRoleIds } },
            columns: { id: true },
          });

          const existingChildRoleIds = new Set(
            existingChildRoles.map(r => String(r.id))
          );

          const invalidChildRoleIds = uniqueChildRoleIds.filter(
            id => !existingChildRoleIds.has(id)
          );

          if (invalidChildRoleIds.length > 0) {
            throw NextlyError.validation({
              errors: [
                {
                  path: "childRoleIds",
                  code: "INVALID",
                  message:
                    "One or more child role IDs do not reference an existing role.",
                },
              ],
              logContext: { invalidChildRoleIds },
            });
          }
        }
      }

      // Wrap all database mutations in a transaction for atomicity. The
      // adapter's, as deleteRole uses: it is async on every dialect, where the
      // query builder's transaction on SQLite runs its callback synchronously
      // and refuses one that returns a promise, so the edit failed there
      // before it changed anything.
      try {
        await this.adapter.transaction(async tx => {
          // First, in the same transaction: inheriting a role that confers
          // super-admin gives super-admin to everyone who holds this one.
          // And what this one stops inheriting may be how the last
          // super-admin is one: kept, under the same lock.
          if (changes.childRoleIds !== undefined) {
            const guardTx = tx.drizzleWithRelations<LastSuperAdminTx>(
              resolveRelations(this.dialect)
            );
            await refuseGrantingSuperAdmin(
              guardTx,
              this.dialect,
              uniqueChildRoleIds,
              { roleId: storedRoleId }
            );
            await refuseRemovingLastSuperAdmin(
              guardTx,
              this.tables,
              this.dialect,
              {
                kind: "replaceChildren",
                roleId: storedRoleId,
                childRoleIds: uniqueChildRoleIds,
              }
            );
          }
          // Update role basic fields if any provided
          if (Object.keys(updateData).length > 0) {
            await tx.update(
              "roles",
              updateData,
              this.whereEq("id", storedRoleId)
            );
          }

          // Handle permission updates
          if (changes.permissionIds !== undefined) {
            // Delete all existing role-permission mappings
            await tx.delete(
              "role_permissions",
              this.whereEq("roleId", storedRoleId)
            );

            // Insert new role-permission mappings. `createdAt` is set here
            // because the schema's default for it is applied by the query
            // builder, which the adapter's insert does not go through.
            if (uniquePermissionIds.length > 0) {
              const createdAt = new Date();
              await tx.insertMany(
                "role_permissions",
                uniquePermissionIds.map(permissionId => ({
                  id: randomUUID(),
                  roleId: storedRoleId,
                  permissionId,
                  createdAt,
                }))
              );
            }
          }

          // Handle child role updates
          if (changes.childRoleIds !== undefined) {
            // Delete all existing role inheritance relationships for this parent
            await tx.delete(
              "role_inherits",
              this.whereEq("parentRoleId", storedRoleId)
            );

            // Insert new role inheritance relationships
            if (uniqueChildRoleIds.length > 0) {
              await tx.insertMany(
                "role_inherits",
                uniqueChildRoleIds.map(childRoleId => ({
                  id: randomUUID(),
                  parentRoleId: storedRoleId,
                  childRoleId,
                }))
              );
            }
          }
        });

        // Invalidate cache after successful transaction. A new slug changes
        // the roles a code-defined rule reads, as new grants change the
        // permissions it reads. Named by the role's own id, as the caches
        // holding its grants keep it.
        if (
          changes.permissionIds !== undefined ||
          changes.childRoleIds !== undefined ||
          changes.slug !== undefined
        ) {
          await afterRoleGrantsChanged(storedRoleId);
        }

        return;
      } catch (e: unknown) {
        // Re-throw NextlyErrors unchanged. Map raw DB errors via
        // fromDatabaseError; the legacy slug/name override message is dropped
        // because the factory's generic "Resource already exists." satisfies
        // §13.8. Normalise raw driver errors first so the kind is preserved.
        if (NextlyError.is(e)) throw e;
        throw NextlyError.fromDatabaseError(toDbError(this.dialect, e));
      }
    } catch (e: unknown) {
      if (NextlyError.is(e)) throw e;
      // Outer catch covers errors thrown before the transaction begins;
      // normalise raw driver errors so the kind is preserved.
      throw NextlyError.fromDatabaseError(toDbError(this.dialect, e));
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
  async deleteRole(roleId: string): Promise<void> {
    try {
      // Validate input
      validateRoleId(roleId);

      const { roles } = this.tables;

      // Fetch the role

      const roleResult = await this.db
        .select({
          id: roles.id,
          isSystem: roles.isSystem,
        })
        .from(roles)
        .where(eq(roles.id, roleId))
        .limit(1);

      if (!roleResult || roleResult.length === 0) {
        throw NextlyError.notFound({ logContext: { roleId } });
      }

      const role = roleResult[0];
      const isSystemRole = Boolean(role.isSystem);

      // Prevent deleting system roles, telling the caller the role is built
      // in; the reason goes to logContext.
      if (isSystemRole) {
        throw NextlyError.builtIn({
          thing: "role",
          change: "delete",
          logContext: { reason: "system-role-undeletable", roleId },
        });
      }

      // The adapter's transaction rather than Drizzle's. Drizzle's SQLite
      // driver wraps better-sqlite3's transaction, which is synchronous and
      // rejects a callback returning a promise — it threw and rolled back
      // while the callback's statements ran on anyway, outside any
      // transaction: the role was deleted and the caller was told it failed.
      // The adapter is async on every dialect, and on Postgres it holds the
      // one pooled client the statements run on, which `this.db` would not.
      // Columns are named as the schema declares them, not as SQL spells them:
      // the adapter resolves a where clause against the table object, whose
      // keys are the JS property names.
      await this.adapter.transaction(async tx => {
        // First, under the lock every change to who is a super-admin takes:
        // the role's holders may be super-admins only through it, and the
        // last of them is kept.
        await refuseRemovingLastSuperAdmin(
          tx.drizzleWithRelations<LastSuperAdminTx>(
            resolveRelations(this.dialect)
          ),
          this.tables,
          this.dialect,
          { kind: "deleteRole", roleId }
        );
        // Cascade first, then the role, so nothing references a row that is
        // already gone if the database is enforcing keys.
        await tx.delete("role_permissions", this.whereEq("roleId", roleId));
        await tx.delete("user_roles", this.whereEq("roleId", roleId));
        await tx.delete("role_inherits", this.whereEq("parentRoleId", roleId));
        await tx.delete("role_inherits", this.whereEq("childRoleId", roleId));
        await tx.delete("roles", this.whereEq("id", roleId));
      });

      // Awaited, for the reason `createRole` gives: an abandoned shared write
      // leaves the other instances holding answers this delete retired.
      await afterRoleGrantsChanged(roleId);
    } catch (e: unknown) {
      // Re-throw NextlyErrors unchanged. Raw DB errors map via
      // fromDatabaseError, which provides the spec-compliant generic public
      // message and rich operator logContext. Normalise raw driver errors
      // via toDbError(dialect) first so the kind is preserved.
      if (NextlyError.is(e)) throw e;
      throw NextlyError.fromDatabaseError(toDbError(this.dialect, e));
    }
  }
}
