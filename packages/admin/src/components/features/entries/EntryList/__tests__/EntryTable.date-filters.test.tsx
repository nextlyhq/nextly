/**
 * The list's Filter menu: "Clear date filters" reads in the menu's text
 * colour, not the brand's.
 *
 * `--nx-primary` is a fill a site's brand may set to any colour (the e2e
 * suite's indigo reads under AA's 4.5:1 as small text on a light surface), so
 * small text drawn in it is only as readable as the brand happens to be. The
 * menu's other words read in the foreground tokens, which every theme and
 * brand keeps readable.
 *
 * @module components/features/entries/EntryList/__tests__/EntryTable.date-filters.test
 */
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import { render, screen } from "@admin/__tests__/utils";

import { EntryTable } from "../EntryTable";
import type { CollectionForColumns } from "../EntryTableColumns";

vi.mock("@admin/hooks/useCan", () => ({ useCan: () => false }));
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
  fields: [{ type: "text", name: "title", label: "Title" } as never],
};

describe("the list's date filters", () => {
  it("draw Clear date filters in the menu's text colour, not the brand's", async () => {
    render(
      <EntryTable
        collection={posts}
        entries={[{ id: "p1", title: "First" }]}
        pagination={{ page: 0, limit: 10, total: 1, totalPages: 1 }}
        onPageChange={vi.fn()}
        onLimitChange={vi.fn()}
        onSortChange={vi.fn()}
        onSearchChange={vi.fn()}
        onEdit={vi.fn()}
        entryHref={id => `/admin/collections/posts/${id}`}
        onDelete={vi.fn()}
        onBulkDelete={vi.fn()}
        onBulkPublish={vi.fn()}
        onBulkUnpublish={vi.fn()}
        onCreatedFromChange={vi.fn()}
        onCreatedToChange={vi.fn()}
      />
    );
    await userEvent
      .setup()
      .click(screen.getByRole("button", { name: "Filter" }));
    const clear = await screen.findByRole("button", {
      name: "Clear date filters",
    });
    expect(clear.className.split(/\s+/)).toContain("text-foreground");
    expect(clear.className).not.toMatch(/(^|\s)text-primary(\s|$)/);
  });
});
