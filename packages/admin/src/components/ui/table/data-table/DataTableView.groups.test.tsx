/**
 * Rows in groups and rows that open a region below them, as a reader of the
 * table and a screen-reader user meet them: each group is a row group named by
 * its header's title, its header carries a badge, a count and actions, and a
 * toggle is a real button that says whether what it controls is shown and
 * points at it. Both the table and the narrow card view render in jsdom, so
 * each property is checked in the view it belongs to.
 *
 * @module components/ui/table/data-table/DataTableView.groups.test
 */
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { describe, it, expect, vi, beforeEach } from "vitest";

import { render, screen, within } from "@admin/__tests__/utils";

import { DataTableView } from "./DataTableView";
import type {
  DataTableGroup,
  DataTableGrouping,
  DataTableRowDetail,
  NextlyColumn,
} from "./types";

const { navigateTo } = vi.hoisted(() => ({ navigateTo: vi.fn() }));
vi.mock("@admin/lib/navigation", () => ({
  navigateTo: (href: string) => navigateTo(href),
}));

interface Row extends Record<string, unknown> {
  id: string;
  title: string;
  kind: string;
}

const rows: Row[] = [
  { id: "a", title: "Alpha", kind: "fruit" },
  { id: "b", title: "Beta", kind: "stone" },
  { id: "c", title: "Gamma", kind: "fruit" },
  { id: "d", title: "Delta", kind: "unlisted" },
];

const columns: NextlyColumn<Row>[] = [
  { name: "title", header: "Title" },
  { name: "kind", header: "Kind" },
];

const groups: DataTableGroup[] = [
  {
    id: "fruit",
    title: "Fruit",
    description: "Grows on trees",
    badge: <span data-testid="fruit-badge">Ripe</span>,
    actions: <button type="button">Pick all</button>,
  },
  { id: "stone", title: "Stone", count: "12 in all" },
  { id: "empty", title: "Nothing here" },
];

const grouping: DataTableGrouping<Row> = {
  groups,
  groupOf: row => row.kind,
};

/** The desktop table (both views render in jsdom). */
function table() {
  return within(screen.getByRole("table"));
}

/** The narrow view: everything outside the desktop table. */
function cardView(): HTMLElement {
  const view = document.querySelector<HTMLElement>("[data-view='cards']");
  if (!view) throw new Error("card view not rendered");
  return view;
}

/** The ids an `aria-controls` names, each resolved to its element. */
function controlled(button: HTMLElement): HTMLElement[] {
  const ids = (button.getAttribute("aria-controls") ?? "").split(/\s+/);
  return ids.filter(Boolean).map(id => {
    const el = document.getElementById(id);
    if (!el) throw new Error(`aria-controls names a missing element: ${id}`);
    return el;
  });
}

