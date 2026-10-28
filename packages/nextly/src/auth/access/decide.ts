/**
 * The one access decision: may this actor perform this action on this target?
 *
 * The answer follows one composition for every caller:
 *
 * - trusted server work is allowed;
 * - a visitor never publishes or unpublishes;
 * - a plugin's person holds no role, so the target's rule decides alone, a
 *   target that declares none refuses, and a person never publishes or
 *   unpublishes;
 * - a super-admin passes every collection and Single rule;
 * - everyone else needs the permission for the action, AND, where the target
 *   declares a rule for the action, a rule that answers exactly `true`. A
 *   publish or an unpublish is judged by its own permission and its own rule,
 *   as any other action is;
 * - a collection's read, update, delete, publish or unpublish rule may answer
 *   a filter instead of `true`, which allows only the entries the filter
 *   matches. The decision then refuses the action for every entry and names
 *   the filter, so a way in that cannot apply it refuses by reading `allowed`
 *   alone.
 *
 * The decision makes no queries: the actor already carries everything it
 * reads. It never knows which way in asked, and each way in presents the
 * answer as its door needs. The reason a refusal carries is for the server
 * log, never for the response.
 */
import { NextlyError } from "../../errors/nextly-error";
import { consoleLogger } from "../../shared/types";
import type {
  AccessControlFunction,
  CollectionAccessControl,
  SingleAccessControl,
} from "../../shared/types/access";

import {
  holdsByManage,
  holdsPermission,
  isSuperAdmin,
  ruleContext,
  type AccessAction,
  type Actor,
  type SystemActor,
} from "./actor";
import { MANAGE_BRIDGED_ACTIONS, isRetiredManage } from "./manage-bridge";
import {
  mayAnswerFilter,
  reportRuleFilterMisuse,
  ruleAnswer,
  type RuleAnswer,
  type RuleFilter,
} from "./rule-answer";

/** A collection or a Single, with the code rules it declares. */
export interface AccessTarget {
  readonly kind: "collection" | "single";
  readonly slug: string;
  readonly access?: CollectionAccessControl | SingleAccessControl;
}

/**
 * What a target's rule answered, as it answered it, and what that means.
 *
 * The raw value is kept for a way in that words a notice about it. Its
 * meaning, read once when the rule was asked, is what every judgement reads
 * ({@link outcomeAnswer}), so a getter or a proxy in the answer cannot tell
 * one judgement something different from the next.
 */
export type RuleOutcome =
  | { readonly declared: false }
  | {
      readonly declared: true;
      readonly value: unknown;
      /** The value's meaning, read when the rule was asked. */
      readonly answer?: RuleAnswer;
    }
  | { readonly declared: true; readonly threw: true };

/** What a rule's outcome means: the meaning read when it was asked. */
export function outcomeAnswer(
  outcome: Extract<RuleOutcome, { readonly value: unknown }>
): RuleAnswer {
  return outcome.answer ?? ruleAnswer(outcome.value);
}

export type RefusalReason =
  | "visitor-cannot-publish"
  | "principal-cannot-publish"
  | "principal-without-rule"
  | "no-permission"
  | "rule-refused"
  | "rule-threw"
  // A rule answered a filter that is not well formed.
  | "rule-filter-malformed"
  // A create rule or a Single's rule answered a filter, which only a
  // collection's read, update, delete, publish and unpublish rules may.
  | "rule-filter-misplaced";

/**
 * Allowed for every entry, refused with the reason, or allowed only for the
 * entries `filter` matches.
 *
 * The last is not `allowed`: `allowed` means every entry, and a way in that
 * does not apply the filter must refuse, which it does by reading `allowed`
 * alone. Only a way in that applies filters reads `filter`.
 */
export type Decision =
  | { readonly allowed: true }
  | { readonly allowed: false; readonly reason: RefusalReason }
  | {
      readonly allowed: false;
      readonly reason: "only-matching-entries";
      readonly filter: RuleFilter;
    };

const ALLOW: Decision = Object.freeze({ allowed: true });

