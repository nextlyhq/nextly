/**
 * Where the footer lands, in both of the views this component switches between.
 *
 * The footer is pagination, and pagination supplies its own `border-t`. That
 * reads as a divider only when there is a card for it to divide. In the table
 * view there is one, so it belongs inside it; in the card view each row is its
 * own card and there is no enclosing edge, so it needs the surrounding gap
 * instead of butting against the last rounded corner.
 *
 * Both views are always in the DOM and CSS shows one, which is how this
 * component already renders rows. So both placements are asserted here rather
 * than one, and each is checked against the block it belongs to.
 */
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { DataTableView } from "./DataTableView";

interface Row extends Record<string, unknown> {
  id: string;
  name: string;
}

const ROWS: Row[] = [{ id: "1", name: "first" }];

function renderWithFooter() {
  render(
    <DataTableView<Row>
      columns={[{ name: "name", header: "Name" }]}
      rows={ROWS}
      footer={<nav data-testid="footer">pagination</nav>}
    />
  );
  return screen.getAllByTestId("footer");
}

/** The nearest ancestor that switches on the table's container query. */
function viewBlockOf(node: HTMLElement): HTMLElement | null {
  let current = node.parentElement;
  while (current) {
    const classes = current.className;
    if (
      typeof classes === "string" &&
      (classes.includes("@md/table:block") ||
        classes.includes("@md/table:hidden"))
    ) {
      return current;
    }
    current = current.parentElement;
  }
  return null;
}

describe("DataTableView footer", () => {
  it("renders once per view, so exactly one is ever displayed", () => {
    expect(renderWithFooter()).toHaveLength(2);
  });

  it("sits inside the bordered card in the table view", () => {
    const desktop = renderWithFooter()
      .map(viewBlockOf)
      .find(block => block?.className.includes("@md/table:block"));

    expect(desktop).toBeTruthy();
    // Inside the block that carries the card, so the card encloses it and the
    // footer's own top border becomes the card's internal divider.
    expect(desktop?.className).toContain("border-border");
  });

  it("takes the card view's own gap, and not a second one", () => {
    const mobile = renderWithFooter()
      .map(node => ({ node, block: viewBlockOf(node) }))
      .find(({ block }) => block?.className.includes("@md/table:hidden"));

    expect(mobile).toBeTruthy();

    // The separation comes from the column's `gap-4`, which means the footer
    // has to be a DIRECT child of it. Wrapping it to add a margin also adds the
    // gap, and the two stack into double the intended space.
    expect(mobile?.node.parentElement).toBe(mobile?.block);
    expect(mobile?.block?.className).toContain("gap-4");

    // Asserting a margin exists would encode whichever spacing shipped rather
    // than the one intended, so what is pinned is the absence of a second
    // source of it.
    const between = mobile?.node.className ?? "";
    expect(between).not.toMatch(/\bmt-\d/);
  });

  it("renders nothing extra when no footer is given", () => {
    render(
      <DataTableView<Row>
        columns={[{ name: "name", header: "Name" }]}
        rows={ROWS}
      />
    );
    expect(screen.queryByTestId("footer")).toBeNull();
  });
});
