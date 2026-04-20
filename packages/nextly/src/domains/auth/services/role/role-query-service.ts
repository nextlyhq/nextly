import type { DrizzleAdapter } from "@revnixhq/adapter-drizzle";
import { and, asc, count, desc, eq, gte, inArray, lte, sql } from "drizzle-orm";

import { mapDbErrorToServiceError } from "@nextly/services/lib/db-error";
import type { RoleListSelectResult } from "@nextly/types/rbac-operations";

import { BaseService } from "../../../../services/base-service";
import type { Logger } from "../../../../services/shared";

import { toDialectBool } from "./utils";

/**
 * RoleQueryService handles all role read/query operations.
 *
 * Responsibilities:
 * - List roles with pagination and filtering
 * - Get role by ID
 * - Find role by name or slug
 *
 * @example
 * ```typescript
 * const queryService = new RoleQueryService(adapter, logger);
 * const result = await queryService.listRoles({ page: 1, pageSize: 10 });
 * ```
 */
export class RoleQueryService extends BaseService {
  /**
   * Creates a new RoleQueryService instance.
   *
   * @param adapter - Database adapter
   * @param logger - Logger instance
   */
  constructor(adapter: DrizzleAdapter, logger: Logger) {
    super(adapter, logger);
  }

  /**
   * List all roles with pagination, search, and filtering.
   *
   * @param options - Pagination, search, filter, and sort options
   * @returns Paginated list of roles with metadata
   */
  async listRoles(options?: {
    // Pagination
    page?: number;
    pageSize?: number;
    // Search
    search?: string;
    // Filters
    isSystem?: boolean;
    levelMin?: number;
    levelMax?: number;
    // Sorting
    sortBy?: "name" | "level";
    sortOrder?: "asc" | "desc";
    // Include permissions
    includePermissions?: boolean;
  }): Promise<{
    success: boolean;
    statusCode: number;
    message: string;
    data: Array<{
      id: string;
      name: string;
      description: string | null;
      level: number;
      isSystem: boolean;
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
        isSystem,
        levelMin,
        levelMax,
        sortBy = "level",
        sortOrder = "asc",
        includePermissions = false,
      } = options || {};

      const { roles, rolePermissions } = this.tables;

      // Build WHERE conditions
      const conditions = [];

      // Search by name (case-insensitive)
      if (search) {
        // Use database-agnostic case-insensitive search
        // ilike() only works on PostgreSQL, so use sql with LOWER() for cross-database compatibility
        const searchPattern = `%${search}%`;
        conditions.push(sql`LOWER(${roles.name}) LIKE LOWER(${searchPattern})`);
      }

      // Filter by isSystem
      if (isSystem !== undefined) {
        conditions.push(eq(roles.isSystem, toDialectBool(isSystem)));
      }

      // Filter by level range
      if (levelMin !== undefined) {
        conditions.push(gte(roles.level, levelMin));
      }
      if (levelMax !== undefined) {
        conditions.push(lte(roles.level, levelMax));
      }

      const whereClause =
        conditions.length > 0 ? and(...conditions) : undefined;

      // Determine sort column
      let orderByClause;
      const orderFn = sortOrder === "asc" ? asc : desc;

      switch (sortBy) {
        case "name":
          orderByClause = orderFn(roles.name);
          break;
        case "level":
          orderByClause = orderFn(roles.level);
          break;
        default:
          orderByClause = orderFn(roles.level);
      }

      // Calculate pagination
      const offset = (page - 1) * pageSize;

      // Get total count of all roles (including those without permissions)
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const countResult = await (this.db as any)
        .select({ value: count() })
        .from(roles)
        .where(whereClause);

      const total = Number(countResult[0]?.value ?? 0);

      // Fetch paginated roles (including those without permissions)
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const rows = await (this.db as any)
        .select({
          id: roles.id,
          name: roles.name,
          slug: roles.slug,
          description: roles.description,
          level: roles.level,
          isSystem: roles.isSystem,
        })
        .from(roles)
        .where(whereClause)
        .orderBy(orderByClause)
        .limit(pageSize)
        .offset(offset);

      const totalPages = Math.ceil(total / pageSize);

      // Fetch child roles for all roles using a single join query
      const roleIds = rows.map((row: RoleListSelectResult) => String(row.id));
      const childRolesMap = new Map<string, string[]>();

      if (roleIds.length > 0) {
        const roleInherits = this.tables.roleInherits;
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const childRolesRows = await (this.db as any)
          .select({
            parentRoleId: roleInherits.parentRoleId,
            childRoleId: roleInherits.childRoleId,
          })
          .from(roleInherits)
          .where(inArray(roleInherits.parentRoleId, roleIds));

        for (const row of childRolesRows) {
          const parentId = String(row.parentRoleId);
          const childId = String(row.childRoleId);
          if (!childRolesMap.has(parentId)) {
            childRolesMap.set(parentId, []);
          }
          childRolesMap.get(parentId)?.push(childId);
        }
      }

      // Fetch permissions for each role if requested
      const permissionsMap = new Map<string, string[]>();
      if (includePermissions && roleIds.length > 0) {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const rolePermissionsRows = await (this.db as any)
          .select({
            roleId: rolePermissions.roleId,
            permissionId: rolePermissions.permissionId,
          })
          .from(rolePermissions)
          .where(inArray(rolePermissions.roleId, roleIds));

        for (const row of rolePermissionsRows) {
          const roleId = String(row.roleId);
          const permId = String(row.permissionId);
          if (!permissionsMap.has(roleId)) {
            permissionsMap.set(roleId, []);
          }
          permissionsMap.get(roleId)?.push(permId);
        }
      }

      // Map results with child roles and permissions
      const data = rows.map((row: RoleListSelectResult) => {
        const roleId = String(row.id);
        return {
          id: roleId,
          name: row.name,
          slug: row.slug,
          description: row.description,
          level: row.level,
          isSystem: Boolean(row.isSystem),
          childRoleIds: childRolesMap.get(roleId) ?? [],
          ...(includePermissions && {
            permissionIds: permissionsMap.get(roleId) ?? [],
          }),
        };
      });

      return {
        success: true,
        statusCode: 200,
        message: "Roles retrieved successfully",
        data,
        meta: {
          total,
          page,
          pageSize,
          totalPages,
        },
      };
    } catch (e: unknown) {
      return mapDbErrorToServiceError(e, {
        defaultMessage: "Failed to list roles",
      });
    }
  }

  /**
   * Get a single role by ID.
   *
   * @param roleId - The role ID to fetch
   * @returns Role data or null if not found
   */
  async getRoleById(roleId: string): Promise<{
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
    } | null;
  }> {
    try {
      // Validate input
      if (!roleId || typeof roleId !== "string" || roleId.trim() === "") {
        return {
          success: false,
          statusCode: 400,
          message: "Role ID is required and must be a non-empty string",
          data: null,
        };
      }

      const uuidRegex =
        /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
      if (!uuidRegex.test(roleId)) {
        return {
          success: false,
          statusCode: 400,
          message: "Role ID must be a valid UUID format",
          data: null,
        };
      }

      const { roles } = this.tables;
      const role = await this.db.query.roles.findFirst({
        where: eq(roles.id, roleId),
        columns: {
          id: true,
          name: true,
          slug: true,
          description: true,
          level: true,
          isSystem: true,
        },
      });

      if (!role) {
        return {
          success: false,
          statusCode: 404,
          message: "Role not found",
          data: null,
        };
      }

      return {
        success: true,
        statusCode: 200,
        message: "Role retrieved successfully",
        data: {
          id: String(role.id),
          name: role.name,
          slug: role.slug,
          description: role.description,
          level: role.level,
          isSystem: Boolean(role.isSystem),
        },
      };
    } catch (e: unknown) {
      return mapDbErrorToServiceError(e, {
        defaultMessage: "Failed to get role",
      });
    }
  }

  /**
   * Find role by name.
   *
   * @param name - The role name to search for
   * @returns Role ID or null if not found
   */
  async getRoleByName(name: string): Promise<{ id: string } | null> {
    const { roles } = this.tables;
    const role = await this.db.query.roles.findFirst({
      where: eq(roles.name, name),
      columns: { id: true },
    });
    return role ? { id: String(role.id) } : null;
  }

  /**
   * Find role ID by slug.
   *
   * @param slug - The role slug to search for
   * @returns Role ID or null if not found
   */
  async findRoleIdBySlug(slug: string): Promise<{ id: string } | null> {
    const { roles } = this.tables;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const role = await (this.db as any)
      .selectDistinct({ id: roles.id })
      .from(roles)
      .where(eq(roles.slug, slug))
      .limit(1);
    return role && role.length > 0 ? { id: String(role[0].id) } : null;
  }
}
