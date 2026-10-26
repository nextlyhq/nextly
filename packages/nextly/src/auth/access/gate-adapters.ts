/**
 * The collection gate's and the Single gate's answers, asked of the one
 * decision.
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
  scopeRowsAgree,
  slugGrants,
  type AuthenticatedScope,
} from "../authenticated-scope";
import { effectiveCallerScope } from "../caller-scope";

import {
  holdsPermission,
  type Actor,
  type KeyActor,
  type UserActor,
} from "./actor";
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
import { targetAsDeclared } from "./declared-rules";
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
import {
  noticePermissionNowComesFirst,
  noticeRuleNoLongerAllows,
} from "./rule-answer-log";
import { askReadAsPlainRead } from "./rule-language";

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

/**
 * How a gate answers a refusal: `failed` when the caller's access could not
 * be read, `missing` when the caller named one entry it may not read (it is
 * answered exactly as a missing entry is), else `refused`, in words.
 */
export type RefusalAnswer =
  | { readonly answer: "failed"; readonly error: unknown }
  | { readonly answer: "missing" }
  | { readonly answer: "refused" };

/**
 * The answer to `refused`, a refusal of `action`. A caller that names one
 * entry (`namesOne`) and was refused it for want of a grant is asked whether it
 * may read it, as a plain read is asked: one it may not read is answered as
 * missing, so the refusal does not confirm the entry exists. `ask` asks the
 * gate's own question about another action.
 */
export async function answerForRefusal(
  refused: Extract<GateVerdict, { allowed: false }>,
  action: string,
  namesOne: boolean,
  ask: (action: "read") => Promise<GateVerdict>
): Promise<RefusalAnswer> {
  if (refused.refusal === "failed") {
    return { answer: "failed", error: refused.error };
  }
  if (!namesOne || refused.refusal !== "insufficient") {
    return { answer: "refused" };
  }
  const read = action === "read" ? refused : await askReadAsPlainRead(ask);
  if (read.allowed) return { answer: "refused" };
  if (read.refusal === "failed") return { answer: "failed", error: read.error };
  return { answer: "missing" };
}

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

/** What a gate is asked, as it is asked it. */
export interface GateQuestion {
  readonly slug: string;
  readonly action: AccessOperation;
  readonly user?: { id: string; role?: string; roles?: string[] };
  readonly routeAuthorized?: boolean;
  /**
   * The key scope in force. For a collection, the caller's own, else the
   * request's; a Single reads only the caller's own.
   */
  readonly scope?: AuthenticatedScope;
  /** The plugin person the call is made as, if any. */
  readonly principal: Principal | null;
  /** The caller's transaction, when the gate is asked inside one. */
  readonly executor?: unknown;
  /** The access-control service's rules; absent without the service. */
  readonly rules?: RuleSource;
  /**
   * Without the access-control service, whether a signed-in user may: for a
   * collection, the permission read from the gate's own database.
   */
  readonly permissionWithoutService: () => Promise<boolean>;
}

/** What the collection gate is asked. */
export type CollectionQuestion = GateQuestion;

/** What the Single gate is asked. */
export type SingleQuestion = Omit<GateQuestion, "permissionWithoutService">;

/**
 * The decision's answer, for a deviation to compare today's against: with the
 * rules the target declares, whether or not this gate has the service that
 * reads them.
 */
const decided = async (
  actor: Actor | Promise<Actor>,
  action: AccessOperation,
  target: AccessTarget
): Promise<boolean> =>
  (await decide(await actor, action, targetAsDeclared(target))).allowed;

export function collectionGateVerdict(
  q: CollectionQuestion
): Promise<GateVerdict> {
  return gateVerdict("collection", q);
}

/**
 * The Single gate's answer. A call that names no key scope is judged under the
 * one in force, as the collection gate judges it: inside a request that arrived
 * on a key, the key, not the person who made it.
 */
