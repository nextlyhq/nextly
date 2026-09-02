/**
 * Which grants reach each API-key operation.
 *
 * Mirrors `requireApiKeyPermission` in `api/api-keys.ts`, which authorises
 * every endpoint as an any-of: the action's own grant, OR `update-api-keys`.
 * That umbrella is why this cannot be read off the slug names — `update`
 * reaches all four, and `create`, `delete` and `read` reach only their own.
 *
 * Declared here so the admin gates on the same rule the server enforces. A
 * control shown to someone the endpoint will refuse is not a permission bug,
 * it is an interface offering an action that cannot happen.
 *
 * @module lib/permissions/api-key-actions
 */
export const API_KEY_ACTION_PERMISSIONS = {
  read: ["read-api-keys", "update-api-keys"],
  create: ["create-api-keys", "update-api-keys"],
  update: ["update-api-keys"],
  delete: ["delete-api-keys", "update-api-keys"],
} as const satisfies Record<string, readonly string[]>;

export type ApiKeyAction = keyof typeof API_KEY_ACTION_PERMISSIONS;

/** Whether this reader may perform one API-key operation. */
export function mayPerformApiKeyAction(
  action: ApiKeyAction,
  hasPermission: (slug: string) => boolean
): boolean {
  return API_KEY_ACTION_PERMISSIONS[action].some(hasPermission);
}
