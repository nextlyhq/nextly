/**
 * A declared widget's loading skeleton, from the `skeleton` it states (published as its `sketch`):
 * its shape, its rows and their layout all read from that one value, so a declared list loads as
 * a list's rows and a declared table as a table, with its heading and columns, on a wide card.
 *
 * jsdom measures every element as zero wide, so the card's own measurement is stood in for with
 * the large tier, where a table is drawn as one.
 */
import { render, screen, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import type { DashboardWidget } from "@admin/types/dashboard/widgets";

import { rowsDrawn } from "../frame/tier";
import { WidgetRenderer } from "../WidgetRenderer";

import { gridBounds } from "./grid-bounds";

vi.mock("../frame/tier", async importOriginal => ({
  ...(await importOriginal<typeof import("../frame/tier")>()),
  useMeasuredTier: (_ref: unknown, stated?: string) => stated ?? "large",
}));

/** A widget drawn by its own component, whose data core answers, loading as `sketch`. */
const declared = (sketch: string): DashboardWidget => ({
  id: "acme/orders",
  title: "Orders",
  archetype: "custom",
  component: "acme#Orders",
  sketch,
  size: gridBounds(6),
});

describe("a declared widget's loading skeleton", () => {
  it("draws a table, headed and in columns, for a widget that loads as a table", () => {
    render(<WidgetRenderer definition={declared("table")} slot={undefined} />);
    const skeleton = screen.getByTestId("card-skeleton");
    expect(skeleton).toHaveAttribute("data-shape", "rows");
    // 🔴 Laid out from the archetype, "custom", it drew no table at all.
    const table = skeleton.querySelector("table");
    expect(table).not.toBeNull();
    if (table === null) return;
    expect(within(table).getAllByRole("columnheader")).toHaveLength(2);
    expect(table.querySelectorAll("tbody tr")).toHaveLength(
      rowsDrawn("large", null)
    );
  });

  it("draws a list's rows for a widget that loads as a list", () => {
    render(<WidgetRenderer definition={declared("list")} slot={undefined} />);
    const skeleton = screen.getByTestId("card-skeleton");
    expect(skeleton).toHaveAttribute("data-shape", "rows");
    expect(skeleton.querySelector("table")).toBeNull();
    // 🔴 The rows a list of its size holds, in a list's own rows: laid out from the archetype,
    // the skeleton was the generic three lines.
    const list = skeleton.querySelector(".divide-y");
    expect(list).not.toBeNull();
    expect(list?.children).toHaveLength(rowsDrawn("large", null));
  });
});
