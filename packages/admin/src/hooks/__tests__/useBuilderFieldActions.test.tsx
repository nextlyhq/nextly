// The three decisions the builder pages used to make identically three times:
// what a duplicated field is named, what a drag means, and which fields count
// as the user's. Each was byte-identical across the collection, field-group and
// single builders before it moved here, so these tests are the only place any
// of them is now covered.
import type { DragEndEvent } from "@dnd-kit/core";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { renderHook } from "@admin/__tests__/utils";
import type {
  BuilderField,
  BuilderFieldsApi,
} from "@admin/components/features/schema-builder/types";

import {
  deleteFieldById,
  updateFieldById,
} from "@admin/lib/builder/field-transformers";
import { insertField } from "@admin/lib/builder/insert-field";

import { useBuilderFieldActions } from "../useBuilderFieldActions";

// vi.hoisted because vi.mock's factory is lifted above every top-level
// binding, so a plain `const` declared here would not exist when it runs.
const { toastError } = vi.hoisted(() => ({ toastError: vi.fn() }));
vi.mock("@admin/components/ui", () => ({
  toast: { error: toastError, success: vi.fn(), warning: vi.fn() },
}));

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

/**
 * A stand-in for `useFieldBuilder`'s return value that holds its own field
 * array, so a handler that reads the list, computes, and writes it back can be
 * observed end to end rather than only at its call boundary.
 */
function makeBuilder(initial: BuilderField[]) {
  let current = initial;
  const api: BuilderFieldsApi = {
    get fields() {
      return current;
    },
    setFields: vi.fn(next => {
      current = typeof next === "function" ? next(current) : next;
    }),
    sensors: [],
    handleDragStart: vi.fn(),
    handleFieldsReorder: vi.fn(reordered => {
      current = reordered;
    }),
    handleFieldDelete: vi.fn(),
    handleFieldUpdate: vi.fn(),
    handleNestedFieldAdd: vi.fn(),
    validateFields: vi.fn(() => ({ valid: true })),
  };
  return {
    api,
    get fields() {
      return current;
    },
  };
}

/**
 * A complete drag-end event, built rather than asserted.
 *
 * The handler reads only `active.id` and `over?.id`, but it is typed against
 * dnd-kit's event, so the fixture supplies the whole shape. That way a change
 * to what a drag carries fails here, instead of a fragment continuing to
 * describe an event the library no longer produces. `overId` is nullable
 * because a drop outside any target is one of the cases under test.
 */
