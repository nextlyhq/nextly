/**
 * A list's rows, and its row menu's Edit, open an entry where its collection
 * says, by the admin's one rule: a collection that opens in a view links each
 * row to that view, and a reader who may not update the entries gets the form.
 * The data hooks are replaced and the page itself is real, so this is the
 * list's own wiring of the rule, not a table handed an address.
 */
import { screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { navigateTo } from "@admin/lib/navigation";

import { renderWithProviders } from "../../../../../__tests__/utils";

const NOTES = {
  name: "notes",
  label: "Notes",
  fields: [
    { name: "title", type: "text", label: "Title" },
    { name: "excerpt", type: "textarea", label: "Excerpt" },
    { name: "sections", type: "blocks", label: "Sections" },
  ],
  admin: { useAsTitle: "title", opensIn: "builder" },
};

let mayUpdate = true;

vi.mock("@admin/hooks/queries", () => ({
  useEntries: () => ({
    data: {
      items: [{ id: "n1", title: "First note" }],
      meta: {
        total: 1,
        page: 1,
        limit: 25,
        totalPages: 1,
        hasNext: false,
        hasPrev: false,
      },
    },
    isLoading: false,
    error: null,
  }),
  useBulkDeleteEntries: () => ({ mutate: vi.fn(), isPending: false }),
  useBulkUpdateEntries: () => ({ mutate: vi.fn(), isPending: false }),
}));
vi.mock("@admin/hooks/queries/useCollections", () => ({
  useEveryNavCollection: () => ({ data: undefined }),
  useCollection: () => ({ data: NOTES, isLoading: false }),
}));
vi.mock("@admin/hooks/useCan", () => ({ useCan: () => true }));
vi.mock("@admin/hooks/useCurrentUserPermissions", async importOriginal => {
  const original = await importOriginal<{
    useCurrentUserPermissions: () => Record<string, unknown>;
  }>();
  return {
    ...original,
    useCurrentUserPermissions: () => ({
      ...original.useCurrentUserPermissions(),
      canAccessCollection: (_slug: string, action: string) =>
        action === "update" ? mayUpdate : true,
    }),
  };
});
vi.mock("@admin/context/providers/BrandingProvider", async importOriginal => {
  const original = await importOriginal<{
    useBranding: () => Record<string, unknown>;
  }>();
  return {
    ...original,
    useBranding: () => ({
      ...original.useBranding(),
      plugins: [
        {
          name: "@acme/builder",
          documentViews: [
            {
              fieldType: "blocks",
              path: "builder",
              component: "@acme/builder#View",
            },
          ],
        },
      ],
    }),
  };
});
vi.mock("@admin/hooks/useLocalization", () => ({
  useLocalization: () => ({ enabled: false, locales: [], defaultLocale: "" }),
}));
vi.mock("@admin/hooks/useSearchParams", () => ({
  useSearchParams: () => ({}),
}));
vi.mock("@admin/lib/navigation", async importOriginal => ({
  ...(await importOriginal<object>()),
  navigateTo: vi.fn(),
}));

import { EntryList } from "../EntryList";

const table = () =>
  within(screen.getByRole("table", { name: "Entries table" }));

beforeEach(() => {
  mayUpdate = true;
  vi.mocked(navigateTo).mockClear();
});

describe("EntryList — where a row opens", () => {
  it("links a row to the view its collection opens entries in", () => {
    renderWithProviders(<EntryList collectionSlug="notes" />);
    expect(table().getByRole("link", { name: "First note" })).toHaveAttribute(
      "href",
      "/admin/collections/notes/n1/builder?field=sections"
    );
  });

  it("opens the same place from the row menu's Edit", async () => {
    const user = userEvent.setup();
    renderWithProviders(<EntryList collectionSlug="notes" />);
    await user.click(table().getByRole("button", { name: "Row actions" }));
    await user.click(await screen.findByRole("menuitem", { name: "Edit" }));
    expect(navigateTo).toHaveBeenCalledWith(
      "/admin/collections/notes/n1/builder?field=sections"
    );
  });

  it("links a reader who may not update the entries to the form", () => {
    mayUpdate = false;
    renderWithProviders(<EntryList collectionSlug="notes" />);
    expect(table().getByRole("link", { name: "First note" })).toHaveAttribute(
      "href",
      "/admin/collections/notes/n1"
    );
  });
});
