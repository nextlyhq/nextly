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
    const card = table.parentElement;

    // Containment rather than parent identity: pagination is wrapped so it can
    // carry a mobile-only gap, so it is a descendant of the card and not a
    // sibling of the table. What must stay true is that the card encloses both
    // — a pagination outside it is the detached bar this shell exists to end.
    expect(card).not.toBeNull();
    expect(card?.contains(pagination)).toBe(true);
  });

  it("separates the pagination only where there is no card", () => {
    const { pagination } = renderShell();
    const wrapper = pagination.parentElement;

    // Below the breakpoint the rows are individual cards with no enclosing
    // edge, so the pagination needs the surrounding rhythm's gap; at and above
    // it the card exists and the pagination's own `border-t` is the divider,
    // so the gap must collapse or the footer detaches again.
    const classes = [...(wrapper?.classList ?? [])];
    expect(classes).toContain("mt-4");
    expect(classes).toContain("@md/list:mt-0");
  });

  it("makes that shared parent the bordered card", () => {
    const { table } = renderShell();
    const card = table.parentElement;

    // Without the border this is just a div and the pagination's own `border-t`
    // becomes a stray line rather than the card's internal divider.
    //
    // The width utility is asserted as an exact token, not as a substring:
    // `toContain("border")` also matches `border-border`, so a shell that set a
    // border COLOUR and no border at all would satisfy it while rendering
    // nothing. Colour without width is the borderless card this test exists to
    // rule out.
    const classes = [...(card?.classList ?? [])];
    expect(classes).toContain("@md/list:border");
    expect(classes).toContain("@md/list:border-border");
    expect(classes).toContain("@md/list:rounded-md");
    expect(classes).toContain("@md/list:bg-card");
  });

  it("applies the card only where the table is a table", () => {
    const { table } = renderShell();

    // Below the breakpoint `DataTableView` hides the table and renders each row
    // as its own bordered Card, so an unconditional card here would enclose a
    // stack of cards in another card and clip their corners. Every card utility
    // must therefore be gated, and gated on a CONTAINER query so it turns on
    // with the same box that component measures rather than with the viewport.
    const carded = [...(table.parentElement?.classList ?? [])];
    expect(carded.length).toBeGreaterThan(0);
    for (const cls of carded) {
      expect(cls.startsWith("@md/list:")).toBe(true);
    }
  });

  it("puts no vertical rhythm between the table and its pagination", () => {
    const { table } = renderShell();

    // `space-y-*` on the card is exactly the defect: it inserts a margin
    // between the two and detaches the footer.
    expect(table.parentElement?.className).not.toContain("space-y");
  });

  it("keeps the toolbar outside the card", () => {
    const { toolbar, table } = renderShell();
    const card = table.parentElement;

    // Containment, not parent inequality. A toolbar nested one level deeper
    // INSIDE the card already has a different immediate parent, so comparing
    // parents passes for the arrangement this rules out -- the toolbar sitting
    // on the card surface, inheriting its background and reading as a header.
    expect(card).not.toBeNull();
    expect(card?.contains(toolbar)).toBe(false);
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