export async function singleGateVerdict(
  q: SingleQuestion
): Promise<GateVerdict> {
  return gateVerdict("single", {
    ...q,
    scope: effectiveCallerScope(q.scope),
    // Without the service a signed-in user is allowed, the permission unread.
    permissionWithoutService: () => Promise.resolve(true),
  });
}

/**
 * The registered target, as the access-control service resolves it; one with
 * no rules where nothing is registered, as without the service.
 */
function registeredTarget(
  kind: "collection" | "single",
  q: GateQuestion
): AccessTarget {
  return q.rules?.getRegisteredTarget(q.slug) ?? { kind, slug: q.slug };
}

async function gateVerdict(
  kind: "collection" | "single",
  q: GateQuestion
): Promise<GateVerdict> {
  const target = registeredTarget(kind, q);
  // A plugin's person is judged by the rule alone, and a target that declares
  // none, as every target does without the service, refuses them.
  if (q.principal !== null) {
    return answerOf(
      await decide(actorForPrincipal(q.principal), q.action, target)
    );
  }
  return staffOrVisitorVerdict(kind, q, target);
}

/** The verdict for a signed-in user, an API key or a visitor. */
async function staffOrVisitorVerdict(
  kind: "collection" | "single",
  q: GateQuestion,
  target: AccessTarget
): Promise<GateVerdict> {
  const keyScope = q.scope?.actorType === "apiKey" ? q.scope : undefined;
  if (!keyScope && (await claimedSuperAdmin(q, target))) return ALLOWED;
  if (q.routeAuthorized) return routeAuthorizedVerdict(kind, q, target);
  if (!q.user) return visitorVerdict(kind, q, target);
  if (keyScope) return keyVerdict(q, target, keyScope, q.user);
  return userVerdict(q, target, q.user);
}

/**
 * A super-admin role named on the `user` a caller hands in passes without a
 * lookup, as it always has.
 */
async function claimedSuperAdmin(
  q: GateQuestion,
  target: AccessTarget
): Promise<boolean> {
  const user = q.user;
  if (!user || !isSuperAdminContext(user)) return false;
  return deviate("claimed-super-admin", true, () =>
    decided(actorForUser(user.id, { executor: q.executor }), q.action, target)
  );
}

/**
 * The route gate already decided for the user it authenticated; a route that
 * authenticated nobody cannot vouch for anyone. A Single still gives such a
 * request the visitor's answer, as it always has.
 */
async function routeAuthorizedVerdict(
  kind: "collection" | "single",
  q: GateQuestion,
  target: AccessTarget
): Promise<GateVerdict> {
  if (q.user) return ALLOWED;
  if (kind === "collection") return UNAUTHENTICATED;
  const today = await visitorVerdict(kind, q, target);
  await deviate("single-route-authorized-visitor", today.allowed, () => false);
  return today;
}

function answerOf(decision: Decision): GateVerdict {
  return verdictOf(decision.allowed);
}

async function visitorVerdict(
  kind: "collection" | "single",
  q: GateQuestion,
  target: AccessTarget
): Promise<GateVerdict> {
  // A Single refuses a visitor's publish before asking its rule.
  if (kind === "single" && isLifecycle(q.action)) return UNAUTHENTICATED;
  const visitor = actorForVisitor();
  const outcome = await askRule(visitor, q.action, target);
  // A rule that answers `false` or fails refuses a visitor outright, and a
  // publish or an unpublish needs a signed-in user whatever the rule says.
  if (outcome.declared && ("threw" in outcome || outcome.value === false)) {
    return INSUFFICIENT;
  }
  if (isLifecycle(q.action)) return UNAUTHENTICATED;
  // Otherwise a declared rule lets a visitor through only by answering
  // `true`.
  if (!outcomeAllows(outcome)) {
    noticeWhereRuleAllowedBefore(outcome, allowedVisitorBefore, q, "visitor");
    return INSUFFICIENT;
  }
  return visitorPassVerdict(q, target, outcome.declared);
}

