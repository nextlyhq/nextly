/**
 * A card its body collapsed: the rows its cell spans, and the frame drawn as its header alone, at
 * rest and in customise mode. The cell's half, drawn in the grid, is in `WidgetGrid.test.tsx`.
 */
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { WidgetCard } from "../../WidgetCard";
import {
  CardCollapseContext,
  collapsedRows,
  COLLAPSED_ROWS,
} from "../collapse";
import { CardHeaderContent } from "../header-slot";

function drawn(collapsed: boolean, customizing = false) {
  render(
    <CardCollapseContext.Provider value={{ collapsed, setCollapsed: () => {} }}>
      <WidgetCard
        title="Set up your project"
        customizing={customizing}
        // The card's menu, as the dashboard hands every card one.
        headerAction={<button type="button">Card menu</button>}
      >
        {/* A collapsing body's controls, drawn in the header (`header-slot`). */}
        <CardHeaderContent>
          <button type="button">Expand</button>
        </CardHeaderContent>
      </WidgetCard>
    </CardCollapseContext.Provider>
  );
  return screen.getByRole("region", { name: "Set up your project" });
}

/** Every control the keyboard reaches in `root`, in tab order (no positive tabindex is used). */
function focusable(root: HTMLElement): HTMLElement[] {
  return [
    ...root.querySelectorAll<HTMLElement>(
      "a[href], button:not([disabled]), input, select, textarea, [tabindex]"
    ),
  ].filter(element => element.tabIndex >= 0 && !element.closest("[inert]"));
}

describe("collapsedRows", () => {
  it("is one row while collapsed, and the cell's own rows otherwise", () => {
    expect(COLLAPSED_ROWS).toBe(1);
    expect(collapsedRows(4, true)).toBe(1);
    expect(collapsedRows(4, false)).toBe(4);
  });
});

describe("the frame of a collapsed card", () => {
  it("draws its header as the one line, with no gap or footer, in one row's padding", () => {
    const card = drawn(true);
    expect(card).toHaveAttribute("data-collapsed");
    expect(card).toHaveClass("py-[15px]");
    expect(screen.getByTestId("widget-card-header")).not.toHaveClass("sr-only");
    expect(screen.getByTestId("widget-card-body")).toHaveClass("pt-0");
    expect(screen.queryByTestId("widget-card-footer")).toBeNull();
  });

  it("leaves no control in the tab order that cannot be seen: the body's controls and the menu, in the header", () => {
    const card = drawn(true);
    const reached = focusable(card);
    expect(reached.map(element => element.textContent)).toEqual([
      "Expand",
      "Card menu",
    ]);
    for (const control of reached) {
      expect(control.closest(".sr-only")).toBeNull();
      expect(screen.getByTestId("widget-card-header")).toContainElement(
        control
      );
    }
  });

  it("draws the whole frame in customise mode, where the card's stored size is being edited", () => {
    const card = drawn(true, true);
    expect(card).not.toHaveAttribute("data-collapsed");
    expect(screen.getByTestId("widget-card-header")).not.toHaveClass("sr-only");
    expect(screen.getByTestId("widget-card-footer")).toBeInTheDocument();
    // The body is out of reach there, so its controls are not drawn in the header.
    expect(screen.queryByRole("button", { name: "Expand" })).toBeNull();
    expect(screen.queryByTestId("widget-card-header-slot")).toBeNull();
  });

  it("draws the whole frame for a body that is not collapsed", () => {
    const card = drawn(false);
    expect(card).not.toHaveAttribute("data-collapsed");
    expect(card).toHaveClass("p-4");
    expect(screen.getByTestId("widget-card-footer")).toBeInTheDocument();
  });
});
