// The frame all three builder kinds draw. What differs between them arrives as
// props and as the one slot above the field list, so these tests cover the
// wiring: the toolbar reaches the overlay state, the read-only notice follows
// the lock, the slot and the page's own dialogs render where the pages put
// them, and the live region speaks only while a save is in flight.
import userEvent from "@testing-library/user-event";
import type { ComponentProps } from "react";
import { describe, expect, it, vi } from "vitest";

import { render, screen } from "@admin/__tests__/utils";

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
    sensors: [] as unknown as BuilderFieldsApi["sensors"],
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
    name: "Posts",
    locked: false,
    unsavedCount: 0,
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
});
