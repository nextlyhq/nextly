/**
 * The pieces of a read decision that every judge shares.
 *
 * `canReadEntity` in `entity-read-access` and the write-side gate in
 * `authenticated-scope` both evaluate a code-defined rule against a caller and
 * both reach the RBAC service the same way. Those two modules import each
 * other's neighbours, so the shared parts live here, beneath both, where
 * neither has to reach through the other to find them.
 *
 * @module auth/code-access
 */

import { container } from "../di/container";
import type { RBACAccessControlService } from "../domains/auth/services/rbac-access-control-service";
import type {
  AccessControlContext,
  CollectionAccessControl,
  SingleAccessControl,
} from "../shared/types/access";

/**
 * The resolved identity a read decision needs.
 *
 * `permissions` are the API key's OWN scoped grants in `{action}-{resource}`
 * form. Note the format: `listEffectivePermissions` returns the other one
 * (`{resource}:{action}`), and mixing them silently answers "denied" for every
 * check. Session callers carry an empty list — their grants are resolved from
 * the database instead.
 */
export interface ReadAccessCaller {
  userId: string;
  authMethod: "session" | "api-key";
  /**
   * An API key's grants in the STORED spelling (`read-posts`): what the coarse
   * `read-{slug}` check compares against. Empty for a session caller, whose
   * grants `checkAccess` resolves from the database.
   */
  permissions: string[];
  /**
   * The same grants in the spelling a code-defined rule reads (`posts:read`),
   * when the caller's scope carried the rows to derive it from.
   *
   * 🔴 Two spellings of one list, kept apart because they are read by two
   * different judges. `AccessControlContext.permissions` promises the
   * `resource:action` form, and a rule written to that promise --
   * `({ permissions }) => permissions.includes("posts:read")` -- was handed
   * the stored form and refused a correctly scoped key. Absent when the scope
   * never had the rows, in which case the stored slugs are what a rule gets:
   * the honest answer, since a slug cannot be split into parts no permission
   * row names.
   */
  rulePermissions?: readonly string[];
  /** Role slugs, already normalized (session roles arrive as ids). */
  roles: string[];
}

/**
 * The RBAC service, or undefined before the container is initialized.
 *
 * Exported for `auth/authenticated-scope`, which composes the api-key and
 * session branches of the same decision and would otherwise hold a fourth copy
 * of this resolver. It is not part of any published surface.
 */
export function getRBACService(): RBACAccessControlService | undefined {
  try {
    if (container.has("rbacAccessControlService")) {
      return container.get<RBACAccessControlService>(
        "rbacAccessControlService"
      );
    }
  } catch {
    // DI container not initialized yet — the caller decides how to fall back.
  }
  return undefined;
}

/**
 * Evaluate a code-defined access rule.
 *
 * An absent rule allows: the permission check that precedes this one is what
 * grants access, and a rule that says nothing about an operation does not
 * revoke it. A rule that throws denies, so a broken rule fails closed.
 */
export async function codeAccessAllows(
  codeAccess: CollectionAccessControl | SingleAccessControl,
  operation: "create" | "read" | "update" | "delete" | "publish" | "unpublish",
  resource: string,
  caller: ReadAccessCaller
): Promise<boolean> {
  const operationAccess =
    codeAccess[
      operation as keyof (CollectionAccessControl | SingleAccessControl)
    ];

  if (operationAccess === undefined) return true;
  if (typeof operationAccess === "boolean") return operationAccess;

  // The context carries the CALLER's roles and permissions. For an API key
  // those are the key's own scoped values, not its owner's — which is the
  // whole point of evaluating the rule against the key.
  const ctx: AccessControlContext = {
    user: { id: caller.userId },
    roles: caller.roles,
    // The RULE-facing spelling, which is what the context promises. The
    // stored spelling is a fallback for a scope that never carried the rows.
    permissions: [...(caller.rulePermissions ?? caller.permissions)],
    operation,
    collection: resource,
  };

  try {
    return (await operationAccess(ctx)) === true;
  } catch {
    return false;
  }
}
