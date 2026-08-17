/**
 * What this component is FOR, expressed as assertions.
 *
 * ListView exists because the strip above a list was composed at each call
 * site, so the properties worth pinning are the ones a call site used to be
 * free to get wrong: whether a toolbar row is drawn at all, whether the columns
 * control is reachable, and which empty state a filtered list shows.
 */
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { ListView } from "../index";

interface Row extends Record<string, unknown> {
  id: string;
  name: string;
}

const COLUMNS = [
  { name: "name", header: "Name" },
  { name: "email", header: "Email" },
];
const ROWS: Row[] = [{ id: "1", name: "first" }];

const noop = () => {};

function renderList(props: Partial<Parameters<typeof ListView<Row>>[0]> = {}) {
  return render(<ListView<Row> columns={COLUMNS} rows={ROWS} {...props} />);
}

describe("ListView toolbar", () => {
  /**
   * An empty flex row still contributes its gap to the column above the table.
   * That stray space is the shape of the inconsistency this component removes,
   * so "draws nothing" has to be a tested property rather than an accident.
   */
  /**
   * Asserted on the toolbar ELEMENT, not on the controls inside it. An empty
   * toolbar row and an absent one contain the same nothing, so a test looking
   * for the search field or the buttons passes in both cases — it was written
   * that way first, and a control that forced the row to render did not fail
   * it.
   */
  it("draws no toolbar row when there is nothing to put in it", () => {
    const { container } = renderList();
    expect(container.querySelector("[data-slot='list-toolbar']")).toBeNull();
  });

  it("draws the toolbar row as soon as it has something to carry", () => {
    const { container } = renderList({
      search: { value: "", onChange: noop, placeholder: "Search users..." },
    });
    expect(container.querySelector("[data-slot='list-toolbar']")).toBeTruthy();
    expect(screen.getByPlaceholderText("Search users...")).toBeTruthy();
  });

  /**
   * The control existed for one surface out of sixteen. Reachability from the
   * shared component is the whole point of lifting it, so it is asserted in
   * both directions rather than only when present.
   */
  it("offers the columns control only when one is supplied", () => {
    const { unmount } = renderList();
    expect(screen.queryByRole("button", { name: /columns/i })).toBeNull();
    unmount();

    renderList({
      columnsControl: {
        columns: COLUMNS,
        isColumnVisible: () => true,
        onToggleColumn: noop,
      },
    });
    expect(screen.getByRole("button", { name: /columns/i })).toBeTruthy();
  });
});

describe("ListView empty states", () => {
  it("shows the empty state instead of the table when there are no rows", () => {
    renderList({ rows: [], empty: { title: "No users yet" } });
    expect(screen.getByText("No users yet")).toBeTruthy();
    expect(screen.queryByRole("table")).toBeNull();
  });

  /**
   * The positive control for the assertion above: with rows present the table
   * renders and the empty state does not. Without it, a ListView that rendered
   * NOTHING would satisfy "no table" just as well.
   */
  it("shows the table, and no empty state, when rows are present", () => {
    renderList({ empty: { title: "No users yet" } });
    expect(screen.getByRole("table")).toBeTruthy();
    expect(screen.queryByText("No users yet")).toBeNull();
  });

  /**
   * The defect this pair prevents: a fruitless search showing "create your
   * first record", which tells the reader their data is gone when it is only
   * filtered out.
   */
  it("prefers the filtered empty state while a search term is applied", () => {
    renderList({
      rows: [],
      search: { value: "zzz", onChange: noop },
      empty: { title: "No users yet" },
      emptyFiltered: { title: "No users match your search" },
    });
    expect(screen.getByText("No users match your search")).toBeTruthy();
    expect(screen.queryByText("No users yet")).toBeNull();
  });

  it("prefers the filtered empty state while a filter is applied", () => {
    renderList({
      rows: [],
      hasActiveFilters: true,
      empty: { title: "No users yet" },
      emptyFiltered: { title: "No users match your filters" },
    });
    expect(screen.getByText("No users match your filters")).toBeTruthy();
  });

  it("falls back to the plain empty state when no filtered one is given", () => {
    renderList({
      rows: [],
      search: { value: "zzz", onChange: noop },
      empty: { title: "No users yet" },
    });
    expect(screen.getByText("No users yet")).toBeTruthy();
  });

  /**
   * An empty state rendered during a pending query announces "nothing here"
   * about a list nobody has read yet. Loading and error belong to the engine.
   */
  it("does not stand in for the table while the list is loading", () => {
    renderList({ rows: [], loading: true, empty: { title: "No users yet" } });
    expect(screen.queryByText("No users yet")).toBeNull();
  });

  it("does not stand in for the table when the list errored", () => {
    renderList({
      rows: [],
      error: "boom",
      empty: { title: "No users yet" },
    });
    expect(screen.queryByText("No users yet")).toBeNull();
  });
});

