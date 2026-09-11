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

import type { Active } from "@dnd-kit/core";
import { describe, expect, it } from "vitest";

import type { BuilderField } from "@admin/components/features/schema-builder/types";

import { builderAnnouncements } from "./builder-announcements";
import { builderRowId, builderRowIndex, builderRows } from "./builder-rows";

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
    expect(builderRowIndex("field_abc")).toBeUndefined();
    expect(builderRowIndex("row-x")).toBeUndefined();
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

  it("never reads a row id or a field id aloud", () => {
    const heard = [
      say.onDragStart({ active: at("row-9") }),
      say.onDragStart({ active: at("field_nope") }),
    ].join(" ");
    expect(heard).not.toMatch(/row-9|field_nope/);
    expect(heard).toContain("the item");
  });
});
