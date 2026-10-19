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
import type {
  AccessControlFunction,
  CollectionAccessControl,
  SingleAccessControl,
} from "../../shared/types/access";

import {
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
  | "update-rule-refused";

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
    const value: unknown = await rule(ruleContext(actor, action, target.slug));
    return { declared: true, value };
  } catch {
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

async function decidePrincipal(
  actor: Extract<Actor, { kind: "principal" }>,
  action: AccessAction,
  target: AccessTarget
): Promise<Decision> {
  if (isLifecycle(action)) return refuse("principal-cannot-publish");
  const outcome = await askRule(actor, action, target);
  if (!outcome.declared) return refuse("principal-without-rule");
  const refusal = ruleRefusal(outcome);
  return refusal ? refuse(refusal) : ALLOW;
}

export async function decide(
  actor: Actor,
  action: AccessAction,
  target: AccessTarget
): Promise<Decision> {
  if (actor.kind === "system") return ALLOW;
  if (actor.kind === "principal") return decidePrincipal(actor, action, target);
  if (actor.kind === "visitor" && isLifecycle(action)) {
    return refuse("visitor-cannot-publish");
  }
  if (isSuperAdmin(actor)) return ALLOW;
  if (!holdsPermission(actor, action, target.slug)) {
    return refuse("no-permission");
  }
  // A publish or an unpublish changes the entry, so it is an update first.
  if (isLifecycle(action) && !holdsPermission(actor, "update", target.slug)) {
    return refuse("no-permission");
  }
  const refusal = ruleRefusal(await askRule(actor, action, target));
  if (refusal) return refuse(refusal);
  if (isLifecycle(action)) {
    const update = ruleRefusal(await askRule(actor, "update", target));
    if (update) return refuse("update-rule-refused");
  }
  return ALLOW;
}
