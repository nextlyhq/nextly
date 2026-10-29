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
import type { AccessOperation } from "../services/access/types";
import type {
  CollectionAccessControl,
  SingleAccessControl,
} from "../shared/types/access";

import type { AccessTarget } from "./access/decide";
import {
  noteFilterNotApplied,
  reportRuleFilterMisuse,
  ruleAnswer,
} from "./access/rule-answer";
import { buildRuleContext } from "./access/rule-context";
import type { GrantedPermission } from "./authenticated-scope";

/**
 * The resolved identity a read decision needs.
 *
 * `permissions` are the API key's OWN scoped grants, in the stored spelling
 * (`read-posts`) the coarse `read-{slug}` check compares against. Session
 * callers carry an empty list: their grants are resolved from the database
 * instead.
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
   * The rows behind `permissions`, when the caller's scope carried them. A
   * rule is handed each one's stored slug either way.
   */
  grants?: readonly GrantedPermission[];
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
  target: AccessTarget,
  operation: AccessOperation,
  caller: ReadAccessCaller
): Promise<boolean> {
  const operationAccess =
    target.access?.[
      operation as keyof (CollectionAccessControl | SingleAccessControl)
    ];

  if (operationAccess === undefined) return true;
  if (typeof operationAccess === "boolean") return operationAccess;

  // The context carries the CALLER's roles and permissions. For an API key
  // those are the key's own scoped values, not its owner's — which is the
  // whole point of evaluating the rule against the key.
  const ctx = buildRuleContext(
    {
      user: { id: caller.userId },
      roles: caller.roles,
      // The rows where the scope carried them, the stored slugs otherwise;
      // the rule is handed each one's stored slug either way.
      permissions: caller.grants ?? caller.permissions,
      // A staff user or an API key, never a plugin-defined person.
      principal: null,
    },
    { operation, target: { kind: target.kind, slug: target.slug } }
  );

  let answer: unknown;
  try {
    answer = await operationAccess(ctx);
  } catch {
    return false;
  }
  // Only `true` allows every entry; a filter, which this check does not
  // apply, refuses, and one that is misused is reported as such.
  const meaning = ruleAnswer(answer);
  reportRuleFilterMisuse(target.slug, operation, target.kind, meaning);
  // Asked only once the caller holds the permission, so the decision would
  // let it read the entries a filter matches.
  await noteFilterNotApplied(target.kind, operation, meaning, true);
  return meaning.kind === "allow";
}
