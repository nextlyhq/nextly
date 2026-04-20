/**
 * User-service dispatch handlers.
 *
 * Routes the 14 user operations (list/get/create/update/delete plus
 * password/account helpers and `getCurrentUserPermissions`) to
 * `container.users`, which is the `UserService` instance held on the
 * `ServiceContainer`.
 */

import type { ServiceContainer } from "../../services";
import {
  isSuperAdmin,
  listEffectivePermissions,
  listRoleSlugsForUser,
} from "../../services/lib/permissions";
import {
  requireBodyField,
  requireParam,
  toBoolean,
  toDate,
  toNumber,
} from "../helpers/validation";
import type { MethodHandler, Params } from "../types";

type UsersService = ServiceContainer["users"];

const USER_METHODS: Record<string, MethodHandler<UsersService>> = {
  listUsers: {
    execute: (svc, p) =>
      svc.listUsers({
        page: toNumber(p.page),
        pageSize: toNumber(p.pageSize),
        search: p.search,
        emailVerified: toBoolean(p.emailVerified),
        hasPassword: toBoolean(p.hasPassword),
        createdAtFrom: toDate(p.createdAtFrom),
        createdAtTo: toDate(p.createdAtTo),
        sortBy: p.sortBy as "createdAt" | "name" | "email" | undefined,
        sortOrder: p.sortOrder as "asc" | "desc" | undefined,
      }),
  },
  getUserById: {
    execute: (svc, p) => svc.getUserById(requireParam(p, "userId", "UserId")),
  },
  getCurrentUser: {
    execute: (svc, p) =>
      svc.getCurrentUser(requireParam(p, "userId", "UserId")),
  },
  updateCurrentUser: {
    execute: (svc, p, body) => {
      if (!p.userId || !body)
        throw new Error("UserId and update data are required");
      return svc.updateCurrentUser(p.userId, body as Record<string, unknown>);
    },
  },
  findByEmail: {
    execute: (svc, p) => svc.findByEmail(requireParam(p, "email", "Email")),
  },
  hasPassword: {
    execute: (svc, p) => svc.hasPassword(requireParam(p, "userId", "UserId")),
  },
  getAccounts: {
    execute: (svc, p) => svc.getAccounts(requireParam(p, "userId", "UserId")),
  },
  createLocalUser: {
    execute: (svc, _, body) => {
      const b = requireBodyField<{ email: string }>(
        body,
        "email",
        "User data with email is required"
      );
      return svc.createLocalUser(
        b as Parameters<typeof svc.createLocalUser>[0]
      );
    },
  },
  updateUser: {
    execute: (svc, p, body) => {
      if (!p.userId || !body)
        throw new Error("UserId and update data are required");
      return svc.updateUser(p.userId, body as Record<string, unknown>);
    },
  },
  deleteUser: {
    execute: (svc, p) => svc.deleteUser(requireParam(p, "userId", "UserId")),
  },
  updatePasswordHash: {
    execute: (svc, p, body) => {
      const b = body as { passwordHash?: string } | undefined;
      if (!p.userId || !b?.passwordHash)
        throw new Error("UserId and passwordHash are required");
      return svc.updatePasswordHash(p.userId, b.passwordHash);
    },
  },
  unlinkAccountForUser: {
    execute: (svc, p) => {
      if (!p.userId || !p.provider || !p.providerAccountId) {
        throw new Error("UserId, provider, and providerAccountId are required");
      }
      return svc.unlinkAccountForUser(
        p.userId,
        p.provider,
        p.providerAccountId
      );
    },
  },
  getUserPasswordHashById: {
    execute: (svc, p) =>
      svc.getUserPasswordHashById(requireParam(p, "userId", "UserId")),
  },
  getCurrentUserPermissions: {
    execute: async (_svc, p) => {
      const userId = requireParam(p, "userId", "UserId");
      const [permissionPairs, superAdmin, roleSlugs] = await Promise.all([
        listEffectivePermissions(userId),
        isSuperAdmin(userId),
        listRoleSlugsForUser(userId),
      ]);
      // Convert "resource:action" → "action-resource" slug format
      // (e.g. "users:read" → "read-users").
      const permissions = permissionPairs.map(pair => {
        const [resource, action] = pair.split(":");
        return `${action}-${resource}`;
      });
      return {
        success: true,
        statusCode: 200,
        message: "User permissions retrieved",
        data: {
          permissions,
          isSuperAdmin: superAdmin,
          roles: roleSlugs,
        },
      };
    },
  },
};

/**
 * Dispatch a user-service method call. The caller passes the
 * `ServiceContainer` so we can look up `container.users` without
 * re-importing the container type into every handler.
 */
export function dispatchUser(
  services: ServiceContainer,
  method: string,
  params: Params,
  body: unknown
): Promise<unknown> {
  const handler = USER_METHODS[method];
  if (!handler) throw new Error(`Unknown method: ${method}`);
  return handler.execute(services.users, params, body);
}
