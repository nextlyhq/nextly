import { randomUUID } from "crypto";

import type { DrizzleAdapter } from "@revnixhq/adapter-drizzle";
import { and, asc, count, desc, eq } from "drizzle-orm";

import type {
  FieldPermissionInsertData,
  FieldPermissionUpdateData,
} from "@nextly/types/field-permissions";

import { BaseService } from "../../../services/base-service";
import { mapDbErrorToServiceError } from "../../../services/lib/db-error";
import type { Logger } from "../../../services/shared";

/**
 * FieldPermissionService handles CRUD operations for field-level permissions.
 *
 * Responsibilities:
 * - Create, read, update, delete field permission rules
 * - List field permissions with pagination and filtering
 * - Validate permission uniqueness
 * - Ensure permissions exist idempotently
 *
 * @example
 * ```typescript
 * const service = new FieldPermissionService(adapter, logger);
 *
 * // Grant read access to email field for editors
 * await service.createFieldPermission({
 *   roleId: "editor",
 *   collectionSlug: "users",
 *   fieldPath: "email",
 *   action: "read"
 * });
 *
 * // Deny access to SSN field for viewers
 * await service.createFieldPermission({
 *   roleId: "viewer",
 *   collectionSlug: "users",
 *   fieldPath: "ssn",
 *   action: "none"
 * });
 *
 * // Conditional access (ownership)
 * await service.createFieldPermission({
 *   roleId: "user",
 *   collectionSlug: "profiles",
 *   fieldPath: "private_notes",
 *   action: "read",
 *   condition: {
 *     type: "ownership",
 *     ownerField: "userId"
 *   }
 * });
 * ```
 */
export class FieldPermissionService extends BaseService {
  constructor(adapter: DrizzleAdapter, logger: Logger) {
    super(adapter, logger);
  }

