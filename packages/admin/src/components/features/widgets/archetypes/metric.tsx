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

import type { ArchetypeBody } from "./types";

/**
 * Renders a `count` result, and REFUSES anything else.
 *
 * The refusal is the point. A `list` result carries `items`, and the tempting
 * coercion — showing `items.length` — invents a number the query never asked
 * for: a list capped at 5 rows would display "5" for a collection of ten
 * thousand, which is not wrong-looking in any way the reader could detect. A
 * mismatch is a declaration bug in the widget, and it has to look like one.
 */
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
        {result.total.toLocaleString()}
      </p>
    ),
  };
};
