import { randomUUID } from "crypto";

import type { DrizzleAdapter } from "@nextlyhq/adapter-drizzle";
import { and, asc, count, desc, eq, or, sql } from "drizzle-orm";

import type {
  PermissionInsertData,
  PermissionSelectResult,
  PermissionUpdateData,
  RBACDatabaseInstance,
} from "@nextly/types/rbac-operations";

// PR 4 migration: replaced legacy result-shape returns and
// mapDbErrorToServiceError calls with throw-based NextlyError. Methods now
// return their data directly; failures throw a NextlyError.
import { toDbError } from "../../../database/errors";
import { NextlyError } from "../../../errors/nextly-error";
import { isSystemResource } from "../../../schemas/_zod/rbac";
import { BaseService } from "../../../services/base-service";
import type { Logger } from "../../../services/shared";

interface PermissionsTableLike {
  resource: unknown;
  action: unknown;
  orphanedAt: unknown;
}

function buildHiddenPermissionConditions(
  permissionsTable: PermissionsTableLike,
  options?: { includeOrphaned?: boolean }
) {
  const conditions = [
    // Hide the legacy `permissions` resource from assignable/admin permission lists.
    sql`${permissionsTable.resource} <> 'permissions'`,
    // Hide create/delete actions for `settings` resource.
    sql`NOT (${permissionsTable.resource} = 'settings' AND ${permissionsTable.action} IN ('create', 'delete'))`,
  ];

  if (!options?.includeOrphaned) {
    // A permission nothing declares any more should not be offered as a choice
    // — it enforces nothing, so granting it does nothing. It stays in the table
    // and keeps its grants; this only takes it off the menu. Retiring it is a
    // separate, deliberate act, and the cleanup that does the retiring asks for
    // orphans explicitly.
    conditions.push(sql`${permissionsTable.orphanedAt} IS NULL`);
  }

  return conditions;
}

/**
 * PermissionService handles all permission CRUD operations.
 *
 * Responsibilities:
 * - List permissions with pagination and filtering
 * - Create, read, update, delete permissions
 * - Validate permission uniqueness (action + resource)
 * - Ensure permissions exist idempotently
 *
 * @example
 * ```typescript
 * const permissionService = new PermissionService(adapter, logger);
 * const result = await permissionService.listPermissions({ action: 'read' });
 * ```
 */
export class PermissionService extends BaseService {
  constructor(adapter: DrizzleAdapter, logger: Logger) {
    super(adapter, logger);
  }

  private async validateResource(resource: string): Promise<void> {
    if (isSystemResource(resource)) {
      return;
    }

    try {
      if (this.tables?.dynamicCollections) {
        const result = await this.db
          .select({ slug: this.tables.dynamicCollections.slug })
          .from(this.tables.dynamicCollections)
          .where(eq(this.tables.dynamicCollections.slug, resource))
          .limit(1);

        if (result.length > 0) {
          return;
        }
      }
    } catch {
      // Table may not exist yet (fresh DB). Silently continue.
    }

    try {
      if (this.tables?.dynamicSingles) {
        const result = await this.db
          .select({ slug: this.tables.dynamicSingles.slug })
          .from(this.tables.dynamicSingles)
          .where(eq(this.tables.dynamicSingles.slug, resource))
          .limit(1);

        if (result.length > 0) {
          return;
        }
      }
    } catch {
      // Table may not exist yet (fresh DB). Silently continue.
    }

    this.logger.warn(
      `Permission resource "${resource}" is not a recognized system resource or existing collection. ` +
        `This may be intentional (e.g., pre-seeding for a collection not yet created).`
    );
  }

