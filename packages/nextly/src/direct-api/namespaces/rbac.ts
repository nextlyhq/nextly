/**
 * Direct API RBAC Namespaces
 *
 * Factories for the RBAC-related Direct API sub-namespaces:
 * - `nextly.roles.*`       — role CRUD + permission assignment
 * - `nextly.permissions.*` — permission CRUD
 * - `nextly.access.*`      — programmatic access checks + API key validation
 * - `nextly.apiKeys.*`     — API key lifecycle management
 *
 * These share plumbing (result shape, pagination, mapping), so they live in
 * one file.
 *
 * @packageDocumentation
 */

import type { DrizzleAdapter } from "@revnixhq/adapter-drizzle";
import { eq } from "drizzle-orm";

import { container } from "../../di/container";
import type {
  ApiKeyMeta,
  ApiKeyService,
} from "../../services/auth/api-key-service";
import type { PaginatedResponse } from "../../types/pagination";
import { NextlyError, NextlyErrorCode } from "../errors";
import type {
  CheckAccessArgs,
  CheckApiKeyArgs,
  CheckApiKeyResult,
  CreateApiKeyArgs,
  CreatePermissionArgs,
  CreateRoleArgs,
  DeletePermissionArgs,
  DeleteResult,
  DeleteRoleArgs,
  FindApiKeyByIDArgs,
  FindPermissionByIDArgs,
  FindPermissionsArgs,
  FindRoleByIDArgs,
  FindRolesArgs,
  GetRolePermissionsArgs,
  ListApiKeysArgs,
  Permission,
  RevokeApiKeyArgs,
  Role,
  SetRolePermissionsArgs,
  UpdateApiKeyArgs,
  UpdateRoleArgs,
} from "../types/index";

import type { NextlyContext } from "./context";
import {
  convertServiceError,
  createErrorFromResult,
  mapPermission,
  mapRole,
} from "./helpers";

/**
 * `nextly.roles.*` namespace — role CRUD and permission assignment.
 */
export interface RolesNamespace {
  find(args?: FindRolesArgs): Promise<PaginatedResponse<Role>>;
  findByID(args: FindRoleByIDArgs): Promise<Role>;
  create(args: CreateRoleArgs): Promise<Role>;
  update(args: UpdateRoleArgs): Promise<Role>;
  delete(args: DeleteRoleArgs): Promise<DeleteResult>;
  getPermissions(args: GetRolePermissionsArgs): Promise<Permission[]>;
  setPermissions(args: SetRolePermissionsArgs): Promise<Permission[]>;
}

/**
 * Build the `roles` namespace for a `Nextly` instance.
 */
