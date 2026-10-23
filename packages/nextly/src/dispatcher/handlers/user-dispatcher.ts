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
import {
  routeGateCapabilities,
  type GateCaller,
} from "../../auth/access/route-gate-adapters";
import {
  currentCallerScope,
  currentRequestCaller,
} from "../../auth/caller-scope";
import { getRBACService } from "../../auth/code-access";
import { requestLanguage } from "../../auth/middleware";
import { container } from "../../di/container";
import type { ApiKeyService } from "../../domains/auth/services/api-key-service";
import { NextlyError } from "../../errors/nextly-error";
import { permissionSlug } from "../../schemas/_zod/rbac";
import type { ServiceContainer } from "../../services";
import {
  isSuperAdmin,
  listEffectivePermissions,
  listRoleSlugsForUser,
  resolveUserRoles,
} from "../../services/lib/permissions";
import { registeredContentSnapshot } from "../../services/lib/registered-content-slugs";
import { readAuthenticatedActor } from "../helpers/authenticated-actor";
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

/**
 * Who the capabilities answer is about, as the route gates judge the request
 * it arrived on: a key on its own scope, pinned for the dispatch, and a
 * session as the user the route authenticated.
 */
function capabilitiesCaller(userId: string): GateCaller {
  const scope = currentCallerScope();
  if (scope?.actorType !== "apiKey") return { userId };
  const actor = currentRequestCaller()?.actor;
  const keyId = actor?.type === "apiKey" ? actor.id : undefined;
  return { userId, key: scope, ...(keyId === undefined ? {} : { keyId }) };
}

/**
 * When the capabilities answer stops holding, in epoch ms, or null.
 *
 * A session's answer holds until its soonest role assignment ends. A key's
 * holds until the key expires; a read-only or full-access key follows its
 * owner's roles, so it also ends when the owner's soonest assignment does,
 * while a role-based key carries a role of its own, which no assignment of
 * the owner's bounds.
 */
async function capabilitiesValidUntil(
  caller: GateCaller
): Promise<number | null> {
  const ownerUntil = async (): Promise<number | undefined> =>
    (await resolveUserRoles(caller.userId)).validUntil;
  if (!caller.key) return (await ownerUntil()) ?? null;
  const key =
    caller.keyId === undefined
      ? null
      : await container
          .get<ApiKeyService>("apiKeyService")
          .getApiKeyById(caller.keyId, caller.userId);
  const ends = [
    key?.expiresAt ? Date.parse(key.expiresAt) : undefined,
    key?.tokenType === "role-based" ? undefined : await ownerUntil(),
  ].filter((end): end is number => end !== undefined && Number.isFinite(end));
  return ends.length > 0 ? Math.min(...ends) : null;
}

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
      const user = await svc.updateCurrentUser(p.userId, body);
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
      const result = await svc.hasPassword(requireParam(p, "userId", "UserId"));
      // No-Boolean-only rule (spec §5.1): wrap in object so callers can
      // grow the shape without breaking the contract later.
      return respondData({ hasPassword: result });
    },
  },
  createLocalUser: {
    execute: async (svc, p, body) => {
      const b = requireBodyField<{ email: string; password?: unknown }>(
        body,
        "email",
        "User data with email is required"
      );
      // This dispatch path is admin-initiated (self-registration and setup call
      // the service directly). So when an admin supplies a password here, it is
      // a password chosen for someone else — force a change on first sign-in.
      const adminSetPassword =
        typeof b.password === "string" && b.password.length > 0;
      const user = await svc.createLocalUser(
        {
          ...(b as Parameters<typeof svc.createLocalUser>[0]),
          mustChangePassword: adminSetPassword,
          // After the spread, never from it: the body is client-supplied, and
          // a caller that could name its own verification mode could vouch for
          // an address it has not proved. The authenticated admin reaching
          // this route is the voucher.
          emailVerification: "admin-vouched",
        },
        // Attribute the account creation to the authenticated admin so the
        // emitted `user.created` event is not anonymous.
        readAuthenticatedActor()
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
      const user = await svc.deleteUser(
        requireParam(p, "userId", "UserId"),
        // Attribute the deletion to the authenticated admin so the emitted
        // `user.deleted` event is not anonymous.
        readAuthenticatedActor()
      );
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
        const [resource = "", action = ""] = pair.split(":");
        return permissionSlug(action, resource);
      });
      return respondData({
        permissions,
        isSuperAdmin: superAdmin,
        roles: roleSlugs,
      });
    },
  },
  /**
   * What the caller may do with each collection, Single and system resource,
   * for the admin to offer only what the server allows.
   *
   * @experimental The shape may change until the admin's access screens
   * settle.
   */
  getCurrentUserCapabilities: {
    execute: async (_svc, p) => {
      const userId = requireParam(p, "userId", "UserId");
      const caller = capabilitiesCaller(userId);
      const [{ kinds, degraded }, validUntil] = await Promise.all([
        registeredContentSnapshot(),
        capabilitiesValidUntil(caller),
      ]);
      // The answer states what the caller may do with EVERY entity, so a
      // registry that could not be enumerated leaves a floor rather than the
      // whole list. Handing that over as the answer would have the admin hide
      // collections the caller may in fact use, with nothing saying so.
      // Refusing leaves the admin on the answer it already holds.
      if (degraded) {
        throw NextlyError.serviceUnavailable({
          logMessage:
            "A content registry could not be enumerated, so capabilities would name only some entities.",
        });
      }
      // A rule is told the languages the REST operation behind an action
      // involves, framed by the same function that frames a REST request, so
      // a rule answering by language answers here as it would at that door.
      // Only `locale` is read from the query: the other language controls
      // belong to operations that carry an entry, and reading them would let
      // a caller widen the framing through a parameter this route does not
      // offer.
      const asked = { locale: p.locale ?? "" };
      const capabilities = await routeGateCapabilities(
        caller,
        kinds,
        getRBACService(),
        operation => requestLanguage({ method: operation, params: asked })
      );
      return respondData(
        {
          // From the read the cells were answered from, so the flag and the
          // cells cannot describe two different moments.
          isSuperAdmin: capabilities.isSuperAdmin,
          validUntil,
          entities: capabilities.entities,
        },
        { headers: { "Cache-Control": "private, no-store" } }
      );
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
