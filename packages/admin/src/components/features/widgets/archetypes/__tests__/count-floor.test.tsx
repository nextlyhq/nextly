/**
 * How a bounded count is drawn — in EVERY archetype that draws one.
 *
 * 🔴 Both are asserted in one file, from one table, deliberately. The defect
 * this covers is not that either renderer was wrong on its own: `metric` handled
 * `atLeast` correctly from the day the field was added, and `stats` formatted
 * `total` and ignored it, so the same query rendered `2,000+` on one card and a
 * confident `2,000` in a cell beside it. A per-archetype test file reproduces
 * exactly that — whoever adds the next archetype copies the neighbouring file
 * and its coverage, or does not. A table over the renderers makes the omission
 * a failing test rather than a missing one.
 */
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import type {
  DashboardWidget,
  WidgetResult,
} from "@admin/types/dashboard/widgets";

import { metricBody } from "../metric";
import { statsBody } from "../stats";

const metricWidget = {
  id: "acme/pending",
  title: "Pending edits",
  archetype: "metric",
  size: "sm",
  query: { source: "system:versions", op: "count" },
} as DashboardWidget;

const statsWidget = {
  id: "acme/health",
  title: "Content health",
  archetype: "stats",
  size: "md",
  cells: [
    { key: "pending", label: "Pending", query: { source: "s", op: "count" } },
  ],
} as unknown as DashboardWidget;

const count = (total: number, atLeast?: boolean): WidgetResult => ({
  op: "count",
  total,
  ...(atLeast === undefined ? {} : { atLeast }),
});

/** Each archetype that draws a count, and how to draw one with it. */
const renderers: [string, (result: WidgetResult) => void][] = [
  [
    "metric",
    result => {
      const outcome = metricBody(result, metricWidget);
      if (!outcome.ok) throw new Error(`refused: ${outcome.message}`);
      render(<>{outcome.node}</>);
    },
  ],
  [
    "stats",
    result => {
      const outcome = statsBody(statsWidget, () => ({ ok: true, result }));
      if (!outcome.ok) throw new Error(`refused: ${outcome.message}`);
      render(<>{outcome.node}</>);
    },
  ],
];

describe.each(renderers)("a count drawn by %s", (_name, draw) => {
  it("marks a FLOOR so the number does not read as the whole figure", () => {
    draw(count(2000, true));

    // The glyph and the words are asserted separately because they are two
    // different readings of one claim: `+` is punctuation a screen reader may
    // not voice, so a card carrying only the glyph tells a sighted reader the
    // number is bounded and tells everyone else it is exact.
    expect(screen.getByText("2,000", { exact: false }).textContent).toContain(
      "+"
    );
    expect(screen.getByText("or more")).toBeInTheDocument();
  });

  it("says nothing extra when the count IS the whole figure", () => {
    // The control. Without it, a renderer that appended "+ or more" to every
    // count would satisfy the case above -- and a reader would be told no
    // number on the dashboard could be trusted.
    draw(count(2000));

    expect(screen.getByText("2,000")).toBeInTheDocument();
    expect(screen.queryByText("or more")).not.toBeInTheDocument();
  });
});