  /**
   * List all permissions with pagination, search, and filtering.
   *
   * @param options - Pagination, search, filter, and sort options
   * @returns Paginated list of permissions with metadata
   */
  async listPermissions(options?: {
    // Pagination
    page?: number;
    limit?: number;
    // Search
    search?: string;
    // Filters
    action?: string;
    resource?: string;
    // Sorting
    sortBy?: "action" | "resource" | "name";
    sortOrder?: "asc" | "desc";
    /**
     * Include permissions nothing declares any more. Off by default: they are
     * not a choice anyone should be offered. The cleanup that retires them
     * needs to see them, and asks.
     */
    includeOrphaned?: boolean;
  }): Promise<{
    data: Array<{
      id: string;
      name: string;
      slug: string;
      action: string;
      resource: string;
      description: string | null;
      category?: string;
      /** Package that declared this permission; null for the built-in seeds. */
      owner: string | null;
      /** True once the declaring package stopped declaring it. */
      orphaned: boolean;
      /** Heading within the owner's section; null when the owner set none. */
      group: string | null;
      /** True for a permission the admin should warn before granting. */
      danger: boolean;
    }>;
    meta: {
      total: number;
      page: number;
      limit: number;
      totalPages: number;
    };
  }> {
    try {
      const {
        page = 1,
        limit = 10,
        search,
        action,
        resource,
        sortBy = "resource",
        sortOrder = "asc",
        includeOrphaned = false,
      } = options || {};

      const { permissions } = this.tables;

      const conditions = [
        ...buildHiddenPermissionConditions(permissions, { includeOrphaned }),
      ];

      if (search) {
        const searchPattern = `%${search}%`;
        const searchCondition = or(
          sql`LOWER(${permissions.name}) LIKE LOWER(${searchPattern})`,
          sql`LOWER(${permissions.action}) LIKE LOWER(${searchPattern})`,
          sql`LOWER(${permissions.resource}) LIKE LOWER(${searchPattern})`,
          sql`LOWER(${permissions.description}) LIKE LOWER(${searchPattern})`
        );

        if (searchCondition) {
          conditions.push(searchCondition);
        }
      }

      if (action) {
        const actionPattern = `%${action}%`;
        conditions.push(
          sql`LOWER(${permissions.action}) LIKE LOWER(${actionPattern})`
        );
      }

      if (resource) {
        const resourcePattern = `%${resource}%`;
        conditions.push(
          sql`LOWER(${permissions.resource}) LIKE LOWER(${resourcePattern})`
        );
      }

      const whereClause =
        conditions.length > 0 ? and(...conditions) : undefined;

      let orderByClause;
      const orderFn = sortOrder === "asc" ? asc : desc;

      switch (sortBy) {
        case "name":
          orderByClause = orderFn(permissions.name);
          break;
        case "action":
          orderByClause = orderFn(permissions.action);
          break;
        case "resource":
          orderByClause = orderFn(permissions.resource);
          break;
        default:
          orderByClause = orderFn(permissions.resource);
      }

      const offset = (page - 1) * limit;

      const countResult = await this.db
        .select({ value: count() })
        .from(permissions)
        .where(whereClause);

      const total = Number(countResult[0]?.value ?? 0);

      const rows = await this.db
        .select({
          id: permissions.id,
          name: permissions.name,
          slug: permissions.slug,
          action: permissions.action,
          resource: permissions.resource,
          description: permissions.description,
          owner: permissions.owner,
          orphanedAt: permissions.orphanedAt,
          permissionGroup: permissions.permissionGroup,
          danger: permissions.danger,
        })
        .from(permissions)
        .where(whereClause)
        .orderBy(orderByClause)
        .limit(limit)
        .offset(offset);

      const totalPages = Math.ceil(total / limit);

      const resourcesInRows = [
        ...new Set(rows.map((row: PermissionSelectResult) => row.resource)),
      ];

      const collectionsMap = new Set<string>();
      const singlesMap = new Set<string>();

      if (this.tables?.dynamicCollections && resourcesInRows.length > 0) {
        const collections = await this.db
          .select({ slug: this.tables.dynamicCollections.slug })
          .from(this.tables.dynamicCollections);
        collections.forEach((c: { slug: string }) =>
          collectionsMap.add(c.slug)
        );
      }

      if (this.tables?.dynamicSingles && resourcesInRows.length > 0) {
        const singles = await this.db
          .select({ slug: this.tables.dynamicSingles.slug })
          .from(this.tables.dynamicSingles);
        singles.forEach((s: { slug: string }) => singlesMap.add(s.slug));
      }

      this.logger.debug("[PermissionService] Categorizing permissions", {
        totalPermissions: rows.length,
        collectionsCount: collectionsMap.size,
        singlesCount: singlesMap.size,
        collections: Array.from(collectionsMap),
        singles: Array.from(singlesMap),
      });

      return {
        data: rows.map((row: PermissionSelectResult) => {
          let category = "collection-types";

          if (isSystemResource(row.resource)) {
            category = "settings";
          } else if (singlesMap.has(row.resource)) {
            category = "single-types";
          } else if (collectionsMap.has(row.resource)) {
            category = "collection-types";
          }

          this.logger.debug("[PermissionService] Permission categorized", {
            resource: row.resource,
            category,
            isSystem: isSystemResource(row.resource),
            isInSingles: singlesMap.has(row.resource),
            isInCollections: collectionsMap.has(row.resource),
          });

          return {
            id: String(row.id),
            name: String(row.name),
            slug: String(row.slug),
            action: String(row.action),
            resource: String(row.resource),
            description: row.description ? String(row.description) : null,
            category,
            owner: row.owner ? String(row.owner) : null,
            orphaned: row.orphanedAt !== null && row.orphanedAt !== undefined,
            group: row.permissionGroup ? String(row.permissionGroup) : null,
            danger: Boolean(row.danger),
          };
        }),
        meta: {
          total,
          page,
          limit,
          totalPages,
        },
      };
    } catch (err) {
      // Any DB error during the list query -> NextlyError. fromDatabaseError
      // gives us a generic public message and rich operator logContext.
      // Normalise raw driver errors via toDbError(dialect) first so the
      // correct kind is preserved (otherwise everything would collapse to
      // INTERNAL_ERROR / 500).
      throw NextlyError.fromDatabaseError(toDbError(this.dialect, err));
    }
  }