  /**
   * List field permissions with pagination, search, and filtering.
   *
   * @param options - Pagination, search, filter, and sort options
   * @returns Paginated list of field permissions
   *
   * @example
   * ```typescript
   * // List all permissions for a role
   * const result = await service.listFieldPermissions({
   *   roleId: "editor",
   *   page: 1,
   *   pageSize: 20
   * });
   *
   * // List permissions for a collection
   * const result = await service.listFieldPermissions({
   *   collectionSlug: "users",
   *   page: 1,
   *   pageSize: 20
   * });
   * ```
   */
  async listFieldPermissions(options?: {
    // Pagination
    page?: number;
    pageSize?: number;
    // Filters
    roleId?: string;
    collectionSlug?: string;
    fieldPath?: string;
    action?: "read" | "write" | "none";
    // Sorting
    sortBy?: "roleId" | "collectionSlug" | "fieldPath" | "createdAt";
    sortOrder?: "asc" | "desc";
  }): Promise<{
    success: boolean;
    statusCode: number;
    message: string;
    data: Array<{
      id: string;
      roleId: string;
      collectionSlug: string;
      fieldPath: string;
      action: string;
      condition: string | null;
      createdAt: Date;
      updatedAt: Date;
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
        pageSize = 20,
        roleId,
        collectionSlug,
        fieldPath,
        action,
        sortBy = "createdAt",
        sortOrder = "desc",
      } = options || {};

      const { fieldPermissions } = this.tables;

      const conditions = [];

      if (roleId) {
        conditions.push(eq(fieldPermissions.roleId, roleId));
      }

      if (collectionSlug) {
        conditions.push(eq(fieldPermissions.collectionSlug, collectionSlug));
      }

      if (fieldPath) {
        conditions.push(eq(fieldPermissions.fieldPath, fieldPath));
      }

      if (action) {
        conditions.push(eq(fieldPermissions.action, action));
      }

      const whereClause =
        conditions.length > 0 ? and(...conditions) : undefined;

      let orderByClause;
      const orderFn = sortOrder === "asc" ? asc : desc;

      switch (sortBy) {
        case "roleId":
          orderByClause = orderFn(fieldPermissions.roleId);
          break;
        case "collectionSlug":
          orderByClause = orderFn(fieldPermissions.collectionSlug);
          break;
        case "fieldPath":
          orderByClause = orderFn(fieldPermissions.fieldPath);
          break;
        case "createdAt":
          orderByClause = orderFn(fieldPermissions.createdAt);
          break;
        default:
          orderByClause = orderFn(fieldPermissions.createdAt);
      }

      const offset = (page - 1) * pageSize;

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const countResult = await (this.db as any)
        .select({ value: count() })
        .from(fieldPermissions)
        .where(whereClause);

      const total = Number(countResult[0]?.value ?? 0);

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const rows = await (this.db as any)
        .select()
        .from(fieldPermissions)
        .where(whereClause)
        .orderBy(orderByClause)
        .limit(pageSize)
        .offset(offset);

      const totalPages = Math.ceil(total / pageSize);

      return {
        success: true,
        statusCode: 200,
        message: "Field permissions fetched successfully",
        data: (rows as Array<Record<string, unknown>>).map(row => ({
          id: String(row.id),
          roleId: String(row.roleId),
          collectionSlug: String(row.collectionSlug),
          fieldPath: String(row.fieldPath),
          action: String(row.action),
          condition: (row.condition as string | null) ?? null,
          createdAt: new Date(row.createdAt as string | number | Date),
          updatedAt: new Date(row.updatedAt as string | number | Date),
        })),
        meta: {
          total,
          page,
          pageSize,
          totalPages,
        },
      };
    } catch (err) {
      return mapDbErrorToServiceError(err, {
        defaultMessage: "Failed to fetch field permissions",
      });
    }
  }

  /**
   * Get a field permission by ID.
   *
   * @param id - Field permission ID
   * @returns Field permission details or null if not found
   */
  async getFieldPermissionById(id: string): Promise<{
    success: boolean;
    message: string;
    statusCode: number;
    data: {
      id: string;
      roleId: string;
      collectionSlug: string;
      fieldPath: string;
      action: string;
      condition: string | null;
      createdAt: Date;
      updatedAt: Date;
    } | null;
  }> {
    try {
      const { fieldPermissions } = this.tables;

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const rows = await (this.db as any)
        .select()
        .from(fieldPermissions)
        .where(eq(fieldPermissions.id, id))
        .limit(1);

      if (rows.length === 0) {
        return {
          success: false,
          message: "Field permission not found",
          statusCode: 404,
          data: null,
        };
      }

      const row = rows[0] as Record<string, unknown>;

      return {
        success: true,
        message: "Field permission fetched successfully",
        statusCode: 200,
        data: {
          id: String(row.id),
          roleId: String(row.roleId),
          collectionSlug: String(row.collectionSlug),
          fieldPath: String(row.fieldPath),
          action: String(row.action),
          condition: (row.condition as string | null) ?? null,
          createdAt: new Date(row.createdAt as string | number | Date),
          updatedAt: new Date(row.updatedAt as string | number | Date),
        },
      };
    } catch (err) {
      return mapDbErrorToServiceError(err, {
        defaultMessage: "Failed to fetch field permission",
      });
    }
  }

  /**
   * Create a new field permission.
   *
   * @param data - Field permission data
   * @returns Created field permission
   *
   * @example
   * ```typescript
   * // Basic field permission
   * const result = await service.createFieldPermission({
   *   roleId: "editor",
   *   collectionSlug: "users",
   *   fieldPath: "email",
   *   action: "read"
   * });
   *
   * // With ownership condition
   * const result = await service.createFieldPermission({
   *   roleId: "user",
   *   collectionSlug: "posts",
   *   fieldPath: "draft_content",
   *   action: "read",
   *   condition: {
   *     type: "ownership",
   *     ownerField: "authorId"
   *   }
   * });
   * ```
   */
  async createFieldPermission(data: FieldPermissionInsertData): Promise<{
    success: boolean;
    message: string;
    statusCode: number;
    data: {
      id: string;
      roleId: string;
      collectionSlug: string;
      fieldPath: string;
      action: string;
      condition: string | null;
      createdAt: Date;
      updatedAt: Date;
    } | null;
  }> {
    try {
      const { fieldPermissions } = this.tables;

      const id = randomUUID();
      const now = new Date();

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      await (this.db as any).insert(fieldPermissions).values({
        id,
        roleId: data.roleId,
        collectionSlug: data.collectionSlug,
        fieldPath: data.fieldPath,
        action: data.action,
        condition: data.condition ? JSON.stringify(data.condition) : null,
        createdAt: now,
        updatedAt: now,
      });

      return {
        success: true,
        message: "Field permission created successfully",
        statusCode: 201,
        data: {
          id,
          roleId: data.roleId,
          collectionSlug: data.collectionSlug,
          fieldPath: data.fieldPath,
          action: data.action,
          condition: data.condition ? JSON.stringify(data.condition) : null,
          createdAt: now,
          updatedAt: now,
        },
      };
    } catch (err) {
      return mapDbErrorToServiceError(err, {
        defaultMessage: "Failed to create field permission",
        "unique-violation":
          "A field permission for this role, collection, and field already exists",
        constraint:
          "A field permission for this role, collection, and field already exists",
      });
    }
  }

  /**
   * Update a field permission.
   *
   * @param id - Field permission ID
   * @param data - Field permission update data
   * @returns Updated field permission
   */
  async updateFieldPermission(
    id: string,
    data: FieldPermissionUpdateData
  ): Promise<{
    success: boolean;
    message: string;
    statusCode: number;
    data: {
      id: string;
      roleId: string;
      collectionSlug: string;
      fieldPath: string;
      action: string;
      condition: string | null;
      createdAt: Date;
      updatedAt: Date;
    } | null;
  }> {
    try {
      const { fieldPermissions } = this.tables;

      const existing = await this.getFieldPermissionById(id);
      if (!existing.success || !existing.data) {
        return {
          success: false,
          message: "Field permission not found",
          statusCode: 404,
          data: null,
        };
      }

      const updates: {
        updatedAt: Date;
        action?: string;
        condition?: string | null;
      } = {
        updatedAt: new Date(),
      };

      if (data.action !== undefined) {
        updates.action = data.action;
      }

      if (data.condition !== undefined) {
        updates.condition = data.condition
          ? JSON.stringify(data.condition)
          : null;
      }

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      await (this.db as any)
        .update(fieldPermissions)
        .set(updates)
        .where(eq(fieldPermissions.id, id));

      const updated = await this.getFieldPermissionById(id);

      return {
        success: true,
        message: "Field permission updated successfully",
        statusCode: 200,
        data: updated.data,
      };
    } catch (err) {
      return mapDbErrorToServiceError(err, {
        defaultMessage: "Failed to update field permission",
      });
    }
  }

  /**
   * Delete a field permission.
   *
   * @param id - Field permission ID
   * @returns Success status
   */
  async deleteFieldPermission(id: string): Promise<{
    success: boolean;
    message: string;
    statusCode: number;
    data: null;
  }> {
    try {
      const { fieldPermissions } = this.tables;

      const existing = await this.getFieldPermissionById(id);
      if (!existing.success || !existing.data) {
        return {
          success: false,
          message: "Field permission not found",
          statusCode: 404,
          data: null,
        };
      }

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      await (this.db as any)
        .delete(fieldPermissions)
        .where(eq(fieldPermissions.id, id));

      return {
        success: true,
        message: "Field permission deleted successfully",
        statusCode: 200,
        data: null,
      };
    } catch (err) {
      return mapDbErrorToServiceError(err, {
        defaultMessage: "Failed to delete field permission",
      });
    }
  }

  /**
   * Bulk create field permissions.
   *
   * @param permissions - Array of field permissions to create
   * @returns Created field permissions
   *
   * @example
   * ```typescript
   * await service.bulkCreateFieldPermissions([
   *   { roleId: "editor", collectionSlug: "users", fieldPath: "email", action: "read" },
   *   { roleId: "editor", collectionSlug: "users", fieldPath: "phone", action: "read" },
   *   { roleId: "viewer", collectionSlug: "users", fieldPath: "ssn", action: "none" }
   * ]);
   * ```
   */
  async bulkCreateFieldPermissions(
    permissions: FieldPermissionInsertData[]
  ): Promise<{
    success: boolean;
    message: string;
    statusCode: number;
    data: {
      created: number;
      failed: number;
      errors: Array<{ index: number; error: string }>;
    } | null;
  }> {
    const results = {
      created: 0,
      failed: 0,
      errors: [] as Array<{ index: number; error: string }>,
    };

    for (let i = 0; i < permissions.length; i++) {
      const result = await this.createFieldPermission(permissions[i]);

      if (result.success) {
        results.created++;
      } else {
        results.failed++;
        results.errors.push({
          index: i,
          error: result.message,
        });
      }
    }

    return {
      success: results.failed === 0,
      message:
        results.failed === 0
          ? `Successfully created ${results.created} field permissions`
          : `Created ${results.created} field permissions, ${results.failed} failed`,
      // 207 Multi-Status
      statusCode: results.failed === 0 ? 201 : 207,
      data: results,
    };
  }

  /**
   * Delete all field permissions for a role.
   *
   * @param roleId - Role ID
   * @returns Number of deleted permissions
   */
  async deleteFieldPermissionsByRole(roleId: string): Promise<{
    success: boolean;
    message: string;
    statusCode: number;
    data: { deleted: number } | null;
  }> {
    try {
      const { fieldPermissions } = this.tables;

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const result = await (this.db as any)
        .delete(fieldPermissions)
        .where(eq(fieldPermissions.roleId, roleId));

      const deleted = result.rowCount || 0;

      return {
        success: true,
        message: `Deleted ${deleted} field permissions for role ${roleId}`,
        statusCode: 200,
        data: { deleted },
      };
    } catch (err) {
      return mapDbErrorToServiceError(err, {
        defaultMessage: "Failed to delete field permissions by role",
      });
    }
  }

  /**
   * Delete all field permissions for a collection.
   *
   * @param collectionSlug - Collection slug
   * @returns Number of deleted permissions
   */
  async deleteFieldPermissionsByCollection(collectionSlug: string): Promise<{
    success: boolean;
    message: string;
    statusCode: number;
    data: { deleted: number } | null;
  }> {
    try {
      const { fieldPermissions } = this.tables;

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const result = await (this.db as any)
        .delete(fieldPermissions)
        .where(eq(fieldPermissions.collectionSlug, collectionSlug));

      const deleted = result.rowCount || 0;

      return {
        success: true,
        message: `Deleted ${deleted} field permissions for collection ${collectionSlug}`,
        statusCode: 200,
        data: { deleted },
      };
    } catch (err) {
      return mapDbErrorToServiceError(err, {
        defaultMessage: "Failed to delete field permissions by collection",
      });
    }
  }
}
