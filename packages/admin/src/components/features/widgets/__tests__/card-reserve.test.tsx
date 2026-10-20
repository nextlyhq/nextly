/**
 * A loading card holds the place of the body that will replace it, in the body's own line boxes.
 *
 * jsdom lays nothing out, so heights cannot be compared here. What is compared is what decides
 * them: the sequence of line boxes, by the `frame/geometry` class each is drawn in. A skeleton
 * drawn in the same sequence as the loaded body is the same height by construction, in a
 * browser, at any font size. The browser measurement is the layout-shift spec.
 */
import { render, screen, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import type { DashboardWidget } from "@admin/types/dashboard/widgets";

import { listBody } from "../archetypes/list";
import { metricBody } from "../archetypes/metric";
import { statsBody } from "../archetypes/stats";
import * as geometry from "../frame/geometry";
import { WidgetCard } from "../WidgetCard";

type Tier = "small" | "medium" | "large";

/** Each geometry constant by name, tried longest first so a class that contains another wins. */
const BOXES = Object.entries(geometry).sort(
  ([, a], [, b]) => b.split(" ").length - a.split(" ").length
);

/**
 * The line boxes under `root`, in document order, each named by the geometry constant it is
 * drawn in. An element carries a constant when it carries every class the constant names.
 */
function lineBoxes(root: HTMLElement): string[] {
  const named: string[] = [];
  for (const element of root.querySelectorAll<HTMLElement>("*")) {
    const classes = new Set(element.classList);
    const match = BOXES.find(([, value]) =>
      value.split(" ").every(token => classes.has(token))
    );
    if (match) named.push(match[0]);
  }
  return named;
}

const SELECT = ["title", "updatedAt", "status"];

function listCard(limit: number): DashboardWidget {
  return {
    id: "acme/recent",
    title: "Recent",
    archetype: "list",
    defaultSize: "md",
    query: { source: "collection:posts", op: "list", select: SELECT, limit },
  } as unknown as DashboardWidget;
}

/** The body as it loads, at `tier`. */
function skeletonAt(tier: Tier, limit: number): string[] {
  const { unmount } = render(
    <WidgetCard
      title="Recent"
      tier={tier}
      state="loading"
      skeleton="rows"
      skeletonItems={limit}
      skeletonFields={SELECT.length}
    >
      body
    </WidgetCard>
  );
  const boxes = lineBoxes(screen.getByTestId("card-skeleton"));
  unmount();
  return boxes;
}

/** The body once a full answer lands, at `tier`: more rows than it draws, so More shows. */
function loadedAt(tier: Tier, limit: number): string[] {
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
    <WidgetCard title="Recent" tier={tier}>
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
      // More line, all at once, as the answer landed.
      const loaded = loadedAt(tier, 5);
      expect(loaded.length).toBeGreaterThan(0);
      expect(skeletonAt(tier, 5)).toEqual(loaded);
    }
  );

  it("lays a large card out as a table of its columns, and a small one as label lines", () => {
    // The control that the comparison above compares something: the tiers draw differently.
    expect(skeletonAt("large", 5)).toContain("TABLE_HEADING_CLASS");
    expect(skeletonAt("small", 5)).not.toContain("LIST_DETAIL_CLASS");
    expect(skeletonAt("medium", 5)).toContain("LIST_DETAIL_CLASS");
  });
});

describe("a figure card holds its number's line", () => {
  it("draws one line of the figure's own type, as the loaded number is", () => {
    render(
      <WidgetCard title="Unpublished" state="loading" skeleton="figure">
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
        state="loading"
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

describe("the footer's freshness line", () => {
  it("is held, unseen, while the card loads", () => {
    // 🔴 The footer appeared with the answer, so a card that had just closed up its body grew
    // again by the footer's height.
    render(
      <WidgetCard title="Recent" state="loading" skeleton="rows">
        body
      </WidgetCard>
    );
    const held = screen.getByTestId("widget-card-freshness-held");
    expect(held).toHaveClass("invisible", "text-xs");
    expect(held).toHaveAttribute("aria-hidden", "true");
  });

  it("is still held by a card that has settled before its time is known", () => {
    // 🔴 A card whose answer came in an early batch settled with no time yet; the held line
    // went with the loading state, and the footer grew the card once the time arrived.
    render(
      <WidgetCard title="Recent" awaitsFreshness>
        body
      </WidgetCard>
    );
    expect(screen.getByTestId("widget-card-freshness-held")).toHaveClass(
      "invisible"
    );
  });

  it("gives way to the real line once the answer lands, and is never drawn beside it", () => {
    render(
      <WidgetCard title="Recent" updatedAt={new Date("2026-10-19T00:00:00Z")}>
        body
      </WidgetCard>
    );
    expect(screen.getByTestId("widget-card-freshness")).toHaveClass("text-xs");
    expect(
      screen.queryByTestId("widget-card-freshness-held")
    ).not.toBeInTheDocument();
  });

  it("is not held by a card that is not loading", () => {
    render(<WidgetCard title="Quick links">body</WidgetCard>);
    expect(screen.queryByTestId("widget-card-footer")).not.toBeInTheDocument();
  });
});
