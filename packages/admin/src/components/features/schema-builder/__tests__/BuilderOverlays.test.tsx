// One overlay is open at a time, chosen by a single ActiveOverlay value. These
// tests lock the transitions the three builder pages used to spell out
// identically: picking a type opens the editor against a draft rather than
// adding a field, a scoped add commits into its parent, and an edit resolves
// its field anywhere in the tree.
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import { render, screen, within } from "@admin/__tests__/utils";

import { BuilderOverlays, type ActiveOverlay } from "../BuilderOverlays";
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

function field(
  name: string,
  overrides: Partial<BuilderField> = {}
): BuilderField {
  return {
    id: `field_${name}`,
    name,
    label: name,
    type: "text",
    validation: {},
    ...overrides,
  };
}

const TREE: BuilderField[] = [
  field("body"),
  field("items", {
    type: "repeater",
    fields: [field("caption")],
  }),
];

function makeBuilder(fields: BuilderField[] = TREE): BuilderFieldsApi {
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

function renderOverlays(
  active: ActiveOverlay,
  overrides: {
    builder?: BuilderFieldsApi;
    onActiveChange?: (next: ActiveOverlay) => void;
    onSettingsChange?: (next: BuilderSettingsValues) => void;
    readOnly?: boolean;
    config?: BuilderConfig;
  } = {}
) {
  const builder = overrides.builder ?? makeBuilder();
  const onActiveChange = overrides.onActiveChange ?? vi.fn(() => {});
  const onSettingsChange = overrides.onSettingsChange ?? vi.fn(() => {});
  const result = render(
    <BuilderOverlays
      active={active}
      onActiveChange={onActiveChange}
      config={overrides.config ?? config}
      builder={builder}
      settings={settings}
      onSettingsChange={onSettingsChange}
      readOnly={overrides.readOnly ?? false}
    />
  );
  return { ...result, builder, onActiveChange, onSettingsChange };
}

describe("BuilderOverlays", () => {
  it("mounts nothing when no overlay is open", () => {
    const { container } = renderOverlays({ kind: "none" });
    expect(container).toBeEmptyDOMElement();
  });

  it("opens the settings modal on the entity's current values", () => {
    renderOverlays({ kind: "settings" });
    expect(screen.getByRole("dialog")).toBeInTheDocument();
    expect(screen.getByDisplayValue("Post")).toBeInTheDocument();
  });

  it("closes the settings modal without changing settings on cancel", async () => {
    const user = userEvent.setup();
    const { onActiveChange, onSettingsChange } = renderOverlays({
      kind: "settings",
    });
    await user.click(screen.getByRole("button", { name: /^cancel$/i }));
    expect(onActiveChange).toHaveBeenCalledWith({ kind: "none" });
    expect(onSettingsChange).not.toHaveBeenCalled();
  });

  // The picker adds nothing by itself. Choosing a type opens the editor sheet
  // against a draft, so a cancelled create leaves no placeholder behind.
  it("turns a picked type into a create draft rather than a field", async () => {
    const user = userEvent.setup();
    const { onActiveChange, builder } = renderOverlays({
      kind: "picker",
      insertAt: 0,
    });

    await user.click(screen.getByText("Text"));

    expect(builder.setFields).not.toHaveBeenCalled();
    expect(onActiveChange).toHaveBeenCalledWith(
      expect.objectContaining({
        kind: "create",
        parentFieldId: undefined,
        draft: expect.objectContaining({ type: "text", name: "" }),
      })
    );
  });

  it("keeps the picker scoped to its parent through to the draft", async () => {
    const user = userEvent.setup();
    const { onActiveChange } = renderOverlays({
      kind: "picker",
      insertAt: 0,
      parentFieldId: "field_items",
    });

    // The title names the parent, which means the id was resolved against the
    // whole tree rather than only the top level.
    expect(screen.getByText(/add field to items/i)).toBeInTheDocument();

    await user.click(screen.getByText("Text"));
    expect(onActiveChange).toHaveBeenCalledWith(
      expect.objectContaining({ kind: "create", parentFieldId: "field_items" })
    );
  });

  it("hides the types the config excludes", () => {
    renderOverlays(
      { kind: "picker", insertAt: 0 },
      { config: { ...config, picker: { excludedTypes: ["relationship"] } } }
    );
    expect(screen.queryByText("Relationship")).not.toBeInTheDocument();
  });

  it("commits an unscoped create to the top level", async () => {
    const user = userEvent.setup();
    const { builder, onActiveChange } = renderOverlays({
      kind: "create",
      draft: field("new_field"),
    });

    await user.click(screen.getByRole("button", { name: /add field/i }));

    expect(builder.setFields).toHaveBeenCalledTimes(1);
    expect(builder.handleNestedFieldAdd).not.toHaveBeenCalled();
    expect(onActiveChange).toHaveBeenCalledWith({ kind: "none" });
  });

  it("commits a scoped create into its parent", async () => {
    const user = userEvent.setup();
    const { builder } = renderOverlays({
      kind: "create",
      draft: field("new_field"),
      parentFieldId: "field_items",
    });

    await user.click(screen.getByRole("button", { name: /add field/i }));

    expect(builder.handleNestedFieldAdd).toHaveBeenCalledTimes(1);
    expect(
      (builder.handleNestedFieldAdd as ReturnType<typeof vi.fn>).mock
        .calls[0][0]
    ).toBe("field_items");
    expect(builder.setFields).not.toHaveBeenCalled();
  });

  // A nested row is clickable in the field list, so the edit overlay has to
  // resolve its id anywhere in the tree, not just among top-level fields.
  it("opens the editor on a nested field", () => {
    renderOverlays({ kind: "edit", fieldId: "field_caption" });
    expect(screen.getByRole("dialog")).toBeInTheDocument();
    // The sheet's own description names the field it resolved.
    expect(
      screen.getByText(/settings for the caption field/i)
    ).toBeInTheDocument();
  });

  it("renders nothing for an edit whose field is gone", () => {
    const { container } = renderOverlays({
      kind: "edit",
      fieldId: "field_missing",
    });
    expect(container).toBeEmptyDOMElement();
  });

  it("applies an edit through the builder and closes", async () => {
    const user = userEvent.setup();
    const { builder, onActiveChange } = renderOverlays({
      kind: "edit",
      fieldId: "field_body",
    });

    await user.click(screen.getByRole("button", { name: /^apply$/i }));

    expect(builder.handleFieldUpdate).toHaveBeenCalledTimes(1);
    expect(onActiveChange).toHaveBeenCalledWith({ kind: "none" });
  });

  it("deletes the edited field once the deletion is confirmed", async () => {
    const user = userEvent.setup();
    const { builder } = renderOverlays({
      kind: "edit",
      fieldId: "field_body",
    });

    await user.click(screen.getByRole("button", { name: /delete field/i }));
    // The header icon and the confirmation share a label, so scope the second
    // click to the dialog the first one opened.
    const confirm = within(screen.getByRole("alertdialog"));
    await user.click(confirm.getByRole("button", { name: /delete field/i }));

    expect(builder.handleFieldDelete).toHaveBeenCalledWith("field_body");
  });
});
