/**
 * User-service dispatch handlers.
 *
 * Routes the 14 user operations (list/get/create/update/delete plus
 * password/account helpers and `getCurrentUserPermissions`) to
 * `container.users`, which is the `UserService` instance held on the
 * `ServiceContainer`.
 *
 * Every handler returns a Response built via the respondX helpers in
 * `../../api/response-shapes.ts`. The dispatcher passes the Response
 * through unchanged. See spec §5.1 for the canonical shape contract.
 */

import {
  respondAction,
  respondData,
  respondDoc,
  respondList,
  respondMutation,
} from "../../api/response-shapes";
import type { ServiceContainer } from "../../services";
import {
  isSuperAdmin,
  listEffectivePermissions,
  listRoleSlugsForUser,
} from "../../services/lib/permissions";
import { toPaginationMeta } from "../helpers/service-envelope";
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
    execute: async (svc, p) => {
      const result = await svc.listUsers({
        page: toNumber(p.page),
        limit: toNumber(p.limit),
        search: p.search,
        emailVerified: toBoolean(p.emailVerified),
        hasPassword: toBoolean(p.hasPassword),
        createdAtFrom: toDate(p.createdAtFrom),
        createdAtTo: toDate(p.createdAtTo),
        sortBy: p.sortBy as "createdAt" | "name" | "email" | undefined,
        sortOrder: p.sortOrder as "asc" | "desc" | undefined,
      });
      return respondList(result.data, toPaginationMeta(result.meta));
    },
  },
  getUserById: {
    execute: async (svc, p) => {
      const user = await svc.getUserById(requireParam(p, "userId", "UserId"));
      return respondDoc(user);
    },
  },
  getCurrentUser: {
    execute: async (svc, p) => {
      const user = await svc.getCurrentUser(
        requireParam(p, "userId", "UserId")
      );
      return respondDoc(user);
    },
  },
  updateCurrentUser: {
    execute: async (svc, p, body) => {
      if (!p.userId || !body)
        throw new Error("UserId and update data are required");
      const user = await svc.updateCurrentUser(
        p.userId,
        body as Record<string, unknown>
      );
      return respondMutation("Profile updated.", user);
    },
  },
  findByEmail: {
    execute: async (svc, p) => {
      const user = await svc.findByEmail(requireParam(p, "email", "Email"));
      return respondDoc(user);
    },
  },
  hasPassword: {
    execute: async (svc, p) => {
      const result = await svc.hasPassword(
        requireParam(p, "userId", "UserId")
      );
      // No-Boolean-only rule (spec §5.1): wrap in object so callers can
      // grow the shape without breaking the contract later.
      return respondData({ hasPassword: result });
    },
  },
  getAccounts: {
    execute: async (svc, p) => {
      const accounts = await svc.getAccounts(
        requireParam(p, "userId", "UserId")
      );
      // Non-paginated list — use respondData with a named field rather
      // than respondList (which would require synthetic pagination meta).
      return respondData({ accounts });
    },
  },
  createLocalUser: {
    execute: async (svc, _, body) => {
      const b = requireBodyField<{ email: string }>(
        body,
        "email",
        "User data with email is required"
      );
      const user = await svc.createLocalUser(
        b as Parameters<typeof svc.createLocalUser>[0]
      );
      return respondMutation("User created.", user, { status: 201 });
    },
  },
  updateUser: {
    execute: async (svc, p, body) => {
      if (!p.userId || !body)
        throw new Error("UserId and update data are required");
      const user = await svc.updateUser(
        p.userId,
        body as Record<string, unknown>
      );
      return respondMutation("User updated.", user);
    },
  },
  deleteUser: {
    execute: async (svc, p) => {
      const user = await svc.deleteUser(requireParam(p, "userId", "UserId"));
      return respondMutation("User deleted.", user);
    },
  },
  updatePasswordHash: {
    execute: async (svc, p, body) => {
      const b = body as { passwordHash?: string } | undefined;
      if (!p.userId || !b?.passwordHash)
        throw new Error("UserId and passwordHash are required");
      await svc.updatePasswordHash(p.userId, b.passwordHash);
      return respondAction("Password hash updated.");
    },
  },
  unlinkAccountForUser: {
    execute: async (svc, p) => {
      if (!p.userId || !p.provider || !p.providerAccountId) {
        throw new Error(
          "UserId, provider, and providerAccountId are required"
        );
      }
      await svc.unlinkAccountForUser(
        p.userId,
        p.provider,
        p.providerAccountId
      );
      return respondAction("Account unlinked.", {
        provider: p.provider,
        providerAccountId: p.providerAccountId,
      });
    },
  },
  getUserPasswordHashById: {
    execute: async (svc, p) => {
      const hash = await svc.getUserPasswordHashById(
        requireParam(p, "userId", "UserId")
      );
      return respondData({ passwordHash: hash });
    },
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
      return respondData({
        permissions,
        isSuperAdmin: superAdmin,
        roles: roleSlugs,
      });
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