  /**
   * Get a permission by ID.
   *
   * @param permissionId - Permission ID
   * @returns Permission details
   * @throws NextlyError(NOT_FOUND) when no permission has this id, or it is
   *   one of the hidden internal permissions (resource = 'permissions', or
   *   create/delete on 'settings'). The hidden case maps to NOT_FOUND
   *   intentionally — exposing it as FORBIDDEN would leak the policy.
   */
  async getPermissionById(permissionId: string): Promise<{
    id: string;
    name: string;
    slug: string;
    action: string;
    resource: string;
    description: string | null;
    category?: string;
  }> {
    const permission = await (
      this.db as RBACDatabaseInstance
    ).query.permissions.findFirst({
      where: { id: permissionId },
      columns: {
        id: true,
        name: true,
        slug: true,
        action: true,
        resource: true,
        description: true,
      },
    });

    if (!permission) {
      // Identifier moves to logContext per §13.8.
      throw NextlyError.notFound({ logContext: { permissionId } });
    }

    const isHiddenPermission =
      permission.resource === "permissions" ||
      (permission.resource === "settings" &&
        (permission.action === "create" || permission.action === "delete"));

    if (isHiddenPermission) {
      // Hidden internal permission — surface as NOT_FOUND to avoid leaking
      // the existence of the hidden surface area.
      throw NextlyError.notFound({
        logContext: {
          permissionId,
          reason: "hidden-permission",
          resource: permission.resource,
          action: permission.action,
        },
      });
    }

    let category = "collection-types";

    if (isSystemResource(permission.resource)) {
      category = "settings";
    } else {
      if (this.tables?.dynamicSingles) {
        const single = await this.db
          .select({ slug: this.tables.dynamicSingles.slug })
          .from(this.tables.dynamicSingles)
          .where(eq(this.tables.dynamicSingles.slug, permission.resource))
          .limit(1);

        if (single.length > 0) {
          category = "single-types";
        }
      }
    }

    return {
      id: String(permission.id),
      name: String(permission.name),
      slug: String(permission.slug),
      action: String(permission.action),
      resource: String(permission.resource),
      description: permission.description
        ? String(permission.description)
        : null,
      category,
    };
  }

