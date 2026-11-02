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
    f("links", { type: "repeater", fields: [f("url"), f("label")] }),
  ],
});

describe("copyWithNewIds", () => {
  it("gives the copy and every field inside it, at any depth, a new id", () => {
    const copy = copyWithNewIds(GROUP);
    const all = [...idsOf([GROUP]), ...idsOf([copy])];
    // Five fields each side, and no id shared between or within them.
    expect(all).toHaveLength(10);
    expect(new Set(all).size).toBe(10);
  });

  it("copies everything but the ids as it was", () => {
    expect(withoutIds(copyWithNewIds(GROUP))).toEqual(withoutIds(GROUP));
  });

  it("leaves the field it copied untouched", () => {
    const before = JSON.stringify(GROUP);
    copyWithNewIds(GROUP);
    expect(JSON.stringify(GROUP)).toBe(before);
  });

  it("shares no object with the original, so editing one never edits the other", () => {
    const copy = copyWithNewIds(GROUP);
    expect(copy.fields).not.toBe(GROUP.fields);
    expect(copy.fields![1].fields).not.toBe(GROUP.fields![1].fields);
    expect(copy.validation).not.toBe(GROUP.validation);
  });
});