function drag(activeId: string, overId: string | null): DragEndEvent {
  const rect = { width: 0, height: 0, top: 0, left: 0, right: 0, bottom: 0 };
  return {
    activatorEvent: new Event("pointerdown"),
    active: {
      id: activeId,
      data: { current: undefined },
      rect: { current: { initial: null, translated: null } },
    },
    collisions: null,
    delta: { x: 0, y: 0 },
    over:
      overId === null
        ? null
        : { id: overId, rect, disabled: false, data: { current: undefined } },
  };
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("handleDuplicateField", () => {
  it("appends a copy of a top-level field under the next free name", () => {
    const builder = makeBuilder([field("title"), field("body")]);
    const { result } = renderHook(() => useBuilderFieldActions(builder.api));

    result.current.handleDuplicateField("field_body");

    expect(builder.fields).toHaveLength(3);
    const added = builder.fields[2];
    expect(added.name).toBe("body_2");
    expect(added.type).toBe("text");
    // A duplicate is a new field, not a second reference to the same one.
    expect(added.id).not.toBe("field_body");
  });

  // Names only have to be unique among siblings, so a nested duplicate is
  // named against its parent's children — a same-named field at the top level
  // must not push the counter along.
  it("names a nested duplicate against its siblings, not the whole tree", () => {
    const builder = makeBuilder([
      field("body"),
      field("items", {
        type: "repeater",
        fields: [field("caption")],
      }),
    ]);
    const { result } = renderHook(() => useBuilderFieldActions(builder.api));

    result.current.handleDuplicateField("field_caption");

    expect(builder.api.handleNestedFieldAdd).toHaveBeenCalledTimes(1);
    const [parentId, duplicate] = (
      builder.api.handleNestedFieldAdd as ReturnType<typeof vi.fn>
    ).mock.calls[0];
    expect(parentId).toBe("field_items");
    expect((duplicate as BuilderField).name).toBe("caption_2");
    // It went to the parent, not to the top level.
    expect(builder.api.setFields).not.toHaveBeenCalled();
  });

  it("does nothing for a field id that is not in the tree", () => {
    const builder = makeBuilder([field("body")]);
    const { result } = renderHook(() => useBuilderFieldActions(builder.api));

    result.current.handleDuplicateField("field_missing");

    expect(builder.api.setFields).not.toHaveBeenCalled();
    expect(builder.api.handleNestedFieldAdd).not.toHaveBeenCalled();
  });
});

describe("handleRowDragEnd", () => {
  it("moves a top-level field among its siblings, built-in fields staying first", () => {
    const builder = makeBuilder([
      field("id", { isSystem: true }),
      field("a"),
      field("b"),
      field("c"),
    ]);
    const { result } = renderHook(() => useBuilderFieldActions(builder.api));

    // The outline drags one field by its own id.
    result.current.handleRowDragEnd(drag("field_a", "field_c"));

    expect(builder.api.setFields).toHaveBeenCalledTimes(1);
    expect(builder.fields.map(f => f.name)).toEqual(["id", "b", "c", "a"]);
  });

  it("moves a hidden field like any other, since the outline shows it", () => {
    const builder = makeBuilder([
      field("a"),
      field("mode", { admin: { hidden: true } }),
      field("c"),
    ]);
    const { result } = renderHook(() => useBuilderFieldActions(builder.api));

    result.current.handleRowDragEnd(drag("field_mode", "field_a"));

    expect(builder.fields.map(f => f.name)).toEqual(["mode", "a", "c"]);
  });

  it("refuses a drop on a built-in field", () => {
    const builder = makeBuilder([field("id", { isSystem: true }), field("a")]);
    const { result } = renderHook(() => useBuilderFieldActions(builder.api));

    result.current.handleRowDragEnd(drag("field_a", "field_id"));

    expect(builder.api.setFields).not.toHaveBeenCalled();
  });

  it("reorders nested fields when both ends share a parent", () => {
    const builder = makeBuilder([
      field("items", {
        type: "repeater",
        fields: [field("one"), field("two")],
      }),
    ]);
    const { result } = renderHook(() => useBuilderFieldActions(builder.api));

    result.current.handleRowDragEnd(drag("field_one", "field_two"));

    expect(builder.api.setFields).toHaveBeenCalledTimes(1);
    expect(builder.fields[0].fields?.map(f => f.name)).toEqual(["two", "one"]);
  });

  // Moving a field out of its container is deliberately not supported, so a
  // cross-parent drag must leave the tree exactly as it was.
  it("ignores a drag between two different parents", () => {
    const builder = makeBuilder([
      field("left", { type: "repeater", fields: [field("one")] }),
      field("right", { type: "repeater", fields: [field("two")] }),
    ]);
    const { result } = renderHook(() => useBuilderFieldActions(builder.api));

    result.current.handleRowDragEnd(drag("field_one", "field_two"));

    expect(builder.api.setFields).not.toHaveBeenCalled();
    expect(builder.api.handleFieldsReorder).not.toHaveBeenCalled();
  });

  it("ignores a drop on itself and a drag with no drop target", () => {
    const builder = makeBuilder([field("a"), field("b")]);
    const { result } = renderHook(() => useBuilderFieldActions(builder.api));

    result.current.handleRowDragEnd(drag("field_a", "field_a"));
    result.current.handleRowDragEnd(drag("field_a", null));

    expect(builder.api.setFields).not.toHaveBeenCalled();
  });

  it("ignores ids that are not fields", () => {
    const builder = makeBuilder([field("a"), field("b")]);
    const { result } = renderHook(() => useBuilderFieldActions(builder.api));

    result.current.handleRowDragEnd(drag("palette-text", "field-list-drop"));

    expect(builder.api.setFields).not.toHaveBeenCalled();
    expect(builder.api.handleFieldsReorder).not.toHaveBeenCalled();
  });
});

describe("getValidatedFields", () => {
  it("returns only the user's fields, as definitions", () => {
    const builder = makeBuilder([
      field("id", { isSystem: true }),
      // Not flagged isSystem, but owned by the server all the same.
      field("title"),
      field("slug"),
      field("body"),
    ]);
    const { result } = renderHook(() => useBuilderFieldActions(builder.api));

    const definitions = result.current.getValidatedFields();

    expect(definitions?.map(d => d.name)).toEqual(["body"]);
    expect(builder.api.validateFields).toHaveBeenCalledWith([
      expect.objectContaining({ name: "body" }),
    ]);
  });

  it("reports the reason and returns null when the fields do not validate", () => {
    const builder = makeBuilder([field("body")]);
    (builder.api.validateFields as ReturnType<typeof vi.fn>).mockReturnValue({
      valid: false,
      errorMessage: "All fields must have a name",
    });
    const { result } = renderHook(() => useBuilderFieldActions(builder.api));

    expect(result.current.getValidatedFields()).toBeNull();
    expect(toastError).toHaveBeenCalledWith("All fields must have a name");
  });
});

// A duplicated container is a field of its own all the way down. The Builder
// edits, deletes and adds into fields by id, and applies each to every field
// holding that id, so a copy whose inner fields kept the originals' ids would
// change the original too, and Save would write that. These run the real tree
// transforms the Builder applies, and read the payload Save sends.
describe("a duplicated container", () => {
  function makeRealBuilder(initial: BuilderField[]) {
    const builder = makeBuilder(initial);
    const set = (next: BuilderField[]) =>
      (builder.api.setFields as (n: BuilderField[]) => void)(next);
    builder.api.handleFieldDelete = vi.fn((id: string) =>
      set(deleteFieldById(builder.fields, id))
    );
    builder.api.handleFieldUpdate = vi.fn((updated: BuilderField) =>
      set(updateFieldById(builder.fields, updated))
    );
    builder.api.handleNestedFieldAdd = vi.fn(
      (parentId: string, added: BuilderField) =>
        set(
          insertField(builder.fields, added, { parentFieldId: parentId }) ??
            builder.fields
        )
    );
    return builder;
  }

  const TREE = (): BuilderField[] => [
    field("details", {
      type: "group",
      fields: [
        field("subtitle"),
        field("links", { type: "repeater", fields: [field("url")] }),
      ],
    }),
  ];

  /** Every id in the tree, depth first. */
  const idsOf = (fields: readonly BuilderField[]): string[] =>
    fields.flatMap(f => [f.id, ...idsOf(f.fields ?? [])]);

  /** The names under a container in the payload Save sends. */
  const savedChildren = (
    saved: ReturnType<
      ReturnType<typeof useBuilderFieldActions>["getValidatedFields"]
    >,
    name: string
  ) => saved?.find(d => d.name === name)?.fields?.map(d => d.name);

  function duplicateDetails() {
    const builder = makeRealBuilder(TREE());
    const { result } = renderHook(() => useBuilderFieldActions(builder.api));
    result.current.handleDuplicateField("field_details");
    const [original, copy] = builder.fields;
    return { builder, result, original, copy };
  }

  it("gives every field in the entity its own id after a duplicate", () => {
    const { builder, copy } = duplicateDetails();
    const ids = idsOf(builder.fields);
    expect(ids).toHaveLength(8);
    expect(new Set(ids).size).toBe(8);
    expect(copy.name).toBe("details_2");
  });

  it("keeps every id unique when the same container is duplicated twice, and the copy again", () => {
    const { builder, result, copy } = duplicateDetails();
    result.current.handleDuplicateField("field_details");
    result.current.handleDuplicateField(copy.id);
    const ids = idsOf(builder.fields);
    // Four containers of four fields each.
    expect(ids).toHaveLength(16);
    expect(new Set(ids).size).toBe(16);
  });

  it("gives a container duplicated inside a group new ids all the way down", () => {
    const builder = makeRealBuilder(TREE());
    const { result } = renderHook(() => useBuilderFieldActions(builder.api));
    result.current.handleDuplicateField("field_links");
    const details = builder.fields[0];
    expect(details.fields!.map(f => f.name)).toEqual([
      "subtitle",
      "links",
      "links_2",
    ]);
    const ids = idsOf(builder.fields);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("deletes a field inside the copy and nothing in the original", () => {
    const { builder, result, copy } = duplicateDetails();
    builder.api.handleFieldDelete(copy.fields![0].id);
    const saved = result.current.getValidatedFields();
    expect(savedChildren(saved, "details")).toEqual(["subtitle", "links"]);
    expect(savedChildren(saved, "details_2")).toEqual(["links"]);
  });

  it("renames a field inside the copy and nothing in the original", () => {
    const { builder, result, copy } = duplicateDetails();
    builder.api.handleFieldUpdate({ ...copy.fields![0], name: "tagline" });
    const saved = result.current.getValidatedFields();
    expect(savedChildren(saved, "details")).toEqual(["subtitle", "links"]);
    expect(savedChildren(saved, "details_2")).toEqual(["tagline", "links"]);
  });

  it("adds into the copy's inner container and nowhere else", () => {
    const { builder, copy } = duplicateDetails();
    const innerCopy = copy.fields![1];
    builder.api.handleNestedFieldAdd(innerCopy.id, field("alt"));
    const [original, updatedCopy] = builder.fields;
    expect(original.fields![1].fields!.map(f => f.name)).toEqual(["url"]);
    expect(updatedCopy.fields![1].fields!.map(f => f.name)).toEqual([
      "url",
      "alt",
    ]);
  });
});
