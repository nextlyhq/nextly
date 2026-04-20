import type { DrizzleAdapter } from "@revnixhq/adapter-drizzle";

import { BaseService } from "../../../services/base-service";
import type { Logger } from "../../../services/shared";

import { RoleMutationService } from "./role/role-mutation-service";
import { RoleQueryService } from "./role/role-query-service";

/**
 * RoleService handles all role CRUD operations.
 *
 * This is a facade that delegates to specialized services:
 * - RoleQueryService: Read operations (list, get, find)
 * - RoleMutationService: Write operations (create, update, delete)
 *
 * The facade maintains backward compatibility with existing code
 * that uses RoleService directly.
 *
 * Responsibilities:
 * - List roles with pagination and filtering
 * - Create, read, update, delete roles
 * - Ensure system roles exist (e.g., super-admin)
 * - Validate role uniqueness (name, slug)
 *
 * @example
 * ```typescript
 * const roleService = new RoleService(adapter, logger);
 * const result = await roleService.listRoles({ page: 1, pageSize: 10 });
 * ```
 */
export class RoleService extends BaseService {
  constructor(adapter: DrizzleAdapter, logger: Logger) {
    super(adapter, logger);
  }

  private _queryService?: RoleQueryService;
  private _mutationService?: RoleMutationService;

  private get queryService(): RoleQueryService {
    if (!this._queryService) {
      this._queryService = new RoleQueryService(this.adapter, this.logger);
    }
    return this._queryService;
  }

  private get mutationService(): RoleMutationService {
    if (!this._mutationService) {
      this._mutationService = new RoleMutationService(
        this.adapter,
        this.logger
      );
    }
    return this._mutationService;
  }

  /**
   * Get the underlying query service for direct access.
   */
  getQueryService(): RoleQueryService {
    return this.queryService;
  }

  /**
   * Get the underlying mutation service for direct access.
   */
  getMutationService(): RoleMutationService {
    return this.mutationService;
  }

  /**
   * List all roles with pagination, search, and filtering.
   *
   * @param options - Pagination, search, filter, and sort options
   * @returns Paginated list of roles with metadata
   */
  listRoles(options?: {
    page?: number;
    pageSize?: number;
    search?: string;
    isSystem?: boolean;
    levelMin?: number;
    levelMax?: number;
    sortBy?: "name" | "level";
    sortOrder?: "asc" | "desc";
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
    return this.queryService.listRoles(options);
  }

  /**
   * Get a single role by ID.
   *
   * @param roleId - The role ID to fetch
   * @returns Role data or null if not found
   */
  getRoleById(roleId: string): Promise<{
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
    return this.queryService.getRoleById(roleId);
  }

  /**
   * Find role by name.
   *
   * @param name - The role name to search for
   * @returns Role ID or null if not found
   */
  getRoleByName(name: string): Promise<{ id: string } | null> {
    return this.queryService.getRoleByName(name);
  }

  /**
   * Find role ID by slug.
   *
   * @param slug - The role slug to search for
   * @returns Role ID or null if not found
   */
  findRoleIdBySlug(slug: string): Promise<{ id: string } | null> {
    return this.queryService.findRoleIdBySlug(slug);
  }

  /**
   * Ensure super admin role exists (idempotent).
   *
   * @returns Role ID and whether it was newly created
   */
  ensureSuperAdminRole(): Promise<{ id: string; created: boolean }> {
    return this.mutationService.ensureSuperAdminRole();
  }

  /**
   * Create a new role with permissions and child roles.
   *
   * @param input - Role data including permissions and child roles
   * @returns Created role data
   */
  createRole(input: {
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
    return this.mutationService.createRole(input);
  }

  /**
   * Update an existing role.
   *
   * @param roleId - The role ID to update
   * @param changes - Fields to update
   * @returns Success/failure status
   */
  updateRole(
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
    return this.mutationService.updateRole(roleId, changes);
  }

  /**
   * Delete a role and cascade delete related data.
   *
   * @param roleId - The role ID to delete
   * @returns Success/failure status
   */
  deleteRole(roleId: string): Promise<{
    success: boolean;
    statusCode: number;
    message: string;
    data: null;
  }> {
    return this.mutationService.deleteRole(roleId);
  }
}
