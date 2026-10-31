/**
 * A card its body collapsed: the rows its cell spans, and the frame drawn around a one-line body,
 * at rest and in customise mode. The cell's half, drawn in the grid, is in `WidgetGrid.test.tsx`.
 */
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { WidgetCard } from "../../WidgetCard";
import {
  CardCollapseContext,
  collapsedRows,
  COLLAPSED_ROWS,
} from "../collapse";

function drawn(collapsed: boolean, customizing = false) {
  render(
    <CardCollapseContext.Provider value={{ collapsed, setCollapsed: () => {} }}>
      <WidgetCard title="Set up your project" customizing={customizing}>
        <p>Set up your project · 2 of 5 done</p>
      </WidgetCard>
    </CardCollapseContext.Provider>
  );
  return screen.getByRole("region", { name: "Set up your project" });
}

describe("collapsedRows", () => {
  it("is one row while collapsed, and the cell's own rows otherwise", () => {
    expect(COLLAPSED_ROWS).toBe(1);
    expect(collapsedRows(4, true)).toBe(1);
    expect(collapsedRows(4, false)).toBe(4);
  });
});

describe("the frame of a collapsed card", () => {
  it("keeps the title for assistive technology only, with no gap or footer, in one row's padding", () => {
    const card = drawn(true);
    expect(card).toHaveAttribute("data-collapsed");
    expect(card).toHaveClass("py-[15px]");
    expect(screen.getByTestId("widget-card-header")).toHaveClass("sr-only");
    expect(screen.getByTestId("widget-card-body")).toHaveClass("pt-0");
    expect(screen.queryByTestId("widget-card-footer")).toBeNull();
  });

  it("draws the whole frame in customise mode, where the card's stored size is being edited", () => {
    const card = drawn(true, true);
    expect(card).not.toHaveAttribute("data-collapsed");
    expect(screen.getByTestId("widget-card-header")).not.toHaveClass("sr-only");
    expect(screen.getByTestId("widget-card-footer")).toBeInTheDocument();
  });

  it("draws the whole frame for a body that is not collapsed", () => {
    const card = drawn(false);
    expect(card).not.toHaveAttribute("data-collapsed");
    expect(card).toHaveClass("p-4");
    expect(screen.getByTestId("widget-card-footer")).toBeInTheDocument();
  });
});
