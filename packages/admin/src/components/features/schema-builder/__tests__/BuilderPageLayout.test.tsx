// The frame all three builder kinds draw. What differs between them arrives as
// props and as the one slot above the field list, so these tests cover the
// wiring: the toolbar reaches the overlay state, the read-only notice follows
// the lock, the slot and the page's own dialogs render where the pages put
// them, and the live region speaks only while a save is in flight.
import userEvent from "@testing-library/user-event";
import type { ComponentProps } from "react";
import { describe, expect, it, vi } from "vitest";

import { render, screen, within } from "@admin/__tests__/utils";
import { convertToFieldDefinition } from "@admin/lib/builder";

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
    savedFieldIds: new Set<string>(),
    onSave: vi.fn(),
    settings,
    onSettingsChange: vi.fn(),
    active: { kind: "none" },
    onActiveChange,
    onDuplicateField: vi.fn(),
    onRowDragEnd: vi.fn(),
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
});
