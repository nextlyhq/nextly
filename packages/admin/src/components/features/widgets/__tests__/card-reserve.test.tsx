/**
 * A loading card holds the place of the body that will replace it, in the body's own line boxes.
 *
 * jsdom lays nothing out, so heights cannot be compared here. What is compared is what decides
 * them: the sequence of line boxes, by the `frame/geometry` class each is drawn in. A skeleton
 * drawn in the same sequence as the loaded body is the same height by construction, in a
 * browser, at any font size. The browser measurement is the layout-shift spec.
 *
 * A list row and a table row are boxes of fixed height (`LIST_ROW_HEIGHT_CLASS`,
 * `TABLE_ROW_HEIGHT_CLASS`), so each is that height whatever it holds: a row is compared by its
 * height class, and the lines inside it are not.
 */
import { render, screen, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import type { ListDensity } from "nextly/config";

import type { DashboardWidget } from "@admin/types/dashboard/widgets";

import { listBody } from "../archetypes/list";
import { metricBody } from "../archetypes/metric";
import { statsBody } from "../archetypes/stats";
import * as geometry from "../frame/geometry";
import { WidgetCard } from "../WidgetCard";

import { gridBounds } from "./grid-bounds";

type Tier = "small" | "medium" | "large";

const { LIST_ROW_HEIGHT_CLASS, TABLE_ROW_HEIGHT_CLASS, ...lineClasses } =
  geometry;

/**
 * A row's fixed height at each density, named `LIST_ROW_HEIGHT_CLASS.<density>` or
 * `TABLE_ROW_HEIGHT_CLASS.<density>`. A table row is known by its rule as well as its height,
 * and tried first, since a table row and a compact list row may share a height.
 */
const ROW_HEIGHTS = [
  ...Object.entries(TABLE_ROW_HEIGHT_CLASS).map(
    ([density, value]) =>
      [
        `TABLE_ROW_HEIGHT_CLASS.${density}`,
        `${geometry.TABLE_ROW_CLASS} ${value}`,
      ] as const
  ),
  ...Object.entries(LIST_ROW_HEIGHT_CLASS).map(
    ([density, value]) => [`LIST_ROW_HEIGHT_CLASS.${density}`, value] as const
  ),
];

/**
 * Each other geometry constant by name, tried longest first so a class that contains another
 * wins. The row heights are the constants that are records rather than class strings, and
 * they are read first, apart from these.
 */
const BOXES = Object.entries(lineClasses).sort(
  ([, a], [, b]) => b.split(" ").length - a.split(" ").length
);

/** The geometry constant of `pairs` that `element` carries every class of, if any. */
function carried(
  element: Element,
  pairs: readonly (readonly [string, string])[]
): string | undefined {
  const classes = new Set(element.classList);
  return pairs.find(([, value]) =>
    value.split(" ").every(token => classes.has(token))
  )?.[0];
}

/**
 * The line boxes under `root`, in document order, each named by the geometry constant it is
 * drawn in. An element carries a constant when it carries every class the constant names. A
 * row of fixed height is named by its height and not looked inside, since nothing it holds
 * changes how tall it is.
 */
function lineBoxes(root: Element): string[] {
  const named: string[] = [];
  for (const element of root.children) {
    const height = carried(element, ROW_HEIGHTS);
    if (height !== undefined) {
      named.push(height);
      continue;
    }
    const match = carried(element, BOXES);
    if (match) named.push(match);
    named.push(...lineBoxes(element));
  }
  return named;
}

const SELECT = ["title", "updatedAt", "status"];

function listCard(limit: number): DashboardWidget {
  return {
    id: "acme/recent",
    title: "Recent",
    archetype: "list",
    size: gridBounds(4),
    query: { source: "collection:posts", op: "list", select: SELECT, limit },
  } as unknown as DashboardWidget;
}

/** The body as it loads, at `tier`. */
function skeletonAt(
  tier: Tier,
  limit: number,
  density: ListDensity = "default"
): string[] {
  const { unmount } = render(
    <WidgetCard
      title="Recent"
      tier={tier}
      state={{ kind: "loading" }}
      skeleton="rows"
      skeletonItems={limit}
      skeletonFields={SELECT.length}
      listDensity={density}
    >
      body
    </WidgetCard>
  );
  const boxes = lineBoxes(screen.getByTestId("card-skeleton"));
  unmount();
  return boxes;
}

/** The body once a full answer lands, at `tier`: more rows than it draws, so its footer shows. */
function loadedAt(
  tier: Tier,
  limit: number,
  density: ListDensity = "default"
): string[] {
  const items = Array.from({ length: limit + 1 }, (_, i) => ({
    title: `Post ${i}`,
    updatedAt: "2026-10-19T00:00:00.000Z",
    status: "draft",
  }));
  const drawn = listBody(
    {
      op: "list",
      items,
      fields: SELECT.map(name => ({ name, kind: "text" })),
    } as never,
    listCard(limit)
  );
  if (!drawn.ok || !("node" in drawn)) throw new Error("expected a list body");
  const { unmount } = render(
    <WidgetCard title="Recent" tier={tier} listDensity={density}>
      {drawn.node}
    </WidgetCard>
  );
  const boxes = lineBoxes(screen.getByTestId("widget-card-body"));
  unmount();
  return boxes;
}

describe("a list card holds its rows' place in their own line boxes", () => {
  it.each<Tier>(["small", "medium", "large"])(
    "draws the same line boxes loading as loaded, at %s",
    tier => {
      // 🔴 The skeleton the card used to draw was three plain bars at every tier: a medium
      // card then gained a detail line per row, a large one a table head, and every card the
      // footer line, all at once, as the answer landed.
      const loaded = loadedAt(tier, 5);
      expect(loaded.length).toBeGreaterThan(0);
      expect(skeletonAt(tier, 5)).toEqual(loaded);
    }
  );

  it("draws the same line boxes loading as loaded at compact density, where more rows fit", () => {
    const loaded = loadedAt("medium", 10, "compact");
    expect(
      loaded.filter(box => box === "LIST_ROW_HEIGHT_CLASS.compact")
    ).toHaveLength(7);
    expect(skeletonAt("medium", 10, "compact")).toEqual(loaded);
  });

  it("lays a large card out as a table of its columns, and counts each tier's rows", () => {
    // The control that the comparison above compares something: the tiers draw differently.
    const rowsOf = (boxes: string[]) =>
      boxes.filter(
        box =>
          box === "LIST_ROW_HEIGHT_CLASS.default" ||
          box === "TABLE_ROW_HEIGHT_CLASS.default"
      ).length;
    expect(skeletonAt("large", 5)).toContain("TABLE_HEADING_CLASS");
    expect(skeletonAt("small", 5)).not.toContain("TABLE_HEADING_CLASS");
    expect(rowsOf(skeletonAt("small", 10))).toBe(3);
    expect(rowsOf(skeletonAt("medium", 10))).toBe(5);
    expect(rowsOf(skeletonAt("large", 10))).toBe(10);
  });
});

describe("a figure card holds its number's line", () => {
  it("draws one line of the figure's own type, as the loaded number is", () => {
    render(
      <WidgetCard
        title="Unpublished"
        state={{ kind: "loading" }}
        skeleton="figure"
      >
        body
      </WidgetCard>
    );
    const loading = lineBoxes(screen.getByTestId("card-skeleton"));

    const drawn = metricBody(
      { op: "count", total: 7 } as never,
      {
        title: "Unpublished",
        query: { source: "versions", op: "count" },
      } as never
    );
    if (!drawn.ok || !("node" in drawn)) throw new Error("expected a body");
    render(<WidgetCard title="Unpublished loaded">{drawn.node}</WidgetCard>);
    const loaded = lineBoxes(
      within(
        screen.getByRole("region", { name: "Unpublished loaded" })
      ).getByTestId("widget-card-body")
    );

    // 🔴 It used to be a tall bar and a caption bar: twice the number's height, closing up
    // as the number arrived.
    expect(loading).toEqual(["FIGURE_VALUE_CLASS"]);
    expect(loaded).toEqual(loading);
  });
});

describe("a stats card holds each of its cells", () => {
  it("draws the same line boxes and labels loading as loaded", () => {
    // 🔴 It shared the figure's skeleton, one number's line, while the loaded card draws a
    // value AND a label for every cell, so it grew by a line and more rows of cells.
    const cells = [
      { key: "total", label: "Total" },
      { key: "published", label: "Published" },
      { key: "draft", label: "Draft" },
    ];
    render(
      <WidgetCard
        title="Health"
        state={{ kind: "loading" }}
        skeleton="stats"
        skeletonCells={cells.map(cell => cell.label)}
      >
        body
      </WidgetCard>
    );
    const skeleton = screen.getByTestId("card-skeleton");
    const loading = lineBoxes(skeleton);
    const loadingLabels = [...skeleton.querySelectorAll("dt")].map(
      dt => dt.textContent
    );

    const drawn = statsBody(
      { title: "Health loaded", cells } as never,
      () => ({ ok: true, result: { op: "count", total: 7 } }) as never
    );
    if (!drawn.ok || !("node" in drawn)) throw new Error("expected a body");
    render(<WidgetCard title="Health loaded">{drawn.node}</WidgetCard>);
    const body = within(
      screen.getByRole("region", { name: "Health loaded" })
    ).getByTestId("widget-card-body");

    expect(loading).toContain("STATS_CELL_CLASS");
    expect(lineBoxes(body)).toEqual(loading);
    expect([...body.querySelectorAll("dt")].map(dt => dt.textContent)).toEqual(
      loadingLabels
    );
  });
});

describe("the footer", () => {
  it("holds the footer's line while the card loads, with nothing in it", () => {
    // Every card keeps its footer, so a link that arrives with the answer moves nothing. The
    // card says nothing about freshness, so the held footer is empty.
    render(
      <WidgetCard title="Recent" state={{ kind: "loading" }} skeleton="rows">
        body
      </WidgetCard>
    );
    const footer = screen.getByTestId("widget-card-footer");
    expect(footer).toHaveClass("h-7");
    expect(footer).toHaveTextContent("");
  });
});
