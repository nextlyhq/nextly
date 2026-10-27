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
import type { AccessOperation } from "../../services/access/types";
import {
  apiKeyWriteAllowed,
  scopeHoldsSuperAdmin,
  scopeRowsAgree,
  slugGrants,
  type AuthenticatedScope,
} from "../authenticated-scope";
import { effectiveCallerScope } from "../caller-scope";

import {
  holdsPermission,
  isSuperAdmin,
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
  outcomeAnswer,
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
import { allowsSome, mayAnswerFilter, type RuleFilter } from "./rule-answer";
import {
  noticePermissionNowComesFirst,
  noticeRuleNoLongerAllows,
} from "./rule-answer-log";
import { askReadAsPlainRead } from "./rule-language";

/**
 * Allowed, refused with the kind of refusal the gate words, or allowed only
 * for the entries a read rule's filter matches. The last is handed only to an
 * asker that applies the filter ({@link GateQuestion.appliesFilter}), and is
 * not `allowed`, which means every entry.
 */
export type GateVerdict =
  | { readonly allowed: true }
  | {
      readonly allowed: false;
      readonly refusal: "only-matching-entries";
      readonly filter: RuleFilter;
    }
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

/**
 * The filter a collection's read rule answered, where it answered a
 * well-formed one; `undefined` for any other answer, action or target.
 */
function readFilterOf(
  target: AccessTarget,
  action: AccessOperation,
  outcome: RuleOutcome
): RuleFilter | undefined {
  if (action !== "read" || !mayAnswerFilter(target.kind, action)) return;
  if (!outcome.declared || "threw" in outcome) return;
  const answer = outcomeAnswer(outcome);
  return answer.kind === "filter" ? answer.filter : undefined;
}

/**
 * A read rule's filter as the gate answers it: the filter, to an asker that
 * applies it, and a refusal to any other. That refusal differs from the
 * decision, which allows the entries the filter matches to a caller it lets
 * read the collection (`decisionAllows`), so it is recorded as the deviation
 * it is.
 */
async function onlyMatching(
  q: GateQuestion,
  filter: RuleFilter,
  decisionAllows: boolean
): Promise<GateVerdict> {
  if (q.appliesFilter) {
    return { allowed: false, refusal: "only-matching-entries", filter };
  }
  await deviate("filter-not-applied", false, () => decisionAllows);
  return INSUFFICIENT;
}

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
  /**
   * The asker applies a collection read rule's filter to the entries it
   * reads, so the gate hands the filter back. Any other asker is refused it,
   * as it cannot limit what it reads to the entries the filter matches.
   */
  readonly appliesFilter?: boolean;
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
  allowsSome(
    await decide(await actor, action, targetAsDeclared(target)),
    action
  );

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
      q,
      await decide(actorForPrincipal(q.principal), q.action, target)
    );
  }
  return staffOrVisitorVerdict(kind, q, target);
}

/**
 * The verdict for a signed-in user, an API key or a visitor. A user is judged
 * by the roles their lookup finds: role names on the `user` a caller hands in
 * grant nothing, so super-admin authority is decided in one place.
 */
async function staffOrVisitorVerdict(
  kind: "collection" | "single",
  q: GateQuestion,
  target: AccessTarget
): Promise<GateVerdict> {
  const keyScope = q.scope?.actorType === "apiKey" ? q.scope : undefined;
  if (q.routeAuthorized) return routeAuthorizedVerdict(kind, q, target);
  if (!q.user) return visitorVerdict(kind, q, target);
  if (keyScope) return keyVerdict(q, target, keyScope, q.user);
  return userVerdict(q, target, q.user);
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

/**
 * The decision's answer as the gate gives it. A filter it names for a read is
 * handed to an asker that applies it; a write rule's filter is not applied
 * yet, so it refuses.
 */
function answerOf(q: GateQuestion, decision: Decision): Promise<GateVerdict> {
  if (
    !decision.allowed &&
    decision.reason === "only-matching-entries" &&
    q.action === "read"
  ) {
    return onlyMatching(q, decision.filter, true);
  }
  return Promise.resolve(verdictOf(decision.allowed));
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
  const filter = readFilterOf(target, q.action, outcome);
  if (filter) return visitorFilterVerdict(q, target, outcome, filter);
  // Otherwise a declared rule lets a visitor through only by answering
  // `true`.
  if (!outcomeAllows(outcome)) {
    noticeWhereRuleAllowedBefore(outcome, allowedVisitorBefore, q, "visitor");
    return INSUFFICIENT;
  }
  return visitorPassVerdict(q, target, outcome.declared);
}

/**
 * A visitor whose read rule answered a filter. An asker that applies it shows
 * the visitor the entries it matches, as the public default shows every entry
 * for a rule answering `true`, where the decision reads the Public role's
 * permissions. Any other asker refuses, as the decision does.
 */
async function visitorFilterVerdict(
  q: GateQuestion,
  target: AccessTarget,
  outcome: RuleOutcome,
  filter: RuleFilter
): Promise<GateVerdict> {
  if (q.appliesFilter) {
    await deviate("visitor-public-default", true, () =>
      decided(actorForVisitor(), q.action, target)
    );
  } else {
    noticeWhereRuleAllowedBefore(outcome, allowedVisitorBefore, q, "visitor");
  }
  return onlyMatching(q, filter, false);
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
  // A key carrying its maker's super-admin authority passes every collection
  // and Single rule, as the decision gives a super-admin.
  if (isSuperAdmin(actor)) return ALLOWED;
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
        superAdmin: scopeHoldsSuperAdmin(scope),
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
  if (q.rules) return answerOf(q, answer);
  // Without the service no rule is read, where the decision reads the rules
  // the target declares.
  return verdictOf(
    await deviate("no-service", answer.allowed, () =>
      decided(actor, q.action, target)
    )
  );
}

/**
 * A rule allows every entry only by answering `true`; no rule adds no limit.
 * A filter allows only the entries it matches, which this gate does not
 * apply, so it refuses.
 */
function outcomeAllows(outcome: RuleOutcome): boolean {
  if (!outcome.declared) return true;
  return !("threw" in outcome) && outcomeAnswer(outcome).kind === "allow";
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
  noticeRuleNoLongerAllows(
    q.slug,
    q.action,
    caller,
    outcome.value,
    outcomeAnswer(outcome)
  );
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
  const filter = readFilterOf(target, q.action, outcome);
  if (filter) {
    if (!q.appliesFilter) {
      noticeWhereRuleAllowedBefore(
        outcome,
        allowedUserBefore,
        q,
        "signed-in user"
      );
    }
    return onlyMatching(q, filter, true);
  }
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
 * are known. Trusted work holds it. `false` where the caller certainly lacks
 * it: no user, who never publishes or unpublishes, a signed-in user without
 * the permission, or a key whose grants do not hold it. Anything else is left
 * to the full gate, which a caller refused here is asked too, so the refusal
 * reads as that gate words it.
 */
export async function holdsGrant(params: {
  action: AccessOperation;
  slug: string;
  user?: { id?: string; roles?: readonly string[] } | null;
  overrideAccess?: boolean;
  authenticatedScope?: AuthenticatedScope;
}): Promise<boolean> {
  if (params.overrideAccess) return true;
  const userId = params.user?.id;
  if (!userId) return false;
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
