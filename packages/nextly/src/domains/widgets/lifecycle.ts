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
 * What a conditional widget may declare, and what a permanent one may not.
 *
 * The two halves are stated together because they are one question — is this
 * declaration coherent — and answering them apart is how a card ends up
 * `dismissible` with nothing to dismiss it from.
 *
 * `pin` and `dismissible` are refused on a permanent widget rather than
 * ignored. Both are meaningless there and both look like they work: a reader
 * would see `pin: "top"` in a declaration, place the card, watch it sit
 * wherever they dragged it, and have nothing to tell them the field was never
 * read. A refusal at registration says so once, to the person who wrote it.
 */
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
  return `visibleWhen must be one of ${WIDGET_CONDITIONS.map(c => `"${c}"`).join(", ")}; received ${JSON.stringify(visibleWhen)}`;
}

/** Whether a field that only a transient card may carry was carried legally. */
function transientOnlyProblem(
  conditional: boolean,
  field: "pin" | "dismissible",
  value: unknown,
  legal: (value: unknown) => boolean,
  shape: string
): string | undefined {
  if (value === undefined) return undefined;
  if (!conditional) {
    return `${field} is only meaningful on a widget declaring lifecycle: "conditional"`;
  }
  return legal(value) ? undefined : `${field}, when given, must be ${shape}`;
}

/**
 * What a conditional widget may declare, and what a permanent one may not.
 *
 * Composed from the rules above rather than written as one chain, and each is
 * named for the question it answers. `pin` and `dismissible` are refused on a
 * permanent widget rather than ignored: both are meaningless there and both
 * LOOK like they work -- a reader would see `pin: "top"` in a declaration,
 * place the card, watch it sit wherever they dragged it, and have nothing to
 * tell them the field was never read.
 */
export function lifecycleProblem(
  widget: Record<string, unknown>
): string | undefined {
  const { lifecycle, visibleWhen, pin, dismissible } = widget;
  const conditional = lifecycle === "conditional";
  return (
    kindProblem(lifecycle) ??
    conditionProblem(conditional, visibleWhen) ??
    transientOnlyProblem(
      conditional,
      "pin",
      pin,
      value => value === "top",
      '"top"'
    ) ??
    transientOnlyProblem(
      conditional,
      "dismissible",
      dismissible,
      value => typeof value === "boolean",
      "a boolean"
    )
  );
}
