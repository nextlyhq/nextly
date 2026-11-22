/**
 * A list row's menu offers the other way into its entry, beside Edit: "Edit
 * details" (the form) where the collection's entries open in a view, and the
 * view in its own words where they open as a form. The data hooks are
 * replaced and the page itself is real, so this is the list's own wiring of
 * the shared rule.
 */
import { screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { navigateTo } from "@admin/lib/navigation";

import { renderWithProviders } from "../../../../../__tests__/utils";

const title = { name: "title", type: "text", label: "Title" };
const excerpt = { name: "excerpt", type: "textarea", label: "Excerpt" };
const sections = { name: "sections", type: "blocks", label: "Sections" };

/** Notes whose entries open in the builder, as the collection declares. */
const OPENS_IN_BUILDER = {
  name: "notes",
  label: "Notes",
  fields: [title, excerpt, sections],
  admin: { useAsTitle: "title", opensIn: "builder" },
};
/** Notes whose entries open as a form: the excerpt is the main field. */
const OPENS_AS_FORM = {
  ...OPENS_IN_BUILDER,
  admin: { useAsTitle: "title" },
};
/** Notes with no blocks field, which no view applies to. */
const NO_BUILDER_FIELD = { ...OPENS_AS_FORM, fields: [title, excerpt] };

let collection: object = OPENS_IN_BUILDER;
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
  useCollection: () => ({ data: collection, isLoading: false }),
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
        action === "updateInDefaultLanguage" ? mayUpdate : true,
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
              label: "Page Builder",
              openLabel: "Open in builder",
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

/** Open the row's menu and wait for its first item. */
async function openRowMenu(user: ReturnType<typeof userEvent.setup>) {
  renderWithProviders(<EntryList collectionSlug="notes" />);
  await user.click(table().getByRole("button", { name: "Row actions" }));
  await screen.findByRole("menuitem", { name: "Edit" });
}

beforeEach(() => {
  collection = OPENS_IN_BUILDER;
  mayUpdate = true;
  vi.mocked(navigateTo).mockClear();
});

describe("EntryList — a row's menu offers the entry's other view", () => {
  it('offers "Edit details", opening the form, where entries open in the builder', async () => {
    const user = userEvent.setup();
    await openRowMenu(user);
    expect(
      screen.queryByRole("menuitem", { name: "Open in builder" })
    ).not.toBeInTheDocument();
    await user.click(screen.getByRole("menuitem", { name: "Edit details" }));
    expect(navigateTo).toHaveBeenCalledWith("/admin/collections/notes/n1");
  });

  it('offers "Open in builder", in the view\'s own words, where entries open as a form', async () => {
    collection = OPENS_AS_FORM;
    const user = userEvent.setup();
    await openRowMenu(user);
    expect(
      screen.queryByRole("menuitem", { name: "Edit details" })
    ).not.toBeInTheDocument();
    await user.click(screen.getByRole("menuitem", { name: "Open in builder" }));
    expect(navigateTo).toHaveBeenCalledWith(
      "/admin/collections/notes/n1/builder?field=sections"
    );
  });

  it("offers neither on a collection with no field the builder edits", async () => {
    collection = NO_BUILDER_FIELD;
    const user = userEvent.setup();
    await openRowMenu(user);
    expect(
      screen.queryByRole("menuitem", { name: "Edit details" })
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole("menuitem", { name: "Open in builder" })
    ).not.toBeInTheDocument();
  });

  it("offers neither to a reader who may not update the entries, whose rows open the form", async () => {
    mayUpdate = false;
    const user = userEvent.setup();
    await openRowMenu(user);
    expect(
      screen.queryByRole("menuitem", { name: "Edit details" })
    ).not.toBeInTheDocument();
  });
});
