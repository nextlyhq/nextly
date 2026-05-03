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
import { NextlyError } from "../../errors/nextly-error";
import type {
  ApiKeyMeta,
  ApiKeyService,
} from "../../services/auth/api-key-service";
import type {
  CheckAccessArgs,
  CheckApiKeyArgs,
  CheckApiKeyResult,
  CreateApiKeyArgs,
  CreatePermissionArgs,
  CreateRoleArgs,
  DeletePermissionArgs,
  DeleteRoleArgs,
  FindApiKeyByIDArgs,
  FindPermissionByIDArgs,
  FindPermissionsArgs,
  FindRoleByIDArgs,
  FindRolesArgs,
  GetRolePermissionsArgs,
  ListApiKeysArgs,
  ListResult,
  MutationResult,
  Permission,
  RevokeApiKeyArgs,
  Role,
  SetRolePermissionsArgs,
  UpdateApiKeyArgs,
  UpdateRoleArgs,
} from "../types/index";

import type { NextlyContext } from "./context";
import { mapPermission, mapRole } from "./helpers";

/**
 * `nextly.roles.*` namespace — role CRUD and permission assignment.
 *
 * Phase 4 (Task 13): list/mutation surfaces use canonical envelopes
 * (`ListResult<T>`, `MutationResult<T>`).
 */
export interface RolesNamespace {
  find(args?: FindRolesArgs): Promise<ListResult<Role>>;
  findByID(args: FindRoleByIDArgs): Promise<Role>;
  create(args: CreateRoleArgs): Promise<MutationResult<Role>>;
  update(args: UpdateRoleArgs): Promise<MutationResult<Role>>;
  delete(args: DeleteRoleArgs): Promise<MutationResult<{ id: string }>>;
  getPermissions(args: GetRolePermissionsArgs): Promise<Permission[]>;
  setPermissions(args: SetRolePermissionsArgs): Promise<Permission[]>;
}

/**
 * Build the `roles` namespace for a `Nextly` instance.
 */
export function createRolesNamespace(ctx: NextlyContext): RolesNamespace {
  return {
    async find(args: FindRolesArgs = {}): Promise<ListResult<Role>> {
      // PR 4 (unified-error-system): listRoles returns `{ data, meta }`
      // directly and throws NextlyError on failure.
      const result = await ctx.rbacRoleService.listRoles({
        search: args.search,
        page: args.page ?? 1,
        limit: args.limit ?? 10,
      });

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
      const items = data.map(r => mapRole(r));
      const total = result.meta?.total ?? items.length;
      const limit = args.limit ?? 10;
      const page = args.page ?? 1;
      // Clamp totalPages to 1 minimum so empty result sets still produce a
      // sensible page count (parity with `respondList` on the wire side).
      const totalPages = Math.max(1, Math.ceil(total / limit));

      return {
        items,
        meta: {
          total,
          page,
          limit,
          totalPages,
          hasNext: page < totalPages,
          hasPrev: page > 1,
        },
      };
    },

    async findByID(args: FindRoleByIDArgs): Promise<Role> {
      // PR 4: getRoleById returns the role directly, throws NOT_FOUND.
      const role = await ctx.rbacRoleService.getRoleById(args.id);
      return mapRole(role);
    },

    async create(args: CreateRoleArgs): Promise<MutationResult<Role>> {
      // Pass through caller-provided permissionIds and childRoleIds.
      // Previously these were hardcoded to empty arrays, which made
      // every create call fail against the service's validation
      // ("At least one permission is required to create a role"). The
      // service accepts empty arrays only when both are empty AND
      // the caller has bypassed validation via a different path;
      // ordinary Direct API callers always need to pass at least one.
      //
      // PR 4: createRole returns the created role directly.
      const role = await ctx.rbacRoleService.createRole({
        name: args.data.name,
        slug: args.data.slug,
        description: args.data.description,
        level: args.data.level ?? 0,
        permissionIds: args.data.permissionIds ?? [],
        childRoleIds: args.data.childRoleIds ?? [],
      });
      // Phase 4 (Task 13): mutation envelope.
      return {
        message: "Role created.",
        item: mapRole(role),
      };
    },

    async update(args: UpdateRoleArgs): Promise<MutationResult<Role>> {
      // PR 4: updateRole returns void; getRoleById returns the role
      // directly. Both throw on failure.
      await ctx.rbacRoleService.updateRole(args.id, {
        name: args.data.name,
        slug: args.data.slug,
        description: args.data.description ?? undefined,
        level: args.data.level,
      });
      const updated = await ctx.rbacRoleService.getRoleById(args.id);
      return {
        message: "Role updated.",
        item: mapRole(updated),
      };
    },

    async delete(
      args: DeleteRoleArgs
    ): Promise<MutationResult<{ id: string }>> {
      // PR 4: deleteRole returns void; throws on failure.
      await ctx.rbacRoleService.deleteRole(args.id);
      return {
        message: "Role deleted.",
        item: { id: args.id },
      };
    },

    async getPermissions(args: GetRolePermissionsArgs): Promise<Permission[]> {
      const rolePerms = await ctx.rbacRolePermissionService.listRolePermissions(
        args.id
      );

      // PR 4: getPermissionById returns the permission directly, throws
      // NOT_FOUND on missing rows. Catch per-iteration so a single
      // missing perm doesn't fail the whole list (parity with the
      // previous null-tolerant behavior).
      const fullPerms = await Promise.all(
        rolePerms.map(async rp => {
          try {
            const perm = await ctx.rbacPermissionService.getPermissionById(
              rp.id
            );
            return mapPermission(perm);
          } catch {
            return null;
          }
        })
      );

      return fullPerms.filter((p): p is Permission => p !== null);
    },

    async setPermissions(args: SetRolePermissionsArgs): Promise<Permission[]> {
      const updatedPerms =
        await ctx.rbacRolePermissionService.setRolePermissions(
          args.roleId,
          args.permissionIds
        );

      // PR 4: getPermissionById returns the permission directly. Same
      // null-tolerant pattern as getPermissions above.
      const fullPerms = await Promise.all(
        updatedPerms.map(async rp => {
          try {
            const perm = await ctx.rbacPermissionService.getPermissionById(
              rp.id
            );
            return mapPermission(perm);
          } catch {
            return null;
          }
        })
      );

      return fullPerms.filter((p): p is Permission => p !== null);
    },
  };
}

