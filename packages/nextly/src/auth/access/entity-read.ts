/**
 * Whether a caller may read a collection or a Single as the entity readers
 * answer it (`canReadEntity`, and through it versions, translations, document
 * locks, widgets, the dashboard, content events and plugins' readable
 * content), asked of the one decision.
 *
 * The caller becomes an actor, and the decision answers. Where today's reader
 * answers differently, today's answer is kept through a named deviation, so
 * no answer moves, and removing a deviation is a change of its own that the
 * access table shows.
 *
 * @module auth/access/entity-read
 */
import type { RBACAccessControlService } from "../../domains/auth/services/rbac-access-control-service";
import { scopeRowsAgree, slugGrants } from "../authenticated-scope";
import { codeAccessAllows, type ReadAccessCaller } from "../code-access";

import { isSuperAdmin, type Actor } from "./actor";
import { decide, declaresRule, type AccessTarget } from "./decide";
import { targetAsDeclared } from "./declared-rules";
import { deviate } from "./deviations";
import { actorForKey, actorForUser } from "./resolve-actor";

/** The target as the access-control service registers it, or one with no rule. */
function targetOf(
  slug: string,
  rbac: RBACAccessControlService | undefined
): AccessTarget {
  return rbac?.getRegisteredTarget(slug) ?? { kind: "collection", slug };
}

/** The decision about reading `target`, for the answer a deviation keeps. */
async function decided(actor: Actor, target: AccessTarget): Promise<boolean> {
  return (await decide(actor, "read", targetAsDeclared(target))).allowed;
}

/**
 * The key's actor: from the grant rows its caller carries, or, for a caller
 * whose slugs carry no rows, from the grants those slugs name, which is what
 * the decision would judge if it could read them.
 */
function keyActorOf(caller: ReadAccessCaller): Actor {
  return actorForKey({
    keyId: "",
    userId: caller.userId,
    grants: scopeRowsAgree(caller)
      ? (caller.grants ?? [])
      : slugGrants(caller.permissions),
    roles: caller.roles,
  });
}

/** The entity reader's answer for an API key. */
async function keyReads(
  slug: string,
  caller: ReadAccessCaller,
  rbac: RBACAccessControlService | undefined
): Promise<boolean> {
  const target = targetOf(slug, rbac);
  const actor = keyActorOf(caller);
  // Judged on its own stored slugs, today as before: the grant decides, and
  // a registered rule must answer `true`.
  const slugAllows = caller.permissions.includes(`read-${slug}`);
  if (!rbac) {
    // Without the service no rule is read: the grant is the whole answer.
    return deviate("no-service", slugAllows, () => decided(actor, target));
  }
  if (!scopeRowsAgree(caller)) {
    const today =
      slugAllows &&
      (target.access === undefined ||
        (await codeAccessAllows(target, "read", caller)));
    return deviate("key-slug-string-match", today, () =>
      decided(actor, target)
    );
  }
  return decided(actor, target);
}

/** The entity reader's answer for a signed-in user. */
async function userReads(
  slug: string,
  caller: ReadAccessCaller,
  rbac: RBACAccessControlService | undefined
): Promise<boolean> {
  const target = targetOf(slug, rbac);
  if (!rbac) {
    // Without the service a signed-in user's grant is never asked.
    return deviate("no-service", false, async () =>
      decided(await actorForUser(caller.userId), target)
    );
  }
  const actor = await actorForUser(caller.userId);
  if (!isSuperAdmin(actor) && declaresRule(target, "read")) {
    // A declared read rule decides alone, whatever the user's grants, and
    // its answer is handed back as the rule gave it: today's answer is the
    // access-control service's, which asks the rule once.
    const today = await rbac.checkAccess({
      userId: caller.userId,
      operation: "read",
      resource: slug,
    });
    return deviate("rule-alone-for-people", today, () =>
      decided(actor, target)
    );
  }
  return decided(actor, target);
}

/**
 * The entity reader's answer for `caller` about `slug`, with `rbac` the
 * access-control service, or `undefined` when none is registered.
 */
export function readsEntity(
  slug: string,
  caller: ReadAccessCaller,
  rbac: RBACAccessControlService | undefined
): Promise<boolean> {
  return caller.authMethod === "api-key"
    ? keyReads(slug, caller, rbac)
    : userReads(slug, caller, rbac);
}
