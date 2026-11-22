// @vitest-environment jsdom
/**
 * The property under test: a column the reader's stored choice hides is gone
 * from the rendered table — header and cells both — while the columns kept
 * visible still render. Header queries are scoped to the table because the
 * toolbar's column menu lists every toggleable column by design.
 */
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { render, screen, waitFor, within } from "@admin/__tests__/utils";
import type { ApiKeyMeta } from "@admin/services/apiKeyApi";

import { ApiKeyTable } from "../ApiKeyTable";

/** The api-keys list's toggleable columns, in declaration order. */
const TOGGLEABLE = [
  "tokenType",
  "keyPrefix",
  "owner",
  "expiresAt",
  "lastUsedAt",
  "isActive",
  "id",
];

const KEY: ApiKeyMeta = {
  id: "abcdefgh123456",
  name: "CI Deploy",
  description: null,
  keyPrefix: "nx_live_abcdef",
  tokenType: "read-only",
  role: null,
  owner: { id: "u-ada", name: "Ada Lovelace", email: "ada@example.com" },
  expiresAt: null,
  lastUsedAt: null,
  isActive: true,
  createdAt: "2026-01-01T00:00:00.000Z",
  updatedAt: "2026-01-01T00:00:00.000Z",
};

function seedStoredChoice(visible: string[]): void {
  localStorage.setItem(
    "nextly-column-visibility-api-keys",
    JSON.stringify({
      columns: visible,
      defaultsHash: [...TOGGLEABLE].sort().join(","),
    })
  );
}

beforeEach(() => localStorage.clear());

describe("ApiKeyTable columns", () => {
  it("omits the header and cells of a column the stored choice hides", () => {
    seedStoredChoice(TOGGLEABLE.filter(name => name !== "id"));
    render(
      <ApiKeyTable
        data={[KEY]}
        onEdit={vi.fn()}
        onRevoke={vi.fn()}
        canEdit
        canRevoke
        ownersVisible
      />
    );
    const table = screen.getByRole("table");
    // The Type header is the positive control: a header this query CAN find
    // inside the table, so the ID absence below is the hidden column and not
    // a string that never renders at all.
    expect(within(table).getAllByText("Type").length).toBeGreaterThan(0);
    expect(within(table).queryByText("ID")).toBeNull();
    expect(screen.queryByText("abcdefgh...")).toBeNull();
  });

  it("names each key's owner, and a deleted one as such", () => {
    render(
      <ApiKeyTable
        data={[KEY, { ...KEY, id: "orphaned-key-1", owner: null }]}
        onEdit={vi.fn()}
        onRevoke={vi.fn()}
        canEdit
        canRevoke
        ownersVisible
      />
    );
    const table = screen.getByRole("table");
    expect(within(table).getAllByText("Owner").length).toBeGreaterThan(0);
    expect(within(table).getByText("Ada Lovelace")).toBeTruthy();
    expect(within(table).getByText("Deleted user")).toBeTruthy();
  });

  it("says an owner withheld from a reader who may not read users is hidden, not deleted", () => {
    // The server withholds the owner of someone else's key from a reader
    // without `read-users`; that is not an account that no longer exists.
    render(
      <ApiKeyTable
        data={[KEY, { ...KEY, id: "someone-elses-key", owner: null }]}
        onEdit={vi.fn()}
        onRevoke={vi.fn()}
        canEdit
        canRevoke
        ownersVisible={false}
      />
    );
    const table = screen.getByRole("table");
    expect(within(table).getByText("Ada Lovelace")).toBeTruthy();
    expect(within(table).getByText("Hidden")).toBeTruthy();
    expect(within(table).queryByText("Deleted user")).toBeNull();
  });

  it("finds a key by its role, which its Type badge shows", async () => {
    const user = userEvent.setup();
    render(
      <ApiKeyTable
        data={[
          KEY,
          {
            ...KEY,
            id: "role-key-1",
            name: "Editors' key",
            tokenType: "role-based",
            role: { id: "r-admin", name: "Admin", slug: "admin" },
          },
        ]}
        onEdit={vi.fn()}
        onRevoke={vi.fn()}
        canEdit
        canRevoke
        ownersVisible
      />
    );

    await user.type(
      screen.getByPlaceholderText(/name, description, type, role/),
      "admin"
    );

    const table = screen.getByRole("table");
    // The search applies once typing pauses: the read-only key, which holds
    // no role, leaves the table.
    await waitFor(() =>
      expect(within(table).queryByText("CI Deploy")).toBeNull()
    );
    expect(within(table).getByText("Role-based: Admin")).toBeTruthy();
    expect(within(table).getByText("Editors' key")).toBeTruthy();
  });
});