export function createRolesNamespace(ctx: NextlyContext): RolesNamespace {
  return {
    async find(args: FindRolesArgs = {}): Promise<PaginatedResponse<Role>> {
      try {
        const result = await ctx.rbacRoleService.listRoles({
          search: args.search,
          page: args.page ?? 1,
          pageSize: args.limit ?? 10,
        });

        if (!result.success || !result.data) {
          throw createErrorFromResult({
            success: result.success,
            statusCode: result.statusCode,
            message: result.message,
            data: result.data,
          });
        }

        // The query selects `slug` at runtime but the RoleQueryService return
        // type doesn't declare it (type gap in the service layer); widen the
        // runtime shape to the full Role record the mapper expects.
        const data = result.data as Array<{
          id: string;
          name: string;
          slug: string;
          description: string | null;
          level: number;
          isSystem: boolean;
        }>;
        const docs = data.map(r => mapRole(r));
        const totalDocs = result.meta?.total ?? docs.length;
        const limit = args.limit ?? 10;
        const page = args.page ?? 1;
        const totalPages = Math.ceil(totalDocs / limit) || 1;

        return {
          docs,
          totalDocs,
          limit,
          page,
          totalPages,
          hasNextPage: page < totalPages,
          hasPrevPage: page > 1,
          nextPage: page < totalPages ? page + 1 : null,
          prevPage: page > 1 ? page - 1 : null,
          pagingCounter: (page - 1) * limit + 1,
        };
      } catch (error) {
        throw convertServiceError(error);
      }
    },

    async findByID(args: FindRoleByIDArgs): Promise<Role> {
      try {
        const result = await ctx.rbacRoleService.getRoleById(args.id);
        if (!result.success || !result.data) {
          throw createErrorFromResult({
            success: result.success,
            statusCode: result.statusCode,
            message: result.message,
            data: result.data,
          });
        }
        return mapRole(result.data);
      } catch (error) {
        throw convertServiceError(error);
      }
    },

    async create(args: CreateRoleArgs): Promise<Role> {
      try {
        // Pass through caller-provided permissionIds and childRoleIds.
        // Previously these were hardcoded to empty arrays, which made
        // every create call fail against the service's validation
        // ("At least one permission is required to create a role"). The
        // service accepts empty arrays only when both are empty AND
        // the caller has bypassed validation via a different path;
        // ordinary Direct API callers always need to pass at least one.
        const result = await ctx.rbacRoleService.createRole({
          name: args.data.name,
          slug: args.data.slug,
          description: args.data.description,
          level: args.data.level ?? 0,
          permissionIds: args.data.permissionIds ?? [],
          childRoleIds: args.data.childRoleIds ?? [],
        });
        if (!result.success || !result.data) {
          throw createErrorFromResult({
            success: result.success,
            statusCode: result.statusCode,
            message: result.message,
            data: result.data,
          });
        }
        return mapRole(result.data);
      } catch (error) {
        throw convertServiceError(error);
      }
    },

    async update(args: UpdateRoleArgs): Promise<Role> {
      try {
        const updateResult = await ctx.rbacRoleService.updateRole(args.id, {
          name: args.data.name,
          slug: args.data.slug,
          description: args.data.description ?? undefined,
          level: args.data.level,
        });
        if (!updateResult.success) {
          throw createErrorFromResult({
            success: updateResult.success,
            statusCode: updateResult.statusCode,
            message: updateResult.message,
            data: updateResult.data,
          });
        }
        // updateRole returns data: null — fetch the updated role
        const fetchResult = await ctx.rbacRoleService.getRoleById(args.id);
        if (!fetchResult.success || !fetchResult.data) {
          throw createErrorFromResult({
            success: fetchResult.success,
            statusCode: fetchResult.statusCode,
            message: fetchResult.message,
            data: fetchResult.data,
          });
        }
        return mapRole(fetchResult.data);
      } catch (error) {
        throw convertServiceError(error);
      }
    },

    async delete(args: DeleteRoleArgs): Promise<DeleteResult> {
      try {
        const result = await ctx.rbacRoleService.deleteRole(args.id);
        if (!result.success) {
          throw createErrorFromResult({
            success: result.success,
            statusCode: result.statusCode,
            message: result.message,
            data: result.data,
          });
        }
        return { deleted: true, ids: [args.id] };
      } catch (error) {
        throw convertServiceError(error);
      }
    },

    async getPermissions(args: GetRolePermissionsArgs): Promise<Permission[]> {
      try {
        const rolePerms =
          await ctx.rbacRolePermissionService.listRolePermissions(args.id);

        const fullPerms = await Promise.all(
          rolePerms.map(async rp => {
            const result = await ctx.rbacPermissionService.getPermissionById(
              rp.id
            );
            if (!result.success || !result.data) {
              return null;
            }
            return mapPermission(result.data);
          })
        );

        return fullPerms.filter((p): p is Permission => p !== null);
      } catch (error) {
        throw convertServiceError(error);
      }
    },

    async setPermissions(args: SetRolePermissionsArgs): Promise<Permission[]> {
      try {
        const updatedPerms =
          await ctx.rbacRolePermissionService.setRolePermissions(
            args.roleId,
            args.permissionIds
          );

        const fullPerms = await Promise.all(
          updatedPerms.map(async rp => {
            const result = await ctx.rbacPermissionService.getPermissionById(
              rp.id
            );
            if (!result.success || !result.data) {
              return null;
            }
            return mapPermission(result.data);
          })
        );

        return fullPerms.filter((p): p is Permission => p !== null);
      } catch (error) {
        throw convertServiceError(error);
      }
    },
  };
}

/**
 * `nextly.permissions.*` namespace — permission CRUD.
 */
export interface PermissionsNamespace {
  find(args?: FindPermissionsArgs): Promise<PaginatedResponse<Permission>>;
  findByID(args: FindPermissionByIDArgs): Promise<Permission | null>;
  create(args: CreatePermissionArgs): Promise<Permission>;
  delete(args: DeletePermissionArgs): Promise<void>;
}

/**
 * Build the `permissions` namespace for a `Nextly` instance.
 */
