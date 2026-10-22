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

import { holdsPermission, type Actor } from "./actor";
import { decide, declaresRule, type AccessTarget } from "./decide";
import { targetAsDeclared } from "./declared-rules";
import { deviate } from "./deviations";
import { actorForKey, actorForUserFailingClosed } from "./resolve-actor";

/** The target as the access-control service registers it, or one with no rule. */
function targetOf(
  slug: string,
  rbac: RBACAccessControlService | undefined
): AccessTarget {
  return rbac?.getRegisteredTarget(slug) ?? { kind: "collection", slug };
}

/**
 * The decision about reading `target`: the reader's answer, or the one a
 * deviation compares today's with. With the service, `target` is what it
 * registers now; without one, the rules the app declared stand in.
 */
async function decided(actor: Actor, target: AccessTarget): Promise<boolean> {
  return (await decide(actor, "read", target)).allowed;
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
    return deviate("no-service", slugAllows, () =>
      decided(actor, targetAsDeclared(target))
    );
  }
  if (
    !scopeRowsAgree(caller) ||
    slugAllows !== holdsPermission(actor, "read", slug)
  ) {
    // The stored slug and the rows answer differently: a scope without rows,
    // or a grant stored under a slug of its own.
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
  // A lookup that fails counts as holding nothing of its kind, so the read
  // is refused rather than failed.
  const actor = () => actorForUserFailingClosed(caller.userId);
  if (!rbac) {
    // Without the service a signed-in user's grant is never asked.
    return deviate("no-service", false, async () =>
      decided(await actor(), targetAsDeclared(target))
    );
  }
  if (declaresRule(target, "read")) {
    // A declared read rule decides alone for anyone but a super-admin,
    // whatever their grants, and its answer is handed back as the rule gave
    // it: today's answer is the access-control service's, which admits a
    // super-admin and otherwise asks the rule once, with no need of the
    // user's grants.
    const today = await rbac.checkAccess({
      userId: caller.userId,
      operation: "read",
      resource: slug,
    });
    return deviate("rule-alone-for-people", today, async () =>
      decided(await actor(), target)
    );
  }
  return decided(await actor(), target);
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
