/**
 * The footer is mounted once, and the surface around it is what changes.
 *
 * An earlier version rendered it in each view and let CSS hide one. That is how
 * this component renders ROWS, and it is safe for them because they are static
 * cells — but the footer is pagination: a component with state, effects and
 * form controls carrying ids. Two mounts meant effects running twice, two live
 * `id="page-size"` selects on the page, and a resize handing the user the other
 * instance mid-interaction.
 *
 * So the single mount is the property under test, not an implementation detail.
 */
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { DataTableView } from "./DataTableView";

interface Row extends Record<string, unknown> {
  id: string;
  name: string;
}

const ROWS: Row[] = [{ id: "1", name: "first" }];

function renderWithFooter(bordered?: boolean) {
  render(
    <DataTableView<Row>
      columns={[{ name: "name", header: "Name" }]}
      rows={ROWS}
      bordered={bordered}
      footer={
        <nav data-testid="footer">
          <select id="page-size" aria-label="Page size">
            <option>10</option>
          </select>
        </nav>
      }
    />
  );
  return screen.getAllByTestId("footer");
}

describe("DataTableView footer", () => {
  it("mounts exactly once", () => {
    expect(renderWithFooter()).toHaveLength(1);
  });

  it("leaves one element per id, so controls stay addressable", () => {
    renderWithFooter();

    // A duplicated mount is not only a React concern: two elements sharing an
    // id is invalid, and a label or a test that resolves one of them silently
    // picks whichever came first.
    expect(document.querySelectorAll("#page-size")).toHaveLength(1);
  });

  it("sits inside the surface that carries the card", () => {
    const [footer] = renderWithFooter();
    const surface = footer?.parentElement;

    // Same element that becomes the card at the breakpoint, so the footer is
    // enclosed by it and its own top border reads as the divider.
    expect(surface?.className).toContain("@md/table:border");
    expect(surface?.className).toContain("@md/table:rounded-md");
  });

  it("takes the column gap where there is no card to be a footer of", () => {
    const [footer] = renderWithFooter();
    const surface = footer?.parentElement;

    // Below the breakpoint the surface is a plain column and the rows are
    // separate cards, so the gap separates the footer from the last of them.
    // Above it the gap collapses and the card's edge does the work.
    expect(surface?.className).toContain("gap-4");
    expect(surface?.className).toContain("@md/table:gap-0");
  });

  it("draws no card when the caller supplies one", () => {
    const [footer] = renderWithFooter(false);

    // `EntryTable` and the media library wrap the view themselves; the surface
    // must stay borderless there or the outlines double.
    expect(footer?.parentElement?.className).not.toContain("@md/table:border");
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
