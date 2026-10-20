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

import type { DrizzleAdapter } from "@nextlyhq/adapter-drizzle";
import { eq } from "drizzle-orm";

import {
  authorizeCallerForAny,
  isErrorResponse,
  type AuthContext,
} from "../../auth/middleware";
import { toNextlyAuthError } from "../../auth/middleware/to-nextly-error";
import { container } from "../../di/container";
import {
  apiKeyPermissionsFor,
  type ApiKeyOperation,
} from "../../domains/auth/api-key-policy";
import {
  apiKeyAsSeenBy,
  type ApiKeyMeta,
  type ApiKeyService,
} from "../../domains/auth/services/api-key-service";
import { NextlyError } from "../../errors/nextly-error";
import { isSuperAdmin } from "../../services/lib/permissions";
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
  DirectAPIConfig,
} from "../types/index";

import type { NextlyContext } from "./context";
import { accessOptions, mapPermission, mapRole, mergeConfig } from "./helpers";

/**
 * `nextly.roles.*` namespace — role CRUD and permission assignment.
 *
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
 */
export interface PermissionsNamespace {
  find(args?: FindPermissionsArgs): Promise<ListResult<Permission>>;
  findByID(args: FindPermissionByIDArgs): Promise<Permission | null>;
  create(args: CreatePermissionArgs): Promise<MutationResult<Permission>>;
  delete(args: DeletePermissionArgs): Promise<MutationResult<{ id: string }>>;
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
 * argument for their internal ownership check, which a TRUSTED call
 * (`overrideAccess: true`, the default) bypasses. A checked call never comes
 * here: it acts as its caller, so the ownership check applies.
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
    throw NextlyError.notFound({
      logContext: { entity: "apiKey", apiKeyId: id },
    });
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
 * The caller a checked `apiKeys` call is made as, or `null` for a trusted one.
 *
 * Checked when the call, over the instance's defaults, says
 * `overrideAccess: false`. Keys a call passes as `undefined` are dropped before
 * merging: `mergeConfig` is a spread and a present-but-undefined key wins it,
 * so `{ overrideAccess: undefined }` would otherwise erase an instance's `false`
 * and quietly restore trust, and `{ user: undefined }` would erase its user.
 *
 * Read through `accessOptions`, so the identity and the key scope travel
 * together as they do at every other namespace.
 */
function checkedCaller(
  ctx: NextlyContext,
  args: DirectAPIConfig
): AuthContext | null {
  const supplied = Object.fromEntries(
    Object.entries(args).filter(([, value]) => value !== undefined)
  ) as DirectAPIConfig;
  const access = accessOptions(mergeConfig(ctx.defaultConfig, supplied));
  if (access.overrideAccess !== false) return null;

  // A checked call names who it is for, as a REST request must be signed in.
  const userId = access.user?.id;
  if (!userId) {
    throw NextlyError.authRequired({
      logContext: { reason: "direct-api-api-keys-no-user" },
    });
  }

  // The caller as the REST routes see one: a person signed in, or an API key
  // judged by its own grants rather than its owner's.
  const scope = access.authenticatedScope;
  const byKey = scope?.actorType === "apiKey";
  return {
    userId,
    permissions: byKey ? [...scope.permissions] : [],
    roles: access.user?.roles ?? [],
    authMethod: byKey ? "api-key" : "session",
  };
}

/**
 * Whether `caller` may do `operation` to keys, asked of the decision the REST
 * routes ask, so one caller gets one answer through either door. Making and
 * changing keys is for a signed-in person only, as over REST: a key that could
 * mint keys could outlive its own revocation.
 */
async function authorizeKeyOperation(
  caller: AuthContext,
  operation: ApiKeyOperation
): Promise<void> {
  const decision = await authorizeCallerForAny(
    caller,
    apiKeyPermissionsFor(operation)
  );
  if (isErrorResponse(decision)) throw toNextlyAuthError(decision);
  if (operation !== "read" && caller.authMethod !== "session") {
    throw NextlyError.forbidden({
      logContext: { reason: "session-only", action: operation },
    });
  }
}

/**
 * Build the `apiKeys` namespace for a `Nextly` instance.
 *
 * A trusted call (the default) does what server code asks, for any person's
 * keys. A checked call is judged as the REST routes judge its caller: the same
 * permissions, a key made only for the caller, only the caller's own keys
 * changed (a super-admin's included), and every key readable only by a
 * super-admin. Each check runs before anything is written.
 */
export function createApiKeysNamespace(ctx: NextlyContext): ApiKeysNamespace {
  return {
    async list(args: ListApiKeysArgs = {}): Promise<ApiKeyMeta[]> {
      const caller = checkedCaller(ctx, args);
      if (!caller) {
        const allUsers = !args.userId;
        return await ctx.apiKeyService.listApiKeys(args.userId ?? "", {
          allUsers,
        });
      }

      await authorizeKeyOperation(caller, "read");
      const superAdmin = await isSuperAdmin(caller.userId);
      if (args.userId && args.userId !== caller.userId && !superAdmin) {
        throw NextlyError.forbidden({
          logContext: { reason: "other-owner", entity: "apiKey" },
        });
      }
      // Only a super-admin reads everyone's keys, or names whose to read.
      const keys = superAdmin
        ? await ctx.apiKeyService.listApiKeys(args.userId ?? "", {
            allUsers: !args.userId,
          })
        : await ctx.apiKeyService.listApiKeys(caller.userId);
      return keys.map(key => apiKeyAsSeenBy(caller, key));
    },

    async findByID(args: FindApiKeyByIDArgs): Promise<ApiKeyMeta | null> {
      const caller = checkedCaller(ctx, args);
      if (!caller) {
        return await ctx.apiKeyService.getApiKeyById(args.id, "", {
          allUsers: true,
        });
      }

      await authorizeKeyOperation(caller, "read");
      // Someone else's key reads as missing, as over REST, for anyone but a
      // super-admin.
      const key = await ctx.apiKeyService.getApiKeyById(
        args.id,
        caller.userId,
        { allUsers: await isSuperAdmin(caller.userId) }
      );
      return key ? apiKeyAsSeenBy(caller, key) : null;
    },

    async create(
      args: CreateApiKeyArgs
    ): Promise<{ doc: ApiKeyMeta; key: string }> {
      const caller = checkedCaller(ctx, args);
      if (caller) {
        await authorizeKeyOperation(caller, "create");
        // A key acts as its owner, so a checked call makes one only for its
        // caller, as the admin does; the role ceiling then judges them.
        if (args.userId !== caller.userId) {
          throw NextlyError.forbidden({
            logContext: { reason: "other-owner", entity: "apiKey" },
          });
        }
      }

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
      const caller = checkedCaller(ctx, args);
      if (caller) await authorizeKeyOperation(caller, "update");
      // A checked call acts as its caller, so the service finds someone
      // else's key missing and changes nothing.
      const userId =
        caller?.userId ??
        (await resolveApiKeyOwner(ctx.apiKeyService, args.id));
      return await ctx.apiKeyService.updateApiKey(args.id, userId, {
        name: args.name,
        description: args.description ?? undefined,
      });
    },

    async revoke(args: RevokeApiKeyArgs): Promise<{ success: true }> {
      const caller = checkedCaller(ctx, args);
      if (caller) await authorizeKeyOperation(caller, "delete");
      // As `update`: a checked call can revoke only its caller's own key.
      const userId =
        caller?.userId ??
        (await resolveApiKeyOwner(ctx.apiKeyService, args.id));
      await ctx.apiKeyService.revokeApiKey(args.id, userId);
      return { success: true };
    },
  };
}
