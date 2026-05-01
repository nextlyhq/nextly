/**
 * Auth / RBAC dispatch handlers.
 *
 * Groups two closely related method maps into one file:
 *
 * - `AUTH_METHODS` — login, register, password flows, email verification
 *   against `container.auth`.
 * - `RBAC_METHODS` — role / permission / role-permission / user-role /
 *   role-inheritance operations that need access to multiple sub-services
 *   on the container, so the handler receives the full `ServiceContainer`.
 */

import type { ServiceContainer } from "../../services";
import {
  requireBodyField,
  requireParam,
  toBoolean,
  toNumber,
} from "../helpers/validation";
import type { MethodHandler, Params } from "../types";

type AuthService = ServiceContainer["auth"];
type RbacContainer = ServiceContainer;

// ============================================================
// Auth methods
// ============================================================

const AUTH_METHODS: Record<string, MethodHandler<AuthService>> = {
  registerUser: {
    execute: (svc, _, body) => {
      const b = body as { email?: string; password?: string } | undefined;
      if (!b?.email || !b?.password)
        throw new Error("Email and password are required");
      return svc.registerUser(b as Parameters<typeof svc.registerUser>[0]);
    },
  },
  verifyCredentials: {
    execute: (svc, _, body) => {
      const b = body as { email?: string; password?: string } | undefined;
      if (!b?.email || !b?.password)
        throw new Error("Email and password are required");
      return svc.verifyCredentials(b.email, b.password);
    },
  },
  changePassword: {
    execute: (svc, p, body) => {
      const b = body as
        | { currentPassword?: string; newPassword?: string }
        | undefined;
      if (!p.userId || !b?.currentPassword || !b?.newPassword) {
        throw new Error(
          "UserId, currentPassword, and newPassword are required"
        );
      }
      return svc.changePassword(p.userId, b.currentPassword, b.newPassword);
    },
  },
  generatePasswordResetToken: {
    execute: (svc, _, body) => {
      const b = requireBodyField<{
        email: string;
        redirectPath?: string;
      }>(body, "email", "Email is required");
      return svc.generatePasswordResetToken(b.email, {
        redirectPath: b.redirectPath,
      });
    },
  },
  resetPasswordWithToken: {
    execute: (svc, _, body) => {
      const b = body as { token?: string; newPassword?: string } | undefined;
      if (!b?.token || !b?.newPassword)
        throw new Error("Token and newPassword are required");
      return svc.resetPasswordWithToken(b.token, b.newPassword);
    },
  },
  generateEmailVerificationToken: {
    execute: (svc, _, body) => {
      const b = requireBodyField<{
        email: string;
        redirectPath?: string;
      }>(body, "email", "Email is required");
      return svc.generateEmailVerificationToken(b.email, {
        redirectPath: b.redirectPath,
      });
    },
  },
  verifyEmail: {
    execute: (svc, _, body) => {
      const b = requireBodyField<{ token: string }>(
        body,
        "token",
        "Token is required"
      );
      return svc.verifyEmail(b.token);
    },
  },
  cleanupExpiredTokens: {
    execute: svc => svc.cleanupExpiredTokens(),
  },
};

// ============================================================
// RBAC methods
// ============================================================

