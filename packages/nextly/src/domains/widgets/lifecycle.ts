/**
 * How long a widget stays on the dashboard, and who decides.
 *
 * Most widgets are permanent: a reader places one and it stays until they
 * remove it. A CONDITIONAL widget is transient — it shows only while a named
 * condition holds, and stops being offered the moment it does not. Onboarding
 * is the case that needs it, and today every such card decides for itself:
 * `core/seed-demo-content` is placed in the grid, given an order, and then
 * renders nothing once seeding is done. The grid reserves a slot for a card
 * that draws nothing, and the reason lives in a component rather than in the
 * declaration.
 *
 * 🔴 The condition is NAMED, from a closed set this module owns, and the HOST
 * evaluates it. A plugin never supplies a predicate, a callback or an
 * expression. That is the structural difference between this and WordPress's
 * `admin_notices`, which takes an arbitrary hook and is a documented source of
 * admin spam that guidelines have never managed to contain. A vocabulary
 * cannot be spammed: a name this file does not know is refused at
 * registration, where the author can still be told, rather than at render.
 *
 * The set is deliberately SMALL and grows one member at a time, each with a
 * host-side evaluator landing beside it. A condition nothing can answer is a
 * declaration that always hides the widget, which reads to the author as a
 * broken card rather than as a missing feature.
 *
 * `pin` and `dismissible` are deliberately NOT here yet. The design calls for
 * both, and nothing reads either one: pinning is a property of how the grid
 * materialises an arrangement, and dismissal needs somewhere per-reader to
 * record it. Accepting them now would publish two options that look like they
 * work — an author would declare `pin: "top"`, watch the card sit wherever it
 * was dragged, and have nothing to tell them the field was never read. They
 * arrive with the code that honours them.
 *
 * @module domains/widgets/lifecycle
 */

/**
 * How long a widget lives on the dashboard.
 *
 * `always` is the default and is what every widget shipped before this was:
 * placed by the reader, removed by the reader. It is named rather than left as
 * the absence of a lifecycle so a reader of the declaration sees which of the
 * two a card is, instead of inferring permanence from a missing field.
 */
export const WIDGET_LIFECYCLES = ["always", "conditional"] as const;
export type WidgetLifecycle = (typeof WIDGET_LIFECYCLES)[number];

/**
 * The conditions a conditional widget may name.
 *
 * `content:empty` — this READER can see no content. Reader-scoped, and the
 * name says `content` rather than `install` for that reason: evaluating it
 * across the whole install would answer from rows the reader is not allowed to
 * know exist, which turns an onboarding prompt into a channel for whether
 * content exists elsewhere. The two readings coincide for the audience that
 * actually meets onboarding — the admin who just created themselves at
 * `(auth)/setup` and can read everything — and where they diverge, the
 * reader-scoped one is both the safe answer and the true one about what that
 * person is looking at.
 *
 * What follows for the COPY of any card using it: it may say there is nothing
 * here yet, and it may not claim the install is empty. A limited editor seeing
 * "nothing to show" is correct; the same editor told the install is empty is
 * being told something false.
 *
 * `onboarding:incomplete` — this READER still has setup steps outstanding.
 * Reader-scoped for the same reason and more sharply: the steps are detected
 * from what this reader can see, so an editor who may not read a collection is
 * not held short of finishing by content they cannot know about. It is NOT a
 * narrower `content:empty`, and the two are deliberately separable — an install
 * with content can still have onboarding outstanding, and a reader who has
 * written nothing may have finished every step available to them.
 *
 * `seed:unanswered` — nobody has accepted or declined the offer of demo
 * content. The one condition here that is deliberately about the INSTALL
 * rather than the reader, and the name says `seed` rather than `content` for
 * that reason: whether a project took the demo data is a property of the
 * project, recorded once in `nextly_meta`, and a second admin arriving after
 * the first declined should not be offered it again. It discloses nothing
 * about rows — only that a setup offer was answered.
 *
 * Namespaced `subject:state` so a later condition about a different subject
 * cannot be mistaken for a variant of this one, and so the set stays readable
 * as it grows.
 */
export const WIDGET_CONDITIONS = [
  "content:empty",
  "onboarding:incomplete",
  "seed:unanswered",
] as const;
export type WidgetCondition = (typeof WIDGET_CONDITIONS)[number];

const LIFECYCLE_SET: ReadonlySet<string> = new Set(WIDGET_LIFECYCLES);
const CONDITION_SET: ReadonlySet<string> = new Set(WIDGET_CONDITIONS);

/** Whether a value is a condition this host knows how to evaluate. */
export function isWidgetCondition(value: unknown): value is WidgetCondition {
  return typeof value === "string" && CONDITION_SET.has(value);
}

