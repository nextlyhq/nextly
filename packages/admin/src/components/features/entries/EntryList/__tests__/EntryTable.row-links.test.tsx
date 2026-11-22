/**
 * A row is a real link to where the admin's one rule opens it, so a click, a
 * middle click and a modified click all open the same place: the table draws
 * the address it is handed for each row and builds none of its own.
 */
import { describe, expect, it, vi } from "vitest";

import { render, screen, within } from "@admin/__tests__/utils";

import { EntryTable } from "../EntryTable";
import type { CollectionForColumns } from "../EntryTableColumns";

vi.mock("@admin/hooks/useCan", () => ({ useCan: () => true }));
vi.mock("@admin/hooks/useLocalization", () => ({
  useLocalization: () => ({
    enabled: false,
    locales: [],
    defaultLocale: "en",
    fallback: true,
    getLocale: () => undefined,
  }),
}));

const pages: CollectionForColumns = {
  slug: "pages",
  label: "Pages",
  fields: [{ type: "text", name: "title", label: "Title" } as never],
};

describe("EntryTable — row links", () => {
  it("links each row to the address it is handed for it", () => {
    render(
      <EntryTable
        collection={pages}
        entries={[{ id: "p1", title: "Home" }]}
        pagination={{ page: 0, limit: 10, total: 1, totalPages: 1 }}
        onPageChange={vi.fn()}
        onLimitChange={vi.fn()}
        onSortChange={vi.fn()}
        onSearchChange={vi.fn()}
        onEdit={vi.fn()}
        entryHref={id => `/admin/collections/pages/${id}/builder?field=content`}
        onDelete={vi.fn()}
        onBulkDelete={vi.fn()}
        onBulkPublish={vi.fn()}
        onBulkUnpublish={vi.fn()}
      />
    );
    const table = within(screen.getByRole("table", { name: "Entries table" }));
    expect(table.getByRole("link", { name: "Home" })).toHaveAttribute(
      "href",
      "/admin/collections/pages/p1/builder?field=content"
    );
  });
});