export function createPermissionsNamespace(
  ctx: NextlyContext
): PermissionsNamespace {
  return {
    async find(
      args: FindPermissionsArgs = {}
    ): Promise<PaginatedResponse<Permission>> {
      const limit = args.limit ?? 10;
      const page = args.page ?? 1;

      const result = await ctx.rbacPermissionService.listPermissions({
        page,
        pageSize: limit,
        search: args.search,
        resource: args.resource,
        action: args.action,
      });

      if (!result.success || !result.data) {
        throw convertServiceError({
          code: "INTERNAL_ERROR",
          message: result.message,
          httpStatus: result.statusCode,
        });
      }

      const total = result.meta?.total ?? result.data.length;
      const totalPages = Math.ceil(total / limit);
      const docs: Permission[] = result.data.map(p => mapPermission(p));

      return {
        docs,
        totalDocs: total,
        limit,
        page,
        totalPages,
        hasNextPage: page < totalPages,
        hasPrevPage: page > 1,
        nextPage: page < totalPages ? page + 1 : null,
        prevPage: page > 1 ? page - 1 : null,
        pagingCounter: (page - 1) * limit + 1,
      };
    },

    async findByID(args: FindPermissionByIDArgs): Promise<Permission | null> {
      const result = await ctx.rbacPermissionService.getPermissionById(args.id);

      if (!result.success || !result.data) {
        if (args.disableErrors) return null;
        throw new NextlyError(
          result.message,
          NextlyErrorCode.NOT_FOUND,
          result.statusCode
        );
      }

      return mapPermission(result.data);
    },

    async create(args: CreatePermissionArgs): Promise<Permission> {
      try {
        const { name, slug, action, resource, description } = args.data;

        const result = await ctx.rbacPermissionService.ensurePermission(
          action,
          resource,
          name,
          slug,
          description
        );

        if (!result.success || !result.data) {
          throw convertServiceError({
            code: "INTERNAL_ERROR",
            message: result.message,
            httpStatus: result.statusCode,
          });
        }

        const fetchResult = await ctx.rbacPermissionService.getPermissionById(
          result.data.id
        );

        if (!fetchResult.success || !fetchResult.data) {
          throw new NextlyError(
            "Permission created but could not be retrieved",
            NextlyErrorCode.INTERNAL_ERROR,
            500
          );
        }

        return mapPermission(fetchResult.data);
      } catch (error) {
        throw convertServiceError(error);
      }
    },

    async delete(args: DeletePermissionArgs): Promise<void> {
      try {
        const result = await ctx.rbacPermissionService.deletePermissionById(
          args.id
        );

        if (!result.success) {
          throw convertServiceError({
            code: "INTERNAL_ERROR",
            message: result.message,
            httpStatus: result.statusCode,
          });
        }
      } catch (error) {
        throw convertServiceError(error);
      }
    },
  };
}

/**
 * `nextly.access.*` namespace — programmatic access checks + API key validation.
 */
export interface AccessNamespace {
  check(args: CheckAccessArgs): Promise<boolean>;
  checkApiKey(args: CheckApiKeyArgs): Promise<CheckApiKeyResult>;
}

/**
 * Build the `access` namespace for a `Nextly` instance.
 */
export function createAccessNamespace(ctx: NextlyContext): AccessNamespace {
  return {
    async check(args: CheckAccessArgs): Promise<boolean> {
      try {
        return await ctx.rbacAccessControlService.checkAccess({
          userId: args.userId,
          operation: args.operation,
          resource: args.resource,
        });
      } catch (error) {
        throw convertServiceError(error);
      }
    },

    async checkApiKey(args: CheckApiKeyArgs): Promise<CheckApiKeyResult> {
      try {
        const auth = await ctx.apiKeyService.authenticateApiKey(args.rawKey);
        if (!auth) return { valid: false };

        const [permissions, roles, meta] = await Promise.all([
          ctx.apiKeyService.resolveApiKeyPermissions(
            auth.tokenType,
            auth.roleId,
            auth.userId,
            auth.id
          ),
          ctx.apiKeyService.resolveApiKeyRoles(
            auth.tokenType,
            auth.roleId,
            auth.userId
          ),
          ctx.apiKeyService.getApiKeyById(auth.id, auth.userId, {
            allUsers: true,
          }),
        ]);

        return {
          valid: true,
          userId: auth.userId,
          tokenType: auth.tokenType,
          permissions,
          roles,
          expiresAt: meta?.expiresAt ?? null,
        };
      } catch {
        return { valid: false };
      }
    },
  };
}