describe("ListView slots", () => {
  /**
   * `beforeList` sits above the toolbar and `beforeTable` below it. That is the
   * only reason both exist, so the order is the property under test.
   */
  it("renders the slots around the toolbar in document order", () => {
    const { container } = render(
      <ListView<Row>
        columns={COLUMNS}
        rows={ROWS}
        search={{ value: "", onChange: noop, placeholder: "Search..." }}
        slots={{
          beforeList: <div data-slot-mark="before-list" />,
          beforeTable: <div data-slot-mark="before-table" />,
          afterTable: <div data-slot-mark="after-table" />,
          afterList: <div data-slot-mark="after-list" />,
        }}
      />
    );

    // Scoped to this test's OWN marker attribute. Matching on `data-testid`
    // also selects the search field, which carries one of its own — so the
    // assertion would be about SearchBar's internals as much as slot order.
    const marks = [
      ...container.querySelectorAll("[data-slot-mark], table"),
    ].map(el => el.getAttribute("data-slot-mark") ?? el.tagName.toLowerCase());

    expect(marks).toEqual([
      "before-list",
      "before-table",
      "table",
      "after-table",
      "after-list",
    ]);
  });

  /**
   * The selection bar acts on rows, so it belongs between the toolbar and the
   * table. Above the toolbar it would displace search and filters the moment a
   * checkbox is ticked.
   */
  it("places the bulk bar below the toolbar and above the table", () => {
    const { container } = render(
      <ListView<Row>
        columns={COLUMNS}
        rows={ROWS}
        bulkBar={<div data-slot-mark="bulk" />}
        search={{ value: "", onChange: noop, placeholder: "Search..." }}
      />
    );

    const input = container.querySelector("input");
    const bulk = container.querySelector("[data-slot-mark='bulk']");
    const table = container.querySelector("table");
    expect(input && bulk && table).toBeTruthy();

    const follows = (a: Element, b: Element) =>
      Boolean(a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING);
    expect(follows(input!, bulk!)).toBe(true);
    expect(follows(bulk!, table!)).toBe(true);
  });
});

describe("ListView skeleton", () => {
  /**
   * A surface that supplies a skeleton keeps its toolbar mounted through the
   * load, so the search field does not disappear and reappear.
   */
  it("stands in for the table while loading, leaving the toolbar mounted", () => {
    const { container } = render(
      <ListView<Row>
        columns={COLUMNS}
        rows={[]}
        loading
        skeleton={<div data-slot-mark="skeleton" />}
        search={{ value: "", onChange: noop, placeholder: "Search..." }}
      />
    );

    expect(container.querySelector("[data-slot-mark='skeleton']")).toBeTruthy();
    expect(container.querySelector("table")).toBeNull();
    expect(container.querySelector("input")).toBeTruthy();
  });

  it("renders the table once loading finishes", () => {
    const { container } = render(
      <ListView<Row>
        columns={COLUMNS}
        rows={ROWS}
        skeleton={<div data-slot-mark="skeleton" />}
      />
    );
    expect(container.querySelector("[data-slot-mark='skeleton']")).toBeNull();
    expect(container.querySelector("table")).toBeTruthy();
  });
});
