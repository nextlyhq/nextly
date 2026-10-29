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
 * The answer is every entry, none, or the entries a read rule's filter
 * matches: "may the caller read the entity" means yes, some entries, and the
 * readers behind it apply the filter.
 *
 * @module auth/access/entity-read
 */
import type { RBACAccessControlService } from "../../domains/auth/services/rbac-access-control-service";
import { scopeRowsAgree, slugGrants } from "../authenticated-scope";
import { codeAccessAllows, type ReadAccessCaller } from "../code-access";

import { holdsPermission, isSuperAdmin, type Actor } from "./actor";
import { declaresRule, type AccessTarget } from "./decide";
import { targetAsDeclared } from "./declared-rules";
import { deviate } from "./deviations";
import { decidedRead as decided, filteredRead } from "./read-decision";
import { actorForKey, actorForUserFailingClosed } from "./resolve-actor";
import { readOf, type FilteredRead } from "./rule-answer";

/** The target as the access-control service registers it, or one with no rule. */
function targetOf(
  slug: string,
  rbac: RBACAccessControlService | undefined
): AccessTarget {
  return rbac?.getRegisteredTarget(slug) ?? { kind: "collection", slug };
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
    superAdmin: caller.keyHoldsSuperAdmin === true,
  });
}

/** The entity reader's answer for an API key. */
async function keyReads(
  slug: string,
  caller: ReadAccessCaller,
  rbac: RBACAccessControlService | undefined
): Promise<FilteredRead> {
  const target = targetOf(slug, rbac);
  const actor = keyActorOf(caller);
  // A key carrying its maker's super-admin authority reads every entity a
  // super-admin's session does.
  if (isSuperAdmin(actor)) return true;
  // Judged on its own stored slugs, today as before: the grant decides, and
  // a registered rule must answer `true`.
  const slugAllows = caller.permissions.includes(`read-${slug}`);
  if (!rbac) {
    // Without the service no rule is read: the grant is the whole answer.
    return readOf(
      await deviate("no-service", slugAllows, () =>
        decided(actor, targetAsDeclared(target))
      )
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
    return readOf(
      await deviate("key-slug-string-match", today, () =>
        decided(actor, target)
      )
    );
  }
  return filteredRead(actor, target);
}

/** The entity reader's answer for a signed-in user. */
async function userReads(
  slug: string,
  caller: ReadAccessCaller,
  rbac: RBACAccessControlService | undefined
): Promise<FilteredRead> {
  const target = targetOf(slug, rbac);
  // A lookup that fails counts as holding nothing of its kind, so the read
  // is refused rather than failed.
  const actor = () => actorForUserFailingClosed(caller.userId);
  if (!rbac) {
    // Without the service a signed-in user's grant is never asked.
    return readOf(
      await deviate("no-service", false, async () =>
        decided(await actor(), targetAsDeclared(target))
      )
    );
  }
  if (declaresRule(target, "read")) {
    // The access-control service's answer: it admits a super-admin, and
    // otherwise needs the read permission first and then a rule that answers
    // `true`, or a filter, as the decision does.
    return rbac.checkAccessApplyingFilter({
      userId: caller.userId,
      operation: "read",
      resource: slug,
    });
  }
  return filteredRead(await actor(), target);
}

/**
 * What the entity reader lets `caller` read of `slug`: every entry, none, or
 * those a read rule's filter matches, with `rbac` the access-control service,
 * or `undefined` when none is registered.
 */
export function readsEntity(
  slug: string,
  caller: ReadAccessCaller,
  rbac: RBACAccessControlService | undefined
): Promise<FilteredRead> {
  return caller.authMethod === "api-key"
    ? keyReads(slug, caller, rbac)
    : userReads(slug, caller, rbac);
}
