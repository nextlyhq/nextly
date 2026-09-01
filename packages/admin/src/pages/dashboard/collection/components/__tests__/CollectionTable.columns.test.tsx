// @vitest-environment jsdom
/**
 * The properties under test: a hidden column's header and cells leave the
 * rendered table, and the pinned columns (the label that names the row, and
 * the created date) survive a stored choice that hides everything else.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

import { render, screen, within } from "@admin/__tests__/utils";

import CollectionTable from "../CollectionTable";

const { useCollections, useDeleteCollection, useBulkDeleteCollections } =
  vi.hoisted(() => ({
    useCollections: vi.fn(),
    useDeleteCollection: vi.fn(),
    useBulkDeleteCollections: vi.fn(),
  }));

vi.mock("@admin/hooks/queries", () => ({
  useCollections: (params: unknown) => useCollections(params),
  useDeleteCollection: () => useDeleteCollection(),
  useBulkDeleteCollections: () => useBulkDeleteCollections(),
}));

/** The collections list's toggleable columns, in declaration order. */
const TOGGLEABLE = [
  "source",
  "migrationStatus",
  "description",
  "schemaDefinition",
];

function seedStoredChoice(visible: string[]): void {
  localStorage.setItem(
    "nextly-column-visibility-collections",
    JSON.stringify({
      columns: visible,
      defaultsHash: [...TOGGLEABLE].sort().join(","),
    })
  );
}

beforeEach(() => {
  localStorage.clear();
  useDeleteCollection.mockReturnValue({ mutate: vi.fn(), isPending: false });
  useBulkDeleteCollections.mockReturnValue({
    mutate: vi.fn(),
    isPending: false,
  });
  useCollections.mockReturnValue({
    data: {
      items: [
        {
          id: "col_1",
          label: "Posts",
          slug: "posts",
          source: "ui",
          migrationStatus: "synced",
          description: "Editorial posts",
          locked: false,
          schemaDefinition: {},
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

describe("CollectionTable columns", () => {
  it("omits the header and cells of a column the stored choice hides", () => {
    seedStoredChoice(TOGGLEABLE.filter(name => name !== "description"));
    render(<CollectionTable />);
    const table = screen.getByRole("table");
    // The SOURCE header is the positive control: a header this query CAN find
    // inside the table, so the DESCRIPTION absence below is the hidden column
    // and not a string that never renders at all.
    expect(within(table).getAllByText("SOURCE").length).toBeGreaterThan(0);
    expect(within(table).queryByText("DESCRIPTION")).toBeNull();
    expect(screen.queryByText("Editorial posts")).toBeNull();
  });

  it("still renders the pinned columns after every toggleable column is hidden", () => {
    seedStoredChoice([]);
    render(<CollectionTable />);
    const table = screen.getByRole("table");
    expect(within(table).getByText("COLLECTION")).toBeDefined();
    expect(within(table).getByText("CREATED")).toBeDefined();
    expect(screen.getAllByText("Posts").length).toBeGreaterThan(0);
    expect(within(table).queryByText("DESCRIPTION")).toBeNull();
  });
});
