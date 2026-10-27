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
 *   publish or an unpublish is judged on top of update: it needs the update
 *   permission as well as its own, and where the target declares an update
 *   rule, that rule must answer `true` too.
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

/** A collection or a Single, with the code rules it declares. */
export interface AccessTarget {
  readonly kind: "collection" | "single";
  readonly slug: string;
  readonly access?: CollectionAccessControl | SingleAccessControl;
}

/**
 * What a target's rule answered, as it answered it.
 *
 * Kept raw, so a caller that must reproduce how a door judges the answer
 * today (truthy, `=== true`, `=== false` or `!== false`) can do so from one
 * call of the rule, and the decision below judges it one way only.
 */
export type RuleOutcome =
  | { readonly declared: false }
  | { readonly declared: true; readonly value: unknown }
  | { readonly declared: true; readonly threw: true };

export type RefusalReason =
  | "visitor-cannot-publish"
  | "principal-cannot-publish"
  | "principal-without-rule"
  | "no-permission"
  | "rule-refused"
  | "rule-threw"
  | "update-rule-refused"
  | "update-rule-threw";

/**
 * Allowed, or refused with the reason. `filter` is where a rule's row filter
 * will go once rules may answer with one; no rule answers with one yet.
 */
export type Decision =
  | { readonly allowed: true; readonly filter?: undefined }
  | { readonly allowed: false; readonly reason: RefusalReason };

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
 * having thrown.
 */
export async function askRule(
  actor: Exclude<Actor, SystemActor>,
  action: AccessAction,
  target: AccessTarget
): Promise<RuleOutcome> {
  const rule = ruleFor(target, action);
  if (rule === undefined) return { declared: false };
  if (typeof rule === "boolean") return { declared: true, value: rule };
  try {
    const value: unknown = await rule(ruleContext(actor, action, target));
    return { declared: true, value };
  } catch (error) {
    // A broken rule refuses, and is logged so it can be found and fixed.
    consoleLogger.error(
      `[rbac] Code access function for ${action}:${target.slug} threw`,
      { error }
    );
    return { declared: true, threw: true };
  }
}

/**
 * Whether a rule's outcome lets the action through: no rule adds no limit,
 * and a declared rule must answer exactly `true`. Anything else refuses,
 * `null`, `undefined` and a truthy non-boolean included.
 */
function ruleRefusal(outcome: RuleOutcome): RefusalReason | null {
  if (!outcome.declared) return null;
  if ("threw" in outcome) return "rule-threw";
  return outcome.value === true ? null : "rule-refused";
}

const isLifecycle = (action: AccessAction) =>
  action === "publish" || action === "unpublish";

/**
 * What the target's rules answered for one question: the action's own rule,
 * and, for a publish or an unpublish its own rule let through, the update
 * rule as well. A rule the judgement never reaches is never asked.
 */
export interface RuleOutcomes {
  readonly action: RuleOutcome;
  readonly update?: RuleOutcome;
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
  // A publish or an unpublish changes the entry, so it is an update first.
  if (isLifecycle(action) && !holdsPermission(actor, "update", target.slug)) {
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
  const outcome = await askRule(actor, action, target);
  if (actor.kind === "principal" || !isLifecycle(action)) {
    return { action: outcome };
  }
  // The update rule is read only when the action's own rule lets it through.
  if (ruleRefusal(outcome)) return { action: outcome };
  return { action: outcome, update: await askRule(actor, "update", target) };
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
  if (actor.kind === "principal") {
    if (!outcomes.action.declared) return refuse("principal-without-rule");
    const refusal = ruleRefusal(outcomes.action);
    return refusal ? refuse(refusal) : ALLOW;
  }
  const refusal = ruleRefusal(outcomes.action);
  if (refusal) return refuse(refusal);
  if (isLifecycle(action)) {
    // A change judged without its update rule could be one that rule refuses.
    if (!outcomes.update) {
      throw NextlyError.internal({
        logContext: {
          reason: "access-update-rule-not-asked",
          action,
          target: target.slug,
        },
      });
    }
    const update = ruleRefusal(outcomes.update);
    // Kept apart, so the log tells a failing update rule from a refusing one.
    if (update === "rule-threw") return refuse("update-rule-threw");
    if (update) return refuse("update-rule-refused");
  }
  return ALLOW;
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
  return holdsPermission(actor, action, resource) ||
    holdsByManage(actor, action, resource)
    ? ALLOW
    : refuse("no-permission");
}
