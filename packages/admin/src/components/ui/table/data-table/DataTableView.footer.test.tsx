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

/**
 * A class list as discrete tokens.
 *
 * Class assertions here go through this rather than through `className`,
 * because Tailwind utility names nest as prefixes of one another and a
 * substring match cannot tell `border` from `border-border`. Membership can.
 */
function tokensOf(el: Element | null | undefined): string[] {
  return [...(el?.classList ?? [])];
}

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
    //
    // Exact tokens, never substrings: "@md/table:border" is a prefix of
    // "@md/table:border-border", so a substring check passes for a surface
    // carrying a border COLOUR and no border at all -- which renders nothing
    // and is precisely the implementation this test claims to exclude.
    expect(tokensOf(surface)).toContain("@md/table:border");
    expect(tokensOf(surface)).toContain("@md/table:rounded-md");
  });

  it("takes the column gap where there is no card to be a footer of", () => {
    const [footer] = renderWithFooter();
    const surface = footer?.parentElement;

    // Below the breakpoint the surface is a plain column and the rows are
    // separate cards, so the gap separates the footer from the last of them.
    // Above it the gap collapses and the card's edge does the work.
    expect(tokensOf(surface)).toContain("gap-4");
    expect(tokensOf(surface)).toContain("@md/table:gap-0");
  });

  it("draws no card when the caller supplies one", () => {
    const [footer] = renderWithFooter(false);

    // `EntryTable` and the media library wrap the view themselves; the surface
    // must stay borderless there or the outlines double.
    expect(tokensOf(footer?.parentElement)).not.toContain("@md/table:border");
  });

  it("still clips when the caller supplies the card", () => {
    const [footer] = renderWithFooter(false);

    // Clipping is not part of the card and must not travel with it. A parent
    // can round its corners without clipping -- `DataTable` does exactly that,
    // and it is the caller that passes bordered={false} -- so a globally
    // coloured <thead> would paint square corners through the rounded parent.
    expect(tokensOf(footer?.parentElement)).toContain(
      "@md/table:overflow-hidden"
    );
  });

  it("keeps the footer when a page fails with no rows", () => {
    // The pager lives in the footer, and a request that fails for ONE page
    // leaves the user on that page with nothing. Dropping the footer with the
    // rows takes away the only way back to a page that works, which turns a
    // recoverable error into a dead end. The rows are gone; the navigation out
    // of the failure is not part of the failure.
    render(
      <DataTableView<Row>
        columns={[{ name: "name", header: "Name" }]}
        rows={[]}
        error="Request failed"
        footer={<div data-testid="footer">pager</div>}
      />
    );

    expect(screen.getByRole("alert")).toBeInTheDocument();
    const footer = screen.getByTestId("footer");
    expect(footer).toBeInTheDocument();

    // Presence is not placement, and asserting only presence is what let the
    // footer render outside the card here while every assertion stayed green.
    // The pager has to sit in the SAME surface it occupies when the request
    // succeeds, or a failed page moves it out of the card it normally lives in.
    expect(tokensOf(footer.parentElement)).toContain("@md/table:border");
    expect(tokensOf(footer.parentElement)).toContain(
      "@md/table:overflow-hidden"
    );
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

  // `pagination` is the supported way to paginate a table, so the placement
  // guarantee the two tests above make for `footer` has to hold for it as well.
  // Asserting it only for `footer` would leave the path every list actually
  // uses uncovered, which is the arrangement this file exists to prevent.
  const PAGER = {
    currentPage: 0,
    totalPages: 3,
    pageSize: 10,
    onPageChange: () => {},
    ariaLabel: "Test pagination",
  };

  it("places a pager given as data inside the table's surface", () => {
    render(
      <DataTableView<Row>
        columns={[{ name: "name", header: "Name" }]}
        rows={ROWS}
        pagination={PAGER}
      />
    );

    const pager = screen.getByRole("navigation", { name: "Test pagination" });
    expect(pager).toBeInTheDocument();
    // Presence is not placement. The pager must be INSIDE the bordered surface
    // that holds both views, which is what a caller could get wrong while the
    // pager was passed as markup.
    expect(tokensOf(pager.parentElement)).toContain("@md/table:border");
    expect(tokensOf(pager.parentElement)).toContain(
      "@md/table:overflow-hidden"
    );
  });

  it("keeps a data pager in the same surface when a page fails", () => {
    render(
      <DataTableView<Row>
        columns={[{ name: "name", header: "Name" }]}
        rows={[]}
        error="Request failed"
        pagination={PAGER}
      />
    );

    expect(screen.getByRole("alert")).toBeInTheDocument();
    const pager = screen.getByRole("navigation", { name: "Test pagination" });
    expect(tokensOf(pager.parentElement)).toContain("@md/table:border");
  });

  // The two directions React and JavaScript disagree about. Kept together
  // because fixing either one alone reintroduces the other, which is how this
  // expression collected three rounds of findings.
  it.each([
    ["false", false],
    ["true", true],
    ["an empty string", ""],
    ["null", null],
  ])(
    "draws no footer surface for %s, which React renders as nothing",
    (_l, value) => {
      const { container } = render(
        <DataTableView<Row>
          columns={[{ name: "name", header: "Name" }]}
          rows={[]}
          error="Request failed"
          footer={value}
        />
      );
      // The error path is where it shows: a surface built for a footer that
      // renders nothing is an empty bordered box under the alert.
      expect(container.querySelectorAll(".\\@md\\/table\\:border").length).toBe(
        0
      );
    }
  );

  it("keeps a zero-valued footer, which React renders", () => {
    // `footer` is a ReactNode and `0` is a valid one -- a caller passing
    // `selectedIds.length` with nothing selected renders "0". A truthiness test
    // on the slot drops it, which is content loss wearing a falsy value.
    render(
      <DataTableView<Row>
        columns={[{ name: "name", header: "Name" }]}
        rows={ROWS}
        footer={0}
      />
    );
    expect(screen.getByText("0")).toBeInTheDocument();
  });

  it("renders a custom footer alongside the pager, not instead of it", () => {
    // `footer` is an arbitrary node rather than a pager, so a caller using it
    // for a selection summary or bulk actions and then adopting `pagination`
    // must not lose it. Both props are public and both are permitted by the
    // type, so dropping one silently is content loss with nothing reporting it.
    render(
      <DataTableView<Row>
        columns={[{ name: "name", header: "Name" }]}
        rows={ROWS}
        footer={<div data-testid="footer">3 selected</div>}
        pagination={PAGER}
      />
    );

    const custom = screen.getByTestId("footer");
    const pager = screen.getByRole("navigation", { name: "Test pagination" });
    expect(custom).toBeInTheDocument();
    expect(pager).toBeInTheDocument();

    // Both inside the one surface, since the placement guarantee is what this
    // file exists for and it has to hold for the composed case too.
    expect(tokensOf(custom.parentElement)).toContain("@md/table:border");
    expect(custom.parentElement).toBe(pager.parentElement);

    // Footer first: a summary describes the rows above it, and the pager moves
    // between pages, so the reading order is summary then controls.
    expect(custom.compareDocumentPosition(pager)).toBe(
      Node.DOCUMENT_POSITION_FOLLOWING
    );
  });
});
