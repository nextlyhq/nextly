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

  it("takes a gap in the card view, where no card encloses it", () => {
    const mobile = renderWithFooter().find(
      node => node.parentElement?.className.includes("mt-4") ?? false
    );

    // Without this the footer's top border lands against the last row card's
    // rounded corner and reads as a hairline stuck to it.
    expect(mobile).toBeTruthy();
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
