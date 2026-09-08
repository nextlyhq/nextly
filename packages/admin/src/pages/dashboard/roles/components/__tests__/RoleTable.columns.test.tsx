// @vitest-environment jsdom
/**
 * The property under test is the list's column POLICY as the reader sees it:
 * a column the stored choice hides is gone from the rendered table, and the
 * pinned column survives even the most hostile stored choice — every
 * toggleable column hidden. `roleName` is the one cell that says which row
 * this is, which is why the policy pins it.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

import { render, screen, within } from "@admin/__tests__/utils";

import RoleTable from "../RoleTable";

const { useRoles, useDeleteRole, useBulkDeleteRoles } = vi.hoisted(() => ({
  useRoles: vi.fn(),
  useDeleteRole: vi.fn(),
  useBulkDeleteRoles: vi.fn(),
}));

vi.mock("@admin/hooks/queries/useRoles", () => ({
  useRoles: (params: unknown) => useRoles(params),
  useDeleteRole: () => useDeleteRole(),
  useBulkDeleteRoles: () => useBulkDeleteRoles(),
}));

/** The roles list's toggleable columns, in declaration order. */
const TOGGLEABLE = ["id", "description", "permissions"];

function seedStoredChoice(visible: string[]): void {
  localStorage.setItem(
    "nextly-column-visibility-roles",
    JSON.stringify({
      columns: visible,
      defaultsHash: [...TOGGLEABLE].sort().join(","),
    })
  );
}

beforeEach(() => {
  localStorage.clear();
  useDeleteRole.mockReturnValue({ mutate: vi.fn(), isPending: false });
  useBulkDeleteRoles.mockReturnValue({ mutate: vi.fn(), isPending: false });
  useRoles.mockReturnValue({
    data: {
      items: [
        {
          id: "role_1",
          roleName: "Editor",
          name: "Editor",
          subtitle: "Content access",
          description: "Edits content",
          type: "Custom" as const,
          permissions: ["posts:read"],
        },
      ],
      meta: { page: 1, pageSize: 10, totalItems: 1, totalPages: 1 },
    },
    isLoading: false,
  });
});

describe("RoleTable columns", () => {
  /*
   * Header queries are scoped to the <table>: the toolbar's column menu lists
   * EVERY toggleable column by design, so an unscoped text query finds the
   * hidden column's menu entry and the absence assertion says nothing.
   */
  it("omits the cells of a column the stored choice hides", () => {
    seedStoredChoice(TOGGLEABLE.filter(name => name !== "description"));
    render(<RoleTable />);
    const table = screen.getByRole("table");
    // The Permissions header is the positive control: a header this query CAN
    // find inside the table, so the Description absence below is the hidden
    // column and not a string that never renders at all.
    expect(within(table).getAllByText("Permissions").length).toBeGreaterThan(0);
    expect(within(table).queryByText("Description")).toBeNull();
    expect(screen.queryByText("Edits content")).toBeNull();
    expect(screen.getAllByText("Editor").length).toBeGreaterThan(0);
  });

  it("still renders the pinned column after every toggleable column is hidden", () => {
    seedStoredChoice([]);
    render(<RoleTable />);
    const table = screen.getByRole("table");
    expect(screen.getAllByText("Editor").length).toBeGreaterThan(0);
    expect(within(table).queryByText("Description")).toBeNull();
  });
});
