import type { AuthContext } from "../session/session-types";

import { checkPermission } from "./require-permission";

export type CollectionOperation = "create" | "read" | "update" | "delete";

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
 */
export async function checkCollectionAccess(
  context: AuthContext,
  collectionSlug: string,
  operation: CollectionOperation,
  deps: CollectionAccessDeps
): Promise<boolean> {
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
  return checkPermission(context, operation, collectionSlug, deps);
}
