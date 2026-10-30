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
 * Population applies a read rule's filter: where the target's read rule
 * answers one, the answer is the filter, and the expansion shows the related
 * rows it matches.
 *
 * @module auth/access/population-read
 */
import type { RBACAccessControlService } from "../../domains/auth/services/rbac-access-control-service";
import type { Principal } from "../../plugins/principals/types";
import {
  apiKeyScopeAllows,
  scopeHoldsSuperAdmin,
  scopeRowsAgree,
  slugGrants,
  type AuthenticatedScope,
} from "../authenticated-scope";
import { codeAccessAllows } from "../code-access";
import { readAccessCaller } from "../entity-read-access";

import {
  holdsPermission,
  isSuperAdmin,
  visitorActor,
  type Actor,
  type VisitorActor,
} from "./actor";
import { declaresRule, type AccessTarget } from "./decide";
import { targetAsDeclared } from "./declared-rules";
import { deviate } from "./deviations";
import { decidedRead as decided, filteredRead } from "./read-decision";
import {
  actorForKey,
  actorForPrincipal,
  actorForScope,
  actorForUserFailingClosed,
  actorForVisitorFailingClosed,
  userHoldsPermission,
} from "./resolve-actor";
import { readOf, type FilteredRead } from "./rule-answer";

/** The caller a related row is judged for, as the expansion holds it. */
export interface RelatedRowCaller {
  /** The user the row is judged for, as the read names it, with any role it names. */
  readonly user?: { id: string; role?: string; roles?: string[] };
  /** The key's scope, when the read is made with an API key. */
  readonly scope?: AuthenticatedScope;
  /** A plugin's signed-in person, when the read is made as one. */
  readonly principal: Principal | null;
  /**
   * Without the access-control service, the visitor as the reading service's
   * own database records the Public role, as its direct gate reads it;
   * absent, the process's.
   */
  readonly visitorWithoutService?: () => Promise<VisitorActor>;
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
    superAdmin: scopeHoldsSuperAdmin(scope),
  });
}

/** Population's answer for a visitor. */
async function visitorReads(
  target: AccessTarget,
  own: RelatedRowCaller["visitorWithoutService"]
): Promise<FilteredRead> {
  // A failed read of Public's grants withholds the row rather than failing
  // the read, as a user's failed lookup does here.
  const visitor = own
    ? await own().catch(() => visitorActor())
    : await actorForVisitorFailingClosed();
  // The decision, with or without the service: the Public role's read, then
  // the read rule. Without the service no rule is registered, so Public's
  // read decides, as it does for the visitor's direct read. A rule answering
  // a filter hands it back, and population reads only the rows it matches,
  // as for a user or a key.
  return filteredRead(visitor, target);
}

/** Population's answer for an API key. */
async function keyReads(
  target: AccessTarget,
  scope: AuthenticatedScope,
  user: { id: string; roles?: string[] },
  rbac: RBACAccessControlService | undefined
): Promise<FilteredRead> {
  const actor = keyActorOf(scope, user);
  // A key carrying its maker's super-admin authority reads every related row
  // a super-admin's session does.
  if (isSuperAdmin(actor)) return readOf(true);
  // The key's own stored slug is asked first, today as before.
  const slugAllows = apiKeyScopeAllows(scope, "read", target.slug) !== false;
  if (!rbac) {
    // Without the service no rule is read: the grant is the whole answer.
    return readOf(
      await deviate("no-service", slugAllows, () => decided(actor, target))
    );
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
    return readOf(
      await deviate("key-slug-string-match", today, () =>
        decided(actor, target)
      )
    );
  }
  return filteredRead(actor, target);
}

/** Population's answer for a signed-in user. */
async function userReads(
  target: AccessTarget,
  userId: string,
  rbac: RBACAccessControlService | undefined
): Promise<FilteredRead> {
  // A lookup that fails counts as holding nothing of its kind, so the row is
  // withheld rather than the read failed.
  const actor = () => actorForUserFailingClosed(userId);
  if (!rbac) {
    // Without the service the rule is never read: the user's grants decide.
    const today = await userHoldsPermission(userId, "read", target.slug);
    return readOf(
      await deviate("no-service", today, async () =>
        decided(await actor(), target)
      )
    );
  }
  if (declaresRule(target, "read")) {
    // The access-control service's answer: it admits a super-admin, and
    // otherwise needs the read permission first and then a rule that answers
    // `true`, or a filter, as the decision does.
    return rbac.checkAccessApplyingFilter({
      userId,
      operation: "read",
      resource: target.slug,
      codeAccess: target.access,
    });
  }
  return filteredRead(await actor(), target);
}

/**
 * Which rows of `slug` population shows `caller`: every row, none, or those a
 * read rule's filter matches, with `rbac` the access-control service, or
 * `undefined` when none is registered.
 */
export async function relatedRowReads(
  slug: string,
  caller: RelatedRowCaller,
  rbac: RBACAccessControlService | undefined
): Promise<FilteredRead> {
  // What the service registers now; without one, the rules the app declared
  // stand in, which no answer kept without the service reads.
  const undeclared: AccessTarget = { kind: "collection", slug };
  const target = rbac
    ? (rbac.getRegisteredTarget(slug) ?? undeclared)
    : targetAsDeclared(undeclared);
  const scope = caller.scope?.actorType === "apiKey" ? caller.scope : undefined;
  // A plugin's person is judged first, as the person, whatever user the read
  // also names; a user is judged by the roles their lookup finds, never by
  // role names handed in with them.
  if (caller.principal) {
    const person = actorForPrincipal(caller.principal);
    // A plugin's person is judged by the target's rule alone; without the
    // service there is no rule to read, and the person is refused.
    if (!rbac) {
      return readOf(
        await deviate("no-service", false, () => decided(person, target))
      );
    }
    return filteredRead(person, target);
  }
  // A read with no user is a visitor's, a key scope included, as it was
  // before: no door populates for a key without naming the user it acts for.
  // Without the service a visitor is judged as its direct read is, by the
  // Public role's read alone: that gate has no rule registered, so a rule the
  // process declared for the slug, perhaps for another instance, is neither
  // asked nor run here.
  if (!caller.user) {
    return rbac
      ? visitorReads(target, undefined)
      : visitorReads(undeclared, caller.visitorWithoutService);
  }
  if (scope) return keyReads(target, scope, caller.user, rbac);
  return userReads(target, caller.user.id, rbac);
}
