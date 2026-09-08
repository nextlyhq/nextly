// @vitest-environment jsdom
/**
 * The properties under test: a hidden column's header and cells leave the
 * rendered table, and the pinned name column survives a stored choice that
 * hides everything else — the name is the one cell that says which row this
 * is, which is why the policy pins it.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

import { render, screen, within } from "@admin/__tests__/utils";

import UserTable from "../UserTable";

const { useUserFields, useUsers, useDeleteUser, useBulkDeleteUsers } =
  vi.hoisted(() => ({
    useUserFields: vi.fn(),
    useUsers: vi.fn(),
    useDeleteUser: vi.fn(),
    useBulkDeleteUsers: vi.fn(),
  }));

vi.mock("@admin/hooks/queries/useUserFields", () => ({
  useUserFields: () => useUserFields(),
}));

vi.mock("@admin/hooks/queries/useUsers", () => ({
  useUsers: (params: unknown) => useUsers(params),
  useDeleteUser: () => useDeleteUser(),
  useBulkDeleteUsers: () => useBulkDeleteUsers(),
}));

/** The users list's toggleable columns, in declaration order. */
const TOGGLEABLE = ["id", "roles", "createdAt"];

function seedStoredChoice(visible: string[]): void {
  localStorage.setItem(
    "nextly-column-visibility-users",
    JSON.stringify({
      columns: visible,
      defaultsHash: [...TOGGLEABLE].sort().join(","),
    })
  );
}

beforeEach(() => {
  localStorage.clear();
  useUserFields.mockReturnValue({ data: { items: [] } });
  useDeleteUser.mockReturnValue({ mutate: vi.fn(), isPending: false });
  useBulkDeleteUsers.mockReturnValue({ mutate: vi.fn(), isPending: false });
  useUsers.mockReturnValue({
    data: {
      items: [
        {
          id: "abcdefgh123456",
          name: "Mona Lisa",
          email: "mona@example.com",
          roles: [{ id: "role_1", name: "editor" }],
          createdAt: "2026-01-01T00:00:00.000Z",
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

describe("UserTable columns", () => {
  it("omits the header and cells of a column the stored choice hides", () => {
    seedStoredChoice(TOGGLEABLE.filter(name => name !== "id"));
    render(<UserTable />);
    const table = screen.getByRole("table");
    // The ROLE header is the positive control: a header this query CAN find
    // inside the table, so the ID absence below is the hidden column and not
    // a string that never renders at all.
    expect(within(table).getAllByText("ROLE").length).toBeGreaterThan(0);
    expect(within(table).queryByText("ID")).toBeNull();
    expect(screen.queryByText("abcdefgh...")).toBeNull();
    expect(screen.getAllByText("Mona Lisa").length).toBeGreaterThan(0);
  });

  it("still renders the pinned column after every toggleable column is hidden", () => {
    seedStoredChoice([]);
    render(<UserTable />);
    const table = screen.getByRole("table");
    expect(within(table).getByText("NAME")).toBeDefined();
    expect(screen.getAllByText("Mona Lisa").length).toBeGreaterThan(0);
    expect(within(table).queryByText("ID")).toBeNull();
  });
});