function refuse(reason: RefusalReason): Decision {
  return { allowed: false, reason };
}

function ruleFor(
  target: AccessTarget,
  action: AccessAction
): AccessControlFunction | boolean | undefined {
  // A Single declares no create or delete rule; asked one, it has none.
  const access:
    | Partial<Record<AccessAction, AccessControlFunction | boolean>>
    | undefined = target.access;
  return access?.[action];
}

/** Whether the target declares a rule for `action`. */
export function declaresRule(
  target: AccessTarget,
  action: AccessAction
): boolean {
  return ruleFor(target, action) !== undefined;
}

/**
 * The yes or no a target declares for `action`, when its rule is a plain
 * boolean, which reads nothing of the caller; `undefined` otherwise.
 */
export function plainRule(
  target: AccessTarget,
  action: AccessAction
): boolean | undefined {
  const rule = ruleFor(target, action);
  return typeof rule === "boolean" ? rule : undefined;
}

/**
 * Asks the target's rule for `action` about this actor, once, and returns
 * what it said. A rule that throws, or whose promise rejects, is reported as
 * having thrown, and a filter it may not answer, or one that is not well
 * formed, is reported as misused.
 */
export async function askRule(
  actor: Exclude<Actor, SystemActor>,
  action: AccessAction,
  target: AccessTarget
): Promise<RuleOutcome> {
  const rule = ruleFor(target, action);
  if (rule === undefined) return { declared: false };
  if (typeof rule === "boolean") return { declared: true, value: rule };
  let value: unknown;
  try {
    value = await rule(ruleContext(actor, action, target));
  } catch (error) {
    // A broken rule refuses, and is logged so it can be found and fixed.
    consoleLogger.error(
      `[rbac] Code access function for ${action}:${target.slug} threw`,
      { error }
    );
    return { declared: true, threw: true };
  }
  // Read once, here, and kept with the outcome for every judgement of it.
  const answer = ruleAnswer(value);
  reportRuleFilterMisuse(target.slug, action, target.kind, answer);
  return { declared: true, value, answer };
}

/**
 * Whether the rule `target` declares for `action` refuses, from its outcome:
 * no rule adds no limit, and a declared rule must answer exactly `true` or a
 * well-formed filter it may answer. Anything else refuses, `null`,
 * `undefined` and a truthy non-boolean included, and so does a filter from a
 * rule that may not answer one (a create rule, a Single's). A filter it may
 * answer is not a refusal here; {@link filterOf} reads it.
 */
function ruleRefusal(
  outcome: RuleOutcome,
  target: AccessTarget,
  action: AccessAction
): RefusalReason | null {
  if (!outcome.declared) return null;
  if ("threw" in outcome) return "rule-threw";
  const answer = outcomeAnswer(outcome);
  if (answer.kind === "allow") return null;
  if (answer.kind === "filter") {
    return mayAnswerFilter(target.kind, action)
      ? null
      : "rule-filter-misplaced";
  }
  return answer.kind === "malformed-filter"
    ? "rule-filter-malformed"
    : "rule-refused";
}

/** The filter a rule's outcome answered, or `undefined` for none. */
function filterOf(outcome: RuleOutcome | undefined): RuleFilter | undefined {
  if (!outcome?.declared || "threw" in outcome) return undefined;
  const answer = outcomeAnswer(outcome);
  return answer.kind === "filter" ? answer.filter : undefined;
}

/**
 * The decision once the action's rule has let it through: allowed for every
 * entry, or only for the entries the filter it answered matches. A filter
 * from a rule that may not answer one refuses.
 */
function withFilter(
  target: AccessTarget,
  action: AccessAction,
  filter: RuleFilter | undefined
): Decision {
  if (filter === undefined) return ALLOW;
  if (!mayAnswerFilter(target.kind, action)) {
    return refuse("rule-filter-misplaced");
  }
  return { allowed: false, reason: "only-matching-entries", filter };
}

const isLifecycle = (action: AccessAction) =>
  action === "publish" || action === "unpublish";