  /**
   * Ensure a permission exists (idempotent create).
   *
   * Creates a permission if it doesn't exist. If a permission with the same
   * action and resource already exists, returns the existing permission ID.
   *
   * @param action - Permission action (e.g., 'read', 'write', 'delete')
   * @param resource - Permission resource (e.g., 'users', 'posts', 'settings')
   * @param name - Human-readable permission name
   * @param slug - URL-friendly permission slug
   * @param description - Optional permission description
   * @returns Permission ID (existing or newly created)
   */
  async ensurePermission(
    action: string,
    resource: string,
    name: string,
    slug: string,
    description?: string,
    /**
     * What the declaration says about the permission beyond its identity.
     *
     * An object rather than three more positional arguments: the signature was
     * already six deep, and `(…, undefined, undefined, true)` is not something
     * anyone should have to read.
     */
    meta?: {
      /**
       * Who declared it — a plugin name, or omitted for the framework's own
       * per-collection seeds. Recorded so the admin can tell a plugin's custom
       * permission from a content type's, rather than inferring one from the
       * slug and inventing a collection that does not exist.
       */
      owner?: string;
      /** Heading within the owner's section of the matrix. */
      group?: string;
      /** True for a permission the admin should warn before granting. */
      danger?: boolean;
    }
  ): Promise<{
    /** ID of the existing or newly created permission row. */
    id: string;
    /** True if this call inserted a new row, false if a matching row already existed. */
    created: boolean;
  }> {
    await this.validateResource(resource);

    const { permissions } = this.tables;
    // Case-insensitive matching to align with listPermissions behavior

    const existing = await this.db
      .select({
        id: permissions.id,
        owner: permissions.owner,
        slug: permissions.slug,
        permissionGroup: permissions.permissionGroup,
        danger: permissions.danger,
        orphanedAt: permissions.orphanedAt,
      })
      .from(permissions)
      .where(
        and(
          sql`LOWER(${permissions.action}) = LOWER(${action})`,
          sql`LOWER(${permissions.resource}) = LOWER(${resource})`
        )
      )
      .limit(1)
      .then((rows: unknown[]) => rows[0] || null);
    if (existing) {
      // Adopt the row's provenance and slug if either is out of step with the
      // declaration. Create-if-missing alone would leave every permission
      // seeded before provenance existed permanently unattributed, which is
      // most of them on any database that has already run — and the
      // declaration is the truth about a permission, not whatever was true
      // when it was first written.
      //
      // The slug is a label, not a key: identity is (action, resource) and
      // grants reference the row by id, so bringing a stale slug into line
      // renames without revoking. Without this, a corrected slug would reach
      // new installs only, and existing databases would keep answering to a
      // name no caller asks for.
      const patch: {
        owner?: string | null;
        slug?: string;
        permissionGroup?: string | null;
        danger?: boolean;
        orphanedAt?: Date | null;
      } = {};

      // Ensuring a permission IS the declaration, so a row that was retired
      // rejoins the menu. Without this, a permission whose declaration went
      // away and later came back stays marked: `listPermissions` filters
      // orphans out by default, so preset-role syncing and the permission
      // matrix would both skip a permission that exists and is declared.
      const currentlyOrphaned =
        (existing as { orphanedAt?: unknown }).orphanedAt != null;
      if (currentlyOrphaned) {
        patch.orphanedAt = null;
      }

      const currentOwner =
        (existing as { owner?: string | null }).owner ?? null;
      const declaredOwner = meta?.owner ?? null;
      if (currentOwner !== declaredOwner) {
        patch.owner = declaredOwner;
      }

      const currentGroup =
        (existing as { permissionGroup?: string | null }).permissionGroup ??
        null;
      const declaredGroup = meta?.group ?? null;
      if (currentGroup !== declaredGroup) {
        patch.permissionGroup = declaredGroup;
      }

      const currentDanger = Boolean((existing as { danger?: unknown }).danger);
      const declaredDanger = meta?.danger === true;
      if (currentDanger !== declaredDanger) {
        patch.danger = declaredDanger;
      }

      const currentSlug = (existing as { slug?: string | null }).slug ?? null;
      if (currentSlug !== slug) {
        patch.slug = slug;
      }

      if (Object.keys(patch).length > 0) {
        try {
          await this.db
            .update(permissions)
            .set(patch)
            .where(eq(permissions.id, String(existing.id)));
        } catch (err) {
          // Same contract as the insert below: a raw driver error never leaves
          // this service. The reachable case is the slug — it carries a unique
          // index, so adopting a declared slug already taken by another row
          // fails here rather than at insert.
          throw NextlyError.fromDatabaseError(toDbError(this.dialect, err));
        }
      }
      return { id: String(existing.id), created: false };
    }
    const id = randomUUID();
    const permissionData: PermissionInsertData = {
      id,
      name,
      slug,
      action,
      resource,
      description: description ?? null,
      owner: meta?.owner ?? null,
      permissionGroup: meta?.group ?? null,
      danger: meta?.danger === true,
    };
    try {
      const insertPerm = (this.db as RBACDatabaseInstance)
        .insert(this.tables.permissions)
        .values(permissionData);
      if (typeof insertPerm.onConflictDoNothing === "function") {
        await insertPerm.onConflictDoNothing();
      } else {
        await insertPerm;
      }
    } catch (err) {
      // Constraint / dialect error during insert -> NextlyError. The
      // method's seed-style idempotency means callers don't need a
      // distinct "duplicate" branch; fromDatabaseError is enough. Normalise
      // raw driver errors first so the kind is mapped correctly.
      throw NextlyError.fromDatabaseError(toDbError(this.dialect, err));
    }
    return { id, created: true };
  }

