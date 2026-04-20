import { randomUUID } from "crypto";

import type { DrizzleAdapter } from "@revnixhq/adapter-drizzle";
import { and, asc, count, desc, eq, or, sql } from "drizzle-orm";

import type {
  PermissionInsertData,
  PermissionSelectResult,
  PermissionUpdateData,
  RBACDatabaseInstance,
} from "@nextly/types/rbac-operations";

import { isSystemResource } from "../../../schemas/rbac";
import { BaseService } from "../../../services/base-service";
import { mapDbErrorToServiceError } from "../../../services/lib/db-error";
import type { Logger } from "../../../services/shared";

interface PermissionsTableLike {
  resource: unknown;
  action: unknown;
}

function buildHiddenPermissionConditions(
  permissionsTable: PermissionsTableLike
) {
  return [
    // Hide the legacy `permissions` resource from assignable/admin permission lists.
    sql`${permissionsTable.resource} <> 'permissions'`,
    // Hide create/delete actions for `settings` resource.
    sql`NOT (${permissionsTable.resource} = 'settings' AND ${permissionsTable.action} IN ('create', 'delete'))`,
  ];
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
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const result = await (this.db as any)
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
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const result = await (this.db as any)
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
    pageSize?: number;
    // Search
    search?: string;
    // Filters
    action?: string;
    resource?: string;
    // Sorting
    sortBy?: "action" | "resource" | "name";
    sortOrder?: "asc" | "desc";
  }): Promise<{
    success: boolean;
    statusCode: number;
    message: string;
    data: Array<{
      id: string;
      name: string;
      slug: string;
      action: string;
      resource: string;
      description: string | null;
      category?: string;
    }> | null;
    meta?: {
      total: number;
      page: number;
      pageSize: number;
      totalPages: number;
    };
  }> {
    try {
      const {
        page = 1,
        pageSize = 10,
        search,
        action,
        resource,
        sortBy = "resource",
        sortOrder = "asc",
      } = options || {};

      const { permissions } = this.tables;

      const conditions = [...buildHiddenPermissionConditions(permissions)];

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

      const offset = (page - 1) * pageSize;

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const countResult = await (this.db as any)
        .select({ value: count() })
        .from(permissions)
        .where(whereClause);

      const total = Number(countResult[0]?.value ?? 0);

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const rows = await (this.db as any)
        .select({
          id: permissions.id,
          name: permissions.name,
          slug: permissions.slug,
          action: permissions.action,
          resource: permissions.resource,
          description: permissions.description,
        })
        .from(permissions)
        .where(whereClause)
        .orderBy(orderByClause)
        .limit(pageSize)
        .offset(offset);

      const totalPages = Math.ceil(total / pageSize);

      const resourcesInRows = [
        ...new Set(rows.map((row: PermissionSelectResult) => row.resource)),
      ];

      const collectionsMap = new Set<string>();
      const singlesMap = new Set<string>();

      if (this.tables?.dynamicCollections && resourcesInRows.length > 0) {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const collections = await (this.db as any)
          .select({ slug: this.tables.dynamicCollections.slug })
          .from(this.tables.dynamicCollections);
        collections.forEach((c: { slug: string }) =>
          collectionsMap.add(c.slug)
        );
      }

      if (this.tables?.dynamicSingles && resourcesInRows.length > 0) {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const singles = await (this.db as any)
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
        success: true,
        statusCode: 200,
        message: "Permissions fetched successfully",
        data: rows.map((row: PermissionSelectResult) => {
          let category = "collection-types";

          if (isSystemResource(row.resource as string)) {
            category = "settings";
          } else if (singlesMap.has(row.resource as string)) {
            category = "single-types";
          } else if (collectionsMap.has(row.resource as string)) {
            category = "collection-types";
          }

          this.logger.debug("[PermissionService] Permission categorized", {
            resource: row.resource,
            category,
            isSystem: isSystemResource(row.resource as string),
            isInSingles: singlesMap.has(row.resource as string),
            isInCollections: collectionsMap.has(row.resource as string),
          });

          return {
            id: String(row.id),
            name: String(row.name),
            slug: String(row.slug),
            action: String(row.action),
            resource: String(row.resource),
            description: row.description ? String(row.description) : null,
            category,
          };
        }),
        meta: {
          total,
          page,
          pageSize,
          totalPages,
        },
      };
    } catch (err) {
      return mapDbErrorToServiceError(err, {
        defaultMessage: "Failed to fetch permissions",
      });
    }
  }

  /**
   * Get a permission by ID.
   *
   * @param permissionId - Permission ID
   * @returns Permission details or null if not found
   */
  async getPermissionById(permissionId: string): Promise<{
    success: boolean;
    message: string;
    statusCode: number;
    data: {
      id: string;
      name: string;
      slug: string;
      action: string;
      resource: string;
      description: string | null;
      category?: string;
    } | null;
  }> {
    const permission = await (
      this.db as RBACDatabaseInstance
    ).query.permissions.findFirst({
      where: eq(this.tables.permissions.id, permissionId),
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
      return {
        success: false,
        message: "Permission not found",
        statusCode: 404,
        data: null,
      };
    }

    const isHiddenPermission =
      permission.resource === "permissions" ||
      (permission.resource === "settings" &&
        (permission.action === "create" || permission.action === "delete"));

    if (isHiddenPermission) {
      return {
        success: false,
        message: "Permission not found",
        statusCode: 404,
        data: null,
      };
    }

    let category = "collection-types";

    if (isSystemResource(permission.resource as string)) {
      category = "settings";
    } else {
      if (this.tables?.dynamicSingles) {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const single = await (this.db as any)
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
      success: true,
      message: "Permission retrieved successfully",
      statusCode: 200,
      data: {
        id: String(permission.id),
        name: String(permission.name),
        slug: String(permission.slug),
        action: String(permission.action),
        resource: String(permission.resource),
        description: permission.description
          ? String(permission.description)
          : null,
        category,
      },
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
    description?: string
  ): Promise<{
    success: boolean;
    message: string;
    statusCode: number;
    data: { id: string } | null;
  }> {
    await this.validateResource(resource);

    const { permissions } = this.tables;
    // Case-insensitive matching to align with listPermissions behavior
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const existing = await (this.db as any)
      .select({ id: permissions.id })
      .from(permissions)
      .where(
        and(
          sql`LOWER(${permissions.action}) = LOWER(${action})`,
          sql`LOWER(${permissions.resource}) = LOWER(${resource})`
        )
      )
      .limit(1)
      .then((rows: unknown[]) => (rows[0] as unknown) || null);
    if (existing) {
      return {
        success: true,
        message: "Permission already exists",
        statusCode: 200,
        data: { id: String(existing.id) },
      };
    }
    const id = randomUUID();
    const permissionData: PermissionInsertData = {
      id,
      name,
      slug,
      action,
      resource,
      description: description ?? null,
    };
    const insertPerm = (this.db as RBACDatabaseInstance)
      .insert(this.tables.permissions)
      .values(permissionData);
    if (typeof insertPerm.onConflictDoNothing === "function") {
      await insertPerm.onConflictDoNothing();
    } else {
      await insertPerm;
    }
    return {
      success: true,
      message: "Permission created successfully",
      statusCode: 201,
      data: { id },
    };
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
  ): Promise<{
    success: boolean;
    message: string;
    statusCode: number;
    data: null;
  }> {
    try {
      const permission = await (
        this.db as RBACDatabaseInstance
      ).query.permissions.findFirst({
        where: eq(this.tables.permissions.id, permissionId),
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
        return {
          success: false,
          message: "Permission not found",
          statusCode: 404,
          data: null,
        };
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
        return {
          success: true,
          message: "Permission already up to date",
          statusCode: 200,
          data: null,
        };
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

      return {
        success: true,
        message: "Permission updated successfully",
        statusCode: 200,
        data: null,
      };
    } catch (err) {
      return mapDbErrorToServiceError(err, {
        defaultMessage: "Failed to update permission",
        "unique-violation": "Permission with this slug or name already exists",
        constraint: "Permission with this slug or name already exists",
      });
    }
  }

  /**
   * Delete a permission by ID if it's not assigned to any roles.
   *
   * @param permissionId - Permission ID
   * @returns Success/failure status
   */
  async deletePermissionById(permissionId: string): Promise<{
    success: boolean;
    message: string;
    statusCode: number;
    data: null;
  }> {
    const permission = await (
      this.db as RBACDatabaseInstance
    ).query.permissions.findFirst({
      where: eq(this.tables.permissions.id, permissionId),
      columns: {
        id: true,
        resource: true,
      },
    });

    if (!permission) {
      return {
        success: false,
        message: "Permission not found",
        statusCode: 404,
        data: null,
      };
    }

    if (isSystemResource(permission.resource as string)) {
      return {
        success: false,
        message: "System permissions cannot be deleted",
        statusCode: 403,
        data: null,
      };
    }

    const usage = await (
      this.db as RBACDatabaseInstance
    ).query.rolePermissions.findFirst({
      where: eq(this.tables.rolePermissions.permissionId, permissionId),
      columns: {
        id: true,
      },
    });

    if (usage) {
      return {
        success: false,
        message: "Permission is assigned to roles",
        statusCode: 400,
        data: null,
      };
    }

    await (this.db as RBACDatabaseInstance)
      .delete(this.tables.permissions)
      .where(eq(this.tables.permissions.id, permissionId));

    return {
      success: true,
      message: "Permission deleted successfully",
      statusCode: 200,
      data: null,
    };
  }

  /**
   * Delete a permission by action and resource if it's not assigned to any roles.
   *
   * @param action - Permission action
   * @param resource - Permission resource
   * @returns Success/failure status
   */
  async deletePermission(
    action: string,
    resource: string
  ): Promise<{
    success: boolean;
    message: string;
    statusCode: number;
    data: null;
  }> {
    const { permissions } = this.tables;
    // Case-insensitive matching to align with listPermissions behavior
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const permission = await (this.db as any)
      .select({ id: permissions.id })
      .from(permissions)
      .where(
        and(
          sql`LOWER(${permissions.action}) = LOWER(${action})`,
          sql`LOWER(${permissions.resource}) = LOWER(${resource})`
        )
      )
      .limit(1)
      .then((rows: unknown[]) => (rows[0] as unknown) || null);

    if (!permission) {
      return {
        success: false,
        message: "Permission not found",
        statusCode: 404,
        data: null,
      };
    }

    const permissionId = (permission as { id: unknown }).id;
    const usage = await (
      this.db as RBACDatabaseInstance
    ).query.rolePermissions.findFirst({
      where: eq(this.tables.rolePermissions.permissionId, permissionId),
      columns: {
        id: true,
      },
    });

    if (usage) {
      return {
        success: false,
        message: "Permission is assigned to roles",
        statusCode: 400,
        data: null,
      };
    }

    await (this.db as RBACDatabaseInstance)
      .delete(this.tables.permissions)
      .where(eq(this.tables.permissions.id, permissionId));

    return {
      success: true,
      message: "Permission deleted successfully",
      statusCode: 200,
      data: null,
    };
  }
}
