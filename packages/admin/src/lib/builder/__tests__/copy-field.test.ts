// A copied field is a new field all the way down: the copy and every field
// inside it, at any depth, get ids no field in the tree holds, while
// everything else about them is copied as it was.
import { describe, expect, it } from "vitest";

import type { BuilderField } from "@admin/components/features/schema-builder/types";

import { copyWithNewIds } from "../copy-field";

const f = (id: string, over: Partial<BuilderField> = {}): BuilderField => ({
  id,
  name: id,
  label: id,
  type: "text",
  validation: { required: true },
  ...over,
});

/** Every id in a tree, depth first. */
function idsOf(fields: readonly BuilderField[]): string[] {
  return fields.flatMap(field => [field.id, ...idsOf(field.fields ?? [])]);
}

/** The tree with its ids taken out, to compare everything else. */
function withoutIds(field: BuilderField): unknown {
  const { id: _id, fields, ...rest } = field;
  return fields ? { ...rest, fields: fields.map(withoutIds) } : rest;
}

const GROUP = f("details", {
  type: "group",
  fields: [
    f("subtitle"),
    f("links", {
      type: "repeater",
      admin: { width: "100%" },
      fields: [
        f("url"),
        f("label"),
        f("extra", {
          type: "group",
          fields: [f("note", { pluginOptions: { a: 1 } })],
        }),
      ],
    }),
  ],
});

/** Every object reachable from a value, depth first. */
function objectsOf(value: unknown, into: object[] = []): object[] {
  if (value === null || typeof value !== "object") return into;
  into.push(value);
  Object.values(value).forEach(v => objectsOf(v, into));
  return into;
}

describe("copyWithNewIds", () => {
  it("gives the copy and every field inside it, at any depth, a new id", () => {
    const copy = copyWithNewIds(GROUP);
    const all = [...idsOf([GROUP]), ...idsOf([copy])];
    // Seven fields each side, three levels deep, and no id shared between or
    // within them.
    expect(all).toHaveLength(14);
    expect(new Set(all).size).toBe(14);
  });

  it("copies everything but the ids as it was", () => {
    expect(withoutIds(copyWithNewIds(GROUP))).toEqual(withoutIds(GROUP));
  });

  it("leaves the field it copied untouched", () => {
    const before = JSON.stringify(GROUP);
    copyWithNewIds(GROUP);
    expect(JSON.stringify(GROUP)).toBe(before);
  });

  it("shares no object with the original, at any depth, so editing one never edits the other", () => {
    const originals = new Set(objectsOf(GROUP));
    const shared = objectsOf(copyWithNewIds(GROUP)).filter(o =>
      originals.has(o)
    );
    expect(shared).toEqual([]);
  });

  it("gives a second copy of the same field ids of its own too", () => {
    const ids = [GROUP, copyWithNewIds(GROUP), copyWithNewIds(GROUP)].flatMap(
      g => idsOf([g])
    );
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("keeps a plugin option under any name, __proto__ included", () => {
    // The loader defines plugin options rather than assigning them, so a stored
    // option named __proto__ is an own key; a copy must keep it as one.
    const options = {};
    Object.defineProperty(options, "__proto__", {
      value: "kept",
      writable: true,
      enumerable: true,
      configurable: true,
    });
    const copy = copyWithNewIds(f("rating", { pluginOptions: options }));
    expect(Object.hasOwn(copy.pluginOptions ?? {}, "__proto__")).toBe(true);
    expect(
      Object.getOwnPropertyDescriptor(copy.pluginOptions, "__proto__")?.value
    ).toBe("kept");
  });
});