/**
 * A visitor whose rule did not refuse: no rule for the action, or one that
 * answered `true`.
 *
 * Only a read keeps the public default. Every other action changes data, so
 * with no rule naming it the write needs a signed-in caller: an anonymous
 * create, update or delete is allowed only where the target's author wrote a
 * rule that answers `true`. Asked of every action but a read, so an action
 * added later is refused rather than let through.
 */
async function visitorPassVerdict(
  q: GateQuestion,
  target: AccessTarget,
  ruleDeclared: boolean
): Promise<GateVerdict> {
  const visitor = actorForVisitor();
  if (q.action === "read") {
    return verdictOf(
      await deviate("visitor-public-default", true, () =>
        decided(visitor, q.action, target)
      )
    );
  }
  if (!ruleDeclared) return UNAUTHENTICATED;
  return verdictOf(
    await deviate("visitor-write-by-rule", true, () =>
      decided(visitor, q.action, target)
    )
  );
}

async function keyVerdict(
  q: GateQuestion,
  target: AccessTarget,
  scope: AuthenticatedScope,
  user: { id: string; roles?: string[] }
): Promise<GateVerdict> {
  const rows = scopeRowsAgree(scope);
  const actor = keyActorOf(scope, user);
  // A key holds an action by its stored slug, `<action>-<target>`. The
  // decision reads the grant's action and target, which agree with the slug
  // unless the grant was stored under a slug of its own.
  const slugHolds = scope.permissions.includes(
    permissionSlug(q.action, q.slug)
  );
  if (!rows || slugHolds !== holdsPermission(actor, q.action, q.slug)) {
    return slugJudgedVerdict(q, target, scope, user, actor);
  }
  return grantJudgedVerdict(q, target, actor, slugHolds);
}

/** The key a scope stands for, from its grant rows or, without them, its slugs. */
function keyActorOf(
  scope: AuthenticatedScope,
  user: { id: string; roles?: string[] }
): KeyActor {
  return scopeRowsAgree(scope)
    ? actorForScope(scope, user)
    : actorForKey({
        keyId: "",
        userId: user.id,
        grants: slugGrants(scope.permissions),
        roles: scope.roles ?? user.roles ?? [],
      });
}

/**
 * Judged on the stored slugs, as before: a scope without the rows its slugs
 * came from, one whose slugs were narrowed apart from its rows, or a grant
 * stored under a slug of its own.
 */
