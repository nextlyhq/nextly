// One overlay is open at a time, chosen by a single ActiveOverlay value. These
// tests lock the transitions the three builder pages share: an add lands where
// the picker was opened and opens the new field, add-and-add-another stays in
// the picker, and an edit resolves its field anywhere in the tree.
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

import { render, screen } from "@admin/__tests__/utils";

import { BuilderOverlays, type ActiveOverlay } from "../BuilderOverlays";
import type { BuilderConfig } from "../builder-config";
import type { BuilderSettingsValues } from "../BuilderSettingsModal";
import type { BuilderField, BuilderFieldsApi } from "../types";

import { UI_SCHEMA_FIELD_TYPES } from "@admin/lib/builder/ui-schema-mode";
import type { ApiFieldGroup } from "@admin/types/entities";

import { FIELD_TYPES_CATALOG } from "../field-picker-modal/field-types-catalog";

let fieldGroups: ApiFieldGroup[] = [];
vi.mock("@admin/hooks/queries", async importOriginal => ({
  ...(await importOriginal<typeof import("@admin/hooks/queries")>()),
  useFieldGroups: () => ({
    data: { items: fieldGroups, meta: {} },
    isLoading: false,
  }),
}));

const toastError = vi.fn();
vi.mock("@admin/components/ui", async importOriginal => {
  const actual = await importOriginal<typeof import("@admin/components/ui")>();
  return {
    ...actual,
    toast: {
      ...actual.toast,
      error: (...args: unknown[]) => toastError(...args),
    },
  };
});

afterEach(() => {
  fieldGroups = [];
  toastError.mockReset();
});

function fieldGroup(slug: string, label: string): ApiFieldGroup {
  return {
    id: `fg_${slug}`,
    slug,
    label,
    tableName: `fg_${slug}`,
    fields: [],
    createdAt: "2026-10-30T00:00:00Z",
    updatedAt: "2026-10-30T00:00:00Z",
  };
}

