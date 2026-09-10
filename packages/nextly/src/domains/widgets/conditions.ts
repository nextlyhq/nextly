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

import type { ReadCaller } from "../../services/dashboard/readable-resources";

import { isWidgetCondition, type WidgetCondition } from "./lifecycle";
import { onboardingIsIncomplete } from "./onboarding";
import { readerHasContent } from "./reader-content";

/**
 * Whether this reader can see any content at all.
 *
 * DERIVED from {@link readerHasContent} rather than counting here, because the
 * onboarding steps ask the same question of the same rows. Counted in both
 * places the two would agree on the day they were written and drift after:
 * one counting drafts and the other not, or one reading the source registry
 * and the other the collections registry, produces a dashboard that offers an
 * onboarding card while telling the reader their install has content.
 *
 * The scoping, the short-circuit and the `status: "all"` reasoning now live
 * with the counting, in `reader-content.ts`.
 */
async function contentIsEmpty(caller: ReadCaller): Promise<boolean> {
  return !(await readerHasContent(caller));
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
  "onboarding:incomplete": onboardingIsIncomplete,
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
  // SETTLED, not all-or-nothing. `Promise.all` rejects on the first evaluator
  // that throws, and this runs inside the layout read -- so one failing count,
  // on one collection, would answer the whole request as an error and take
  // every PERMANENT card down with the optional one it was asked about. The
  // blast radius of a condition has to be the widget that named it.
  const settled = await Promise.allSettled(
    wanted.map(condition => EVALUATORS[condition](caller))
  );
  const verdicts = new Map<WidgetCondition, boolean>();
  wanted.forEach((condition, index) => {
    const outcome = settled[index];
    // A failure is recorded as UNANSWERED rather than as `false`, and the
    // difference is not cosmetic: the filter hides a widget whose condition has
    // no verdict, so both readings hide the card, but only this one leaves
    // "nobody could answer" distinguishable from "the answer was no" for
    // anything that later reads these verdicts.
    if (outcome.status === "fulfilled") verdicts.set(condition, outcome.value);
  });
  return verdicts;
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
