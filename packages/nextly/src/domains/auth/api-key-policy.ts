import { permissionSlug } from "../../schemas/_zod/rbac";

/** The RBAC resource every API-key permission names. */
export const API_KEY_RESOURCE = "api-keys";

/** The operations an API key supports, as the HTTP surface exposes them. */
export type ApiKeyOperation = "read" | "create" | "update" | "delete";

/**
 * Which actions authorise each API-key operation.
 *
 * Every entry is the operation's own action plus `update`, which is the
 * umbrella: a holder of `update-api-keys` may do anything to a key, so it
 * appears beside each of the others and alone under `update`.
 *
 * Declared once because three surfaces ask the same question and must agree —
 * the endpoints that enforce it, the admin routes that decide who may open a
 * page, and the admin controls that decide which buttons to render. When they
 * disagreed, the list route demanded `update-api-keys` while the endpoint
 * accepted `read-api-keys`, so a reader who could fetch keys over the API was
 * turned away from the page that displays them.
 *
 * @module domains/auth/api-key-policy
 */
export const API_KEY_ACTION_POLICY = {
  read: ["read", "update"],
  create: ["create", "update"],
  update: ["update"],
  delete: ["delete", "update"],
} as const satisfies Record<ApiKeyOperation, readonly string[]>;

/**
 * The permissions that authorise one operation, for `requireAnyPermission`.
 *
 * Any-of: holding any one of them is enough.
 */
export function apiKeyPermissionsFor(
  operation: ApiKeyOperation
): { action: string; resource: string }[] {
  return API_KEY_ACTION_POLICY[operation].map(action => ({
    action,
    resource: API_KEY_RESOURCE,
  }));
}

/**
 * The same permissions as slugs, for callers that hold grant strings.
 *
 * Through `permissionSlug`, which composes that string here and nowhere else,
 * so a change to the slug shape reaches this too.
 */
export function apiKeyPermissionSlugsFor(operation: ApiKeyOperation): string[] {
  return API_KEY_ACTION_POLICY[operation].map(action =>
    permissionSlug(action, API_KEY_RESOURCE)
  );
}
