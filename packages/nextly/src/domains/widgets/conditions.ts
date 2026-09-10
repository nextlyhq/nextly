/**
 * Whether each named condition holds, answered by the HOST for one reader.
 *
 * The other half of `lifecycle.ts`: that module owns the vocabulary and refuses
 * a name this release cannot answer, and this one answers the names it admits.
 * Keeping them in step is a property of the pair — a condition added to the set
 * with no arm here is accepted at registration and then never holds, which
 * reads to an author as a broken card rather than as a missing feature. The
 * exhaustive `Record` below is what makes that a compile error instead.
 *
 * Evaluated ONCE per request, for the conditions some widget actually declares.
 * A dashboard whose cards are all permanent asks nothing and pays nothing.
 *
 * @module domains/widgets/conditions
 */

import {
  readableEntities,
  readAccessCaller,
} from "../../auth/entity-read-access";
import { requireNextly } from "../../direct-api/nextly";
import type { FindArgs } from "../../direct-api/types/collections";
import type { ReadCaller } from "../../services/dashboard/readable-resources";

import { isWidgetCondition, type WidgetCondition } from "./lifecycle";
import { listSources, sourceKindFromId, sourceTarget } from "./sources";

/**
 * The access arguments every condition reads through.
 *
 * The SAME shape a widget query uses, so a condition and the cards it governs
 * cannot disagree about who the reader is. `overrideAccess: false` is the whole
 * point: a condition answered with the guard off would describe an install
 * rather than a reader, and `content:empty` is deliberately about the reader.
 */
function readArgs(caller: ReadCaller) {
  return {
    overrideAccess: false as const,
    user: caller.user,
    ...(caller.authenticatedScope
      ? ({ actor: caller.authenticatedScope } satisfies Pick<
          FindArgs<string>,
          "actor"
        >)
      : {}),
  };
}

/**
 * Whether this reader can see any content at all.
 *
 * SHORT-CIRCUITS on the first collection holding a row, so the expensive shape
 * — many collections — is the one that returns soonest, and the exhaustive walk
 * happens only on an install that is genuinely empty, where every count is
 * against an empty table.
 *
 * Asked per collection through the ordinary counted read rather than through
 * one unscoped total, because "any content" has to mean "any content THIS
 * reader may read": a total taken with the guard off would answer from rows the
 * reader is not allowed to know exist.
 *
 * `status: "all"` because a draft is content. A reader who has written one
 * post and not published it is not looking at an empty install, and telling
 * them they are is the onboarding equivalent of losing their work.
 */
async function contentIsEmpty(caller: ReadCaller): Promise<boolean> {
  const slugs = listSources()
    .filter(source => sourceKindFromId(source.id) === "collection")
    .map(source => sourceTarget(source.id));

  // Asked once for the whole set rather than per collection: a permission
  // decision resolves a session caller through a per-user TTL cache, so asking
  // separately is one database read per collection for one answer.
  // Converted rather than taken as a second parameter: the entity-level shape
  // is DERIVED from this one, and asking a caller to pass both invites the two
  // describing different readers.
  const readable = await readableEntities(slugs, readAccessCaller(caller));

  for (const slug of slugs) {
    if (!readable.has(slug)) continue;
    const { total } = await requireNextly().count({
      collection: slug,
      status: "all",
      ...readArgs(caller),
    });
    if (total > 0) return false;
  }
  return true;
}

/**
 * One arm per condition, exhaustively.
 *
 * A `Record` keyed by the union rather than a `switch` with a default: a
 * `default` arm absorbs a new member silently, and the whole hazard here is a
 * condition that is accepted at registration and never answered. The compiler
 * refuses this object until every member has an arm.
 */
const EVALUATORS: Record<
  WidgetCondition,
  (caller: ReadCaller) => Promise<boolean>
> = {
  "content:empty": contentIsEmpty,
};

/**
 * Whether each of the given conditions holds for this reader.
 *
 * Takes the set a dashboard actually needs, so a condition nothing declares is
 * never evaluated. The answers are returned together because a caller filtering
 * a widget list needs them all before it can decide anything, and resolving
 * them one at a time inside that filter would serialise reads that have no
 * reason to wait for each other.
 */
