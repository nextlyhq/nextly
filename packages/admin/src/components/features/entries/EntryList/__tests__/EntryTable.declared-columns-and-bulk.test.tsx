/**
 * Plugins' declared columns and bulk actions in the entry table: columns drawn
 * after the collection's own, in the order delivered, a field column through
 * the field's own cell and a component column one cell at a time, each behind
 * its own boundary; bulk actions offered in the bulk bar on a selection, run
 * with the rows selected.
 *
 * The real table and bulk bar, as the offered-actions test renders them; only
 * the permission answers are stubbed.
 */
import userEvent from "@testing-library/user-event";
import type { DeliveredAdminEntry } from "nextly/config";
import { describe, expect, it, vi } from "vitest";

import { render, screen, within } from "@admin/__tests__/utils";
import { registerComponent } from "@admin/lib/plugins/component-registry";

import { declaredColumns } from "../declared-columns";
import { EntryTable, type EntryTableProps } from "../EntryTable";
import type { CollectionForColumns } from "../EntryTableColumns";

vi.mock("@admin/hooks/useCan", () => ({
  // Deleting is allowed, so rows can be selected and the bulk bar shows.
  useCan: (slug: string) => slug === "delete-posts",
}));
vi.mock("@admin/hooks/useLocalization", () => ({
  useLocalization: () => ({
    enabled: false,
    locales: [],
    defaultLocale: "en",
    fallback: true,
    getLocale: () => undefined,
  }),
}));

const posts: CollectionForColumns = {
  slug: "posts",
  label: "Posts",
  status: true,
  fields: [
    { type: "text", name: "title", label: "Title" } as never,
    { type: "text", name: "excerpt", label: "Excerpt" } as never,
  ],
};
const CONTEXT = { userId: "u1", collection: "posts" };

const CELL = "@acme/a/admin#Cell";
registerComponent(CELL, ((props: { row: { id: string } }) => {
  if (props.row.id === "p1") throw new Error("this cell failed to draw");
  return <span>plugin cell {props.row.id}</span>;
}) as never);

function column(id: string, label: string, extra: object): DeliveredAdminEntry {
  return {
    plugin: "@acme/a",
    id,
    kind: "column",
    label,
    ...extra,
  } as DeliveredAdminEntry;
}

function renderTable(props: Partial<EntryTableProps> = {}): void {
  render(
    <EntryTable
      collection={posts}
      entries={[
        { id: "p1", title: "First", excerpt: "One" },
        { id: "p2", title: "Second", excerpt: "Two" },
      ]}
      pagination={{ page: 0, limit: 10, total: 2, totalPages: 1 }}
      onPageChange={vi.fn()}
      onLimitChange={vi.fn()}
      onSortChange={vi.fn()}
      onSearchChange={vi.fn()}
      onEdit={vi.fn()}
      onDelete={vi.fn()}
      onBulkDelete={vi.fn()}
      {...props}
    />
  );
}

const table = () =>
  within(screen.getByRole("table", { name: "Entries table" }));

describe("the entry table's declared columns", () => {
  it("a declared column appears in order", () => {
    // Delivered component first, field second: drawn as sent, after the
    // collection's own columns.
    renderTable({
      declaredColumns: declaredColumns(
        [
          column("acme-a.cell", "Fixture: cell", { component: CELL }),
          column("acme-a.excerpt", "Fixture: excerpt", { field: "excerpt" }),
        ],
        posts,
        CONTEXT
      ),
    });

    const headers = table()
      .getAllByRole("columnheader")
      .map(header => header.textContent?.trim() ?? "");
    const at = (label: string) => headers.indexOf(label);
    expect(at("Fixture: cell")).toBeGreaterThan(at("Title"));
    expect(at("Fixture: excerpt")).toBe(at("Fixture: cell") + 1);
    // The field column draws the field's value through the field's own cell.
    expect(table().getAllByText("Two").length).toBeGreaterThan(0);
  });

  it("a throwing cell draws its fallback in that cell only", () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    renderTable({
      declaredColumns: declaredColumns(
        [column("acme-a.cell", "Fixture: cell", { component: CELL })],
        posts,
        CONTEXT
      ),
    });

    // The second row's cell draws; the first row's failed alone, its own
    // fallback naming the component, and the rest of the row stands.
    expect(table().getByText("plugin cell p2")).toBeTruthy();
    expect(table().queryByText("plugin cell p1")).toBeNull();
    expect(table().getByText(CELL, { exact: false })).toBeTruthy();
    expect(table().getByText("First")).toBeTruthy();
  });
});

describe("the entry table's declared bulk actions", () => {
  it("a declared bulk action shows with a selection and runs with the selected rows", async () => {
    const onSelect = vi.fn();
    const user = userEvent.setup();
    renderTable({
      declaredBulkActions: [
        {
          id: "declared:acme-a.inspect",
          label: "Fixture: inspect selected",
          isDisabled: () => false,
          onSelect,
        },
      ],
    });

    // Nothing selected, no bulk bar, so no action.
    expect(
      screen.queryByRole("button", { name: "Fixture: inspect selected" })
    ).toBeNull();

    for (const box of table().getAllByRole("checkbox").slice(1)) {
      await user.click(box);
    }
    const bar = within(screen.getByRole("region", { name: "Bulk actions" }));
    await user.click(
      bar.getByRole("button", { name: "Fixture: inspect selected" })
    );

    expect(onSelect).toHaveBeenCalledWith(["p1", "p2"]);
  });

  it("is held back on a selection it is not offered on", async () => {
    const user = userEvent.setup();
    renderTable({
      declaredBulkActions: [
        {
          id: "declared:acme-a.inspect",
          label: "Fixture: inspect selected",
          isDisabled: ids => ids.includes("p2"),
          onSelect: vi.fn(),
        },
      ],
    });

    const boxes = table().getAllByRole("checkbox").slice(1);
    await user.click(boxes[0]!);
    const action = () =>
      within(screen.getByRole("region", { name: "Bulk actions" })).getByRole(
        "button",
        { name: "Fixture: inspect selected" }
      );
    expect(action()).not.toBeDisabled();
    await user.click(boxes[1]!);
    expect(action()).toBeDisabled();
  });
});