const RBAC_METHODS: Record<string, MethodHandler<RbacContainer>> = {
  // Role operations
  listRoles: {
    // Same root cause + fix as `user-dispatcher.ts:listUsers` (see PR
    // #125): the underlying RoleQueryService.listRoles returns the
    // raw `{ data, meta }` shape with no `statusCode` field, so the
    // dispatcher's smart-extraction path (dispatcher.ts:180) skipped
    // it and the dumb fallback wrapped the whole object as `data`,
    // producing the double-nested `{ data: { data, meta } }` shape
    // the admin "Roles" dropdown chokes on. Wrapping the result with
    // `{ statusCode: 200, data, meta }` triggers the smart path and
    // yields the canonical single-envelope `{ data, meta }`.
    // Phase 4 will replace this with a consistent `PaginatedDocs<T>`
    // migration across all endpoints.
    execute: async (c, p) => {
      const result = await c.roles.listRoles({
        page: toNumber(p.page),
        pageSize: toNumber(p.pageSize),
        search: p.search,
        isSystem: toBoolean(p.isSystem),
        levelMin: toNumber(p.levelMin),
        levelMax: toNumber(p.levelMax),
        sortBy: p.sortBy as "name" | "level" | undefined,
        sortOrder: p.sortOrder as "asc" | "desc" | undefined,
        includePermissions: toBoolean(p.includePermissions),
      });
      return {
        success: true,
        statusCode: 200,
        data: result.data,
        meta: result.meta,
      };
    },
  },
  getRoleById: {
    execute: (c, p) => c.roles.getRoleById(requireParam(p, "roleId", "RoleId")),
  },
  getRoleByName: {
    execute: (c, p) => c.roles.getRoleByName(requireParam(p, "name", "Name")),
  },
  createRole: {
    execute: (c, _, body) => {
      const b = body as
        | { name?: string; slug?: string; permissionIds?: string[] }
        | undefined;
      if (!b?.name || !b?.slug)
        throw new Error("Role data with name and slug is required");
      if (!b.permissionIds?.length) {
        throw new Error("At least one permission is required to create a role");
      }
      return c.roles.createRole(b as Parameters<typeof c.roles.createRole>[0]);
    },
  },
  updateRole: {
    execute: (c, p, body) => {
      if (!p.roleId || !body)
        throw new Error("RoleId and changes data are required");
      return c.roles.updateRole(p.roleId, body);
    },
  },
  deleteRole: {
    execute: (c, p) => c.roles.deleteRole(requireParam(p, "roleId", "RoleId")),
  },

  // Permission operations
  listPermissions: {
    execute: (c, p) =>
      c.permissions.listPermissions({
        page: toNumber(p.page),
        pageSize: toNumber(p.pageSize),
        search: p.search,
        action: p.action,
        resource: p.resource,
        sortBy: p.sortBy as "action" | "resource" | "name" | undefined,
        sortOrder: p.sortOrder as "asc" | "desc" | undefined,
      }),
  },
  getPermissionById: {
    execute: (c, p) =>
      c.permissions.getPermissionById(
        requireParam(p, "permissionId", "PermissionId")
      ),
  },
  ensurePermission: {
    execute: (c, p, body) => {
      const b = body as
        | {
            action?: string;
            resource?: string;
            name?: string;
            slug?: string;
            description?: string;
          }
        | undefined;
      // Support both body and params for backward compatibility.
      const action = b?.action ?? p.action;
      const resource = b?.resource ?? p.resource;
      const name = b?.name ?? p.name;
      const slug = b?.slug ?? p.slug;
      const description = b?.description ?? p.description;
      if (!action || !resource || !name || !slug) {
        throw new Error(
          "Action, resource, name, and slug parameters are required"
        );
      }
      return c.permissions.ensurePermission(
        action,
        resource,
        name,
        slug,
        description
      );
    },
  },
  updatePermission: {
    execute: (c, p, body) => {
      if (!p.permissionId || !body)
        throw new Error("PermissionId and changes data are required");
      return c.permissions.updatePermission(p.permissionId, body);
    },
  },
  deletePermission: {
    execute: (c, p) => {
      if (!p.action || !p.resource)
        throw new Error("Action and resource parameters are required");
      return c.permissions.deletePermission(p.action, p.resource);
    },
  },
  deletePermissionById: {
    execute: (c, p) =>
      c.permissions.deletePermissionById(
        requireParam(p, "permissionId", "PermissionId")
      ),
  },

  // Role-permission operations
  listRolePermissions: {
    execute: (c, p) =>
      c.rolePermissions.listRolePermissions(
        requireParam(p, "roleId", "RoleId")
      ),
  },
  addPermissionToRole: {
    execute: (c, p, body) => {
      const b = body as { action?: string; resource?: string } | undefined;
      if (!p.roleId || !b?.action || !b?.resource) {
        throw new Error(
          "RoleId and permission data (action, resource) are required"
        );
      }
      return c.rolePermissions.addPermissionToRole(p.roleId, {
        action: b.action,
        resource: b.resource,
      });
    },
  },
  removePermissionFromRole: {
    execute: async (c, p, body) => {
      if (p.permissionId) {
        // REST-style: DELETE /api/roles/123/permissions/456
        if (!p.roleId) throw new Error("RoleId parameter is required");
        // PR 4 (unified-error-system): getPermissionById returns the
        // permission directly and throws NextlyError(NOT_FOUND) for
        // missing rows, which propagates to the caller as an error
        // response.
        const perm = await c.permissions.getPermissionById(p.permissionId);
        return c.rolePermissions.removePermissionFromRole(p.roleId, {
          action: perm.action,
          resource: perm.resource,
        });
      }
      const b = body as { action?: string; resource?: string } | undefined;
      if (!p.roleId || !b?.action || !b?.resource) {
        throw new Error(
          "RoleId and permission data (action, resource) are required"
        );
      }
      return c.rolePermissions.removePermissionFromRole(p.roleId, {
        action: b.action,
        resource: b.resource,
      });
    },
  },
  setRolePermissions: {
    execute: (c, p, body) => {
      const b = body as { permissionIds?: string[] } | undefined;
      if (!p.roleId) throw new Error("RoleId is required");
      const permissionIds = Array.isArray(b?.permissionIds)
        ? b.permissionIds
        : [];
      return c.rolePermissions.setRolePermissions(p.roleId, permissionIds);
    },
  },

  // User-role operations
  listUserRoles: {
    execute: (c, p) =>
      c.userRoles.listUserRoles(requireParam(p, "userId", "UserId")),
  },
  listUserRoleNames: {
    execute: (c, p) =>
      c.userRoles.listUserRoleNames(requireParam(p, "userId", "UserId")),
  },
  assignRoleToUser: {
    execute: (c, p, body) => {
      const b = body as { roleId?: string } | undefined;
      // Support both REST-style (roleId in body) and dispatcher-style (roleId in params).
      const roleId = b?.roleId ?? p.roleId;
      if (!p.userId || !roleId)
        throw new Error("UserId and roleId parameters are required");
      return c.userRoles.assignRoleToUser(
        p.userId,
        roleId,
        body as Record<string, unknown>
      );
    },
  },
  unassignRoleFromUser: {
    execute: (c, p) => {
      if (!p.userId || !p.roleId)
        throw new Error("UserId and roleId parameters are required");
      return c.userRoles.unassignRoleFromUser(p.userId, p.roleId);
    },
  },

  // Role inheritance operations
  listAncestorRoles: {
    execute: (c, p) =>
      c.roleInheritance.listAncestorRoles(requireParam(p, "roleId", "RoleId")),
  },
  listDescendantRoles: {
    execute: (c, p) =>
      c.roleInheritance.listDescendantRoles(
        requireParam(p, "roleId", "RoleId")
      ),
  },
  addRoleInheritance: {
    execute: (c, p, body) => {
      const b = body as { childRoleId?: string } | undefined;
      // Support both REST-style and dispatcher-style.
      const childRoleId = b?.childRoleId ?? p.childRoleId;
      if (!childRoleId || !p.parentRoleId) {
        throw new Error("ChildRoleId and parentRoleId parameters are required");
      }
      return c.roleInheritance.addRoleInheritance(childRoleId, p.parentRoleId);
    },
  },
  removeRoleInheritance: {
    execute: (c, p) => {
      if (!p.parentRoleId || !p.childRoleId) {
        throw new Error("ChildRoleId and parentRoleId parameters are required");
      }
      return c.roleInheritance.removeRoleInheritance(
        p.childRoleId,
        p.parentRoleId
      );
    },
  },
};

// ============================================================
// Dispatch entrypoints
// ============================================================

export function dispatchAuth(
  services: ServiceContainer,
  method: string,
  params: Params,
  body: unknown
): Promise<unknown> {
  const handler = AUTH_METHODS[method];
  if (!handler) throw new Error(`Unknown method: ${method}`);
  return handler.execute(services.auth, params, body);
}

export function dispatchRbac(
  services: ServiceContainer,
  method: string,
  params: Params,
  body: unknown
): Promise<unknown> {
  const handler = RBAC_METHODS[method];
  if (!handler) throw new Error(`Unknown method: ${method}`);
  return handler.execute(services, params, body);
}
