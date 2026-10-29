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

import { sessionMayPerform } from "../../auth/access/route-gate-adapters";
import type { AuthContext } from "../../auth/middleware";
import {
  apiKeyPermissionsFor,
  type ApiKeyOperation,
} from "../../domains/auth/api-key-policy";
import {
  apiKeyViewer,
  type ApiKeyMeta,
} from "../../domains/auth/services/api-key-service";
import {
  SYSTEM_READ_POLICY,
  SYSTEM_WRITE_POLICY,
} from "../../domains/auth/system-write-policy";
import { NextlyError } from "../../errors/nextly-error";
import { consoleLogger } from "../../shared/types";
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
import {
  authorizeChecked,
  checkedCaller,
  checkedRoleChange,
  checkRead,
  checkWrite,
  mapPermission,
  mapRole,
} from "./helpers";

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
      // Checked as REST's role list is, before anything is read.
      await checkRead(ctx.defaultConfig, args, SYSTEM_READ_POLICY.roles.read);
      // PR 4 (unified-error-system): listRoles returns `{ data, meta }`
      // directly and throws NextlyError on failure.
      const result = await ctx.rbacRoleService.listRoles({
        search: args.search,
        page: args.page ?? 1,
        limit: args.limit ?? 10,
      });

      const items = result.data.map(r => mapRole(r));
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
      await checkRead(ctx.defaultConfig, args, SYSTEM_READ_POLICY.roles.read);
      // PR 4: getRoleById returns the role directly, throws NOT_FOUND.
      const role = await ctx.rbacRoleService.getRoleById(args.id);
      return mapRole(role);
    },

    async create(args: CreateRoleArgs): Promise<MutationResult<Role>> {
      // Checked as the REST route checks it, before anything is written.
      // Pass through caller-provided permissionIds and childRoleIds.
      // Previously these were hardcoded to empty arrays, which made
      // every create call fail against the service's validation
      // ("At least one permission is required to create a role"). The
      // service accepts empty arrays only when both are empty AND
      // the caller has bypassed validation via a different path;
      // ordinary Direct API callers always need to pass at least one.
      //
      // PR 4: createRole returns the created role directly.
      // Checked as the REST route checks it, before anything is written,
      // then run as its caller: a role made to inherit super-admin is a grant
      // of it, decided by the rule on granting super-admin.
      const role = await checkedRoleChange(
        ctx.defaultConfig,
        args,
        SYSTEM_WRITE_POLICY.roles.create,
        () =>
          ctx.rbacRoleService.createRole({
            name: args.data.name,
            slug: args.data.slug,
            description: args.data.description,
            level: args.data.level ?? 0,
            permissionIds: args.data.permissionIds ?? [],
            childRoleIds: args.data.childRoleIds ?? [],
          })
      );
      return {
        message: "Role created.",
        item: mapRole(role),
      };
    },

    async update(args: UpdateRoleArgs): Promise<MutationResult<Role>> {
      // PR 4: updateRole returns void; getRoleById returns the role
      // directly. Both throw on failure.
      await checkedRoleChange(
        ctx.defaultConfig,
        args,
        SYSTEM_WRITE_POLICY.roles.update,
        () =>
          ctx.rbacRoleService.updateRole(args.id, {
            name: args.data.name,
            slug: args.data.slug,
            description: args.data.description ?? undefined,
            level: args.data.level,
          })
      );
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
      await checkedRoleChange(
        ctx.defaultConfig,
        args,
        SYSTEM_WRITE_POLICY.roles.delete,
        () => ctx.rbacRoleService.deleteRole(args.id)
      );
      return {
        message: "Role deleted.",
        item: { id: args.id },
      };
    },

    async getPermissions(args: GetRolePermissionsArgs): Promise<Permission[]> {
      await checkRead(
        ctx.defaultConfig,
        args,
        SYSTEM_READ_POLICY.roles.readPermissions
      );
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
      await checkWrite(
        ctx.defaultConfig,
        args,
        SYSTEM_WRITE_POLICY.roles.setPermissions
      );
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
      // REST lists permissions to whoever may read roles: the role form needs
      // them to show what a role can grant.
      await checkRead(
        ctx.defaultConfig,
        args,
        SYSTEM_READ_POLICY.permissions.list
      );
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
      // Refused before the lookup, so `disableErrors` answers a refusal as a
      // refusal, never as a missing permission.
      await checkRead(
        ctx.defaultConfig,
        args,
        SYSTEM_READ_POLICY.permissions.read
      );
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
      await checkWrite(
        ctx.defaultConfig,
        args,
        SYSTEM_WRITE_POLICY.permissions.create
      );
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
      await checkWrite(
        ctx.defaultConfig,
        args,
        SYSTEM_WRITE_POLICY.permissions.delete
      );
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
  /**
   * Whether the user may perform `operation` on `resource`, as every route
   * decides it. For a read, `true` means the user may read some entries:
   * where a `read` rule answers a filter, only the entries it matches, which
   * a read made in the user's context (`overrideAccess: false`) applies and a
   * trusted read does not. A write whose rule answers a filter is `false`.
   */
  check(args: CheckAccessArgs): Promise<boolean>;
  checkApiKey(args: CheckApiKeyArgs): Promise<CheckApiKeyResult>;
}