/** The fields the overlay handed the builder, from its one setFields call. */
function setFieldsArg(builder: BuilderFieldsApi): BuilderField[] {
  const calls = (builder.setFields as ReturnType<typeof vi.fn>).mock.calls;
  expect(calls).toHaveLength(1);
  return calls[0][0] as BuilderField[];
}

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
    sensors: [],
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

  // Picking a type and giving it a label adds the field where the picker was
  // opened, then opens it in the editor. The add is a pending change like any
  // other edit: nothing is saved until the page saves.
  it("adds the field where the picker was opened, then opens it", async () => {
    const user = userEvent.setup();
    const { builder, onActiveChange } = renderOverlays({
      kind: "picker",
      position: { beforeFieldId: "field_items" },
    });

    await user.click(screen.getByRole("option", { name: /^Text/ }));
    await user.type(screen.getByRole("textbox", { name: "Label" }), "Summary");
    await user.click(screen.getByRole("button", { name: "Add field" }));

    const next = setFieldsArg(builder);
    expect(next.map(f => f.name)).toEqual(["body", "summary", "items"]);
    expect(next[1]).toMatchObject({
      label: "Summary",
      type: "text",
      validation: {},
    });
    expect(onActiveChange).toHaveBeenLastCalledWith({
      kind: "edit",
      fieldId: next[1].id,
    });
  });

  it("adds inside a container at any depth, and names the container", async () => {
    const user = userEvent.setup();
    const { builder } = renderOverlays({
      kind: "picker",
      position: { parentFieldId: "field_items" },
    });

    // The container was found anywhere in the tree, not only at the top.
    expect(screen.getByText(/to items/i)).toBeInTheDocument();
    await user.click(screen.getByRole("option", { name: /^Text/ }));
    await user.type(screen.getByRole("textbox", { name: "Label" }), "Alt");
    await user.click(screen.getByRole("button", { name: "Add field" }));

    const items = setFieldsArg(builder).find(f => f.name === "items");
    expect(items?.fields?.map(f => f.name)).toEqual(["caption", "alt"]);
  });

  it("add and add another stays in the picker", async () => {
    const user = userEvent.setup();
    const { builder, onActiveChange } = renderOverlays({
      kind: "picker",
      position: {},
    });

    await user.click(screen.getByRole("option", { name: /^Text/ }));
    await user.type(screen.getByRole("textbox", { name: "Label" }), "Summary");
    await user.click(
      screen.getByRole("button", { name: "Add and add another" })
    );

    expect(setFieldsArg(builder).map(f => f.name)).toEqual([
      "body",
      "items",
      "summary",
    ]);
    expect(onActiveChange).not.toHaveBeenCalled();
    expect(
      screen.getByRole("combobox", { name: "Search field types" })
    ).toHaveFocus();
  });

  it("derives a name its siblings do not already use", async () => {
    const user = userEvent.setup();
    const { builder } = renderOverlays({ kind: "picker", position: {} });

    await user.click(screen.getByRole("option", { name: /^Text/ }));
    await user.type(screen.getByRole("textbox", { name: "Label" }), "Body");
    expect(screen.getByText("body_2")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Add field" }));

    expect(setFieldsArg(builder).map(f => f.name)).toEqual([
      "body",
      "items",
      "body_2",
    ]);
  });

  it("adds nothing when the container it was opened for is gone", async () => {
    const user = userEvent.setup();
    const { builder, onActiveChange } = renderOverlays({
      kind: "picker",
      position: { parentFieldId: "field_gone" },
    });

    await user.click(screen.getByRole("option", { name: /^Text/ }));
    await user.type(screen.getByRole("textbox", { name: "Label" }), "Lost");
    await user.click(screen.getByRole("button", { name: "Add field" }));

    expect(builder.setFields).not.toHaveBeenCalled();
    expect(toastError).toHaveBeenCalledWith(
      "The field was not added: the place it was meant for no longer exists."
    );
    expect(onActiveChange).toHaveBeenCalledWith({ kind: "none" });
  });

  it("hides the types the config excludes", () => {
    renderOverlays(
      { kind: "picker", position: {} },
      { config: { ...config, picker: { excludedTypes: ["relationship"] } } }
    );
    expect(
      screen.queryByRole("option", { name: /Link to entries/ })
    ).not.toBeInTheDocument();
    expect(screen.getByRole("option", { name: /^Text/ })).toBeInTheDocument();
  });

  it("offers exactly the catalog's types a ui-schema can store", () => {
    // Today every catalog type is storable, so the Builder's ui-schema filter
    // removes nothing; this pins that, so a catalog type added without
    // ui-schema support fails here and its place in the Builder is decided.
    const storableToday = new Set<string>(UI_SCHEMA_FIELD_TYPES);
    expect(
      FIELD_TYPES_CATALOG.map(e => e.type).filter(t => !storableToday.has(t))
    ).toEqual([]);
    renderOverlays({ kind: "picker", position: {} });
    const offered = screen
      .getAllByRole("option")
      .map(o => o.getAttribute("data-type"));
    const storable = new Set<string>(UI_SCHEMA_FIELD_TYPES);
    expect([...offered].sort()).toEqual(
      FIELD_TYPES_CATALOG.map(e => e.type)
        .filter(type => storable.has(type))
        .sort()
    );
    // Surface-only types are in no Builder catalog row at all.
    expect(offered).not.toContain("url");
  });

  it("gives a label with nothing the name rule keeps a name it can save", async () => {
    const user = userEvent.setup();
    const { builder } = renderOverlays({ kind: "picker", position: {} });

    await user.click(screen.getByRole("option", { name: /^Text/ }));
    await user.type(screen.getByRole("textbox", { name: "Label" }), "标题");
    await user.click(screen.getByRole("button", { name: "Add field" }));

    expect(setFieldsArg(builder).at(-1)).toMatchObject({
      label: "标题",
      name: "field",
    });
  });

  it("chooses a field group by its address and stores the choice", async () => {
    const user = userEvent.setup();
    fieldGroups = [fieldGroup("seo", "SEO"), fieldGroup("seo_v2", "SEO")];
    const { builder } = renderOverlays({ kind: "picker", position: {} });

    await user.click(screen.getByRole("option", { name: /Field group/ }));
    expect(screen.getAllByRole("option").map(o => o.textContent)).toEqual([
      "SEO (Field group, slug: seo)",
      "SEO (Field group, slug: seo_v2)",
    ]);
    await user.click(
      screen.getByRole("option", { name: "SEO (Field group, slug: seo_v2)" })
    );
    await user.click(screen.getByRole("button", { name: "Add field" }));

    expect(setFieldsArg(builder).at(-1)).toMatchObject({
      type: "component",
      label: "SEO",
      name: "seo",
      component: "seo_v2",
    });
  });

  it("never offers a field group inside itself", async () => {
    const user = userEvent.setup();
    fieldGroups = [fieldGroup("posts", "Posts"), fieldGroup("seo", "SEO")];
    renderOverlays(
      { kind: "picker", position: { parentFieldId: "field_items" } },
      { config: { ...config, kind: "field-group" } }
    );

    await user.click(screen.getByRole("option", { name: /Field group/ }));
    expect(screen.getAllByRole("option").map(o => o.textContent)).toEqual([
      "SEO (Field group, slug: seo)",
    ]);
  });

  // A nested row is clickable in the field list, so the edit overlay has to
  // resolve its id anywhere in the tree, not just among top-level fields.
  // The settings panel is docked beside the field list, not laid over it, so
  // the overlays draw nothing for an edit. What the panel does there (finding
  // a nested field, each edit reaching the builder, the delete confirmation)
  // is pinned in BuilderFieldSettings.test.tsx.
  it("draws nothing for an edit, which the layout docks beside the list", () => {
    const { container } = renderOverlays({
      kind: "edit",
      fieldId: "field_caption",
    });
    expect(container).toBeEmptyDOMElement();
  });

  // A field group's own fields hold a field group directly as well: its instances are rows of
  // their own, under the instance holding them. It is offered there as inside a group or repeater.
  it("offers a field group in a field group at its top level and inside a group or repeater", () => {
    const component: BuilderConfig = { ...config, kind: "field-group" };

    const top = renderOverlays(
      { kind: "picker", position: {} },
      { config: component }
    );
    expect(screen.getByRole("option", { name: /^Text/ })).toBeInTheDocument();
    expect(
      screen.getByRole("option", { name: /Field group/ })
    ).toBeInTheDocument();
    top.unmount();

    renderOverlays(
      { kind: "picker", position: { parentFieldId: "field_items" } },
      { config: component }
    );
    expect(
      screen.getByRole("option", { name: /Field group/ })
    ).toBeInTheDocument();
  });

  it("still offers a field group at a collection's top level", () => {
    renderOverlays({ kind: "picker", position: {} });
    expect(
      screen.getByRole("option", { name: /Field group/ })
    ).toBeInTheDocument();
  });
});
