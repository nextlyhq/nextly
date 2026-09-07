/**
 * The `metric` archetype: one number, large.
 *
 * `tabular-nums` because the grid refetches on window focus and a
 * proportionally-spaced count visibly reflows every time its digits change —
 * "1,999" to "2,000" moves the whole number sideways. Fixed-width digits keep
 * a refresh from reading as a layout jump.
 *
 * `toLocaleString()` because an unformatted `1234567` is not a number anyone
 * reads at a glance, and the grouping separator is the reader's, not ours.
 *
 * @module components/features/widgets/archetypes/metric
 */

import { CountValue } from "./count-value";
import type { ArchetypeAccepts, ArchetypeBody } from "./types";

/**
 * Renders a `count` result, and REFUSES anything else.
 *
 * The refusal is the point. A `list` result carries `items`, and the tempting
 * coercion — showing `items.length` — invents a number the query never asked
 * for: a list capped at 5 rows would display "5" for a collection of ten
 * thousand, which is not wrong-looking in any way the reader could detect. A
 * mismatch is a declaration bug in the widget, and it has to look like one.
 */
/**
 * A metric is a number from a query, so it needs one.
 *
 * Stated here rather than inferred from `query` being absent at the call site,
 * because drawability has to be ONE question. `resolve-widgets` used to ask two
 * -- "does it declare a query" and "can core draw this archetype" -- and the
 * first is wrong for an archetype that is drawn WITHOUT a query: `actions` is
 * queryless by design, so the query test declared it undrawable and handed
 * every actions widget with a component fallback to that component, bypassing
 * the host renderer and its per-item permission gating.
 */
export const metricAccepts: ArchetypeAccepts = definition => {
  if (definition.query) return undefined;
  const name = definition.title ?? "This metric widget";
  return `"${name}" is drawn from a query, and this widget declares none.`;
};

export const metricBody: ArchetypeBody = (result, definition) => {
  if (result.op !== "count") {
    return {
      ok: false,
      message: `"${definition.title}" expected a count, but the query returned a ${result.op}.`,
    };
  }

  return {
    ok: true,
    node: (
      <p
        data-testid="widget-metric-value"
        // Sized to the Users and Roles stat cards on the same dashboard rather
        // than a step above them: a plugin's number that shouts louder than the
        // core ones reads as a different component, not as a peer.
        className="text-2xl font-bold leading-none tabular-nums tracking-tight text-foreground"
      >
        {/* A floor is said in the number itself: the card cannot know the whole
            figure -- the rows behind it are filtered by a rule the database
            cannot apply -- and a bare number would claim it does. Drawn by the
            shared renderer so a stats cell showing the same query cannot
            disagree with this one about whether it is exact. */}
        <CountValue total={result.total} atLeast={result.atLeast} />
      </p>
    ),
  };
};