  /**
   * Update a permission's name, action, resource, or description.
   *
   * Note: Changing action/resource may affect existing role-permission assignments.
   *
   * @param permissionId - Permission ID
   * @param changes - Fields to update
   * @returns Success/failure status
   */
  async updatePermission(
    permissionId: string,
    changes: {
      name?: string;
      slug?: string;
      action?: string;
      resource?: string;
      description?: string;
    }
  ): Promise<void> {
    try {
      const permission = await (
        this.db as RBACDatabaseInstance
      ).query.permissions.findFirst({
        where: { id: permissionId },
        columns: {
          id: true,
          name: true,
          slug: true,
          action: true,
          resource: true,
          description: true,
        },
      });

      if (!permission) {
        throw NextlyError.notFound({ logContext: { permissionId } });
      }

      if (
        changes.resource !== undefined &&
        changes.resource !== permission.resource
      ) {
        await this.validateResource(changes.resource);
      }

      if (
        (changes.name === undefined || changes.name === permission.name) &&
        (changes.slug === undefined || changes.slug === permission.slug) &&
        (changes.action === undefined ||
          changes.action === permission.action) &&
        (changes.resource === undefined ||
          changes.resource === permission.resource) &&
        (changes.description === undefined ||
          changes.description === permission.description)
      ) {
        // No-op: nothing to update. Returning void is idempotent and
        // semantically correct here (the resource is already in the
        // requested state).
        return;
      }

      const updateData: PermissionUpdateData = {
        ...(changes.name !== undefined ? { name: changes.name } : {}),
        ...(changes.slug !== undefined ? { slug: changes.slug } : {}),
        ...(changes.action !== undefined ? { action: changes.action } : {}),
        ...(changes.resource !== undefined
          ? { resource: changes.resource }
          : {}),
        ...(changes.description !== undefined
          ? { description: changes.description }
          : {}),
      };

      await (this.db as RBACDatabaseInstance)
        .update(this.tables.permissions)
        .set(updateData)
        .where(eq(this.tables.permissions.id, permissionId));
    } catch (err) {
      // Re-throw NextlyError instances unchanged (e.g. our notFound above);
      // map raw DB errors via fromDatabaseError. The legacy override message
      // ("Permission with this slug or name already exists") is dropped:
      // §13.8 favours generic "Resource already exists." which is what the
      // unique-violation path already produces.
      if (NextlyError.is(err)) throw err;
      // Normalise raw driver errors first so unique-violation etc. are
      // preserved (would collapse to INTERNAL_ERROR otherwise).
      throw NextlyError.fromDatabaseError(toDbError(this.dialect, err));
    }
  }