async function slugJudgedVerdict(
  q: GateQuestion,
  target: AccessTarget,
  scope: AuthenticatedScope,
  user: { id: string; roles?: string[] },
  actor: KeyActor
): Promise<GateVerdict> {
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

/** A key whose slugs and grant rows agree on the action. */
async function grantJudgedVerdict(
  q: GateQuestion,
  target: AccessTarget,
  actor: KeyActor,
  slugHolds: boolean
): Promise<GateVerdict> {
  if (isLifecycle(q.action)) {
    // A key without the grant is refused before its rule is read, as today
    // and as the decision does: it lacks the permission either way.
    if (!slugHolds) return INSUFFICIENT;
    return verdictOf(outcomeAllows(await askRule(actor, q.action, target)));
  }
  const answer = judge(
    actor,
    q.action,
    target,
    await askRules(actor, q.action, target)
  );
  if (q.rules) return answerOf(answer);
  // Without the service no rule is read, where the decision reads the rules
  // the target declares.
  return verdictOf(
    await deviate("no-service", answer.allowed, () =>
      decided(actor, q.action, target)
    )
  );
}

/** A rule allows only by answering `true`; no rule adds no limit. */
function outcomeAllows(outcome: RuleOutcome): boolean {
  if (!outcome.declared) return true;
  return !("threw" in outcome) && outcome.value === true;
}

/**
 * Names a refusal this gate would have allowed before, once. `allowedBefore`
 * says how this caller's answer was judged then, because the two callers
 * differed: a visitor was refused only by `false` or a throw, so `null` and
 * `undefined` let it through, while a signed-in user was judged truthy, so
 * those refused it already. A throw refused both then and now.
 */
function noticeWhereRuleAllowedBefore(
  outcome: RuleOutcome,
  allowedBefore: (value: unknown) => boolean,
  q: GateQuestion,
  caller: string
): void {
  if (!outcome.declared || "threw" in outcome) return;
  if (!allowedBefore(outcome.value)) return;
  noticeRuleNoLongerAllows(q.slug, q.action, caller, outcome.value);
}

/** A visitor's rule refused only by answering `false`. */
const allowedVisitorBefore = (value: unknown): boolean => value !== false;

/** A signed-in user's rule answer was judged truthy. */
const allowedUserBefore = (value: unknown): boolean => Boolean(value);

/** How a signed-in user's verdict is asked, by what the target declares. */
interface UserAsk {
  readonly q: CollectionQuestion;
  readonly target: AccessTarget;
  readonly userId: string;
  /** The user's whole actor, resolved only where a rule needs its context. */
  readonly looked: () => Promise<UserActor>;
}

async function userVerdict(
  q: GateQuestion,
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
async function ruleLessVerdict({ q, userId }: UserAsk): Promise<GateVerdict> {
  return verdictOf(
    await userHoldsPermission(userId, q.action, q.slug, {
      executor: q.executor,
    })
  );
}

/**
 * A plain yes or no reads nothing of the caller, so only super-admin
 * authority, which passes every rule, is looked up, through its cached check.
 * A user named by no id holds nothing.
 */
async function plainRuleVerdict(
  { q, userId }: UserAsk,
  plain: boolean
): Promise<GateVerdict> {
  if (!userId) return INSUFFICIENT;
  if (await userIsSuperAdmin(userId, { executor: q.executor })) {
    return ALLOWED;
  }
  // The permission first; a rule only narrows it. A rule of `false` refused
  // this caller before too, so its refusal is not named as new.
  const holds = await userHoldsPermission(userId, q.action, q.slug, {
    executor: q.executor,
  });
  if (!holds) return plain ? refusedWithoutPermission(q) : INSUFFICIENT;
  return verdictOf(plain);
}

/**
 * A signed-in user refused for want of the permission, where the target
 * declares a rule for the action: named once, since that rule used to decide
 * alone.
 */
function refusedWithoutPermission(q: GateQuestion): GateVerdict {
  noticePermissionNowComesFirst(q.slug, q.action, "signed-in user");
  return INSUFFICIENT;
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
  // The permission first: a user without it is refused before the rule is
  // asked, as the decision refuses.
  if (!holdsPermission(actor, q.action, q.slug)) {
    return refusedWithoutPermission(q);
  }
  const outcome = await askRule(actor, q.action, target);
  // The rule then lets the user through only by answering `true`.
  const allowed = outcomeAllows(outcome);
  if (!allowed) {
    noticeWhereRuleAllowedBefore(
      outcome,
      allowedUserBefore,
      q,
      "signed-in user"
    );
  }
  return verdictOf(allowed);
}

/**
 * Whether the caller holds the permission to `action` on `slug`, its rule not
 * read: asked of a publish or an unpublish of every language before the work
 * only that change needs, its rule being asked once the languages going live
 * are known. `false` only where the caller certainly lacks it, a signed-in
 * user without the permission or a key whose grants do not hold it; anything
 * else, trusted work included, is left to the full gate, which a caller
 * refused here is asked too, so the refusal reads as that gate words it.
 */
export async function holdsGrant(params: {
  action: AccessOperation;
  slug: string;
  user?: { id?: string; roles?: readonly string[] } | null;
  overrideAccess?: boolean;
  authenticatedScope?: AuthenticatedScope;
}): Promise<boolean> {
  const userId = params.user?.id;
  if (params.overrideAccess || !userId) return true;
  const scope = params.authenticatedScope;
  if (scope?.actorType === "apiKey") {
    try {
      return holdsPermission(
        actorForScope(scope, { id: userId, roles: params.user?.roles }),
        params.action,
        params.slug
      );
    } catch {
      return true;
    }
  }
  if (scope !== undefined && scope.actorType !== "user") return true;
  return userHoldsPermission(userId, params.action, params.slug);
}
