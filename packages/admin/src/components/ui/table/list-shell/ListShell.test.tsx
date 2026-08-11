/**
 * The shell's whole job is where pagination sits, so that is what is pinned.
 *
 * Asserting on class strings alone would pass for a shell that rendered the
 * right classes on the wrong element. What matters is the RELATIONSHIP: the
 * table and its pagination share a parent, and that parent is the bordered
 * card. That is the arrangement in which pagination's own `border-t` reads as a
 * divider, and it is the arrangement twelve surfaces had lost.
 */
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { ListShell } from "./index";

function renderShell() {
  render(
    <ListShell
      toolbar={<div data-testid="toolbar">toolbar</div>}
      pagination={<nav data-testid="pagination">pagination</nav>}
    >
      <div data-testid="table">table</div>
    </ListShell>
  );
  return {
    toolbar: screen.getByTestId("toolbar"),
    table: screen.getByTestId("table"),
    pagination: screen.getByTestId("pagination"),
  };
}

describe("ListShell", () => {
  it("puts the pagination inside the same card as the table", () => {
    const { table, pagination } = renderShell();

    // Siblings, not a table in a card with pagination outside it.
    expect(pagination.parentElement).toBe(table.parentElement);
  });

  it("makes that shared parent the bordered card", () => {
    const { table } = renderShell();
    const card = table.parentElement;

    // Without the border this is just a div and the pagination's own `border-t`
    // becomes a stray line rather than the card's internal divider.
    expect(card?.className).toContain("border-border");
    expect(card?.className).toContain("rounded-md");
    expect(card?.className).toContain("bg-card");
  });

  it("puts no vertical rhythm between the table and its pagination", () => {
    const { table } = renderShell();

    // `space-y-*` on the card is exactly the defect: it inserts a margin
    // between the two and detaches the footer.
    expect(table.parentElement?.className).not.toContain("space-y");
  });

  it("keeps the toolbar outside the card", () => {
    const { toolbar, table } = renderShell();

    // The toolbar is page furniture, not part of the table surface. Inside the
    // card it would inherit the card background and read as a table header.
    expect(toolbar.parentElement).not.toBe(table.parentElement);
  });

  it("renders without pagination for lists that do not paginate", () => {
    render(
      <ListShell>
        <div data-testid="table">table</div>
      </ListShell>
    );

    const card = screen.getByTestId("table").parentElement;
    expect(card?.childElementCount).toBe(1);
  });
});
