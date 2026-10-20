/**
 * The collection gate's answer, asked of the one decision.
 *
 * The gate keeps the order and the answers it has always given. Each step
 * either returns the decision's answer, where today's gate agrees with it, or
 * keeps today's answer through a named deviation (`./deviations`), where it
 * does not yet. A rule is asked exactly where the gate asked it before, once,
 * so an app's rule runs as often as it did.
 *
 * The gate presents the answer: a refusal here says only which kind it is,
 * and the gate words it.
 */
import type { Principal } from "../../plugins/principals/types";
import { isSuperAdminContext } from "../../services/access";
import type { AccessOperation } from "../../services/access/types";
import {
  apiKeyWriteAllowed,
  scopeGrants,
  type AuthenticatedScope,
} from "../authenticated-scope";

import { holdsPermission, isSuperAdmin, type Actor } from "./actor";
import {
  askRule,
  askRules,
  decide,
  judge,
  type AccessTarget,
  type Decision,
} from "./decide";
import { deviate } from "./deviations";
import {
  actorForKey,
  actorForPrincipal,
  actorForScope,
  actorForUser,
  actorForVisitor,
} from "./resolve-actor";

/** Allowed, or refused with the kind of refusal the gate words. */
export type GateVerdict =
  | { readonly allowed: true }
  | {
      readonly allowed: false;
      /**
       * `insufficient`: the caller may not; `unauthenticated`: the action
       * needs a signed-in caller; `failed`: the caller's access could not be
       * read, and the gate refuses rather than guess.
       */
      readonly refusal: "insufficient" | "unauthenticated" | "failed";
      readonly error?: unknown;
    };

const ALLOWED: GateVerdict = Object.freeze({ allowed: true });
const INSUFFICIENT: GateVerdict = Object.freeze({
  allowed: false,
  refusal: "insufficient",
});
const UNAUTHENTICATED: GateVerdict = Object.freeze({
  allowed: false,
  refusal: "unauthenticated",
});

const verdictOf = (allowed: boolean): GateVerdict =>
  allowed ? ALLOWED : INSUFFICIENT;

const isLifecycle = (action: AccessOperation) =>
  action === "publish" || action === "unpublish";

/** Where the gate reads the targets apps declare rules for. */
interface RuleSource {
  getRegisteredTarget(slug: string): AccessTarget | undefined;
}

/** What the collection gate is asked, as it is asked it. */
export interface CollectionQuestion {
  readonly slug: string;
  readonly action: AccessOperation;
  readonly user?: { id: string; role?: string; roles?: string[] };
  readonly routeAuthorized?: boolean;
  /** The key scope in force: the caller's own, else the request's. */
  readonly scope?: AuthenticatedScope;
  /** The plugin person the call is made as, if any. */
  readonly principal: Principal | null;
  /** The caller's transaction, when the gate is asked inside one. */
  readonly executor?: unknown;
  /** The access-control service's rules; absent without the service. */
  readonly rules?: RuleSource;
  /**
   * Without the access-control service, whether the user holds the
   * permission, read from the gate's own database.
   */
  readonly permissionWithoutService: () => Promise<boolean>;
}

/** The decision's answer, for a deviation to compare today's against. */
const decided = async (
  actor: Actor | Promise<Actor>,
  action: AccessOperation,
  target: AccessTarget
): Promise<boolean> => (await decide(await actor, action, target)).allowed;

export async function collectionGateVerdict(
  q: CollectionQuestion
): Promise<GateVerdict> {
  // The registered target, as the access-control service resolves it; one
  // with no rules where nothing is registered, as without the service.
  const target: AccessTarget = q.rules?.getRegisteredTarget(q.slug) ?? {
    kind: "collection",
    slug: q.slug,
  };

  // A plugin's person is judged by the rule alone, and a target that declares
  // none, as every target does without the service, refuses them.
  if (q.principal !== null) {
    return answerOf(
      await decide(actorForPrincipal(q.principal), q.action, target)
    );
  }

  const keyAsks = q.scope?.actorType === "apiKey";
  if (!keyAsks && isSuperAdminContext(q.user)) {
    const user = q.user;
    if (
      user &&
      (await deviate("claimed-super-admin", true, () =>
        decided(
          actorForUser(user.id, { executor: q.executor }),
          q.action,
          target
        )
      ))
    ) {
      return ALLOWED;
    }
  }

  if (q.routeAuthorized) {
    // The route gate already decided for the user it authenticated; a route
    // that authenticated nobody cannot vouch for anyone.
    return q.user ? ALLOWED : UNAUTHENTICATED;
  }
  if (!q.user) return visitorVerdict(q, target);
  if (keyAsks && q.scope) return keyVerdict(q, target, q.scope, q.user);
  return userVerdict(q, target, q.user);
}