export async function evaluateConditions(
  needed: ReadonlySet<WidgetCondition>,
  caller: ReadCaller
): Promise<ReadonlyMap<WidgetCondition, boolean>> {
  const wanted = [...needed];
  const held = await Promise.all(
    wanted.map(condition => EVALUATORS[condition](caller))
  );
  return new Map(wanted.map((condition, index) => [condition, held[index]]));
}

/**
 * The declaration fields this filter reads.
 *
 * Typed `unknown` rather than by the declaration's own unions, so any widget
 * shape carrying these keys fits without the caller casting. Both values are
 * guarded here before use — `isWidgetCondition` is the same predicate
 * registration validates with — so narrowing them in the signature would buy a
 * compile-time claim the runtime already establishes, at the cost of every
 * caller having to hold the exact type.
 */
interface ConditionalDeclaration {
  lifecycle?: unknown;
  visibleWhen?: unknown;
}

/**
 * The widgets whose condition currently holds, with permanent ones untouched.
 *
 * A SEPARATE pass from the permission gate, deliberately. The two look alike —
 * both remove widgets from a list — and they answer different questions: the
 * gate decides what a reader may be TOLD EXISTS, and this decides what is
 * worth showing right now. Folding them together would make a lapsed
 * onboarding card indistinguishable from a refusal, and the next person
 * reading the filter would have no way to tell which rule dropped a card.
 *
 * Nothing is evaluated unless some widget asks for it: a dashboard of
 * permanent cards resolves an empty set and issues no reads at all.
 *
 * A condition this host cannot answer keeps its widget HIDDEN rather than
 * showing it. Registration already refuses an unknown name, so reaching here
 * means the vocabulary and the evaluators disagree — and a card shown on a
 * condition nobody evaluated is a card shown always, which is the failure this
 * whole mechanism exists to remove.
 */
/**
 * The conditions this set of widgets actually asks about.
 *
 * Pure, and exported so the "asks nothing" case can be asserted directly: a
 * dashboard of permanent cards must issue no reads at all, and the only way to
 * see that from outside is to observe the empty set rather than to watch for
 * absent database traffic.
 */
export function conditionsNeeded<T extends ConditionalDeclaration>(
  widgets: readonly T[]
): Set<WidgetCondition> {
  const needed = new Set<WidgetCondition>();
  for (const widget of widgets) {
    if (widget.lifecycle !== "conditional") continue;
    if (isWidgetCondition(widget.visibleWhen)) needed.add(widget.visibleWhen);
  }
  return needed;
}

/**
 * The widgets to keep, given what the host answered.
 *
 * Pure, so the decision can be tested without a database. A permanent widget is
 * kept whatever the verdicts say — it never asked.
 *
 * A conditional widget whose condition has NO verdict is hidden. Registration
 * already refuses an unknown name, so an absent verdict means the vocabulary
 * and the evaluators have come apart — and the alternative reading, "show it",
 * turns that disagreement into a card that shows unconditionally, which is
 * exactly what this mechanism exists to stop.
 */
export function widgetsHeldByVerdict<T extends ConditionalDeclaration>(
  widgets: readonly T[],
  verdicts: ReadonlyMap<WidgetCondition, boolean>
): T[] {
  return widgets.filter(widget => {
    if (widget.lifecycle !== "conditional") return true;
    if (!isWidgetCondition(widget.visibleWhen)) return false;
    return verdicts.get(widget.visibleWhen) === true;
  });
}

/**
 * The widgets whose condition currently holds, with permanent ones untouched.
 *
 * A SEPARATE pass from the permission gate, deliberately. The two look alike —
 * both remove widgets from a list — and they answer different questions: the
 * gate decides what a reader may be TOLD EXISTS, and this decides what is
 * worth showing right now. Folding them together would make a lapsed
 * onboarding card indistinguishable from a refusal, and the next person
 * reading the filter would have no way to tell which rule dropped a card.
 *
 * Nothing is evaluated unless some widget asks for it: a dashboard of
 * permanent cards resolves an empty set and issues no reads at all.
 */
export async function widgetsWhoseConditionHolds<
  T extends ConditionalDeclaration,
>(widgets: readonly T[], caller: ReadCaller): Promise<T[]> {
  const needed = conditionsNeeded(widgets);
  if (needed.size === 0) return [...widgets];
  return widgetsHeldByVerdict(
    widgets,
    await evaluateConditions(needed, caller)
  );
}
