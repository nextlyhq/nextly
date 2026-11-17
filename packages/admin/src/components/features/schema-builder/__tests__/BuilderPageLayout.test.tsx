// The frame all three builder kinds draw. What differs between them arrives as
// props and as the one slot above the field list, so these tests cover the
// wiring: the toolbar reaches the overlay state, the read-only notice follows
// the lock, the slot and the page's own dialogs render where the pages put
// them, and the live region speaks only while a save is in flight.
import userEvent from "@testing-library/user-event";
import type { ComponentProps } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { act, render, screen, within } from "@admin/__tests__/utils";
import { convertToFieldDefinition } from "@admin/lib/builder";
import {
  buildOutline,
  flattenOutline,
} from "@admin/lib/builder/outline/outline-model";
import type { FieldDefinition } from "@admin/types/collection";

// Where an exit would take the page, watched rather than followed.
const navigateTo = vi.hoisted(() => vi.fn());
vi.mock("@admin/lib/navigation", async importOriginal => ({
  ...(await importOriginal<typeof import("@admin/lib/navigation")>()),
  navigateTo,
}));

// The field groups the outline reads: one, "seo", with one field.
const seoFields = [
  { name: "meta_title", label: "Meta title", type: "text" },
] as FieldDefinition[];
vi.mock("@admin/services/fieldGroupApi", () => ({
  fieldGroupApi: {
    fetchComponents: vi.fn(() =>
      Promise.resolve({
        items: [{ slug: "seo", label: "SEO", fields: seoFields }],
        meta: { hasNext: false },
      })
    ),
  },
}));

import { BuilderPageLayout } from "../BuilderPageLayout";
import type { BuilderConfig } from "../builder-config";
import type { BuilderSettingsValues } from "../BuilderSettingsModal";
import type { BuilderField, BuilderFieldsApi } from "../types";

const config: BuilderConfig = {
  kind: "collection",
  basicsFields: ["singularName", "slug"],
  advancedFields: ["status"],
  toolbar: { previewSchemaChange: true },
  picker: {},
};

const settings: BuilderSettingsValues = {
  singularName: "Post",
  slug: "posts",
  icon: "Database",
};

const fields: BuilderField[] = [
  {
    id: "system_title",
    name: "title",
    label: "Title",
    type: "text",
    isSystem: true,
    validation: { required: true },
    admin: { width: "100%" },
  },
  {
    id: "u1",
    name: "excerpt",
    label: "Excerpt",
    type: "textarea",
    isSystem: false,
    validation: {},
    admin: { width: "100%" },
  },
];

function makeBuilder(): BuilderFieldsApi {
  return {
    fields,
    setFields: vi.fn(),
    sensors: [],
    handleDragStart: vi.fn(),
    handleFieldsReorder: vi.fn(),
    handleFieldDelete: vi.fn(),
    handleFieldUpdate: vi.fn(),
    handleNestedFieldAdd: vi.fn(),
    validateFields: vi.fn(() => ({ valid: true })),
    resetFields: vi.fn(),
    // The settings share the fields' history; none are shown here.
    settings: null,
    setSettings: vi.fn(),
    snapshot: { fields: [], settings: null },
    rewriteSnapshots: vi.fn(),
    clearHistory: vi.fn(),
    historyStep: 0,
    canUndo: false,
    canRedo: false,
    undo: vi.fn(() => null),
    redo: vi.fn(() => null),
  };
}

function renderLayout(
  overrides: Partial<ComponentProps<typeof BuilderPageLayout>> = {}
) {
  const onActiveChange = vi.fn();
  const props: ComponentProps<typeof BuilderPageLayout> = {
    config,
    builder: makeBuilder(),
    entitySlug: "posts",
    name: "Posts",
    locked: false,
    unsavedCount: 0,
    pending: {
      changes: [],
      marks: new Map(),
      settingChanges: [],
      saved: [],
      canUndo: false,
      canRedo: false,
      undo: () => null,
      redo: () => null,
      discardAll: () => {},
    },
    savedFieldIds: new Set<string>(),
    onSave: vi.fn(),
    settings,
    onSettingsChange: vi.fn(),
    active: { kind: "none" },
    onActiveChange,
    onDuplicateField: vi.fn(),
    isSaving: false,
    savingLabel: "Saving collection changes…",
    ...overrides,
  };
  const result = render(<BuilderPageLayout {...props} />);
  return { ...result, props, onActiveChange: props.onActiveChange };
}

