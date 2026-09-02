/**
 * Which grants reach each API-key operation, as the server defines them.
 *
 * Derived from `nextly/config`, not restated here. The endpoints authorise
 * every API-key operation as an any-of — the operation's own action, OR the
 * `update-api-keys` umbrella that reaches all four — and three surfaces ask
 * that same question: the endpoint enforcing it, the route deciding who may
 * open a page, and the control deciding which buttons to render. They drifted
 * once already, and the admin was the side that was wrong.
 *
 * A control shown to someone the endpoint will refuse is not a permission bug,
 * it is an interface offering an action that cannot happen.
 *
 * @module lib/permissions/api-key-actions
 */
import { apiKeyPermissionSlugsFor, type ApiKeyOperation } from "nextly/config";

export type { ApiKeyOperation };

/** The grants that authorise one API-key operation, as any-of. */
export function apiKeyGrantsFor(operation: ApiKeyOperation): string[] {
  return apiKeyPermissionSlugsFor(operation);
}

/** Whether this reader may perform one API-key operation. */
export function mayPerformApiKeyAction(
  operation: ApiKeyOperation,
  hasPermission: (slug: string) => boolean
): boolean {
  return apiKeyGrantsFor(operation).some(hasPermission);
}
