/**
 * One packing for the builder canvas, read by the list, the reorder and the
 * drag announcements.
 *
 * The property under test is agreement: the row a reader drags is the row
 * that moves. Two packings had drifted — the list dropped hidden fields and
 * forced containers full-width, the reorder did neither — so the cases here
 * are the two inputs on which they disagreed.
 *
 * @module lib/builder/builder-rows.test
 */

import type { Active, Over } from "@dnd-kit/core";
import { describe, expect, it } from "vitest";

import type { BuilderField } from "@admin/components/features/schema-builder/types";

import { builderAnnouncements } from "./builder-announcements";
import {
  builderDropAccepted,
  builderRowId,
  builderRowIndex,
  builderRows,
} from "./builder-rows";

function field(
  id: string,
  patch: Partial<BuilderField> & { width?: string } = {}
): BuilderField {
  const { width, ...rest } = patch;
  return {
    id,
    name: id,
    label: id[0].toUpperCase() + id.slice(1),
    type: "text",
    ...(width ? { admin: { width } } : {}),
    ...rest,
  } as BuilderField;
}

describe("the rows the builder draws", () => {
  it("gives a hidden field no row, so the rows after it keep their index", () => {
    // 🔴 With the hidden field packed, `row-1` named it and the visible
    // field the reader saw second was `row-2`; the reorder then moved a row
    // the reader could not see.
    const rows = builderRows([
      field("title"),
      field("mode", { admin: { hidden: true } }),
      field("body"),
    ]);
    expect(rows.map(row => row.map(item => item.id))).toEqual([
      ["title"],
      ["body"],
    ]);
  });

  it("gives a repeater its own full row whatever width it stores", () => {
    // The list forces a container full-width so its nested group has room.
    // Packed at its stored 50%, the reorder put it beside its neighbour and
    // every row index after it was off by one.
    const rows = builderRows([
      field("first", { width: "50%" }),
      field("gallery", { type: "repeater", width: "50%" }),
      field("last", { width: "50%" }),
    ]);
    expect(rows.map(row => row.map(item => item.id))).toEqual([
      ["first"],
      ["gallery"],
      ["last"],
    ]);
  });

  it("leaves system fields out, to be drawn apart", () => {
    const rows = builderRows([field("id", { isSystem: true }), field("title")]);
    expect(rows.flat().map(item => item.id)).toEqual(["title"]);
  });

  it("round-trips a row id", () => {
    expect(builderRowIndex(builderRowId(3))).toBe(3);
    expect(builderRowIndex(builderRowId(0))).toBe(0);
    expect(builderRowIndex("field_abc")).toBeUndefined();
    expect(builderRowIndex("row-x")).toBeUndefined();
  });

  it("names a row only for the ids the list mints", () => {
    // 🔴 `Number()` read `row--1` as -1 and `row-1.5` as a fraction. Each
    // sat below the acceptance rule's upper bound, so a drop was announced as
    // a move while the reorder's own range check refused it. Only a canonical
    // nonnegative integer -- what `builderRowId` writes -- names a row.
    for (const id of ["row--1", "row-1.5", "row-01", "row-", "row-1e2"]) {
      expect(builderRowIndex(id), id).toBeUndefined();
    }
  });
});

