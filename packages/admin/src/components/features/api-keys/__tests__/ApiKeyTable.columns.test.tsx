// @vitest-environment jsdom
/**
 * The property under test: a column the reader's stored choice hides is gone
 * from the rendered table — header and cells both — while the columns kept
 * visible still render. Header queries are scoped to the table because the
 * toolbar's column menu lists every toggleable column by design.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

import { render, screen, within } from "@admin/__tests__/utils";
import type { ApiKeyMeta } from "@admin/services/apiKeyApi";

import { ApiKeyTable } from "../ApiKeyTable";

/** The api-keys list's toggleable columns, in declaration order. */
const TOGGLEABLE = [
  "tokenType",
  "keyPrefix",
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
    render(<ApiKeyTable data={[KEY]} onEdit={vi.fn()} onRevoke={vi.fn()} />);
    const table = screen.getByRole("table");
    // The Type header is the positive control: a header this query CAN find
    // inside the table, so the ID absence below is the hidden column and not
    // a string that never renders at all.
    expect(within(table).getAllByText("Type").length).toBeGreaterThan(0);
    expect(within(table).queryByText("ID")).toBeNull();
    expect(screen.queryByText("abcdefgh...")).toBeNull();
  });
});
