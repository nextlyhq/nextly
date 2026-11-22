/**
 * A list's "+ New" opens the create dialog the view its collection's entries
 * open in declares (`createDialog`), in place of the create form. Closing it
 * with the new entry's id opens that entry where the collection opens
 * entries; closing it with none leaves the list. A collection that opens as
 * the form, a view with no dialog, or a dialog this admin can't draw keep
 * the create form. The data hooks are replaced and the page itself is real.
 */
import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { navigateTo } from "@admin/lib/navigation";
import {
  clearRegistry,
  registerComponents,
  type DocumentCreateDialogProps,
} from "@admin/lib/plugins/component-registry";

import { renderWithProviders } from "../../../../../__tests__/utils";

const title = { name: "title", type: "text", label: "Title" };
const excerpt = { name: "excerpt", type: "textarea", label: "Excerpt" };
const sections = { name: "sections", type: "blocks", label: "Sections" };

/** Notes whose entries open in the builder, as the collection declares. */
const OPENS_IN_BUILDER = {
  name: "notes",
  label: "Note",
  fields: [title, excerpt, sections],
  admin: { useAsTitle: "title", opensIn: "builder" },
};
/** Notes whose entries open as a form: the excerpt is the main field. */
const OPENS_AS_FORM = {
  ...OPENS_IN_BUILDER,
  admin: { useAsTitle: "title" },
};

let collection: object = OPENS_IN_BUILDER;
let mayUpdate = true;
let declaresDialog = true;

/** The test view's create dialog, as a plugin would declare it. */
const DIALOG = "@acme/builder#NewNote";

/** A dialog body that creates "n9", or closes without creating. */
function NewNoteDialog({ collection, close }: DocumentCreateDialogProps) {
  return (
    <div>
      <p>
        For {collection.slug}, a {collection.labels.singular}
      </p>
      <button type="button" onClick={() => close("n9")}>
        Create
      </button>
      <button type="button" onClick={() => close()}>
        Cancel
      </button>
    </div>
  );
}

/** The admin's dialog around the plugin's body, named by the collection. */
const createDialog = () => screen.queryByRole("dialog", { name: "New note" });

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
              ...(declaresDialog ? { createDialog: DIALOG } : {}),
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

/** Press the list's "+ New" button. */
async function pressNew(user: ReturnType<typeof userEvent.setup>) {
  renderWithProviders(<EntryList collectionSlug="notes" />);
  await user.click(await screen.findByRole("button", { name: /^New / }));
}

beforeEach(() => {
  collection = OPENS_IN_BUILDER;
  mayUpdate = true;
  declaresDialog = true;
  clearRegistry();
  registerComponents({ [DIALOG]: NewNoteDialog });
  vi.mocked(navigateTo).mockClear();
});

describe('EntryList — "+ New" opens the view\'s create dialog', () => {
  it("opens the dialog over the list, given the collection, where entries open in the view", async () => {
    const user = userEvent.setup();
    await pressNew(user);
    const dialog = screen.getByRole("dialog", { name: "New note" });
    expect(within(dialog).getByText("For notes, a Note")).toBeInTheDocument();
    expect(navigateTo).not.toHaveBeenCalled();
  });

  it("opens the new entry where its collection opens entries, once the dialog creates it", async () => {
    const user = userEvent.setup();
    await pressNew(user);
    await user.click(screen.getByRole("button", { name: "Create" }));
    expect(navigateTo).toHaveBeenCalledWith(
      "/admin/collections/notes/n9/builder?field=sections"
    );
    expect(createDialog()).toBeNull();
  });

  it("leaves the list as it was when the dialog closes without creating", async () => {
    const user = userEvent.setup();
    await pressNew(user);
    await user.click(screen.getByRole("button", { name: "Cancel" }));
    expect(createDialog()).toBeNull();
    expect(navigateTo).not.toHaveBeenCalled();
    expect(table().getByRole("link", { name: "First note" })).toBeVisible();
  });

  it("leaves the list as it was when the dialog is dismissed with Escape, giving focus back to New", async () => {
    const user = userEvent.setup();
    await pressNew(user);
    await user.keyboard("{Escape}");
    expect(createDialog()).toBeNull();
    expect(navigateTo).not.toHaveBeenCalled();
    // The admin's dialog gives focus back to what opened it once it closes.
    await waitFor(() =>
      expect(screen.getByRole("button", { name: /^New / })).toHaveFocus()
    );
  });

  it("keeps a way out when the dialog's body throws while drawing", async () => {
    clearRegistry();
    registerComponents({
      [DIALOG]: function Broken(): never {
        throw new Error("the plugin's body broke");
      },
    });
    const errors = vi.spyOn(console, "error").mockImplementation(() => {});
    const user = userEvent.setup();
    await pressNew(user);
    // The admin's frame stays, so the person can still leave it.
    expect(createDialog()).not.toBeNull();
    await user.keyboard("{Escape}");
    expect(createDialog()).toBeNull();
    expect(navigateTo).not.toHaveBeenCalled();
    errors.mockRestore();
  });

  it("goes to the create form for a reader who may not update the entries, which open as the form for them", async () => {
    mayUpdate = false;
    const user = userEvent.setup();
    await pressNew(user);
    expect(navigateTo).toHaveBeenCalledWith("/admin/collections/notes/create");
    expect(createDialog()).toBeNull();
  });

  it("goes to the create form where the entries open as the form", async () => {
    collection = OPENS_AS_FORM;
    const user = userEvent.setup();
    await pressNew(user);
    expect(navigateTo).toHaveBeenCalledWith("/admin/collections/notes/create");
    expect(createDialog()).toBeNull();
  });

  it("goes to the create form where the view declares no dialog", async () => {
    declaresDialog = false;
    const user = userEvent.setup();
    await pressNew(user);
    expect(navigateTo).toHaveBeenCalledWith("/admin/collections/notes/create");
  });

  it("goes to the create form where the dialog's component isn't in this admin", async () => {
    clearRegistry();
    const user = userEvent.setup();
    await pressNew(user);
    expect(navigateTo).toHaveBeenCalledWith("/admin/collections/notes/create");
  });
});
