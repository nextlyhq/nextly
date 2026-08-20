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
  it("re-packs the row layout and keeps system fields ahead of it", () => {
    const builder = makeBuilder([
      field("id", { isSystem: true }),
      field("a"),
      field("b"),
      field("c"),
    ]);
    const { result } = renderHook(() => useBuilderFieldActions(builder.api));

    // Every field defaults to full width, so each occupies its own row.
    result.current.handleRowDragEnd(drag("row-0", "row-2"));

    expect(builder.api.handleFieldsReorder).toHaveBeenCalledTimes(1);
    expect(builder.fields.map(f => f.name)).toEqual(["id", "b", "c", "a"]);
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

  // Q2: moving a field out of its container is deliberately not supported, so
  // a cross-parent drag must leave the tree exactly as it was.
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

    result.current.handleRowDragEnd(drag("row-0", "row-0"));
    result.current.handleRowDragEnd(drag("row-0", null));

    expect(builder.api.handleFieldsReorder).not.toHaveBeenCalled();
  });

  it("ignores ids from neither drag vocabulary", () => {
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
