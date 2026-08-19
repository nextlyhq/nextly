// Loading an entity into the builder, and knowing afterwards what changed.
// Each builder page ran its own copy of this: the same one-shot effect, the
// same two baselines, re-pinned by hand after each of two kinds of save.
import { act } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { renderHook } from "@admin/__tests__/utils";
import type {
  BuilderField,
  BuilderFieldsApi,
} from "@admin/components/features/schema-builder/types";
import type { BuilderSettingsValues } from "@admin/components/features/schema-builder/BuilderSettingsModal";
import { DEFAULT_SYSTEM_FIELDS } from "@admin/lib/builder";
import type { FieldDefinition } from "@admin/types/collection";

import { useBuilderEntityState } from "../useBuilderEntityState";

/** The server shape these tests load from. */
type Entity = { name: string; fields: FieldDefinition[] };

function definition(name: string): FieldDefinition {
  return {
    name,
    label: name,
    type: "text",
    required: false,
    unique: false,
    index: false,
  };
}

function settingsOf(entity: Entity): BuilderSettingsValues {
  return { singularName: entity.name, slug: "posts", icon: "Database" };
}

function isDirty(
  a: BuilderSettingsValues | null,
  b: BuilderSettingsValues | null
): boolean {
  if (!a || !b) return false;
  return a.singularName !== b.singularName;
}

/**
 * A stand-in for `useFieldBuilder` that holds its own fields, so the dirty
 * count can be observed against real field state rather than a mock's calls.
 */
function makeBuilder() {
  let current: BuilderField[] = [];
  const api: BuilderFieldsApi = {
    get fields() {
      return current;
    },
    setFields: vi.fn(next => {
      current = typeof next === "function" ? next(current) : next;
    }),
    sensors: [] as unknown as BuilderFieldsApi["sensors"],
    handleDragStart: vi.fn(),
    handleFieldsReorder: vi.fn(),
    handleFieldDelete: vi.fn(),
    handleFieldUpdate: vi.fn(),
    handleNestedFieldAdd: vi.fn(),
    validateFields: vi.fn(() => ({ valid: true })),
  };
  return {
    api,
    push(field: BuilderField) {
      current = [...current, field];
    },
  };
}

// Counted rather than mocked: the assertion is how MANY times the entity was
// read in, and a counter types cleanly against the hook's callback signature.
let loadCount = 0;

function setup(entity: Entity | undefined) {
  const builder = makeBuilder();
  const rendered = renderHook(
    ({ e }: { e: Entity | undefined }) =>
      useBuilderEntityState({
        entity: e,
        builder: builder.api,
        toFields: (loaded: Entity) => loaded.fields,
        toSettings: settingsOf,
        isDirty,
        onLoad: () => {
          loadCount += 1;
        },
      }),
    { initialProps: { e: entity } }
  );
  return { ...rendered, builder };
}

beforeEach(() => {
  loadCount = 0;
});

describe("useBuilderEntityState", () => {
  it("holds nothing until the entity arrives", () => {
    const { result, builder } = setup(undefined);
    expect(result.current.settings).toBeNull();
    expect(result.current.isInitialized).toBe(false);
    expect(builder.api.setFields).not.toHaveBeenCalled();
    expect(loadCount).toBe(0);
  });

  it("loads the entity's settings and fields once it arrives", () => {
    const { result } = setup({ name: "Post", fields: [definition("body")] });
    expect(result.current.isInitialized).toBe(true);
    expect(result.current.settings?.singularName).toBe("Post");
    expect(loadCount).toBe(1);
  });

  // title and slug are the server's, so the user's field list must not offer
  // them for editing or send them back on save.
  it("drops the fields the server owns", () => {
    const { builder } = setup({
      name: "Post",
      fields: [definition("title"), definition("slug"), definition("body")],
    });
    const names = builder.api.fields.map(f => f.name);
    expect(names).toContain("body");
    expect(builder.api.fields.filter(f => !f.isSystem)).toHaveLength(1);
    // The builder's own system rows are still prepended.
    expect(builder.api.fields.length).toBe(DEFAULT_SYSTEM_FIELDS.length + 1);
  });

  it("loads only once, even as the entity object identity changes", () => {
    const entity = { name: "Post", fields: [definition("body")] };
    const { rerender } = setup(entity);
    rerender({ e: { ...entity } });
    rerender({ e: { ...entity, name: "Renamed" } });
    expect(loadCount).toBe(1);
  });

  it("reports nothing unsaved immediately after loading", () => {
    const { result } = setup({ name: "Post", fields: [definition("body")] });
    expect(result.current.unsavedCount).toBe(0);
  });

  // A settings-only edit has to enable Save; counting field changes alone left
  // the button disabled and the edit unreachable.
  it("counts a settings-only edit", () => {
    const { result } = setup({ name: "Post", fields: [definition("body")] });
    act(() =>
      result.current.setSettings({
        ...settingsOf({ name: "Article", fields: [] }),
      })
    );
    expect(result.current.unsavedCount).toBe(1);
  });

  it("counts an added field", () => {
    const { result, builder, rerender } = setup({
      name: "Post",
      fields: [definition("body")],
    });
    act(() => {
      builder.push({
        id: "field_new",
        name: "subtitle",
        label: "Subtitle",
        type: "text",
        validation: {},
      });
    });
    rerender({ e: undefined });
    expect(result.current.unsavedCount).toBe(1);
  });

  // The baseline moves when the write lands, which is what makes a change and
  // a change-back both read as clean.
  it("goes clean again once the saved settings are pinned", () => {
    const { result } = setup({ name: "Post", fields: [definition("body")] });
    const renamed = settingsOf({ name: "Article", fields: [] });
    act(() => result.current.setSettings(renamed));
    expect(result.current.unsavedCount).toBe(1);

    act(() => result.current.pinSettings(renamed));
    expect(result.current.unsavedCount).toBe(0);
  });

  it("goes clean again once the saved fields are pinned", () => {
    const { result, builder, rerender } = setup({
      name: "Post",
      fields: [definition("body")],
    });
    act(() => {
      builder.push({
        id: "field_new",
        name: "subtitle",
        label: "Subtitle",
        type: "text",
        validation: {},
      });
    });
    rerender({ e: undefined });
    expect(result.current.unsavedCount).toBe(1);

    act(() => result.current.pinFields());
    expect(result.current.unsavedCount).toBe(0);
  });
});