/**
 * What the target's rules answered for one question: the action's own rule.
 * A rule the judgement never reaches is never asked.
 */
export interface RuleOutcomes {
  readonly action: RuleOutcome;
}

/**
 * The answer reached before any rule is read, or `null` when the rules
 * decide. One function for both the asking and the judging, so the rules
 * asked are exactly the ones the judgement reads.
 */
function beforeRules(
  actor: Actor,
  action: AccessAction,
  target: AccessTarget
): Decision | null {
  if (actor.kind === "system") return ALLOW;
  if (actor.kind === "principal") {
    return isLifecycle(action) ? refuse("principal-cannot-publish") : null;
  }
  if (actor.kind === "visitor" && isLifecycle(action)) {
    return refuse("visitor-cannot-publish");
  }
  if (isSuperAdmin(actor)) return ALLOW;
  return permissionRefusal(actor, action, target);
}

/** Refused for a missing permission, or `null` when the actor holds it. */
function permissionRefusal(
  actor: Actor,
  action: AccessAction,
  target: AccessTarget
): Decision | null {
  if (!holdsPermission(actor, action, target.slug)) {
    return refuse("no-permission");
  }
  return null;
}

/**
 * Asks the rules this decision reads, each at most once, and returns what
 * they said; `null` when the answer is reached without them. A way in that
 * must reproduce how it judges a rule today asks once here and hands the same
 * outcomes to {@link judge} and to its own judgement, so an app's rule runs no
 * more often than it did.
 */
export async function askRules(
  actor: Actor,
  action: AccessAction,
  target: AccessTarget
): Promise<RuleOutcomes | null> {
  if (actor.kind === "system" || beforeRules(actor, action, target)) {
    return null;
  }
  return { action: await askRule(actor, action, target) };
}

/**
 * The decision, from the rules' outcomes {@link askRules} gathered for the
 * same actor, action and target. It asks nothing and makes no queries.
 */
export function judge(
  actor: Actor,
  action: AccessAction,
  target: AccessTarget,
  outcomes: RuleOutcomes | null
): Decision {
  const early = beforeRules(actor, action, target);
  if (early) return early;
  if (outcomes === null) {
    throw NextlyError.internal({
      logContext: {
        reason: "access-rules-not-asked",
        action,
        target: target.slug,
      },
    });
  }
  if (actor.kind === "principal" && !outcomes.action.declared) {
    return refuse("principal-without-rule");
  }
  const refusal = ruleRefusal(outcomes.action, target, action);
  if (refusal) return refuse(refusal);
  return withFilter(target, action, filterOf(outcomes.action));
}

export async function decide(
  actor: Actor,
  action: AccessAction,
  target: AccessTarget
): Promise<Decision> {
  return judge(actor, action, target, await askRules(actor, action, target));
}

/**
 * The decision where no rule can apply: a resource that is not an entry, such
 * as settings, roles or email providers, or an action no rule is declared for,
 * such as `manage`. The permission alone answers: trusted work is allowed, a
 * super-admin is allowed, a plugin's person, who holds no role and meets no
 * rule here, is refused, and anyone else needs the permission, which on a
 * system resource its `manage-` permission also gives ({@link holdsByManage}).
 */
export function decidePermission(
  actor: Actor,
  action: string,
  resource: string
): Decision {
  if (actor.kind === "system") return ALLOW;
  if (actor.kind === "principal") return refuse("principal-without-rule");
  if (isSuperAdmin(actor)) return ALLOW;
  // A retired `manage-` permission, asked by a gate written before it was
  // retired, is answered by the plain four it stood for, each counted as
  // below: an unconverted role's `manage-` permission still holds all four.
  if (isRetiredManage(action, resource)) {
    return MANAGE_BRIDGED_ACTIONS.every(
      plain => decidePermission(actor, plain, resource).allowed
    )
      ? ALLOW
      : refuse("no-permission");
  }
  return holdsPermission(actor, action, resource) ||
    holdsByManage(actor, action, resource)
    ? ALLOW
    : refuse("no-permission");
}