/**
 * `nextly.permissions.*` namespace — permission CRUD.
 *
 * Phase 4 (Task 13): list/mutation surfaces use canonical envelopes.
 */
export interface PermissionsNamespace {
  find(args?: FindPermissionsArgs): Promise<ListResult<Permission>>;
  findByID(args: FindPermissionByIDArgs): Promise<Permission | null>;
  create(args: CreatePermissionArgs): Promise<MutationResult<Permission>>;
  delete(
    args: DeletePermissionArgs
  ): Promise<MutationResult<{ id: string }>>;
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
    ): Promise<ListResult<Permission>> {
      const limit = args.limit ?? 10;
      const page = args.page ?? 1;

      // PR 4 (unified-error-system): listPermissions returns
      // `{ data, meta }` directly and throws NextlyError on failure.
      const result = await ctx.rbacPermissionService.listPermissions({
        page,
        limit,
        search: args.search,
        resource: args.resource,
        action: args.action,
      });

      const total = result.meta?.total ?? result.data.length;
      // Clamp totalPages to 1 minimum so empty result sets still produce a
      // sensible page count (parity with `respondList` on the wire side).
      const totalPages = Math.max(1, Math.ceil(total / limit));
      const items: Permission[] = result.data.map(p => mapPermission(p));

      return {
        items,
        meta: {
          total,
          page,
          limit,
          totalPages,
          hasNext: page < totalPages,
          hasPrev: page > 1,
        },
      };
    },

    async findByID(args: FindPermissionByIDArgs): Promise<Permission | null> {
      try {
        // PR 4: getPermissionById returns the permission directly and
        // throws NextlyError(NOT_FOUND) on missing rows.
        const perm = await ctx.rbacPermissionService.getPermissionById(args.id);
        return mapPermission(perm);
      } catch (error) {
        // Honor the disableErrors flag: callers who pass disableErrors
        // expect `null` instead of an exception on missing permissions.
        if (args.disableErrors && NextlyError.isNotFound(error)) {
          return null;
        }
        throw error;
      }
    },

    async create(
      args: CreatePermissionArgs
    ): Promise<MutationResult<Permission>> {
      const { name, slug, action, resource, description } = args.data;

      // PR 4: ensurePermission returns `{ id, created }` directly and
      // throws on failure; getPermissionById returns the permission
      // directly.
      const ensured = await ctx.rbacPermissionService.ensurePermission(
        action,
        resource,
        name,
        slug,
        description
      );

      const fetched = await ctx.rbacPermissionService.getPermissionById(
        ensured.id
      );
      // Phase 4 (Task 13): canonical mutation envelope.
      return {
        message: "Permission created.",
        item: mapPermission(fetched),
      };
    },

    async delete(
      args: DeletePermissionArgs
    ): Promise<MutationResult<{ id: string }>> {
      // PR 4: deletePermissionById returns void; throws on failure.
      await ctx.rbacPermissionService.deletePermissionById(args.id);
      // Phase 4 (Task 13): delete now returns the canonical mutation
      // envelope so callers can surface a server-authored toast.
      return {
        message: "Permission deleted.",
        item: { id: args.id },
      };
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
      return await ctx.rbacAccessControlService.checkAccess({
        userId: args.userId,
        operation: args.operation,
        resource: args.resource,
      });
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
    throw NextlyError.notFound({ logContext: { entity: "apiKey", apiKeyId: id } });
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
      const allUsers = !args.userId;
      return await ctx.apiKeyService.listApiKeys(args.userId ?? "", {
        allUsers,
      });
    },

    async findByID(args: FindApiKeyByIDArgs): Promise<ApiKeyMeta | null> {
      return await ctx.apiKeyService.getApiKeyById(args.id, "", {
        allUsers: true,
      });
    },

    async create(
      args: CreateApiKeyArgs
    ): Promise<{ doc: ApiKeyMeta; key: string }> {
      const { meta, key } = await ctx.apiKeyService.createApiKey(args.userId, {
        name: args.name,
        description: args.description ?? undefined,
        tokenType: args.tokenType,
        roleId: args.roleId ?? undefined,
        expiresIn: args.expiresIn,
      });
      return { doc: meta, key };
    },

    async update(args: UpdateApiKeyArgs): Promise<ApiKeyMeta> {
      const userId = await resolveApiKeyOwner(ctx.apiKeyService, args.id);
      return await ctx.apiKeyService.updateApiKey(args.id, userId, {
        name: args.name,
        description: args.description ?? undefined,
      });
    },

    async revoke(args: RevokeApiKeyArgs): Promise<{ success: true }> {
      const userId = await resolveApiKeyOwner(ctx.apiKeyService, args.id);
      await ctx.apiKeyService.revokeApiKey(args.id, userId);
      return { success: true };
    },
  };
}
