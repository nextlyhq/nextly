/**
 * The shell is layout only, and that is the property worth holding.
 *
 * It used to draw the card and place the pagination, which meant it had to
 * decide whether the table was in table form or card form -- a decision
 * `DataTableView` was already making from a narrower box. Two owners, two
 * container queries, and a band of widths where they disagreed. These tests pin
 * that the shell no longer makes that decision at all.
 */
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { ListShell } from "./index";

function renderShell() {
  render(
    <ListShell toolbar={<div data-testid="toolbar">toolbar</div>}>
      <div data-testid="table">table</div>
    </ListShell>
  );
  return {
    toolbar: screen.getByTestId("toolbar"),
    table: screen.getByTestId("table"),
  };
}

describe("ListShell", () => {
  it("renders the toolbar above the table", () => {
    const { toolbar, table } = renderShell();

    // Siblings in source order, so the surrounding rhythm separates them.
    expect(toolbar.parentElement).toBe(table.parentElement);
    expect(
      toolbar.compareDocumentPosition(table) & Node.DOCUMENT_POSITION_FOLLOWING
    ).toBeTruthy();
  });

  it("draws no card of its own", () => {
    const { table } = renderShell();
    const classes = [...(table.parentElement?.classList ?? [])];

    // A border here would be a second outline around a table that draws its
    // own, and -- worse -- would reintroduce the width disagreement, because
    // this box is wider than the one `DataTableView` measures by exactly that
    // border.
    for (const banned of [
      "border",
      "rounded-md",
      "bg-card",
      "overflow-hidden",
    ]) {
      expect(classes).not.toContain(banned);
    }
  });

  it("asks no container query", () => {
    const { table } = renderShell();
    const root = table.parentElement;

    // Naming a container is how the previous version came to hold an opinion
    // about the breakpoint. Nothing here should need one.
    for (const cls of [...(root?.classList ?? [])]) {
      expect(cls.startsWith("@")).toBe(false);
    }
  });
});
