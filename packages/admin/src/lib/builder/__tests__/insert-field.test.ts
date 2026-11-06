// Where a new field lands. One case per cell of the decision: the container
// (none, a container at any depth, missing, not a container) by the anchor
// (none, a sibling, not a sibling).
import { describe, expect, it } from "vitest";

import type { BuilderField } from "@admin/components/features/schema-builder/types";

import { addFieldToArray, addFieldToGroup } from "../field-transformers";
import { insertField, positionAfter } from "../insert-field";

const f = (id: string, over: Partial<BuilderField> = {}): BuilderField => ({
  id,
  name: id,
  label: id,
  type: "text",
  ...over,
});

const NEW = f("new");

/** The tree as names, containers with their children. */
function shape(fields: readonly BuilderField[] | null): unknown {
  if (fields === null) return null;
  return fields.map(field =>
    field.fields ? { [field.name]: shape(field.fields) } : field.name
  );
}

const TREE: BuilderField[] = [
  f("title"),
  f("details", {
    type: "group",
    fields: [
      f("subtitle"),
      f("links", { type: "repeater", fields: [f("url"), f("label")] }),
    ],
  }),
  f("body"),
];

describe("insertField", () => {
  it.each([
    [
      "top level, no anchor: last",
      {},
      [
        "title",
        { details: ["subtitle", { links: ["url", "label"] }] },
        "body",
        "new",
      ],
    ],
    [
      "top level, before a top-level field",
      { beforeFieldId: "body" },
      [
        "title",
        { details: ["subtitle", { links: ["url", "label"] }] },
        "new",
        "body",
      ],
    ],
    [
      "top level, first",
      { beforeFieldId: "title" },
      [
        "new",
        "title",
        { details: ["subtitle", { links: ["url", "label"] }] },
        "body",
      ],
    ],
    [
      "top level, anchor missing: last",
      { beforeFieldId: "gone" },
      [
        "title",
        { details: ["subtitle", { links: ["url", "label"] }] },
        "body",
        "new",
      ],
    ],
    [
      "top level, anchor nested elsewhere: last at the top, not beside it",
      { beforeFieldId: "url" },
      [
        "title",
        { details: ["subtitle", { links: ["url", "label"] }] },
        "body",
        "new",
      ],
    ],
    [
      "a group, no anchor: last in it",
      { parentFieldId: "details" },
      [
        "title",
        { details: ["subtitle", { links: ["url", "label"] }, "new"] },
        "body",
      ],
    ],
    [
      "a group, before its child",
      { parentFieldId: "details", beforeFieldId: "links" },
      [
        "title",
        { details: ["subtitle", "new", { links: ["url", "label"] }] },
        "body",
      ],
    ],
    [
      "a repeater two levels down, before its child",
      { parentFieldId: "links", beforeFieldId: "label" },
      [
        "title",
        { details: ["subtitle", { links: ["url", "new", "label"] }] },
        "body",
      ],
    ],
    [
      "a repeater two levels down, no anchor",
      { parentFieldId: "links" },
      [
        "title",
        { details: ["subtitle", { links: ["url", "label", "new"] }] },
        "body",
      ],
    ],
    [
      "a container, anchor at the top level instead: last in the container",
      { parentFieldId: "details", beforeFieldId: "body" },
      [
        "title",
        { details: ["subtitle", { links: ["url", "label"] }, "new"] },
        "body",
      ],
    ],
  ])("%s", (_name, position, expected) => {
    expect(shape(insertField(TREE, NEW, position))).toEqual(expected);
  });

  it.each([
    ["a container that is gone", { parentFieldId: "gone" }],
    ["a field that is not a container", { parentFieldId: "title" }],
  ])("adds nothing into %s", (_name, position) => {
    expect(insertField(TREE, NEW, position)).toBeNull();
  });

  it("adds into an empty container", () => {
    const tree = [f("meta", { type: "group" })];
    expect(shape(insertField(tree, NEW, { parentFieldId: "meta" }))).toEqual([
      { meta: ["new"] },
    ]);
  });

  it("leaves the tree it was given untouched", () => {
    const before = JSON.stringify(TREE);
    insertField(TREE, NEW, { parentFieldId: "links", beforeFieldId: "url" });
    expect(JSON.stringify(TREE)).toBe(before);
  });

  it("keeps the order of several adds at one anchor", () => {
    let fields: BuilderField[] = [f("a"), f("b")];
    for (const id of ["one", "two", "three"]) {
      fields = insertField(fields, f(id), { beforeFieldId: "b" }) ?? fields;
    }
    expect(shape(fields)).toEqual(["a", "one", "two", "three", "b"]);
  });
});

// The older helpers the Builder's duplicate and drag paths call place a field
// by the same rule, each into the one container type its name says.
describe("addFieldToArray and addFieldToGroup", () => {
  it("adds at the end of a repeater at any depth, and only a repeater", () => {
    expect(shape(addFieldToArray(TREE, "links", NEW))).toEqual([
      "title",
      { details: ["subtitle", { links: ["url", "label", "new"] }] },
      "body",
    ]);
    expect(addFieldToArray(TREE, "details", NEW)).toBe(TREE);
  });

  it("adds at the end of a group, and only a group", () => {
    expect(shape(addFieldToGroup(TREE, "details", NEW))).toEqual([
      "title",
      { details: ["subtitle", { links: ["url", "label"] }, "new"] },
      "body",
    ]);
    expect(addFieldToGroup(TREE, "links", NEW)).toBe(TREE);
    expect(addFieldToGroup(TREE, "gone", NEW)).toBe(TREE);
  });
});

// "/" on a field adds right after it: before its next sibling in the list that
// drew it, or that list's end after its last field.
describe("positionAfter", () => {
  const details = TREE[1];
  const links = details.fields![1];
  it.each([
    [
      "a top-level field",
      TREE,
      "title",
      undefined,
      { beforeFieldId: "details" },
    ],
    ["the last top-level field", TREE, "body", undefined, {}],
    [
      "a field inside a group",
      details.fields!,
      "subtitle",
      "details",
      { parentFieldId: "details", beforeFieldId: "links" },
    ],
    [
      "the last field inside a group",
      details.fields!,
      "links",
      "details",
      { parentFieldId: "details" },
    ],
    [
      "a field two levels down",
      links.fields!,
      "url",
      "links",
      { parentFieldId: "links", beforeFieldId: "label" },
    ],
  ])("after %s", (_name, siblings, fieldId, parentFieldId, expected) => {
    expect(positionAfter(siblings, fieldId, parentFieldId)).toEqual(expected);
  });

  it("has no position after a field that is not in the list", () => {
    expect(positionAfter(TREE, "subtitle")).toBeNull();
  });

  it("stays in the container that drew the field when a copy shares its ids", () => {
    // A duplicated group: its fields keep the original fields' ids.
    const copy = { ...details, id: "details_copy", name: "details_copy" };
    const tree = [...TREE, copy];
    const at = positionAfter(copy.fields!, "subtitle", copy.id);
    expect(at).toEqual({
      parentFieldId: "details_copy",
      beforeFieldId: "links",
    });
    const placed = insertField(tree, NEW, at!);
    expect(
      placed?.find(f => f.id === "details")?.fields?.map(f => f.id)
    ).toEqual(["subtitle", "links"]);
    expect(
      placed?.find(f => f.id === "details_copy")?.fields?.map(f => f.id)
    ).toEqual(["subtitle", "new", "links"]);
  });
});
