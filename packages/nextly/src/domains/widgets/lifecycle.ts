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
 * Namespaced `subject:state` so a later condition about a different subject
 * cannot be mistaken for a variant of this one, and so the set stays readable
 * as it grows.
 */
export const WIDGET_CONDITIONS = ["content:empty"] as const;
export type WidgetCondition = (typeof WIDGET_CONDITIONS)[number];

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

/** Whether the lifecycle names one of the two dispositions there are. */
function kindProblem(lifecycle: unknown): string | undefined {
  if (lifecycle === undefined) return undefined;
  if (lifecycle === "always" || lifecycle === "conditional") return undefined;
  return `lifecycle, when given, must be ${WIDGET_LIFECYCLES.map(l => `"${l}"`).join(" or ")}`;
}

/**
 * Whether the condition and the lifecycle agree, and whether the host knows it.
 *
 * The two directions are one rule: a conditional widget without a condition has
 * nothing to evaluate, and a condition without the lifecycle is a field nobody
 * reads. Separating them would let a declaration satisfy one and fail the other
 * silently.
 */
function conditionProblem(
  conditional: boolean,
  visibleWhen: unknown
): string | undefined {
  if (!conditional) {
    return visibleWhen === undefined
      ? undefined
      : 'visibleWhen is only meaningful on a widget declaring lifecycle: "conditional"';
  }
  if (visibleWhen === undefined) {
    return "a conditional widget must name the condition it shows under, as `visibleWhen`";
  }
  if (isWidgetCondition(visibleWhen)) return undefined;
  // The known set is NAMED in the refusal. An author who mistyped a condition,
  // and one who reached for a condition this release does not have, need
  // different next steps and the message cannot tell them apart -- so it shows
  // what is available and lets them see which of the two they are.
  return `visibleWhen must be one of ${WIDGET_CONDITIONS.map(c => `"${c}"`).join(", ")}; received ${describe(visibleWhen)}`;
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
