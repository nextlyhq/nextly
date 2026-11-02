// Where a new field lands. One case per cell of the decision: the container
// (none, a container at any depth, missing, not a container) by the anchor
// (none, a sibling, not a sibling).
import { describe, expect, it } from "vitest";

import type { BuilderField } from "@admin/components/features/schema-builder/types";

import { insertField } from "../insert-field";

const f = (
  id: string,
  over: Partial<BuilderField> = {}
): BuilderField => ({ id, name: id, label: id, type: "text", ...over });

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
      ["title", { details: ["subtitle", { links: ["url", "label"] }] }, "body", "new"],
    ],
    [
      "top level, before a top-level field",
      { beforeFieldId: "body" },
      ["title", { details: ["subtitle", { links: ["url", "label"] }] }, "new", "body"],
    ],
    [
      "top level, first",
      { beforeFieldId: "title" },
      ["new", "title", { details: ["subtitle", { links: ["url", "label"] }] }, "body"],
    ],
    [
      "top level, anchor missing: last",
      { beforeFieldId: "gone" },
      ["title", { details: ["subtitle", { links: ["url", "label"] }] }, "body", "new"],
    ],
    [
      "top level, anchor nested elsewhere: last at the top, not beside it",
      { beforeFieldId: "url" },
      ["title", { details: ["subtitle", { links: ["url", "label"] }] }, "body", "new"],
    ],
    [
      "a group, no anchor: last in it",
      { parentFieldId: "details" },
      ["title", { details: ["subtitle", { links: ["url", "label"] }, "new"] }, "body"],
    ],
    [
      "a group, before its child",
      { parentFieldId: "details", beforeFieldId: "links" },
      ["title", { details: ["subtitle", "new", { links: ["url", "label"] }] }, "body"],
    ],
    [
      "a repeater two levels down, before its child",
      { parentFieldId: "links", beforeFieldId: "label" },
      ["title", { details: ["subtitle", { links: ["url", "new", "label"] }] }, "body"],
    ],
    [
      "a repeater two levels down, no anchor",
      { parentFieldId: "links" },
      ["title", { details: ["subtitle", { links: ["url", "label", "new"] }] }, "body"],
    ],
    [
      "a container, anchor at the top level instead: last in the container",
      { parentFieldId: "details", beforeFieldId: "body" },
      ["title", { details: ["subtitle", { links: ["url", "label"] }, "new"] }, "body"],
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
