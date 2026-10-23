import {
  INSTEAD_OF_AN_ACCESS_CHECK,
  warnDeprecatedExport,
} from "../deprecated-exports";
import type { AuthContext } from "../session/session-types";

import { permissionHeld } from "./require-permission";

export type CollectionOperation =
  | "create"
  | "read"
  | "update"
  | "delete"
  | "publish"
  | "unpublish";

export interface CollectionAccessDeps {
  /** Check a user's permission via RBAC service */
  checkUserPermission?: (
    userId: string,
    action: string,
    resource: string
  ) => Promise<boolean>;
  /** Evaluate code-defined access function from defineCollection */
  evaluateCodeAccess?: (
    collectionSlug: string,
    operation: CollectionOperation,
    context: AuthContext
  ) => Promise<boolean | null>; // null = not defined, fall through to RBAC
}

/**
 * Check if the auth context has access to a collection operation.
 * Priority: super-admin bypass > code-defined access > database RBAC.
 *
 * @deprecated For a signed-in user, use
 * `nextly.access.check({ userId, resource, operation })`, which asks the one
 * access decision. For an API key, check the key's own permissions, which
 * `nextly.access.checkApiKey({ rawKey })` returns: `nextly.access.check`
 * judges the key's maker, not the key. Removed in the next release.
 */
export async function checkCollectionAccess(
  context: AuthContext,
  collectionSlug: string,
  operation: CollectionOperation,
  deps: CollectionAccessDeps
): Promise<boolean> {
  warnDeprecatedExport("checkCollectionAccess", INSTEAD_OF_AN_ACCESS_CHECK);
  // Super-admin bypass: check for "super-admin" role
  if (context.roles.includes("super-admin")) {
    return true;
  }

  // Code-defined access (from defineCollection({ access: { read: fn } }))
  if (deps.evaluateCodeAccess) {
    const codeResult = await deps.evaluateCodeAccess(
      collectionSlug,
      operation,
      context
    );
    if (codeResult !== null) {
      return codeResult;
    }
  }

  // Fall through to database RBAC
  return permissionHeld(context, operation, collectionSlug, deps);
}