describe("what a drag on the canvas says", () => {
  const fields = [
    field("first", { label: "First name", width: "50%" }),
    field("last", { label: "Last name", width: "50%" }),
    field("mode", { admin: { hidden: true } }),
    field("gallery", {
      type: "repeater",
      label: "Gallery",
      fields: [
        field("caption", { label: "Caption" }),
        field("credit", { label: "Credit" }),
      ],
    } as Partial<BuilderField>),
  ];
  const say = builderAnnouncements(fields);
  const at = (id: string): Active => ({
    id,
    data: { current: undefined },
    rect: { current: { initial: null, translated: null } },
  });
  // A drop target is an `Over`, a different shape from the `Active` being
  // dragged: it carries a resolved rect and a `disabled` flag, neither of
  // which the announcement reads.
  const over = (id: string): Over => ({
    id,
    data: { current: undefined },
    rect: { width: 0, height: 0, top: 0, left: 0, right: 0, bottom: 0 },
    disabled: false,
  });

  it("names every field in a row, and places the row among the rows drawn", () => {
    // Two half-width fields share row 1; the hidden field takes none; the
    // repeater is row 2. A packing that kept the hidden field would say
    // "row 1 of 3".
    expect(say.onDragStart({ active: at("row-0") })).toBe(
      "Picked up First name and Last name, row 1 of 2."
    );
    expect(say.onDragStart({ active: at("row-1") })).toBe(
      "Picked up Gallery, row 2 of 2."
    );
  });

  it("names a nested field and places it among its siblings", () => {
    expect(say.onDragStart({ active: at("credit") })).toBe(
      "Picked up Credit, position 2 of 2."
    );
  });

  it("says a field with no label and no name yet is unnamed, rather than nothing", () => {
    // 🔴 A field just added to the canvas has both empty until its author
    // fills them in, and it drags in that state. Read as `label || name` it
    // was announced as "Picked up , row 2" and, beside a named field, as
    // "and Title".
    const blank = field("new_1", { name: "", label: "", width: "50%" });
    const speak = builderAnnouncements([
      field("title", { label: "Title", width: "50%" }),
      blank,
      field("new_2", { name: "", label: "" }),
      field("gallery", {
        type: "repeater",
        label: "Gallery",
        fields: [field("new_3", { name: "", label: "" })],
      } as Partial<BuilderField>),
    ]);
    expect(speak.onDragStart({ active: at("row-0") })).toBe(
      "Picked up Title and an unnamed field, row 1 of 3."
    );
    expect(speak.onDragStart({ active: at("row-1") })).toBe(
      "Picked up an unnamed field, row 2 of 3."
    );
    expect(speak.onDragStart({ active: at("new_3") })).toBe(
      "Picked up an unnamed field, position 1 of 1."
    );
  });

  it("says a drop the handler refuses moved nothing", () => {
    // 🔴 A nested field released over a field in ANOTHER container is refused
    // by the drop handler, and the generic landing sentence said "moved to"
    // anyway. Decided by the same predicate the handler decides with.
    const withTwoContainers = [
      ...fields,
      field("sidebar", {
        type: "group",
        label: "Sidebar",
        fields: [field("note", { label: "Note" })],
      } as Partial<BuilderField>),
    ];
    const speak = builderAnnouncements(withTwoContainers);
    expect(speak.onDragEnd({ active: at("credit"), over: over("note") })).toBe(
      "Credit cannot move there. Nothing moved."
    );
    // The accepted case keeps its landing sentence.
    expect(
      speak.onDragEnd({ active: at("credit"), over: over("caption") })
    ).toBe("Credit moved to position 1 of 2.");
  });

  it("never reads a row id or a field id aloud", () => {
    const heard = [
      say.onDragStart({ active: at("row-9") }),
      say.onDragStart({ active: at("field_nope") }),
    ].join(" ");
    expect(heard).not.toMatch(/row-9|field_nope/);
    expect(heard).toContain("the item");
  });
});

describe("which drops the canvas accepts", () => {
  const fields = [
    field("first"),
    field("gallery", {
      type: "repeater",
      fields: [field("caption"), field("credit")],
    } as Partial<BuilderField>),
    field("sidebar", {
      type: "group",
      fields: [field("note")],
    } as Partial<BuilderField>),
  ];

  it("accepts a row over another row, and a field over a sibling", () => {
    expect(builderDropAccepted(fields, "row-0", "row-1")).toBe(true);
    expect(builderDropAccepted(fields, "caption", "credit")).toBe(true);
  });

  it("refuses a field over another container, a row over a field, and an item over itself", () => {
    expect(builderDropAccepted(fields, "caption", "note")).toBe(false);
    expect(builderDropAccepted(fields, "row-0", "caption")).toBe(false);
    expect(builderDropAccepted(fields, "caption", "row-0")).toBe(false);
    expect(builderDropAccepted(fields, "row-1", "row-1")).toBe(false);
  });

  it("refuses a row index the canvas does not draw", () => {
    expect(builderDropAccepted(fields, "row-0", "row-9")).toBe(false);
    // Below the count too: a negative index passes `< count` and is refused
    // by the reorder, so accepting it here announces a move that never
    // happens.
    expect(builderDropAccepted(fields, "row-0", "row--1")).toBe(false);
  });
});
