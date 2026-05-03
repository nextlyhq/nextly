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
 *
 * Phase 4: every handler returns a Response built via the respondX
 * helpers in `../../api/response-shapes.ts`. See spec §5.1 for the
 * canonical shape contract.
 */

import {
  respondAction,
  respondData,
  respondDoc,
  respondList,
  respondMutation,
} from "../../api/response-shapes";
import type { ServiceContainer } from "../../services";
// Phase 4.9: shared `toPaginationMeta` (previously a local copy here).
import { toPaginationMeta } from "../helpers/service-envelope";
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
    execute: async (svc, _, body) => {
      const b = body as { email?: string; password?: string } | undefined;
      if (!b?.email || !b?.password)
        throw new Error("Email and password are required");
      const user = await svc.registerUser(
        b as Parameters<typeof svc.registerUser>[0]
      );
      return respondMutation("Account created.", user, { status: 201 });
    },
  },
  verifyCredentials: {
    execute: async (svc, _, body) => {
      const b = body as { email?: string; password?: string } | undefined;
      if (!b?.email || !b?.password)
        throw new Error("Email and password are required");
      const user = await svc.verifyCredentials(b.email, b.password);
      // verifyCredentials returns the user record on success or null on
      // bad creds; expose as a bare data shape so callers can branch on
      // `body.user === null`.
      return respondData({ user });
    },
  },
  changePassword: {
    execute: async (svc, p, body) => {
      const b = body as
        | { currentPassword?: string; newPassword?: string }
        | undefined;
      if (!p.userId || !b?.currentPassword || !b?.newPassword) {
        throw new Error(
          "UserId, currentPassword, and newPassword are required"
        );
      }
      await svc.changePassword(p.userId, b.currentPassword, b.newPassword);
      return respondAction("Password changed.");
    },
  },
  generatePasswordResetToken: {
    execute: async (svc, _, body) => {
      const b = requireBodyField<{ email: string; redirectPath?: string }>(
        body,
        "email",
        "Email is required"
      );
      await svc.generatePasswordResetToken(b.email, {
        redirectPath: b.redirectPath,
      });
      // Generic message — do not leak whether the email exists.
      return respondAction(
        "If an account exists for this email, a password reset link has been sent."
      );
    },
  },
  resetPasswordWithToken: {
    execute: async (svc, _, body) => {
      const b = body as { token?: string; newPassword?: string } | undefined;
      if (!b?.token || !b?.newPassword)
        throw new Error("Token and newPassword are required");
      await svc.resetPasswordWithToken(b.token, b.newPassword);
      return respondAction("Password reset.");
    },
  },
  generateEmailVerificationToken: {
    execute: async (svc, _, body) => {
      const b = requireBodyField<{ email: string; redirectPath?: string }>(
        body,
        "email",
        "Email is required"
      );
      await svc.generateEmailVerificationToken(b.email, {
        redirectPath: b.redirectPath,
      });
      return respondAction("Verification email sent.");
    },
  },
  verifyEmail: {
    execute: async (svc, _, body) => {
      const b = requireBodyField<{ token: string }>(
        body,
        "token",
        "Token is required"
      );
      await svc.verifyEmail(b.token);
      return respondAction("Email verified.");
    },
  },
  cleanupExpiredTokens: {
    execute: async svc => {
      // cleanupExpiredTokens returns void; the message is the only payload.
      await svc.cleanupExpiredTokens();
      return respondAction("Expired tokens cleaned up.");
    },
  },
};

// ============================================================
// RBAC methods
// ============================================================

