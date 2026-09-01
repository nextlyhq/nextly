// @vitest-environment jsdom
/**
 * The property under test: a column the reader's stored choice hides is gone
 * from the rendered table — header and cells both — while the columns kept
 * visible still render. Header queries are scoped to the table because the
 * toolbar's column menu lists every toggleable column by design.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

import { render, screen, within } from "@admin/__tests__/utils";

import FieldGroupTable from "../FieldGroupTable";

const { useFieldGroups, useDeleteFieldGroup, useBulkDeleteFieldGroups } =
  vi.hoisted(() => ({
    useFieldGroups: vi.fn(),
    useDeleteFieldGroup: vi.fn(),
    useBulkDeleteFieldGroups: vi.fn(),
  }));

vi.mock("@admin/hooks/queries", () => ({
  useFieldGroups: (params: unknown) => useFieldGroups(params),
  useDeleteFieldGroup: () => useDeleteFieldGroup(),
  useBulkDeleteFieldGroups: () => useBulkDeleteFieldGroups(),
}));

/** The field-groups list's toggleable columns, in declaration order. */
const TOGGLEABLE = ["admin", "source", "migrationStatus", "fields"];

function seedStoredChoice(visible: string[]): void {
  localStorage.setItem(
    "nextly-column-visibility-field-groups",
    JSON.stringify({
      columns: visible,
      defaultsHash: [...TOGGLEABLE].sort().join(","),
    })
  );
}

beforeEach(() => {
  localStorage.clear();
  useDeleteFieldGroup.mockReturnValue({ mutate: vi.fn(), isPending: false });
  useBulkDeleteFieldGroups.mockReturnValue({
    mutate: vi.fn(),
    isPending: false,
  });
  useFieldGroups.mockReturnValue({
    data: {
      items: [
        {
          id: "fg_1",
          label: "Hero Section",
          slug: "hero-section",
          source: "ui",
          migrationStatus: "synced",
          admin: { category: "Layout" },
          locked: false,
        },
      ],
      meta: { page: 1, pageSize: 10, totalItems: 1, totalPages: 1 },
    },
    isLoading: false,
    isFetching: false,
    isError: false,
    error: null,
  });
});

describe("FieldGroupTable columns", () => {
  it("omits the header and cells of a column the stored choice hides", () => {
    seedStoredChoice(TOGGLEABLE.filter(name => name !== "admin"));
    render(<FieldGroupTable />);
    const table = screen.getByRole("table");
    // The SOURCE header is the positive control: a header this query CAN find
    // inside the table, so the CATEGORY absence below is the hidden column
    // and not a string that never renders at all.
    expect(within(table).getAllByText("SOURCE").length).toBeGreaterThan(0);
    expect(within(table).queryByText("CATEGORY")).toBeNull();
    expect(screen.queryByText("Layout")).toBeNull();
    expect(screen.getAllByText("Hero Section").length).toBeGreaterThan(0);
  });

  it("still renders the pinned columns after every toggleable column is hidden", () => {
    seedStoredChoice([]);
    render(<FieldGroupTable />);
    const table = screen.getByRole("table");
    expect(within(table).getByText("FIELD GROUP")).toBeDefined();
    expect(within(table).getByText("CREATED")).toBeDefined();
    expect(screen.getAllByText("Hero Section").length).toBeGreaterThan(0);
    expect(within(table).queryByText("CATEGORY")).toBeNull();
  });
});
