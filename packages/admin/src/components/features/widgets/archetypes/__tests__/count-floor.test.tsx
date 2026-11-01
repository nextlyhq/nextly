/**
 * How a bounded count is drawn — in EVERY archetype that draws one.
 *
 * 🔴 Asserted from one table over the renderers, deliberately. Two renderers
 * once disagreed: one handled `atLeast` and the other formatted `total` and
 * ignored it, so the same count rendered `2,000+` on one card and a confident
 * `2,000` beside it. A per-archetype test file reproduces exactly that —
 * whoever adds the next archetype copies the neighbouring file and its
 * coverage, or does not. A table over the renderers makes the omission a
 * failing test rather than a missing one.
 *
 * A GROUPED result's counts are drawn by `bars`, and are held to the same two
 * readings in their own section below: the fixture differs, the claim does not.
 */
import {
  act,
  render,
  screen,
  within,
  type RenderResult,
} from "@testing-library/react";
import { describe, expect, it } from "vitest";

import type {
  DashboardWidget,
  WidgetResult,
} from "@admin/types/dashboard/widgets";

import { sizeChartsInTests } from "../../charts/__tests__/chart-env";
import { barsBody } from "../bars";
import { metricBody } from "../metric";
import { gridBounds } from "../../__tests__/grid-bounds";

const metricWidget = {
  id: "acme/pending",
  title: "Pending edits",
  archetype: "metric",
  size: gridBounds(3),
} as DashboardWidget;

const count = (total: number, atLeast?: boolean): WidgetResult => ({
  op: "count",
  total,
  ...(atLeast === undefined ? {} : { atLeast }),
});

/** Each archetype that draws a count, and how to draw one with it. */
const renderers: [string, (result: WidgetResult) => RenderResult][] = [
  [
    "metric",
    result => {
      const outcome = metricBody(result, metricWidget);
      if (!outcome.ok) throw new Error(`refused: ${outcome.message}`);
      return render(<>{outcome.node}</>);
    },
  ],
];

describe.each(renderers)("a count drawn by %s", (_name, draw) => {
  it("marks a FLOOR for both readers, in their own notation", () => {
    const { container } = draw(count(2000, true));

    // Asserted separately because they are two renderings of one claim and
    // each can be lost on its own: `+` is punctuation a screen reader may not
    // voice, and the words are invisible.
    // The drawn form carries the "+"; the heard form says "or more" in words, with the full
    // value -- both from the one card formatter.
    expect(container.querySelector('[aria-hidden="true"]')?.textContent).toBe(
      "2,000+"
    );
    expect(container.querySelector(".sr-only")?.textContent).toBe(
      "2,000 or more"
    );
  });

  it("says nothing extra when the count IS the whole figure", () => {
    // The control. Without it, a renderer that appended the floor wording to
    // every count would satisfy the case above, and a reader would be told no
    // number on the dashboard could be trusted.
    const { container } = draw(count(2000));

    expect(container.textContent).toContain("2,000");
    expect(container.querySelector(".sr-only")).toBeNull();
    expect(container.textContent).not.toContain("or more");
  });
});

sizeChartsInTests();

describe("a grouped count drawn by bars", () => {
  const barsWidget = {
    id: "acme/issues",
    title: "Issues by kind",
    archetype: "bars",
    size: gridBounds(4),
  } as unknown as DashboardWidget;

  const drawGrouped = (atLeast?: boolean): RenderResult => {
    const outcome = barsBody(
      {
        op: "groupBy",
        buckets: [{ value: "Missing title", count: 2000 }],
        ...(atLeast === undefined ? {} : { atLeast }),
      },
      barsWidget
    );
    if (!outcome.ok) throw new Error(`refused: ${outcome.message}`);
    return render(<>{outcome.node}</>);
  };

  it("marks every bucket's FLOOR for both readers, in their own notation", async () => {
    drawGrouped(true);

    // Sight reads "2,000+" beside the bar, and a screen reader "2,000 or more" where the
    // keys land on it, from one formatter.
    const drawing = await screen.findByTestId("chart-drawing");
    expect(
      [...drawing.querySelectorAll("text")].map(node => node.textContent)
    ).toContain("2,000+");
    const graphic = screen.getByRole("group", { name: /Use the arrow keys/ });
    act(() => graphic.focus());
    expect(screen.getByTestId("chart-live")).toHaveTextContent(
      "Missing title: 2,000 or more."
    );
    // The text alternative says the counts are lower bounds and names no group the most.
    expect(graphic).toHaveAccessibleDescription(
      /lower bounds, and groups not counted may exist/
    );
    expect(graphic).not.toHaveAccessibleDescription(/Most:/);
    // And the table a reader navigates cell by cell makes the same claim.
    expect(
      within(screen.getByRole("table")).getByRole("row", {
        name: /^Missing title 2,000 or more$/,
      })
    ).toBeInTheDocument();
  });

  it("says nothing extra when every count IS whole", () => {
    const { container } = drawGrouped();

    expect(container.textContent).toContain("2,000");
    expect(container.textContent).not.toContain("2,000+");
    expect(container.textContent).not.toContain("or more");
  });
});