const RBAC_METHODS: Record<string, MethodHandler<RbacContainer>> = {
  // Role operations
  listRoles: {
    execute: async (c, p) => {
      const result = await c.roles.listRoles({
        page: toNumber(p.page),
        limit: toNumber(p.limit),
        search: p.search,
        isSystem: toBoolean(p.isSystem),
        levelMin: toNumber(p.levelMin),
        levelMax: toNumber(p.levelMax),
        sortBy: p.sortBy as "name" | "level" | undefined,
        sortOrder: p.sortOrder as "asc" | "desc" | undefined,
        includePermissions: toBoolean(p.includePermissions),
      });
      return respondList(result.data, toPaginationMeta(result.meta));
    },
  },
  getRoleById: {
    execute: async (c, p) => {
      const role = await c.roles.getRoleById(
        requireParam(p, "roleId", "RoleId")
      );
      return respondDoc(role);
    },
  },
  getRoleByName: {
    execute: async (c, p) => {
      const role = await c.roles.getRoleByName(
        requireParam(p, "name", "Name")
      );
      return respondDoc(role);
    },
  },
  createRole: {
    execute: async (c, _, body) => {
      const b = body as
        | { name?: string; slug?: string; permissionIds?: string[] }
        | undefined;
      if (!b?.name || !b?.slug)
        throw new Error("Role data with name and slug is required");
      if (!b.permissionIds?.length) {
        throw new Error("At least one permission is required to create a role");
      }
      const role = await c.roles.createRole(
        b as Parameters<typeof c.roles.createRole>[0]
      );
      return respondMutation("Role created.", role, { status: 201 });
    },
  },
  updateRole: {
    execute: async (c, p, body) => {
      if (!p.roleId || !body)
        throw new Error("RoleId and changes data are required");
      const role = await c.roles.updateRole(p.roleId, body);
      return respondMutation("Role updated.", role);
    },
  },
  deleteRole: {
    execute: async (c, p) => {
      const role = await c.roles.deleteRole(
        requireParam(p, "roleId", "RoleId")
      );
      return respondMutation("Role deleted.", role);
    },
  },

  // Permission operations
  listPermissions: {
    execute: async (c, p) => {
      const result = await c.permissions.listPermissions({
        page: toNumber(p.page),
        limit: toNumber(p.limit),
        search: p.search,
        action: p.action,
        resource: p.resource,
        sortBy: p.sortBy as "action" | "resource" | "name" | undefined,
        sortOrder: p.sortOrder as "asc" | "desc" | undefined,
      });
      return respondList(result.data, toPaginationMeta(result.meta));
    },
  },
  getPermissionById: {
    execute: async (c, p) => {
      const permission = await c.permissions.getPermissionById(
        requireParam(p, "permissionId", "PermissionId")
      );
      return respondDoc(permission);
    },
  },
  ensurePermission: {
    execute: async (c, p, body) => {
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
      const permission = await c.permissions.ensurePermission(
        action,
        resource,
        name,
        slug,
        description
      );
      // ensurePermission may create OR return existing; status 200 covers
      // both since this operation is idempotent and the caller can't tell
      // them apart anyway.
      return respondMutation("Permission ensured.", permission);
    },
  },
  updatePermission: {
    execute: async (c, p, body) => {
      if (!p.permissionId || !body)
        throw new Error("PermissionId and changes data are required");
      const permission = await c.permissions.updatePermission(
        p.permissionId,
        body
      );
      return respondMutation("Permission updated.", permission);
    },
  },
  deletePermission: {
    execute: async (c, p) => {
      if (!p.action || !p.resource)
        throw new Error("Action and resource parameters are required");
      const permission = await c.permissions.deletePermission(
        p.action,
        p.resource
      );
      return respondMutation("Permission deleted.", permission);
    },
  },
  deletePermissionById: {
    execute: async (c, p) => {
      const permission = await c.permissions.deletePermissionById(
        requireParam(p, "permissionId", "PermissionId")
      );
      return respondMutation("Permission deleted.", permission);
    },
  },

  // Role-permission operations
  listRolePermissions: {
    execute: async (c, p) => {
      const permissions = await c.rolePermissions.listRolePermissions(
        requireParam(p, "roleId", "RoleId")
      );
      // Non-paginated list — use respondData with named field so the
      // shape can grow without breaking the contract.
      return respondData({ permissions });
    },
  },
  addPermissionToRole: {
    execute: async (c, p, body) => {
      const b = body as { action?: string; resource?: string } | undefined;
      if (!p.roleId || !b?.action || !b?.resource) {
        throw new Error(
          "RoleId and permission data (action, resource) are required"
        );
      }
      // addPermissionToRole may return void or a row; either way, the
      // useful info for the client is the role/action/resource trio
      // they just changed.
      await c.rolePermissions.addPermissionToRole(p.roleId, {
        action: b.action,
        resource: b.resource,
      });
      return respondAction("Permission added to role.", {
        roleId: p.roleId,
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
        await c.rolePermissions.removePermissionFromRole(p.roleId, {
          action: perm.action,
          resource: perm.resource,
        });
        return respondAction("Permission removed from role.", {
          roleId: p.roleId,
          permissionId: p.permissionId,
        });
      }
      const b = body as { action?: string; resource?: string } | undefined;
      if (!p.roleId || !b?.action || !b?.resource) {
        throw new Error(
          "RoleId and permission data (action, resource) are required"
        );
      }
      await c.rolePermissions.removePermissionFromRole(p.roleId, {
        action: b.action,
        resource: b.resource,
      });
      return respondAction("Permission removed from role.", {
        roleId: p.roleId,
        action: b.action,
        resource: b.resource,
      });
    },
  },
  setRolePermissions: {
    execute: async (c, p, body) => {
      const b = body as { permissionIds?: string[] } | undefined;
      if (!p.roleId) throw new Error("RoleId is required");
      const permissionIds = Array.isArray(b?.permissionIds)
        ? b.permissionIds
        : [];
      await c.rolePermissions.setRolePermissions(p.roleId, permissionIds);
      return respondAction("Role permissions updated.", {
        roleId: p.roleId,
        permissionCount: permissionIds.length,
      });
    },
  },

  // User-role operations
  listUserRoles: {
    execute: async (c, p) => {
      const roles = await c.userRoles.listUserRoles(
        requireParam(p, "userId", "UserId")
      );
      return respondData({ roles });
    },
  },
  listUserRoleNames: {
    execute: async (c, p) => {
      const roleNames = await c.userRoles.listUserRoleNames(
        requireParam(p, "userId", "UserId")
      );
      return respondData({ roleNames });
    },
  },
  assignRoleToUser: {
    execute: async (c, p, body) => {
      const b = body as { roleId?: string } | undefined;
      // Support both REST-style (roleId in body) and dispatcher-style (roleId in params).
      const roleId = b?.roleId ?? p.roleId;
      if (!p.userId || !roleId)
        throw new Error("UserId and roleId parameters are required");
      // assignRoleToUser may return void or a confirmation row. The
      // useful info for the client is the user/role ids they just
      // changed; expose those as the action's result payload.
      await c.userRoles.assignRoleToUser(
        p.userId,
        roleId,
        body as Record<string, unknown>
      );
      return respondAction("Role assigned to user.", {
        userId: p.userId,
        roleId,
      });
    },
  },
  unassignRoleFromUser: {
    execute: async (c, p) => {
      if (!p.userId || !p.roleId)
        throw new Error("UserId and roleId parameters are required");
      await c.userRoles.unassignRoleFromUser(p.userId, p.roleId);
      return respondAction("Role unassigned from user.", {
        userId: p.userId,
        roleId: p.roleId,
      });
    },
  },

  // Role inheritance operations
  listAncestorRoles: {
    execute: async (c, p) => {
      const roles = await c.roleInheritance.listAncestorRoles(
        requireParam(p, "roleId", "RoleId")
      );
      return respondData({ roles });
    },
  },
  listDescendantRoles: {
    execute: async (c, p) => {
      const roles = await c.roleInheritance.listDescendantRoles(
        requireParam(p, "roleId", "RoleId")
      );
      return respondData({ roles });
    },
  },
  addRoleInheritance: {
    execute: async (c, p, body) => {
      const b = body as { childRoleId?: string } | undefined;
      // Support both REST-style and dispatcher-style.
      const childRoleId = b?.childRoleId ?? p.childRoleId;
      if (!childRoleId || !p.parentRoleId) {
        throw new Error("ChildRoleId and parentRoleId parameters are required");
      }
      await c.roleInheritance.addRoleInheritance(childRoleId, p.parentRoleId);
      return respondAction("Role inheritance added.", {
        childRoleId,
        parentRoleId: p.parentRoleId,
      });
    },
  },
  removeRoleInheritance: {
    execute: async (c, p) => {
      if (!p.parentRoleId || !p.childRoleId) {
        throw new Error("ChildRoleId and parentRoleId parameters are required");
      }
      await c.roleInheritance.removeRoleInheritance(
        p.childRoleId,
        p.parentRoleId
      );
      return respondAction("Role inheritance removed.", {
        childRoleId: p.childRoleId,
        parentRoleId: p.parentRoleId,
      });
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