describe("DataTableView groups", () => {
  beforeEach(() => vi.clearAllMocks());

  it("draws each group as a row group named by its title, its rows under its header", () => {
    render(<DataTableView columns={columns} rows={rows} grouping={grouping} />);
    const fruit = table().getByRole("rowgroup", { name: "Fruit" });
    const stone = table().getByRole("rowgroup", { name: "Stone" });
    // Each group's rows, in the list's order, and no other group's.
    const titlesIn = (group: HTMLElement) =>
      within(group)
        .getAllByRole("row")
        .filter(r => r.hasAttribute("data-row-id"))
        .map(r => r.getAttribute("data-row-id"));
    expect(titlesIn(fruit)).toEqual(["a", "c"]);
    expect(titlesIn(stone)).toEqual(["b"]);
    // The header row is a header for the group, spanning the table.
    const header = within(fruit).getByRole("rowheader");
    expect(header).toHaveAttribute("scope", "rowgroup");
    expect(header).toHaveAttribute("colspan", String(columns.length));
  });

  it("puts the badge, the count, the description and the actions in the header", () => {
    render(<DataTableView columns={columns} rows={rows} grouping={grouping} />);
    const fruit = within(
      within(table().getByRole("rowgroup", { name: "Fruit" })).getByRole(
        "rowheader"
      )
    );
    expect(fruit.getByTestId("fruit-badge")).toHaveTextContent("Ripe");
    expect(fruit.getByText("Grows on trees")).toBeInTheDocument();
    expect(fruit.getByRole("button", { name: "Pick all" })).toBeInTheDocument();
    // The count is derived from the group's rows, and said in words.
    expect(fruit.getByText("2 rows")).toBeInTheDocument();
    // A count the page states (a total across pages) replaces the derived one.
    const stone = within(table().getByRole("rowgroup", { name: "Stone" }));
    expect(stone.getByText("12 in all")).toBeInTheDocument();
    expect(stone.queryByText("1 row")).toBeNull();
  });

  it("draws a listed group with no rows, and a row of an unlisted group after the groups", () => {
    render(<DataTableView columns={columns} rows={rows} grouping={grouping} />);
    const empty = table().getByRole("rowgroup", { name: "Nothing here" });
    expect(within(empty).getByText("0 rows")).toBeInTheDocument();
    const bodies = [...screen.getByRole("table").querySelectorAll("tbody")];
    const last = bodies[bodies.length - 1];
    expect(last.querySelector("[data-row-id='d']")).not.toBeNull();
    expect(last).not.toHaveAttribute("aria-labelledby");
  });

  it("draws the groups rather than the empty message when there are groups but no rows", () => {
    render(
      <DataTableView
        columns={columns}
        rows={[]}
        grouping={grouping}
        emptyMessage="Nothing at all"
      />
    );
    expect(
      table().getByRole("rowgroup", { name: "Fruit" })
    ).toBeInTheDocument();
    expect(screen.queryByText("Nothing at all")).toBeNull();
  });

  it("folds a collapsible group's rows behind a button that says so and points at them", async () => {
    const user = userEvent.setup();
    const onCollapsedChange = vi.fn();
    render(
      <DataTableView
        columns={columns}
        rows={rows}
        grouping={{ ...grouping, collapsible: true, onCollapsedChange }}
      />
    );
    const fruit = table().getByRole("rowgroup", { name: "Fruit" });
    const toggle = within(fruit).getByRole("button", { name: "Fruit" });
    expect(toggle).toHaveAttribute("aria-expanded", "true");
    const rowsOf = controlled(toggle);
    expect(rowsOf.map(r => r.getAttribute("data-row-id"))).toEqual(["a", "c"]);
    rowsOf.forEach(r => expect(r).toBeVisible());

    await user.click(toggle);
    expect(toggle).toHaveAttribute("aria-expanded", "false");
    controlled(toggle).forEach(r => expect(r).not.toBeVisible());
    expect(onCollapsedChange).toHaveBeenLastCalledWith(["fruit"]);
    // The other groups are untouched.
    const stone = table().getByRole("rowgroup", { name: "Stone" });
    expect(
      within(stone).getByRole("button", { name: "Stone" })
    ).toHaveAttribute("aria-expanded", "true");

    // The keyboard reaches the same button and Enter unfolds it again.
    toggle.focus();
    await user.keyboard("{Enter}");
    expect(toggle).toHaveAttribute("aria-expanded", "true");
    expect(onCollapsedChange).toHaveBeenLastCalledWith([]);
  });

  it("follows the page's collapsed ids when the page owns them", async () => {
    const user = userEvent.setup();
    function Owned() {
      const [collapsedIds, setCollapsed] = useState<string[]>(["stone"]);
      return (
        <>
          <output data-testid="owned">{collapsedIds.join(",")}</output>
          <DataTableView
            columns={columns}
            rows={rows}
            grouping={{
              ...grouping,
              collapsible: true,
              collapsedIds,
              onCollapsedChange: setCollapsed,
            }}
          />
        </>
      );
    }
    render(<Owned />);
    const stone = table().getByRole("rowgroup", { name: "Stone" });
    const toggle = within(stone).getByRole("button", { name: "Stone" });
    expect(toggle).toHaveAttribute("aria-expanded", "false");
    await user.click(toggle);
    expect(screen.getByTestId("owned")).toHaveTextContent("");
    expect(toggle).toHaveAttribute("aria-expanded", "true");
  });

  it("gives a group with no rows nothing to fold", () => {
    render(
      <DataTableView
        columns={columns}
        rows={rows}
        grouping={{ ...grouping, collapsible: true }}
      />
    );
    const empty = table().getByRole("rowgroup", { name: "Nothing here" });
    expect(within(empty).queryByRole("button")).toBeNull();
  });

  it("draws each group as a named section in the card view, folding its cards", async () => {
    const user = userEvent.setup();
    render(
      <DataTableView
        columns={columns}
        rows={rows}
        grouping={{ ...grouping, collapsible: true }}
      />
    );
    const fruit = within(cardView()).getByRole("region", { name: "Fruit" });
    expect(within(fruit).getByText("Alpha")).toBeInTheDocument();
    expect(within(fruit).getByText("Gamma")).toBeInTheDocument();
    expect(within(fruit).queryByText("Beta")).toBeNull();
    expect(within(fruit).getByText("2 rows")).toBeInTheDocument();
    const toggle = within(fruit).getByRole("button", { name: "Fruit" });
    const [cards] = controlled(toggle);
    expect(cards).toBeVisible();
    await user.click(toggle);
    expect(toggle).toHaveAttribute("aria-expanded", "false");
    expect(cards).not.toBeVisible();
  });
});

