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
 *
 * A GROUPED result's counts are drawn by `bars`, and are held to the same two
 * readings in their own section below: the fixture differs, the claim does not.
 */
import {
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

import { barsBody } from "../bars";
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
const renderers: [string, (result: WidgetResult) => RenderResult][] = [
  [
    "metric",
    result => {
      const outcome = metricBody(result, metricWidget);
      if (!outcome.ok) throw new Error(`refused: ${outcome.message}`);
      return render(<>{outcome.node}</>);
    },
  ],
  [
    "stats",
    result => {
      const outcome = statsBody(statsWidget, () => ({ ok: true, result }));
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

describe("a stats cell that links", () => {
  /** The generated collection-health cells all declare a link. */
  const linked = {
    ...statsWidget,
    cells: [
      {
        key: "pending",
        label: "Pending",
        query: { source: "s", op: "count" },
        link: { href: "/admin/posts?status=draft", label: "Draft posts" },
      },
    ],
  } as unknown as DashboardWidget;

  const drawLinked = (result: WidgetResult) => {
    const outcome = statsBody(linked, () => ({ ok: true, result }));
    if (!outcome.ok) throw new Error(`refused: ${outcome.message}`);
    return render(<>{outcome.node}</>);
  };

  it("names the count AND the floor, not just the destination", () => {
    // 🔴 An `aria-label` REPLACES the element's descendants as the accessible
    // name, so the `sr-only` wording inside the link is not announced at all.
    // Naming only the destination left a screen-reader user hearing "Draft
    // posts" with no number and no way to tell a bounded count from a whole
    // one -- while the visible card showed `2,000+`.
    drawLinked(count(2000, true));

    expect(
      screen.getByRole("link", { name: "2,000 or more, Draft posts" })
    ).toBeInTheDocument();
  });

  it("names an exact count without the floor wording", () => {
    drawLinked(count(2000));

    expect(
      screen.getByRole("link", { name: "2,000, Draft posts" })
    ).toBeInTheDocument();
  });
});

describe("a grouped count drawn by bars", () => {
  const barsWidget = {
    id: "acme/issues",
    title: "Issues by kind",
    archetype: "bars",
    size: "md",
    query: { source: "s", op: "groupBy", groupBy: "kind" },
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

  it("marks every bucket's FLOOR for both readers, in their own notation", () => {
    drawGrouped(true);

    // Scoped to the drawn graphic: a chart also carries a hidden title, so the first hidden node
    // on the page is not the count's. Sight reads "2,000+", a screen reader "2,000 or more", from
    // one formatter.
    const graphic = screen.getByRole("img");
    expect(
      [...graphic.querySelectorAll('[aria-hidden="true"]')].map(
        node => node.textContent
      )
    ).toContain("2,000+");
    expect(
      [...graphic.querySelectorAll(".sr-only")].map(node => node.textContent)
    ).toContain("2,000 or more");
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