describe("BuilderPageLayout", () => {
  it("draws the toolbar over the entity's field list", () => {
    renderLayout();
    expect(screen.getByText("Posts")).toBeInTheDocument();
    expect(screen.getByText("Excerpt")).toBeInTheDocument();
  });

  // The toolbar's settings button is the only way into the settings overlay,
  // and the layout owns that transition so no page has to restate it.
  it("opens the settings overlay from the toolbar", async () => {
    const user = userEvent.setup();
    const { onActiveChange } = renderLayout();
    await user.click(screen.getByRole("button", { name: /settings/i }));
    expect(onActiveChange).toHaveBeenCalledWith({ kind: "settings" });
  });

  // The toolbar's add opens the picker at the end of the list, the position
  // with neither a container nor a field to go before.
  it("opens the picker at the end of the list from the toolbar", async () => {
    const user = userEvent.setup();
    const { onActiveChange } = renderLayout();
    await user.click(screen.getByRole("button", { name: "Add field" }));
    expect(onActiveChange).toHaveBeenCalledWith({
      kind: "picker",
      position: {},
    });
  });

  it("shows the read-only notice, with its source file, only when locked", () => {
    const { unmount } = renderLayout();
    expect(screen.queryByRole("note")).not.toBeInTheDocument();
    unmount();

    renderLayout({ locked: true, configPath: "src/collections/posts.ts" });
    expect(screen.getByRole("note")).toBeInTheDocument();
    expect(screen.getByText("src/collections/posts.ts")).toBeInTheDocument();
  });

  // Collections and singles put plugin slots here; field groups put a repair
  // notice. The layout knows about neither.
  it("renders whatever the page puts above the field list", () => {
    renderLayout({
      beforeFieldList: <p>repair this definition</p>,
    });
    expect(screen.getByText("repair this definition")).toBeInTheDocument();
  });

  it("renders the page's own dialogs inside the frame", () => {
    renderLayout({ children: <p>schema change confirmation</p> });
    expect(screen.getByText("schema change confirmation")).toBeInTheDocument();
  });

  it("announces the save only while one is in flight", () => {
    const { unmount } = renderLayout();
    expect(
      screen.queryByText("Saving collection changes…")
    ).not.toBeInTheDocument();
    unmount();

    renderLayout({ isSaving: true });
    expect(screen.getByText("Saving collection changes…")).toBeInTheDocument();
  });

  // A save on its way keeps what it was started with: discarding then would
  // clear the editor while the save could still write the discarded values.
  it("offers no Discard all while a save or its preview is on its way", () => {
    const { unmount } = renderLayout({ unsavedCount: 2 });
    expect(
      screen.getByRole("button", { name: "Discard all changes" })
    ).toBeEnabled();
    unmount();

    renderLayout({ unsavedCount: 2, isSaving: true });
    expect(
      screen.getByRole("button", { name: "Discard all changes" })
    ).toBeDisabled();
  });

  // An unsaved entity's address being moved: a save then would create it under
  // the address it is leaving, so Save waits and the page says why.
  it("holds Save, saying why, while the page holds it", () => {
    const { unmount } = renderLayout({ unsavedCount: 2 });
    expect(screen.getByRole("button", { name: "Save" })).toBeEnabled();
    expect(
      screen.queryByText("Save waits while the new address is checked.")
    ).not.toBeInTheDocument();
    unmount();

    renderLayout({
      unsavedCount: 2,
      saveHeld: "Save waits while the new address is checked.",
    });
    expect(screen.getByRole("button", { name: "Save" })).toBeDisabled();
    expect(
      screen.getByText("Save waits while the new address is checked.")
    ).toBeVisible();
  });

  // A status region inserted with its message already in it is not reliably
  // announced, so the hold's region is there before the hold and only its text
  // changes.
  it("keeps the hold's status mounted, so its reason is announced when it arrives", () => {
    const { rerender, props } = renderLayout({ unsavedCount: 2 });
    const status = screen.getByTestId("save-held-status");
    expect(status).toHaveTextContent("");

    rerender(
      <BuilderPageLayout
        {...props}
        saveHeld="Save waits while the new address is checked."
      />
    );
    expect(screen.getByTestId("save-held-status")).toBe(status);
    expect(status).toHaveTextContent(
      "Save waits while the new address is checked."
    );
  });

  // The toolbar's row is full on a phone: there the reason is announced and
  // carried by Save itself rather than set beside it, where it would push the
  // row past the screen's edge.
  it("keeps the hold's reason out of a phone's toolbar row, on Save instead", () => {
    renderLayout({
      unsavedCount: 2,
      saveHeld: "Save waits while the new address is checked.",
    });
    const status = screen.getByTestId("save-held-status");
    expect(status).toHaveClass("sr-only", "sm:not-sr-only");
    expect(screen.getByRole("button", { name: "Save" })).toHaveAttribute(
      "title",
      "Save waits while the new address is checked."
    );
  });

  it("holds Undo and Redo with Save while the page holds Save", () => {
    const pending = {
      changes: [],
      marks: new Map(),
      settingChanges: [],
      saved: [],
      canUndo: true,
      canRedo: true,
      undo: () => null,
      redo: () => null,
      discardAll: () => {},
    };
    const { unmount } = renderLayout({ unsavedCount: 2, pending });
    expect(screen.getByRole("button", { name: "Undo" })).toBeEnabled();
    unmount();

    renderLayout({
      unsavedCount: 2,
      pending,
      saveHeld: "Save waits while the new address is checked.",
    });
    expect(screen.getByRole("button", { name: "Undo" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Redo" })).toBeDisabled();
  });

  it("carries the lock through to the field list", () => {
    renderLayout({ locked: true });
    // Every editing affordance on a row is gone when the entity is code-first.
    expect(
      screen.queryByRole("button", { name: /duplicate/i })
    ).not.toBeInTheDocument();
  });

  describe("the settings panel while a field is edited", () => {
    /** A screen that matches only the wide-layout query. */
    function asWideScreen() {
      const original = window.matchMedia;
      window.matchMedia = (query: string) =>
        ({
          ...original(query),
          matches: query === "(min-width: 1024px)",
        }) as MediaQueryList;
      return () => {
        window.matchMedia = original;
      };
    }

    it("is docked beside the list on a wide screen, not laid over it", async () => {
      const restore = asWideScreen();
      try {
        renderLayout({ active: { kind: "edit", fieldId: "u1" } });
        const docked = await screen.findByRole("complementary");
        expect(
          within(docked).getByRole("heading", { name: "Excerpt" })
        ).toBeInTheDocument();
        expect(screen.queryByRole("dialog")).toBeNull();
        // The list is still there beside it.
        expect(screen.getAllByText("Excerpt").length).toBeGreaterThan(1);
      } finally {
        restore();
      }
    });

    it("never lays a sheet over the list on a wide screen, even for a moment", () => {
      const restore = asWideScreen();
      try {
        // The page is open, its effects settled inside render's act, before a
        // field is chosen.
        const { rerender, props } = renderLayout();
        rerender(
          <BuilderPageLayout
            {...props}
            active={{ kind: "edit", fieldId: "u1" }}
          />
        );
        // Read straight after the field is chosen, before any effect could
        // switch a sheet over to the docked panel.
        expect(screen.queryByRole("dialog")).toBeNull();
        expect(screen.getByRole("complementary")).toBeInTheDocument();
      } finally {
        restore();
      }
    });

    it("opens as a sheet on a narrow screen", () => {
      renderLayout({ active: { kind: "edit", fieldId: "u1" } });
      expect(
        within(screen.getByRole("dialog")).getByRole("heading", {
          name: "Excerpt",
        })
      ).toBeInTheDocument();
    });

    it("hands each edit to the builder at once", async () => {
      const user = userEvent.setup();
      const { props } = renderLayout({
        active: { kind: "edit", fieldId: "u1" },
      });
      await user.click(screen.getByRole("switch", { name: "Required" }));
      expect(props.builder.handleFieldUpdate).toHaveBeenCalledTimes(1);
    });

    it("closes when asked", async () => {
      const user = userEvent.setup();
      const { onActiveChange } = renderLayout({
        active: { kind: "edit", fieldId: "u1" },
      });
      await user.click(
        screen.getByRole("button", { name: "Close field settings" })
      );
      expect(onActiveChange).toHaveBeenCalledWith({ kind: "none" });
    });
  });

  // Rename… is on a row only where the field's own settings can rename it: a saved field with a
  // column of its own. Each request is its own, so asking again on the same field asks again.
  describe("a row's Rename…", () => {
    async function openMenu(user: ReturnType<typeof userEvent.setup>) {
      screen.getByTestId("field-row-excerpt").focus();
      await user.keyboard("{Shift>}{F10}{/Shift}");
      return screen.findByRole("menu");
    }

    it("is not offered for a field not yet saved", async () => {
      renderLayout();
      const menu = await openMenu(userEvent.setup());
      expect(
        within(menu).queryByRole("menuitem", { name: "Rename…" })
      ).toBeNull();
    });

    it("opens the saved field's settings to rename it, afresh each time it is asked", async () => {
      const user = userEvent.setup();
      const { onActiveChange } = renderLayout({
        savedFieldIds: new Set(["u1"]),
      });
      await openMenu(user);
      await user.click(screen.getByRole("menuitem", { name: "Rename…" }));
      await openMenu(user);
      await user.click(screen.getByRole("menuitem", { name: "Rename…" }));

      const asked = (onActiveChange as ReturnType<typeof vi.fn>).mock.calls.map(
        ([active]) => active as { kind: string; renaming?: number }
      );
      expect(asked).toHaveLength(2);
      expect(asked[0]).toMatchObject({ kind: "edit", fieldId: "u1" });
      expect(asked[0].renaming).not.toBe(asked[1].renaming);
    });

    it("asks again when the settings are already open on that field", async () => {
      const user = userEvent.setup();
      const { rerender, props } = renderLayout({
        savedFieldIds: new Set(["u1"]),
        active: { kind: "edit", fieldId: "u1", renaming: 1 },
      });
      await user.click(
        within(
          screen.getByRole("dialog", { name: /Rename Excerpt/ })
        ).getByRole("button", { name: "Cancel" })
      );
      expect(
        screen.queryByRole("dialog", { name: /Rename Excerpt/ })
      ).toBeNull();
      rerender(
        <BuilderPageLayout
          {...props}
          active={{ kind: "edit", fieldId: "u1", renaming: 2 }}
        />
      );
      expect(
        screen.getByRole("dialog", { name: /Rename Excerpt/ })
      ).toBeInTheDocument();
    });
  });

  // Hiding from the outline changes the field in the Builder's draft, and the
  // save sends it hidden: the outline's Hide is the same edit as the panel's.
  it("hides a field from its row's menu, into the draft the save sends", async () => {
    const { props } = renderLayout();
    const user = userEvent.setup();
    screen.getByTestId("field-row-excerpt").focus();
    await user.keyboard("{Shift>}{F10}{/Shift}");
    await user.click(await screen.findByRole("menuitem", { name: "Hide" }));

    const update = props.builder.handleFieldUpdate as ReturnType<typeof vi.fn>;
    expect(update).toHaveBeenCalledTimes(1);
    const hidden = update.mock.calls[0][0] as BuilderField;
    expect(hidden).toMatchObject({ id: "u1", admin: { hidden: true } });
    // Kept by what a save sends.
    expect(convertToFieldDefinition(hidden).admin?.hidden).toBe(true);
  });

  describe("opening a field group, which leaves the page", () => {
    const seo: BuilderField = {
      id: "u2",
      name: "seo",
      label: "SEO",
      type: "component",
      component: "seo",
      validation: {},
      admin: { width: "100%" },
    } as BuilderField;
    const withSeo = (unsavedCount: number) =>
      renderLayout({
        builder: { ...makeBuilder(), fields: [...fields, seo] },
        unsavedCount,
      });
    const openFromMenu = async () => {
      const user = userEvent.setup();
      screen.getByTestId("field-row-seo").focus();
      await user.keyboard("{Shift>}{F10}{/Shift}");
      await user.click(
        await screen.findByRole("menuitem", { name: /Open the field group/ })
      );
    };

    beforeEach(() => navigateTo.mockClear());
    afterEach(() => vi.restoreAllMocks());

    // The reference goes; the field group's own fields, shown beneath it,
    // stay where they are defined.
    it("deleting it says the field goes, not the field group's own fields", async () => {
      withSeo(0);
      const user = userEvent.setup();
      screen.getByTestId("field-row-seo").focus();
      await user.keyboard("{Shift>}{F10}{/Shift}");
      await user.click(await screen.findByRole("menuitem", { name: "Delete" }));
      expect(
        screen.getByText("Deleted SEO. Undo brings it back.")
      ).toBeInTheDocument();
    });

    // The page's guard asks before any navigation while changes are pending
    // (see "leaving with pending changes" below), so opening a field group
    // only navigates: asking here as well would ask twice.
    it("navigates to the field group's editor without asking itself", async () => {
      const confirm = vi.spyOn(window, "confirm");
      withSeo(2);
      await openFromMenu();
      expect(confirm).not.toHaveBeenCalled();
      expect(navigateTo).toHaveBeenCalledTimes(1);
      expect(navigateTo.mock.calls[0][0]).toContain("seo");
    });

    it("navigates from the settings panel too, without asking itself", async () => {
      const confirm = vi.spyOn(window, "confirm");
      // The id the outline gives the field group's own field.
      const metaTitle = flattenOutline(
        buildOutline([...fields, seo], {
          entityReadOnly: false,
          fieldGroups: new Map([
            ["seo", { slug: "seo", label: "SEO", fields: seoFields }],
          ]),
        })
      ).find(node => node.path === "seo/meta_title");
      renderLayout({
        builder: { ...makeBuilder(), fields: [...fields, seo] },
        unsavedCount: 1,
        active: { kind: "edit", fieldId: metaTitle?.id ?? "" },
      });
      await userEvent.click(
        await screen.findByRole("button", { name: /Open the field group/ })
      );
      expect(confirm).not.toHaveBeenCalled();
      expect(navigateTo).toHaveBeenCalledTimes(1);
    });
  });

  // Every way out goes through the history the admin's router writes, which
  // the page's guard watches: an in-app link, the field group's editor, and
  // the browser's back. A reload and closing the tab are asked about by the
  // browser itself, and are covered in the browser tests.
  describe("leaving with pending changes", () => {
    const start = window.location.pathname;
    afterEach(() => window.history.replaceState(null, "", start));

    const leave = () =>
      act(() => window.history.pushState(null, "", "/admin/somewhere-else"));

    it("asks first, and stays when the editor keeps editing", async () => {
      renderLayout({ unsavedCount: 2 });
      leave();
      const dialog = await screen.findByRole("alertdialog");
      expect(window.location.pathname).toBe(start);
      await userEvent.click(
        within(dialog).getByRole("button", { name: /keep editing/i })
      );
      expect(screen.queryByRole("alertdialog")).toBeNull();
      expect(window.location.pathname).toBe(start);
    });

    it("leaves once the editor chooses to discard", async () => {
      renderLayout({ unsavedCount: 2 });
      leave();
      await userEvent.click(
        within(await screen.findByRole("alertdialog")).getByRole("button", {
          name: /discard/i,
        })
      );
      expect(window.location.pathname).toBe("/admin/somewhere-else");
    });

    // The crumb back to the list is a link like the admin's others: it moves
    // through the admin's own history, which the guard watches, so it asks
    // as every other way out does.
    it("asks first when the crumb back to the list is clicked", async () => {
      const actual = await vi.importActual<
        typeof import("@admin/lib/navigation")
      >("@admin/lib/navigation");
      navigateTo.mockImplementationOnce(actual.navigateTo);
      renderLayout({ unsavedCount: 2 });
      await userEvent.click(
        screen.getByRole("link", { name: /back to collections/i })
      );
      expect(await screen.findByRole("alertdialog")).toBeInTheDocument();
      expect(window.location.pathname).toBe(start);
    });

    it("does not ask with nothing pending", () => {
      renderLayout({ unsavedCount: 0 });
      leave();
      expect(screen.queryByRole("alertdialog")).toBeNull();
      expect(window.location.pathname).toBe("/admin/somewhere-else");
    });

    it("does not ask on a read-only entity, which has nothing to lose", () => {
      renderLayout({ unsavedCount: 0, locked: true });
      leave();
      expect(screen.queryByRole("alertdialog")).toBeNull();
    });

    // A save on its way writes what it was started with: discarding then would
    // leave the page while the save could still write the discarded values.
    // A save on its way still writes what it was started with, even when an
    // undo since has brought the pending count back to none: the way out waits
    // for it rather than leaving the save to land unseen.
    it("asks before leaving while a save is on its way, with nothing pending", async () => {
      renderLayout({ unsavedCount: 0, isSaving: true });
      leave();
      const dialog = await screen.findByRole("alertdialog");
      expect(window.location.pathname).toBe(start);
      expect(
        within(dialog).getByRole("button", { name: /discard/i })
      ).toBeDisabled();
    });

    it("offers no Discard Changes while a save is on its way", async () => {
      renderLayout({ unsavedCount: 2, isSaving: true });
      leave();
      const dialog = await screen.findByRole("alertdialog");
      expect(
        within(dialog).getByRole("button", { name: /discard/i })
      ).toBeDisabled();
      expect(
        within(dialog).getByRole("button", { name: /keep editing/i })
      ).toBeEnabled();
    });

    // An unsaved entity's new address being checked: discarding then would let
    // the entity go before the move renames it, and the move would report its
    // address as taken.
    it("offers no Discard Changes while a new address is checked", async () => {
      renderLayout({
        unsavedCount: 2,
        saveHeld: "Save waits while the new address is checked.",
      });
      leave();
      const dialog = await screen.findByRole("alertdialog");
      expect(
        within(dialog).getByRole("button", { name: /discard/i })
      ).toBeDisabled();
      expect(
        within(dialog).getByRole("button", { name: /keep editing/i })
      ).toBeEnabled();
    });
  });
});