describe("DataTableView row detail", () => {
  beforeEach(() => vi.clearAllMocks());

  const detail: DataTableRowDetail<Row> = {
    render: row => <p>Inside {row.title}</p>,
    hasDetail: row => row.id !== "d",
  };

  it("opens a region below a row from a button that says whether it is open", async () => {
    const user = userEvent.setup();
    const render_ = vi.fn(detail.render);
    const onExpandedChange = vi.fn();
    render(
      <DataTableView
        columns={columns}
        rows={rows}
        rowDetail={{ ...detail, render: render_, onExpandedChange }}
      />
    );
    const toggle = table().getByRole("button", { name: "Details Alpha" });
    expect(toggle).toHaveAttribute("aria-expanded", "false");
    // Closed: the region is not shown and its content is never asked for.
    const [region] = controlled(toggle);
    expect(region).not.toBeVisible();
    expect(render_).not.toHaveBeenCalled();

    await user.click(toggle);
    expect(toggle).toHaveAttribute("aria-expanded", "true");
    const [opened] = controlled(toggle);
    expect(opened).toBeVisible();
    // The region is named by the row it belongs to and holds its content.
    const named = table().getByRole("region", { name: "Alpha" });
    expect(opened.contains(named) || named.contains(opened)).toBe(true);
    expect(within(named).getByText("Inside Alpha")).toBeInTheDocument();
    expect(onExpandedChange).toHaveBeenLastCalledWith(["a"]);
    // The region sits directly below its row.
    const row = screen
      .getByRole("table")
      .querySelector<HTMLElement>("tr[data-row-id='a']");
    expect(row?.nextElementSibling?.contains(named)).toBe(true);
  });

  it("gives a row with nothing to open no toggle, and keeps the columns in line", () => {
    render(<DataTableView columns={columns} rows={rows} rowDetail={detail} />);
    const delta = screen
      .getByRole("table")
      .querySelector<HTMLElement>("tr[data-row-id='d']");
    if (!delta) throw new Error("row d not rendered");
    expect(within(delta).queryByRole("button")).toBeNull();
    // Every row has the toggle's column, so the cells stay under their headers.
    const headerCells = table().getAllByRole("columnheader").length;
    expect(delta.querySelectorAll("td")).toHaveLength(headerCells);
  });

  it("runs the toggle from the keyboard without running the row's way in", async () => {
    const user = userEvent.setup();
    render(
      <DataTableView
        columns={columns}
        rows={rows}
        rowDetail={detail}
        rowHref={row => `/items/${row.id}`}
      />
    );
    const toggle = table().getByRole("button", { name: "Details Beta" });
    toggle.focus();
    await user.keyboard(" ");
    expect(toggle).toHaveAttribute("aria-expanded", "true");
    await user.click(toggle);
    expect(toggle).toHaveAttribute("aria-expanded", "false");
    expect(navigateTo).not.toHaveBeenCalled();
  });

  it("names the toggle as the page says, and follows the page's open ids", async () => {
    const user = userEvent.setup();
    const onExpandedChange = vi.fn();
    render(
      <DataTableView
        columns={columns}
        rows={rows}
        rowDetail={{
          ...detail,
          toggleLabel: row => `Pages for ${row.title}`,
          expandedIds: ["b"],
          onExpandedChange,
        }}
      />
    );
    const beta = table().getByRole("button", { name: "Pages for Beta" });
    expect(beta).toHaveAttribute("aria-expanded", "true");
    expect(table().getByText("Inside Beta")).toBeInTheDocument();
    // Owned by the page: a click asks, and nothing changes until it answers.
    await user.click(beta);
    expect(onExpandedChange).toHaveBeenLastCalledWith([]);
    expect(beta).toHaveAttribute("aria-expanded", "true");
  });

  it("opens rows given as open at first", () => {
    render(
      <DataTableView
        columns={columns}
        rows={rows}
        rowDetail={{ ...detail, defaultExpandedIds: ["c"] }}
      />
    );
    expect(
      table().getByRole("button", { name: "Details Gamma" })
    ).toHaveAttribute("aria-expanded", "true");
    expect(table().getByText("Inside Gamma")).toBeInTheDocument();
  });

  it("opens a card's region from a toggle in the card, without opening the card", async () => {
    const user = userEvent.setup();
    render(
      <DataTableView
        columns={columns}
        rows={rows}
        rowDetail={detail}
        rowHref={row => `/items/${row.id}`}
      />
    );
    const toggle = within(cardView()).getByRole("button", {
      name: "Details Alpha",
    });
    expect(toggle).toHaveAttribute("aria-expanded", "false");
    await user.click(toggle);
    expect(toggle).toHaveAttribute("aria-expanded", "true");
    const [region] = controlled(toggle);
    expect(region).toBeVisible();
    expect(within(region).getByText("Inside Alpha")).toBeInTheDocument();
    expect(navigateTo).not.toHaveBeenCalled();
    // The card view and the table share one open state.
    expect(
      table().getByRole("button", { name: "Details Alpha" })
    ).toHaveAttribute("aria-expanded", "true");
  });

  it("opens rows inside groups", async () => {
    const user = userEvent.setup();
    render(
      <DataTableView
        columns={columns}
        rows={rows}
        grouping={grouping}
        rowDetail={detail}
      />
    );
    const fruit = table().getByRole("rowgroup", { name: "Fruit" });
    // The header spans the toggle's column too.
    expect(within(fruit).getByRole("rowheader")).toHaveAttribute(
      "colspan",
      String(columns.length + 1)
    );
    await user.click(
      within(fruit).getByRole("button", { name: "Details Gamma" })
    );
    expect(within(fruit).getByText("Inside Gamma")).toBeInTheDocument();
  });
});
