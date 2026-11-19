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
import type { SchemaTemplateKind } from "@admin/lib/builder/schema-templates";
import type { FieldDefinition } from "@admin/types/collection";

import { useBuilderEntityState } from "../useBuilderEntityState";
import { useBuilderFieldActions } from "../useBuilderFieldActions";

/** The server shape these tests load from. */
type Entity = { slug: string; name: string; fields: FieldDefinition[] };

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

/**
 * A stand-in for `useFieldBuilder` that holds its own fields, so the dirty
 * count can be observed against real field state rather than a mock's calls.
 */
function makeBuilder() {
  let current: BuilderField[] = [];
  // The settings share the builder's history, so the stand-in holds them too.
  let settings: BuilderSettingsValues | null = null;
  const api: BuilderFieldsApi = {
    get fields() {
      return current;
    },
    get settings() {
      return settings;
    },
    setSettings: vi.fn((next: BuilderSettingsValues) => {
      settings = next;
    }),
    get snapshot() {
      return { fields: current, settings };
    },
    setFields: vi.fn(next => {
      current = typeof next === "function" ? next(current) : next;
    }),
    sensors: [],
    handleDragStart: vi.fn(),
    handleFieldsReorder: vi.fn(),
    handleFieldDelete: vi.fn(),
    handleFieldUpdate: vi.fn(),
    handleNestedFieldAdd: vi.fn(),
    validateFields: vi.fn(() => ({ valid: true })),
    resetFields: vi.fn(
      (next: BuilderField[], nextSettings?: BuilderSettingsValues | null) => {
        current = next;
        if (nextSettings !== undefined) settings = nextSettings;
      }
    ),
    rewriteSnapshots: vi.fn(),
    clearHistory: vi.fn(),
    historyStep: 0,
    canUndo: false,
    canRedo: false,
    undo: vi.fn(() => null),
    redo: vi.fn(() => null),
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

function setup(
  entity: Entity | undefined,
  {
    unsaved = false,
    kind = "collection",
  }: { unsaved?: boolean; kind?: SchemaTemplateKind } = {}
) {
  const builder = makeBuilder();
  const rendered = renderHook(
    ({ e }: { e: Entity | undefined }) =>
      useBuilderEntityState({
        kind,
        entity: e,
        builder: builder.api,
        toFields: (loaded: Entity) => loaded.fields,
        toSettings: settingsOf,
        onLoad: () => {
          loadCount += 1;
        },
        identity: (loaded: Entity) => loaded.slug,
        unsaved,
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
    const { result } = setup({
      slug: "posts",
      name: "Post",
      fields: [definition("body")],
    });
    expect(result.current.isInitialized).toBe(true);
    expect(result.current.settings?.singularName).toBe("Post");
    expect(loadCount).toBe(1);
  });

  // title and slug are the server's, so the user's field list must not offer
  // them for editing or send them back on save.
  it("drops the fields the server owns", () => {
    const { builder } = setup({
      slug: "posts",
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
    const entity = {
      slug: "posts",
      name: "Post",
      fields: [definition("body")],
    };
    const { rerender } = setup(entity);
    rerender({ e: { ...entity } });
    rerender({ e: { ...entity, name: "Renamed" } });
    expect(loadCount).toBe(1);
  });

  // The router renders each page component without a key, so navigating from
  // one builder to another reuses the instance and its state. Keyed on "has
  // something loaded" rather than "which", the second entity never reaches the
  // builder and the page keeps showing the first one's fields under the new
  // one's name.
  it("loads again when it is pointed at a different entity", () => {
    const { result, builder, rerender } = setup({
      slug: "posts",
      name: "Post",
      fields: [definition("body")],
    });
    expect(result.current.settings?.singularName).toBe("Post");

    rerender({
      e: { slug: "pages", name: "Page", fields: [definition("intro")] },
    });

    expect(loadCount).toBe(2);
    expect(result.current.settings?.singularName).toBe("Page");
    expect(builder.api.fields.map(f => f.name)).toContain("intro");
    expect(builder.api.fields.map(f => f.name)).not.toContain("body");
    // Baselines moved with it: the new entity is what "unchanged" now means.
    expect(result.current.unsavedCount).toBe(0);
  });

  it("reports nothing unsaved immediately after loading", () => {
    const { result } = setup({
      slug: "posts",
      name: "Post",
      fields: [definition("body")],
    });
    expect(result.current.unsavedCount).toBe(0);
  });

  // A settings-only edit has to enable Save; counting field changes alone left
  // the button disabled and the edit unreachable.
  it("counts a settings-only edit", () => {
    const { result, rerender } = setup({
      slug: "posts",
      name: "Post",
      fields: [definition("body")],
    });
    act(() =>
      result.current.setSettings({
        ...settingsOf({ slug: "posts", name: "Article", fields: [] }),
      })
    );
    // The stand-in builder holds the settings outside React, as it does the
    // fields, so the page is drawn again to read them.
    rerender({ e: undefined });
    expect(result.current.unsavedCount).toBe(1);
  });

  it("counts an added field", () => {
    const { result, builder, rerender } = setup({
      slug: "posts",
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
    const { result, rerender } = setup({
      slug: "posts",
      name: "Post",
      fields: [definition("body")],
    });
    const renamed = settingsOf({ slug: "posts", name: "Article", fields: [] });
    act(() => result.current.setSettings(renamed));
    // Drawn again to read the stand-in builder's settings, held outside React.
    rerender({ e: undefined });
    expect(result.current.unsavedCount).toBe(1);

    act(() => result.current.pinSettings(renamed));
    expect(result.current.unsavedCount).toBe(0);
  });

  it("goes clean again once the saved fields are pinned", () => {
    const { result, builder, rerender } = setup({
      slug: "posts",
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

  // An entity created in the dialog and not saved yet: nothing of it is on the
  // server, so its starting fields are pending additions and the create itself
  // is one more pending change.
  it("counts an entity not saved yet, and its starting fields, as pending", () => {
    const { result } = setup(
      { slug: "products", name: "Product", fields: [definition("body")] },
      { unsaved: true }
    );
    expect(result.current.pending.saved).toEqual([]);
    expect(result.current.pending.changes).toEqual([
      expect.objectContaining({ kind: "added", name: "body" }),
    ]);
    expect(result.current.unsavedCount).toBe(2);
  });

  it("counts an entity not saved yet with no fields as one pending change", () => {
    const { result } = setup(
      { slug: "products", name: "Product", fields: [] },
      { unsaved: true }
    );
    expect(result.current.unsavedCount).toBe(1);
  });
});

// A field group holds no built-in title or slug, so a field of its own by either name is its
// own: shown as an editable field, and sent by the save. A collection's are built in: its
// rows are the built-in ones, and the save leaves them out.
describe("the built-in fields follow the entity's kind", () => {
  const OWN_NAMES = [
    definition("title"),
    definition("slug"),
    definition("body"),
  ];
  const shown = (fields: readonly BuilderField[]) =>
    fields.map(field => `${field.name}${field.isSystem ? " (built in)" : ""}`);

  it("keeps a field group's own title and slug through the load and the save", () => {
    const { builder } = setup(
      { slug: "card", name: "Card", fields: OWN_NAMES },
      { kind: "fieldGroup" }
    );
    expect(shown(builder.api.fields)).toEqual(["title", "slug", "body"]);

    const { result } = renderHook(() =>
      useBuilderFieldActions(builder.api, "fieldGroup")
    );
    expect(
      result.current.getValidatedFields()?.map(field => field.name)
    ).toEqual(["title", "slug", "body"]);
  });

  it("shows a collection's title and slug as its built-in fields, and saves neither", () => {
    const { builder } = setup(
      { slug: "posts", name: "Post", fields: OWN_NAMES },
      { kind: "collection" }
    );
    expect(shown(builder.api.fields)).toEqual([
      "title (built in)",
      "slug (built in)",
      "body",
    ]);

    const { result } = renderHook(() =>
      useBuilderFieldActions(builder.api, "collection")
    );
    expect(
      result.current.getValidatedFields()?.map(field => field.name)
    ).toEqual(["body"]);
  });
});

// A collection's title is a built-in row, yet its Unique is the person's to choose: turning it on
// or off is a change the count shows, the save sends, a reload keeps, and Discard all takes back.
// Its slug is always unique, and a Single's built-in fields are not saved by the Builder, so
// neither is ever sent.
describe("a collection's title Unique", () => {
  const titleOf = (fields: readonly BuilderField[]) =>
    fields.find(field => field.isSystem && field.name === "title");
  const withUnique = (
    fields: readonly BuilderField[],
    name: string,
    unique: boolean
  ) =>
    fields.map(field =>
      field.isSystem && field.name === name
        ? { ...field, advanced: { ...field.advanced, unique } }
        : field
    );
  const sent = (
    builder: ReturnType<typeof makeBuilder>,
    kind: SchemaTemplateKind
  ) =>
    renderHook(() => useBuilderFieldActions(builder.api, kind))
      .result.current.getValidatedFields()
      ?.map(field => [field.name, field.unique]);

  it("counts turning it on as one change of the title's settings, and saves the title with it", () => {
    const entity = {
      slug: "posts",
      name: "Post",
      fields: [definition("body")],
    };
    const { result, builder, rerender } = setup(entity);
    expect(result.current.unsavedCount).toBe(0);

    act(() =>
      builder.api.setFields(withUnique(builder.api.fields, "title", true))
    );
    rerender({ e: entity });

    expect(result.current.unsavedCount).toBe(1);
    expect(result.current.pending.changes).toEqual([
      expect.objectContaining({ kind: "settings", name: "title" }),
    ]);
    expect(sent(builder, "collection")).toEqual([
      ["title", true],
      ["body", false],
    ]);
  });

  it("reloads a title stored unique with its Unique on, and sends it off once turned off", () => {
    const entity = {
      slug: "posts",
      name: "Post",
      fields: [{ ...definition("title"), unique: true }, definition("body")],
    };
    const { result, builder, rerender } = setup(entity);
    expect(titleOf(builder.api.fields)?.advanced?.unique).toBe(true);
    expect(result.current.unsavedCount).toBe(0);

    act(() =>
      builder.api.setFields(withUnique(builder.api.fields, "title", false))
    );
    rerender({ e: entity });

    expect(result.current.unsavedCount).toBe(1);
    // Off is sent: the server keeps a stored built-in field it is not sent.
    expect(sent(builder, "collection")).toEqual([
      ["title", false],
      ["body", false],
    ]);
  });

  it("takes the change back with Discard all", () => {
    const entity = {
      slug: "posts",
      name: "Post",
      fields: [definition("body")],
    };
    const { result, builder, rerender } = setup(entity);
    act(() =>
      builder.api.setFields(withUnique(builder.api.fields, "title", true))
    );
    rerender({ e: entity });
    expect(result.current.unsavedCount).toBe(1);

    act(() => result.current.pending.discardAll());
    rerender({ e: entity });

    expect(titleOf(builder.api.fields)?.advanced?.unique).toBeUndefined();
    expect(result.current.unsavedCount).toBe(0);
  });

  it("keeps a stored title's own settings, changing only its Unique", () => {
    // A title stored with settings of its own (a label, required): the row is that title, so a
    // save that sends it back changes nothing of it but its Unique.
    const storedTitle = {
      ...definition("title"),
      label: "Headline",
      required: true,
      unique: true,
    };
    const entity = {
      slug: "posts",
      name: "Post",
      fields: [storedTitle, definition("body")],
    };
    const { result, builder, rerender } = setup(entity);
    expect(titleOf(builder.api.fields)).toMatchObject({
      label: "Headline",
      isSystem: true,
      advanced: { unique: true },
    });
    expect(result.current.unsavedCount).toBe(0);

    act(() =>
      builder.api.setFields(withUnique(builder.api.fields, "title", false))
    );
    rerender({ e: entity });

    const saved = renderHook(() =>
      useBuilderFieldActions(builder.api, "collection")
    ).result.current.getValidatedFields();
    expect(saved?.[0]).toMatchObject({
      name: "title",
      label: "Headline",
      required: true,
      unique: false,
    });
  });

  it("counts no change for a Single's built-in Unique, which no save sends", () => {
    const entity = { slug: "home", name: "Home", fields: [definition("body")] };
    const { result, builder, rerender } = setup(entity, { kind: "single" });

    act(() =>
      builder.api.setFields(withUnique(builder.api.fields, "title", true))
    );
    rerender({ e: entity });

    expect(result.current.unsavedCount).toBe(0);
    expect(result.current.pending.changes).toEqual([]);
  });

  it("never sends the slug, nor a Single's title", () => {
    const entity = {
      slug: "posts",
      name: "Post",
      fields: [definition("body")],
    };
    const collection = setup(entity);
    act(() =>
      collection.builder.api.setFields(
        withUnique(collection.builder.api.fields, "slug", true)
      )
    );
    expect(sent(collection.builder, "collection")).toEqual([["body", false]]);

    const single = setup(entity, { kind: "single" });
    act(() =>
      single.builder.api.setFields(
        withUnique(single.builder.api.fields, "title", true)
      )
    );
    expect(sent(single.builder, "single")).toEqual([["body", false]]);
  });
});