  /**
   * Delete a permission by ID if it's not assigned to any roles.
   *
   * @param permissionId - Permission ID
   * @throws NextlyError(NOT_FOUND) when no permission has this id.
   * @throws NextlyError(FORBIDDEN) when the permission belongs to a system
   *   resource (system permissions are immutable).
   * @throws NextlyError(BUSINESS_RULE_VIOLATION) when the permission is
   *   currently assigned to one or more roles.
   */
  async deletePermissionById(permissionId: string): Promise<void> {
    const permission = await (
      this.db as RBACDatabaseInstance
    ).query.permissions.findFirst({
      where: { id: permissionId },
      columns: {
        id: true,
        resource: true,
      },
    });

    if (!permission) {
      throw NextlyError.notFound({ logContext: { permissionId } });
    }

    if (isSystemResource(permission.resource)) {
      // §13.8: forbidden messages must not reveal *why* (the policy / which
      // resource is system). Generic "You don't have permission..." comes
      // from the factory; the detail moves to logContext.
      throw NextlyError.forbidden({
        logContext: {
          reason: "system-permission-undeletable",
          permissionId,
          resource: permission.resource,
        },
      });
    }

    const usage = await (
      this.db as RBACDatabaseInstance
    ).query.rolePermissions.findFirst({
      where: { permissionId: permissionId },
      columns: {
        id: true,
      },
    });

    if (usage) {
      // Business rule, not a validation issue: the data was correct, but the
      // operation can't be completed in the current state. Custom code +
      // explicit 422 per the migration mapping table.
      throw new NextlyError({
        code: "BUSINESS_RULE_VIOLATION",
        publicMessage:
          "This permission is currently assigned to one or more roles and cannot be deleted.",
        statusCode: 422,
        logContext: { reason: "permission-in-use", permissionId },
      });
    }

    try {
      await (this.db as RBACDatabaseInstance)
        .delete(this.tables.permissions)
        .where(eq(this.tables.permissions.id, permissionId));
    } catch (err) {
      // Normalise raw driver errors so fk-violation / etc. produce the
      // right NextlyError instead of collapsing to INTERNAL_ERROR.
      throw NextlyError.fromDatabaseError(toDbError(this.dialect, err));
    }
  }

  /**
   * Delete a permission by action and resource if it's not assigned to any roles.
   *
   * @param action - Permission action
   * @param resource - Permission resource
   * @throws NextlyError(NOT_FOUND) when no permission matches.
   * @throws NextlyError(BUSINESS_RULE_VIOLATION) when the permission is in use.
   */
  async deletePermission(action: string, resource: string): Promise<void> {
    const { permissions } = this.tables;
    // Case-insensitive matching to align with listPermissions behavior

    const permission = await this.db
      .select({ id: permissions.id })
      .from(permissions)
      .where(
        and(
          sql`LOWER(${permissions.action}) = LOWER(${action})`,
          sql`LOWER(${permissions.resource}) = LOWER(${resource})`
        )
      )
      .limit(1)
      .then((rows: unknown[]) => rows[0] || null);

    if (!permission) {
      // Action + resource pair is operator context only; never echo into
      // the public message.
      throw NextlyError.notFound({ logContext: { action, resource } });
    }

    const permissionId = (permission as { id: unknown }).id;
    const usage = await (
      this.db as RBACDatabaseInstance
    ).query.rolePermissions.findFirst({
      where: { permissionId: permissionId },
      columns: {
        id: true,
      },
    });

    if (usage) {
      throw new NextlyError({
        code: "BUSINESS_RULE_VIOLATION",
        publicMessage:
          "This permission is currently assigned to one or more roles and cannot be deleted.",
        statusCode: 422,
        logContext: {
          reason: "permission-in-use",
          permissionId: String(permissionId),
        },
      });
    }

    try {
      await (this.db as RBACDatabaseInstance)
        .delete(this.tables.permissions)
        .where(eq(this.tables.permissions.id, permissionId));
    } catch (err) {
      // Normalise raw driver errors so the kind is mapped correctly
      // instead of collapsing to INTERNAL_ERROR.
      throw NextlyError.fromDatabaseError(toDbError(this.dialect, err));
    }
  }
}
