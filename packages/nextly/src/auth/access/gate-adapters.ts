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
import { permissionSlug } from "../../schemas/_zod/rbac";
import { isSuperAdminContext } from "../../services/access";
import type { AccessOperation } from "../../services/access/types";
import {
  apiKeyWriteAllowed,
  scopeGrants,
  type AuthenticatedScope,
} from "../authenticated-scope";

import { holdsPermission, type Actor, type UserActor } from "./actor";
import {
  askRule,
  askRules,
  decide,
  declaresRule,
  judge,
  plainRule,
  type AccessTarget,
  type Decision,
  type RuleOutcome,
} from "./decide";
import { deviate } from "./deviations";
import {
  actorForKey,
  actorForPrincipal,
  actorForScope,
  actorForUser,
  actorForVisitor,
  userHoldsPermission,
  userIsSuperAdmin,
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
  const rows = rowsAgree(scope);
  const actor = rows
    ? actorForScope(scope, user)
    : actorForKey({
        keyId: "",
        userId: user.id,
        grants: scope.grants ?? [],
        roles: scope.roles ?? user.roles ?? [],
      });
  // A key holds an action by its stored slug, `<action>-<target>`. The
  // decision reads the grant's action and target, which agree with the slug
  // unless the grant was stored under a slug of its own.
  const slugHolds = scope.permissions.includes(
    permissionSlug(q.action, q.slug)
  );
  if (!rows || slugHolds !== holdsPermission(actor, q.action, q.slug)) {
    // Judged on the stored slugs, as before: a scope without the rows its
    // slugs came from, one whose slugs were narrowed apart from its rows, or
    // a grant stored under a slug of its own.
    const today = await apiKeyWriteAllowed(
      scope,
      q.action,
      q.slug,
      user,
      q.rules
    );
    return verdictOf(
      await deviate("key-slug-string-match", today === true, () =>
        decided(actor, q.action, target)
      )
    );
  }
  if (isLifecycle(q.action)) {
    // A key without the grant is refused before its rule is read, as today
    // and as the decision does: it lacks the permission either way.
    if (!slugHolds) return INSUFFICIENT;
    const outcome = await askRule(actor, q.action, target);
    const today = outcomeAllows(outcome);
    return verdictOf(
      await deviate("lifecycle-judged-alone", today, () =>
        decidedFrom(actor, q.action, target, outcome)
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
function outcomeAllows(outcome: RuleOutcome): boolean {
  if (!outcome.declared) return true;
  return !("threw" in outcome) && outcome.value === true;
}

/**
 * The decision's answer from the action rule's outcome the gate has already
 * asked, so the rule runs once however its answer is compared. For a publish
 * or an unpublish its own rule lets through, the update rule, which the gate
 * itself does not ask, is asked here.
 */
async function decidedFrom(
  actor: Exclude<Actor, { kind: "system" }>,
  action: AccessOperation,
  target: AccessTarget,
  outcome: RuleOutcome
): Promise<boolean> {
  const update =
    isLifecycle(action) && outcomeAllows(outcome)
      ? await askRule(actor, "update", target)
      : undefined;
  return judge(actor, action, target, { action: outcome, update }).allowed;
}

/** How a signed-in user's verdict is asked, by what the target declares. */
interface UserAsk {
  readonly q: CollectionQuestion;
  readonly target: AccessTarget;
  readonly userId: string;
  /** The user's whole actor, resolved only where a rule needs its context. */
  readonly looked: () => Promise<UserActor>;
}

async function userVerdict(
  q: CollectionQuestion,
  target: AccessTarget,
  user: { id: string }
): Promise<GateVerdict> {
  const ask: UserAsk = {
    q,
    target,
    userId: user.id,
    looked: () => actorForUser(user.id, { executor: q.executor }),
  };
  try {
    if (!q.rules) return await withoutServiceVerdict(ask);
    if (!declaresRule(target, q.action)) return await ruleLessVerdict(ask);
    const plain = plainRule(target, q.action);
    if (plain !== undefined) return await plainRuleVerdict(ask, plain);
    return await ruleVerdict(ask);
  } catch (error) {
    return { allowed: false, refusal: "failed", error };
  }
}

/** Without the service, today's answer, which reads no rule. */
async function withoutServiceVerdict({
  q,
  target,
  looked,
}: UserAsk): Promise<GateVerdict> {
  const today = await q.permissionWithoutService();
  return verdictOf(
    await deviate("no-service", today, () =>
      decided(looked(), q.action, target)
    )
  );
}

/**
 * With no rule for the action, the decision is the permission alone,
 * super-admin authority included, so the targeted check answers it without
 * loading the caller's every role and grant.
 */
async function ruleLessVerdict({
  q,
  target,
  userId,
  looked,
}: UserAsk): Promise<GateVerdict> {
  const holds = await userHoldsPermission(userId, q.action, q.slug, {
    executor: q.executor,
  });
  if (!isLifecycle(q.action)) return verdictOf(holds);
  return verdictOf(
    await deviate("lifecycle-judged-alone", holds, () =>
      decided(looked(), q.action, target)
    )
  );
}

/**
 * A plain yes or no reads nothing of the caller, so only super-admin
 * authority, which passes every rule, is looked up, through its cached check.
 * A user named by no id holds nothing.
 */
async function plainRuleVerdict(
  { q, target, userId, looked }: UserAsk,
  plain: boolean
): Promise<GateVerdict> {
  if (!userId) return INSUFFICIENT;
  if (await userIsSuperAdmin(userId, { executor: q.executor })) {
    return ALLOWED;
  }
  return verdictOf(
    await deviate("rule-alone-for-people", plain, () =>
      decided(looked(), q.action, target)
    )
  );
}

/** A rule function, handed the caller's roles and permissions. */
async function ruleVerdict({
  q,
  target,
  userId,
  looked,
}: UserAsk): Promise<GateVerdict> {
  // A user named by no id holds nothing, and a super-admin passes every rule:
  // neither asks the rule, nor needs the caller's whole access read for it.
  if (!userId) return INSUFFICIENT;
  if (await userIsSuperAdmin(userId, { executor: q.executor })) {
    return ALLOWED;
  }
  const actor = await looked();
  const outcome = await askRule(actor, q.action, target);
  const today =
    outcome.declared && !("threw" in outcome) && Boolean(outcome.value);
  return verdictOf(
    await deviate("rule-alone-for-people", today, () =>
      decidedFrom(actor, q.action, target, outcome)
    )
  );
}