function answerOf(decision: Decision): GateVerdict {
  return verdictOf(decision.allowed);
}

async function visitorVerdict(
  q: CollectionQuestion,
  target: AccessTarget
): Promise<GateVerdict> {
  const visitor = actorForVisitor();
  const outcome = await askRule(visitor, q.action, target);
  // A rule refuses a visitor by answering `false`, or by failing.
  if (outcome.declared && ("threw" in outcome || outcome.value === false)) {
    return INSUFFICIENT;
  }
  if (isLifecycle(q.action)) return UNAUTHENTICATED;
  const allowed = await deviate("visitor-public-default", true, () =>
    decided(visitor, q.action, target)
  );
  return verdictOf(allowed);
}

async function keyVerdict(
  q: CollectionQuestion,
  target: AccessTarget,
  scope: AuthenticatedScope,
  user: { id: string; roles?: string[] }
): Promise<GateVerdict> {
  if (!rowsAgree(scope)) {
    // Judged on the stored slugs, as before: a scope without the rows its
    // slugs came from, or one whose slugs were narrowed apart from its rows.
    const today = await apiKeyWriteAllowed(
      scope,
      q.action,
      q.slug,
      user,
      q.rules
    );
    const rowsAlone = actorForKey({
      keyId: "",
      userId: user.id,
      grants: scope.grants ?? [],
      roles: scope.roles ?? user.roles ?? [],
    });
    return verdictOf(
      await deviate("key-slug-string-match", today === true, () =>
        decided(rowsAlone, q.action, target)
      )
    );
  }
  const actor = actorForScope(scope, user);
  if (isLifecycle(q.action)) {
    const today =
      holdsPermission(actor, q.action, q.slug) &&
      (await ruleAllows(actor, q.action, target));
    return verdictOf(
      await deviate("lifecycle-judged-alone", today, () =>
        decided(actor, q.action, target)
      )
    );
  }
  return answerOf(
    judge(actor, q.action, target, await askRules(actor, q.action, target))
  );
}

/** Whether the scope carries grant rows its slugs were derived from. */
function rowsAgree(scope: AuthenticatedScope): boolean {
  if (!scope.grants) return false;
  try {
    scopeGrants(scope);
    return true;
  } catch {
    return false;
  }
}

/** A key's rule allows only by answering `true`; no rule adds no limit. */
async function ruleAllows(
  actor: Actor,
  action: AccessOperation,
  target: AccessTarget
): Promise<boolean> {
  if (actor.kind === "system") return true;
  const outcome = await askRule(actor, action, target);
  if (!outcome.declared) return true;
  return !("threw" in outcome) && outcome.value === true;
}

async function userVerdict(
  q: CollectionQuestion,
  target: AccessTarget,
  user: { id: string }
): Promise<GateVerdict> {
  try {
    if (!q.rules) {
      const today = await q.permissionWithoutService();
      return verdictOf(
        await deviate("no-service", today, () =>
          decided(
            actorForUser(user.id, { executor: q.executor }),
            q.action,
            target
          )
        )
      );
    }
    const actor = await actorForUser(user.id, { executor: q.executor });
    // A super-admin passes without a rule being read, and a user named by no
    // id holds nothing, so neither asks one.
    if (isSuperAdmin(actor) || !user.id) {
      return answerOf(judge(actor, q.action, target, null));
    }
    const outcome = await askRule(actor, q.action, target);
    if (outcome.declared) {
      const today = !("threw" in outcome) && Boolean(outcome.value);
      return verdictOf(
        await deviate("rule-alone-for-people", today, () =>
          decided(actor, q.action, target)
        )
      );
    }
    if (isLifecycle(q.action)) {
      return verdictOf(
        await deviate(
          "lifecycle-judged-alone",
          holdsPermission(actor, q.action, q.slug),
          () => decided(actor, q.action, target)
        )
      );
    }
    return answerOf(judge(actor, q.action, target, { action: outcome }));
  } catch (error) {
    return { allowed: false, refusal: "failed", error };
  }
}
