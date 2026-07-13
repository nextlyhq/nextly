import userEvent from "@testing-library/user-event";
import { describe, it, expect, vi, beforeEach } from "vitest";

import { render, screen, within } from "@admin/__tests__/utils";

import { DataTableView } from "./DataTableView";
import type { DataTableSelection } from "./DataTableView";
import type { NextlyColumn } from "./types";

// Stub navigation so href-driven rows are inspectable without a router.
const navigateTo = vi.fn();
vi.mock("@admin/lib/navigation", () => ({
  navigateTo: (href: string) => navigateTo(href),
}));

interface Row extends Record<string, unknown> {
  id: string;
  name: string;
  role: string;
}

const rows: Row[] = [
  { id: "1", name: "Ada", role: "admin" },
  { id: "2", name: "Bo", role: "editor" },
];

const columns: NextlyColumn<Row>[] = [
  { name: "name", header: "Name" },
  { name: "role", header: "Role" },
];

/** Scope queries to the desktop table (both views render in jsdom). */
function table() {
  return within(screen.getByRole("table"));
}

describe("DataTableView", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("renders rows through the cell registry", () => {
    render(<DataTableView columns={columns} rows={rows} />);
    expect(table().getByText("Ada")).toBeInTheDocument();
    expect(table().getByText("editor")).toBeInTheDocument();
  });

  it("shows the empty message when there are no rows", () => {
    render(
      <DataTableView columns={columns} rows={[]} emptyMessage="Nothing here" />
    );
    // Rendered in both the card and table empty states.
    expect(screen.getAllByText("Nothing here").length).toBeGreaterThan(0);
  });

  it("renders the primary column as a navigation link when rowHref yields an href", () => {
    render(
      <DataTableView
        columns={columns}
        rows={rows}
        rowHref={row => `/admin/users/${row.id}`}
      />
    );
    const link = table().getByRole("link", { name: "Ada" });
    expect(link).toHaveAttribute("href", "/admin/users/1");
  });

  it("runs onRowClick as a side-effect instead of navigating", async () => {
    const openDialog = vi.fn();
    const user = userEvent.setup();
    render(
      <DataTableView
        columns={columns}
        rows={rows}
        onRowClick={row => openDialog(row.id)}
      />
    );
    // The handler must not fire during render, only on click.
    expect(openDialog).not.toHaveBeenCalled();
    await user.click(table().getByText("Ada"));
    expect(openDialog).toHaveBeenCalledWith("1");
    expect(navigateTo).not.toHaveBeenCalled();
  });

  it("renders row actions and fires onSelect", async () => {
    const onEdit = vi.fn();
    const user = userEvent.setup();
    render(
      <DataTableView
        columns={columns}
        rows={rows}
        rowActions={() => [
          { id: "edit", label: "Edit", onSelect: row => onEdit(row.id) },
        ]}
      />
    );
    // One trigger per row per view; open the first within the table.
    const triggers = table().getAllByRole("button", { name: "Row actions" });
    await user.click(triggers[0]);
    await user.click(await screen.findByText("Edit"));
    expect(onEdit).toHaveBeenCalledWith("1");
  });

  it("supports controlled selection and select-all", async () => {
    const onToggleAll = vi.fn();
    const onToggle = vi.fn();
    const user = userEvent.setup();
    const selection: DataTableSelection<Row> = {
      selectedIds: [],
      onToggle: row => onToggle(row.id),
      onToggleAll,
    };
    render(
      <DataTableView columns={columns} rows={rows} selection={selection} />
    );
    await user.click(table().getByRole("checkbox", { name: "Select all" }));
    expect(onToggleAll).toHaveBeenCalledWith(rows, false);
  });

  it("does not navigate when the row checkbox is clicked (stopPropagation)", async () => {
    const onToggle = vi.fn();
    const user = userEvent.setup();
    const selection: DataTableSelection<Row> = {
      selectedIds: [],
      onToggle: row => onToggle(row.id),
      onToggleAll: vi.fn(),
    };
    render(
      <DataTableView
        columns={columns}
        rows={rows}
        rowHref={() => "/x"}
        selection={selection}
      />
    );
    const rowCheckbox = table().getAllByRole("checkbox", {
      name: "Select row",
    })[0];
    await user.click(rowCheckbox);
    expect(onToggle).toHaveBeenCalledWith("1");
    expect(navigateTo).not.toHaveBeenCalled();
  });
});