/**
 * A value named in a diagnostic, without the formatter ever throwing.
 *
 * `JSON.stringify` was the obvious choice and is the wrong one here: it throws
 * a native `TypeError` on a BigInt and on a cyclic object, and this string is
 * built while composing a REFUSAL. The throw would escape before the refusal
 * could be turned into the developer-facing error, so a plugin sending `1n`
 * would abort registration with the wrong error shape and lose the diagnostic
 * naming the widget — the message that exists to help them replaced by a crash
 * from the code writing it.
 *
 * A SHAPE rather than a value for anything structured: a diagnostic needs to
 * say what kind of thing arrived, and printing a whole object into a validation
 * message helps nobody.
 */
function describe(value: unknown): string {
  if (value === undefined) return "undefined";
  if (value === null) return "null";
  if (typeof value === "string") return `"${value}"`;
  if (typeof value === "bigint") return `${value.toString()}n`;
  if (typeof value === "number" || typeof value === "boolean") {
    return String(value);
  }
  if (typeof value === "object") return "an object";
  // A symbol or a function, named by KIND. A diagnostic needs to say what sort
  // of thing arrived, and these two carry nothing a reader could act on beyond
  // that -- so they are not enumerated one by one.
  return `a ${typeof value}`;
}

/**
 * Whether the lifecycle names one of the dispositions there are.
 *
 * Membership is read from the vocabulary rather than spelled out, so the type
 * and this boundary cannot come apart. Spelled out, a third disposition added
 * to the tuple would be accepted by `WidgetDefinition` and named in the refusal
 * below while registration still rejected it — a message listing the value it
 * had just refused.
 */
function kindProblem(lifecycle: unknown): string | undefined {
  if (lifecycle === undefined) return undefined;
  if (typeof lifecycle === "string" && LIFECYCLE_SET.has(lifecycle)) {
    return undefined;
  }
  return `lifecycle, when given, must be ${WIDGET_LIFECYCLES.map(l => `"${l}"`).join(" or ")}`;
}

/**
 * Every condition a declaration names, as a list.
 *
 * A card may name one or several, and one is written as a bare string because
 * that is what almost every card wants. Normalising here means the rules below
 * and the filter both see one shape, rather than each carrying its own
 * "string or array" branch that could disagree about the empty case.
 */
export function declaredConditions(visibleWhen: unknown): unknown[] {
  if (visibleWhen === undefined) return [];
  return Array.isArray(visibleWhen) ? [...visibleWhen] : [visibleWhen];
}

/**
 * Where the first unknown condition sits, or -1.
 *
 * An INDEX rather than the value, because the value's type is `unknown` and
 * `unknown | undefined` collapses back to `unknown` — leaving no way to say
 * "every name was known" that a caller could tell apart from a name that
 * happened to be `undefined`.
 */
function unknownConditionIndex(named: readonly unknown[]): number {
  return named.findIndex(condition => !isWidgetCondition(condition));
}

/**
 * Whether the conditions and the lifecycle agree, and whether the host knows
 * them.
 *
 * The two directions are one rule: a conditional widget without a condition has
 * nothing to evaluate, and a condition without the lifecycle is a field nobody
 * reads. Separating them would let a declaration satisfy one and fail the other
 * silently.
 *
 * SEVERAL conditions are ANDed, and the card shows only while every one holds.
 * The alternative reading — any of them — was rejected because it cannot express
 * the case that motivated the list: a card offered while the install is empty
 * AND the offer it makes has not been answered. Under "any", declining the offer
 * would leave the card showing on the strength of the other condition, which is
 * the behaviour the list exists to remove.
 */
function conditionProblem(
  conditional: boolean,
  visibleWhen: unknown
): string | undefined {
  const named = declaredConditions(visibleWhen);
  if (!conditional) {
    return named.length === 0
      ? undefined
      : 'visibleWhen is only meaningful on a widget declaring lifecycle: "conditional"';
  }
  // An empty ARRAY is refused as firmly as an absent field, and reaches here as
  // the same length. A card declaring `visibleWhen: []` has named no rule, so
  // every condition it must satisfy is vacuously satisfied -- a conditional
  // widget that is permanent, which is the one thing the lifecycle promises it
  // is not.
  if (named.length === 0) {
    return "a conditional widget must name the condition it shows under, as `visibleWhen`";
  }
  const at = unknownConditionIndex(named);
  if (at === -1) return undefined;
  // The known set is NAMED in the refusal. An author who mistyped a condition,
  // and one who reached for a condition this release does not have, need
  // different next steps and the message cannot tell them apart -- so it shows
  // what is available and lets them see which of the two they are.
  return `visibleWhen must name only ${WIDGET_CONDITIONS.map(c => `"${c}"`).join(", ")}; received ${describe(named[at])}`;
}

/**
 * What a conditional widget may declare, and what a permanent one may not.
 *
 * Composed from the rules above rather than written as one chain, and each is
 * named for the question it answers.
 */
export function lifecycleProblem(
  widget: Record<string, unknown>
): string | undefined {
  const { lifecycle, visibleWhen } = widget;
  const conditional = lifecycle === "conditional";
  return kindProblem(lifecycle) ?? conditionProblem(conditional, visibleWhen);
}
