/**
 * Whether a read that populates relationships may show its caller a row of a
 * configured collection, asked of the one decision.
 *
 * Population withholds a related row the caller could not read by name. Who
 * the caller is, and whether a trusted read reaches the target at all, is
 * settled before this is asked. The caller becomes an actor, and the decision
 * answers. Where population answers differently today, today's answer is
 * kept through a named deviation, so no answer moves, and removing one is a
 * change of its own that the access table shows.
 *
 * @module auth/access/population-read
 */
import type { RBACAccessControlService } from "../../domains/auth/services/rbac-access-control-service";
import type { Principal } from "../../plugins/principals/types";
import { isSuperAdminContext } from "../../services/access";
import {
  apiKeyScopeAllows,
  scopeRowsAgree,
  slugGrants,
  type AuthenticatedScope,
} from "../authenticated-scope";
import { codeAccessAllows } from "../code-access";
import { readAccessCaller } from "../entity-read-access";

import { holdsPermission, type Actor } from "./actor";
import { decide, declaresRule, type AccessTarget } from "./decide";
import { targetAsDeclared } from "./declared-rules";
import { deviate } from "./deviations";
import {
  actorForKey,
  actorForPrincipal,
  actorForScope,
  actorForUserFailingClosed,
  actorForVisitor,
  userHoldsPermission,
} from "./resolve-actor";

/** The caller a related row is judged for, as the expansion holds it. */
export interface RelatedRowCaller {
  /** The user the row is judged for, as the read names it, with any role it names. */
  readonly user?: { id: string; role?: string; roles?: string[] };
  /** The key's scope, when the read is made with an API key. */
  readonly scope?: AuthenticatedScope;
  /** A plugin's signed-in person, when the read is made as one. */
  readonly principal: Principal | null;
}

/**
 * The decision about reading `target`: population's answer, or the one a
 * deviation compares today's with.
 */
async function decided(actor: Actor, target: AccessTarget): Promise<boolean> {
  return (await decide(actor, "read", target)).allowed;
}

/**
 * A key's actor: from its scope's rows, or, for a scope whose slugs carry no
 * rows, from the grants those slugs name, which is what the decision would
 * judge if it could read them.
 */
function keyActorOf(
  scope: AuthenticatedScope,
  user: { id: string; roles?: string[] }
): Actor {
  if (scopeRowsAgree(scope)) return actorForScope(scope, user);
  return actorForKey({
    keyId: "",
    userId: user.id,
    grants: slugGrants(scope.permissions),
    roles: scope.roles ?? user.roles ?? [],
  });
}

/** The actor for a caller that is no key. */
async function actorOf(caller: RelatedRowCaller): Promise<Actor> {
  if (caller.principal) return actorForPrincipal(caller.principal);
  if (caller.user) return actorForUserFailingClosed(caller.user.id);
  return actorForVisitor();
}

/** Population's answer for a visitor. */
async function visitorReads(
  target: AccessTarget,
  rbac: RBACAccessControlService | undefined
): Promise<boolean> {
  const visitor = actorForVisitor();
  // A visitor is judged by the target's read rule alone: no rule, or any
  // answer but `false`, admits them, and a rule that throws refuses. Without
  // the service nothing is asked, and the visitor is admitted.
  if (!rbac) return deviate("no-service", true, () => decided(visitor, target));
  const verdict = await rbac.checkAnonymousCodeAccess({
    operation: "read",
    resource: target.slug,
  });
  return deviate("visitor-public-default", verdict !== false, () =>
    decided(visitor, target)
  );
}

/** Population's answer for an API key. */
async function keyReads(
  target: AccessTarget,
  scope: AuthenticatedScope,
  user: { id: string; roles?: string[] },
  rbac: RBACAccessControlService | undefined
): Promise<boolean> {
  const actor = keyActorOf(scope, user);
  // The key's own stored slug is asked first, today as before.
  const slugAllows = apiKeyScopeAllows(scope, "read", target.slug) !== false;
  if (!rbac) {
    // Without the service no rule is read: the grant is the whole answer.
    return deviate("no-service", slugAllows, () => decided(actor, target));
  }
  if (
    !scopeRowsAgree(scope) ||
    slugAllows !== holdsPermission(actor, "read", target.slug)
  ) {
    // The stored slug and the rows answer differently: a scope without rows,
    // or a grant stored under a slug of its own.
    const today =
      slugAllows &&
      (!declaresRule(target, "read") ||
        (await codeAccessAllows(
          target,
          "read",
          readAccessCaller({ user, authenticatedScope: scope })
        )));
    return deviate("key-slug-string-match", today, () =>
      decided(actor, target)
    );
  }
  return decided(actor, target);
}

/** Population's answer for a signed-in user. */
async function userReads(
  target: AccessTarget,
  userId: string,
  rbac: RBACAccessControlService | undefined
): Promise<boolean> {
  // A lookup that fails counts as holding nothing of its kind, so the row is
  // withheld rather than the read failed.
  const actor = () => actorForUserFailingClosed(userId);
  if (!rbac) {
    // Without the service the rule is never read: the user's grants decide.
    const today = await userHoldsPermission(userId, "read", target.slug);
    return deviate("no-service", today, async () =>
      decided(await actor(), target)
    );
  }
  if (declaresRule(target, "read")) {
    // A declared read rule decides alone for anyone but a super-admin,
    // whatever their grants, judged truthy: today's answer is the
    // access-control service's, which admits a super-admin and otherwise asks
    // the rule once, with no need of the user's grants.
    const today = await rbac.checkAccess({
      userId,
      operation: "read",
      resource: target.slug,
      codeAccess: target.access,
    });
    return deviate("rule-alone-for-people", Boolean(today), async () =>
      decided(await actor(), target)
    );
  }
  return decided(await actor(), target);
}

/**
 * Whether population shows `caller` the rows of `slug`, with `rbac` the
 * access-control service, or `undefined` when none is registered.
 */
export function relatedRowReads(
  slug: string,
  caller: RelatedRowCaller,
  rbac: RBACAccessControlService | undefined
): Promise<boolean> {
  // What the service registers now; without one, the rules the app declared
  // stand in, which no answer kept without the service reads.
  const target = rbac
    ? (rbac.getRegisteredTarget(slug) ?? { kind: "collection" as const, slug })
    : targetAsDeclared({ kind: "collection", slug });
  const scope = caller.scope?.actorType === "apiKey" ? caller.scope : undefined;
  // A caller that names the super-admin role is admitted on that name, and a
  // key never is, whatever its maker holds.
  if (!scope && isSuperAdminContext(caller.user)) {
    return deviate("claimed-super-admin", true, async () =>
      decided(await actorOf(caller), target)
    );
  }
  if (caller.principal) {
    const person = actorForPrincipal(caller.principal);
    // A plugin's person is judged by the target's rule alone; without the
    // service there is no rule to read, and the person is refused.
    if (!rbac) {
      return deviate("no-service", false, () => decided(person, target));
    }
    return decided(person, target);
  }
  if (!caller.user) return visitorReads(target, rbac);
  if (scope) return keyReads(target, scope, caller.user, rbac);
  return userReads(target, caller.user.id, rbac);
}
