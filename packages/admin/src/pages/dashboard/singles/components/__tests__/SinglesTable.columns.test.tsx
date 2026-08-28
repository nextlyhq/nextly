// @vitest-environment jsdom
/**
 * The properties under test: a hidden column's header and cells leave the
 * rendered table, and the pinned columns (the label that names the row, and
 * the created date) survive a stored choice that hides everything else.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

import { render, screen, within } from "@admin/__tests__/utils";

import SinglesTable from "../SinglesTable";

const { useSingles, useDeleteSingle, useBulkDeleteSingles } = vi.hoisted(
  () => ({
    useSingles: vi.fn(),
    useDeleteSingle: vi.fn(),
    useBulkDeleteSingles: vi.fn(),
  })
);

vi.mock("@admin/hooks/queries", () => ({
  useSingles: (params: unknown) => useSingles(params),
  useDeleteSingle: () => useDeleteSingle(),
  useBulkDeleteSingles: () => useBulkDeleteSingles(),
}));

/** The singles list's toggleable columns, in declaration order. */
const TOGGLEABLE = ["source", "migrationStatus", "fields"];

function seedStoredChoice(visible: string[]): void {
  localStorage.setItem(
    "nextly-column-visibility-singles",
    JSON.stringify({
      columns: visible,
      defaultsHash: [...TOGGLEABLE].sort().join(","),
    })
  );
}

beforeEach(() => {
  localStorage.clear();
  useDeleteSingle.mockReturnValue({ mutate: vi.fn(), isPending: false });
  useBulkDeleteSingles.mockReturnValue({ mutate: vi.fn(), isPending: false });
  useSingles.mockReturnValue({
    data: {
      items: [
        {
          id: "single_1",
          label: "Homepage",
          slug: "homepage",
          source: "ui",
          migrationStatus: "synced",
          locked: false,
          admin: {},
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

describe("SinglesTable columns", () => {
  it("omits the header and cells of a column the stored choice hides", () => {
    seedStoredChoice(TOGGLEABLE.filter(name => name !== "source"));
    render(<SinglesTable />);
    const table = screen.getByRole("table");
    // The STATUS header is the positive control: a header this query CAN find
    // inside the table, so the SOURCE absence below is the hidden column and
    // not a string that never renders at all.
    expect(within(table).getAllByText("STATUS").length).toBeGreaterThan(0);
    expect(within(table).queryByText("SOURCE")).toBeNull();
    expect(screen.getAllByText("Homepage").length).toBeGreaterThan(0);
  });

  it("still renders the pinned columns after every toggleable column is hidden", () => {
    seedStoredChoice([]);
    render(<SinglesTable />);
    const table = screen.getByRole("table");
    expect(within(table).getByText("SINGLE")).toBeDefined();
    expect(screen.getAllByText("Homepage").length).toBeGreaterThan(0);
    expect(within(table).queryByText("SOURCE")).toBeNull();
  });
});
