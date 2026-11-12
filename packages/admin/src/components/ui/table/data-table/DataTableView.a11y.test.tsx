/**
 * The semantics assistive technology reads from a list: a header cell stays a
 * column header and carries the sort state, a row or card is never a control
 * that holds other controls, and each row's way in is a real link or button
 * with a pointer target of at least 24px.
 *
 * @module components/ui/table/data-table/DataTableView.a11y.test
 */
import userEvent from "@testing-library/user-event";
import { describe, it, expect, vi, beforeEach } from "vitest";

import { render, screen, within } from "@admin/__tests__/utils";

import { DataTableView } from "./DataTableView";
import type { DataTableSelection } from "./DataTableView";
import type { NextlyColumn } from "./types";

const { navigateTo } = vi.hoisted(() => ({ navigateTo: vi.fn() }));
vi.mock("@admin/lib/navigation", () => ({
  navigateTo: (href: string) => navigateTo(href),
}));

interface Row extends Record<string, unknown> {
  id: string;
  title: string;
  status: string;
}

const rows: Row[] = [
  { id: "1", title: "First post", status: "draft" },
  { id: "2", title: "Second post", status: "published" },
];

const columns: NextlyColumn<Row>[] = [
  { name: "title", header: "Title", sortable: true },
  { name: "status", header: "Status" },
];

const selection: DataTableSelection<Row> = {
  selectedIds: [],
  onToggle: () => undefined,
  onToggleAll: () => undefined,
};

/** The desktop table (both views render in jsdom). */
function table() {
  return within(screen.getByRole("table"));
}

/** The narrow-width row cards. */
function cards(): HTMLElement[] {
  return [...document.querySelectorAll<HTMLElement>('[data-slot^="card."]')];
}

/**
 * Elements that make a widget of their own: what axe's `nested-interactive`
 * looks for around a control.
 */
const WIDGET = "[role], [tabindex], a[href], button, input, select, textarea";

describe("DataTableView header semantics", () => {
  beforeEach(() => vi.clearAllMocks());

  it("keeps sortable headers as column headers carrying aria-sort", () => {
    render(
      <DataTableView
        columns={columns}
        rows={rows}
        sort={{ field: "title", order: "desc" }}
        onSortChange={() => undefined}
      />
    );
    const [title, status] = table().getAllByRole("columnheader");

    // The cell is still a column header, the role aria-sort is allowed on,
    // and nothing overrides it.
    expect(title).not.toHaveAttribute("role");
    expect(title).not.toHaveAttribute("tabindex");
    expect(title).toHaveAttribute("aria-sort", "descending");
    // A column that cannot be sorted states no sort at all.
    expect(status).not.toHaveAttribute("aria-sort");
  });

  it("marks a sortable but unsorted column as none", () => {
    render(
      <DataTableView
        columns={columns}
        rows={rows}
        onSortChange={() => undefined}
      />
    );
    const [title] = table().getAllByRole("columnheader");
    expect(title).toHaveAttribute("aria-sort", "none");
  });

  it("sorts from a button inside the header, by keyboard as well", async () => {
    const onSortChange = vi.fn();
    const user = userEvent.setup();
    render(
      <DataTableView
        columns={columns}
        rows={rows}
        onSortChange={onSortChange}
      />
    );
    const [title, status] = table().getAllByRole("columnheader");
    const sortButton = within(title).getByRole("button", { name: "Title" });

    sortButton.focus();
    await user.keyboard("{Enter}");
    expect(onSortChange).toHaveBeenCalledWith("title", "asc");
    // The unsortable header holds no control.
    expect(within(status).queryByRole("button")).toBeNull();
  });
});

describe("DataTableView row semantics", () => {
  beforeEach(() => vi.clearAllMocks());

  it("makes neither rows nor cards controls, and links each row from its title", () => {
    render(
      <DataTableView
        columns={columns}
        rows={rows}
        rowHref={row => `/admin/collections/posts/${row.id}`}
        selection={selection}
      />
    );
    const bodyRows = table().getAllByRole("row").slice(1);
    expect(bodyRows).toHaveLength(2);
    for (const row of [...bodyRows, ...cards()]) {
      expect(row).not.toHaveAttribute("role");
      expect(row).not.toHaveAttribute("tabindex");
    }
    expect(cards()).toHaveLength(2);

    // The way in: one link per row in each view.
    const links = screen.getAllByRole("link", { name: "First post" });
    expect(links).toHaveLength(2);
    for (const link of links) {
      expect(link).toHaveAttribute("href", "/admin/collections/posts/1");
    }
  });

  it("holds the selection box in no other control", () => {
    render(
      <DataTableView
        columns={columns}
        rows={rows}
        rowHref={row => `/x/${row.id}`}
        selection={selection}
      />
    );
    const boxes = screen.getAllByRole("checkbox", { name: "Select row" });
    expect(boxes.length).toBeGreaterThan(0);
    for (const box of boxes) {
      expect(box.parentElement?.closest(WIDGET)).toBeNull();
    }
  });

  it("gives a row with only a click handler a button as its way in", async () => {
    const onRowClick = vi.fn();
    const user = userEvent.setup();
    render(
      <DataTableView
        columns={columns}
        rows={rows}
        onRowClick={row => onRowClick(row.id)}
        selection={selection}
      />
    );
    for (const row of [...table().getAllByRole("row").slice(1), ...cards()]) {
      expect(row).not.toHaveAttribute("role");
      expect(row).not.toHaveAttribute("tabindex");
    }
    const button = table().getByRole("button", { name: "Second post" });
    button.focus();
    await user.keyboard("{Enter}");
    expect(onRowClick).toHaveBeenCalledTimes(1);
    expect(onRowClick).toHaveBeenCalledWith("2");
  });

  it("still navigates when a pointer clicks elsewhere on the row", async () => {
    const user = userEvent.setup();
    render(
      <DataTableView
        columns={columns}
        rows={rows}
        rowHref={row => `/x/${row.id}`}
      />
    );
    await user.click(table().getByText("published"));
    expect(navigateTo).toHaveBeenCalledWith("/x/2");
  });

  it("falls back to the first shown column when the primary one is hidden", () => {
    render(
      <DataTableView
        columns={[
          { name: "title", header: "Title", hidden: true },
          { name: "status", header: "Status" },
        ]}
        rows={rows}
        primaryColumn="title"
        rowHref={row => `/x/${row.id}`}
      />
    );
    expect(table().getByRole("link", { name: "draft" })).toHaveAttribute(
      "href",
      "/x/1"
    );
  });
});

describe("DataTableView target size", () => {
  it("gives the title link a 24px target without a taller row", () => {
    render(
      <DataTableView
        columns={columns}
        rows={rows}
        rowHref={row => `/x/${row.id}`}
      />
    );
    const link = table().getByRole("link", { name: "First post" });
    const tokens = [...link.classList];
    // A block box, so the padding counts toward its height: 2px above and
    // below 20px text make 24px, and the matching negative margin keeps the
    // line, and so the row, at the text's height.
    expect(tokens).toContain("inline-block");
    expect(tokens).toContain("py-0.5");
    expect(tokens).toContain("-my-0.5");
  });
});