/**
 * Narrow structural view of the private `apiKeysTable` field on
 * `ApiKeyService`. The service does not expose a public method to look up a
 * key's owner by ID, so we reach into the table via this cast exclusively for
 * the trusted server-side ownership-resolution path used by
 * `apiKeys.update()` and `apiKeys.revoke()`.
 */
interface ApiKeyServicePrivateTable {
  readonly apiKeysTable: {
    readonly id: unknown;
    readonly userId: unknown;
  };
}

/**
 * Resolve the owner userId of an API key. Required because
 * `ApiKeyService.updateApiKey()` / `revokeApiKey()` expect a `userId`
 * argument for their internal ownership check, even though the Direct API
 * operates in a trusted context and bypasses ownership.
 */
async function resolveApiKeyOwner(
  apiKeyService: ApiKeyService,
  id: string
): Promise<string> {
  const adapter = container.get<DrizzleAdapter>("adapter");
  const privateTable = (apiKeyService as unknown as ApiKeyServicePrivateTable)
    .apiKeysTable;

  // Drizzle's builder chain is generic over dialect and the adapter
  // returns `unknown` to keep the interface dialect-neutral. Use the
  // adapter's generic parameter to narrow to just the chain we need -
  // avoids an `as` cast that ESLint's "unnecessary type assertion"
  // autofix would strip.
  const db = adapter.getDrizzle<{
    select: (columns: Record<string, unknown>) => {
      from: (table: unknown) => {
        where: (cond: unknown) => {
          limit: (n: number) => Promise<unknown[]>;
        };
      };
    };
  }>();

  const rows = (await db
    .select({ userId: privateTable.userId })
    .from(privateTable)
    .where(eq(privateTable.id as never, id))
    .limit(1)) as Array<{ userId: string }>;

  if (rows.length === 0) {
    throw new NextlyError("API key not found", NextlyErrorCode.NOT_FOUND, 404);
  }
  return rows[0].userId;
}

/**
 * `nextly.apiKeys.*` namespace — API key lifecycle management.
 */
export interface ApiKeysNamespace {
  list(args?: ListApiKeysArgs): Promise<ApiKeyMeta[]>;
  findByID(args: FindApiKeyByIDArgs): Promise<ApiKeyMeta | null>;
  create(args: CreateApiKeyArgs): Promise<{ doc: ApiKeyMeta; key: string }>;
  update(args: UpdateApiKeyArgs): Promise<ApiKeyMeta>;
  revoke(args: RevokeApiKeyArgs): Promise<{ success: true }>;
}

/**
 * Build the `apiKeys` namespace for a `Nextly` instance.
 */
export function createApiKeysNamespace(ctx: NextlyContext): ApiKeysNamespace {
  return {
    async list(args: ListApiKeysArgs = {}): Promise<ApiKeyMeta[]> {
      try {
        const allUsers = !args.userId;
        return await ctx.apiKeyService.listApiKeys(args.userId ?? "", {
          allUsers,
        });
      } catch (error) {
        throw convertServiceError(error);
      }
    },

    async findByID(args: FindApiKeyByIDArgs): Promise<ApiKeyMeta | null> {
      try {
        return await ctx.apiKeyService.getApiKeyById(args.id, "", {
          allUsers: true,
        });
      } catch (error) {
        throw convertServiceError(error);
      }
    },

    async create(
      args: CreateApiKeyArgs
    ): Promise<{ doc: ApiKeyMeta; key: string }> {
      try {
        const { meta, key } = await ctx.apiKeyService.createApiKey(
          args.userId,
          {
            name: args.name,
            description: args.description ?? undefined,
            tokenType: args.tokenType,
            roleId: args.roleId ?? undefined,
            expiresIn: args.expiresIn,
          }
        );
        return { doc: meta, key };
      } catch (error) {
        throw convertServiceError(error);
      }
    },

    async update(args: UpdateApiKeyArgs): Promise<ApiKeyMeta> {
      try {
        const userId = await resolveApiKeyOwner(ctx.apiKeyService, args.id);
        return await ctx.apiKeyService.updateApiKey(args.id, userId, {
          name: args.name,
          description: args.description ?? undefined,
        });
      } catch (error) {
        throw convertServiceError(error);
      }
    },

    async revoke(args: RevokeApiKeyArgs): Promise<{ success: true }> {
      try {
        const userId = await resolveApiKeyOwner(ctx.apiKeyService, args.id);
        await ctx.apiKeyService.revokeApiKey(args.id, userId);
        return { success: true };
      } catch (error) {
        throw convertServiceError(error);
      }
    },
  };
}