/**
 * Build the `access` namespace for a `Nextly` instance.
 */
export function createAccessNamespace(ctx: NextlyContext): AccessNamespace {
  return {
    async check(args: CheckAccessArgs): Promise<boolean> {
      // The question is about a signed-in user, so naming none is refused,
      // never answered as a visitor's public default.
      if (!args.userId) return false;
      try {
        // The route gate's answer for the user's session, with the rules
        // registered now. A read a rule's filter limits answers yes, since
        // the user may read some entries; a read made in the user's context
        // applies the filter.
        return await sessionMayPerform(
          args.userId,
          args.operation,
          args.resource,
          ctx.rbacAccessControlService
        );
      } catch (error) {
        // A lookup the answer needs that fails is refused rather than failed,
        // since the answer is a boolean: a grant lookup, or a role lookup
        // wherever a rule would be asked, so a rule is never asked with a role
        // set that could not be read.
        consoleLogger.error("[rbac] access.check could not read the user", {
          userId: args.userId,
          error,
        });
        return false;
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
 * Whether `caller` may do `operation` to keys, asked of the decision the REST
 * routes ask, so one caller gets one answer through either door. Making and
 * changing keys is for a signed-in person only, as over REST: a key that could
 * mint keys could outlive its own revocation.
 */
async function authorizeKeyOperation(
  caller: AuthContext,
  operation: ApiKeyOperation
): Promise<void> {
  await authorizeChecked(caller, { anyOf: apiKeyPermissionsFor(operation) });
  if (operation !== "read" && caller.authMethod !== "session") {
    throw NextlyError.personOnly({
      doing: "manage API keys",
      logContext: { reason: "session-only", action: operation },
    });
  }
}

/**
 * Build the `apiKeys` namespace for a `Nextly` instance.
 *
 * A trusted call (the default) does what server code asks, for any person's
 * keys. A checked call is judged as the REST routes judge its caller: the same
 * permission for each operation, which then reaches every key (reading,
 * updating and revoking anyone's), a key made only for the caller, and an
 * owner's name shown only to a caller who may read users. Each check runs
 * before anything is written.
 */
export function createApiKeysNamespace(ctx: NextlyContext): ApiKeysNamespace {
  return {
    async list(args: ListApiKeysArgs = {}): Promise<ApiKeyMeta[]> {
      const caller = checkedCaller(ctx.defaultConfig, args);
      if (caller) await authorizeKeyOperation(caller, "read");
      const keys = await ctx.apiKeyService.listApiKeys(args.userId ?? "", {
        allUsers: !args.userId,
      });
      if (!caller) return keys;
      return keys.map(await apiKeyViewer(caller));
    },

    async findByID(args: FindApiKeyByIDArgs): Promise<ApiKeyMeta | null> {
      const caller = checkedCaller(ctx.defaultConfig, args);
      if (caller) await authorizeKeyOperation(caller, "read");
      const key = await ctx.apiKeyService.getApiKeyById(args.id, "", {
        allUsers: true,
      });
      if (!caller || !key) return key;
      return (await apiKeyViewer(caller))(key);
    },

    async create(
      args: CreateApiKeyArgs
    ): Promise<{ doc: ApiKeyMeta; key: string }> {
      const caller = checkedCaller(ctx.defaultConfig, args);
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
      const caller = checkedCaller(ctx.defaultConfig, args);
      if (caller) await authorizeKeyOperation(caller, "update");
      // Any key: the permission to update keys reaches every key, and a
      // trusted call is server code acting for any owner.
      const updated = await ctx.apiKeyService.updateApiKey(
        args.id,
        caller?.userId ?? "",
        { name: args.name, description: args.description ?? undefined },
        { allUsers: true }
      );
      if (!caller) return updated;
      return (await apiKeyViewer(caller))(updated);
    },

    async revoke(args: RevokeApiKeyArgs): Promise<{ success: true }> {
      const caller = checkedCaller(ctx.defaultConfig, args);
      if (caller) await authorizeKeyOperation(caller, "delete");
      // As `update`: the permission to revoke keys reaches every key.
      await ctx.apiKeyService.revokeApiKey(args.id, caller?.userId ?? "", {
        allUsers: true,
      });
      return { success: true };
    },
  };
}
