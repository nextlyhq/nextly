// Whether a name is taken where a field would get it, by the save's own rules: a sibling holding
// it (in any spelling the save counts as the same), a built-in column, or Draft/Published while it
// is on. A name refused for its spelling or its length is not taken, since no suffix frees it, but
// a sibling holding it still takes it: a copy of a plugin's camelCase field must not share its
// name.
import { describe, expect, it } from "vitest";

import type { BuilderField } from "@admin/components/features/schema-builder/types";

import { duplicatedFields } from "../duplicate-field";
import { nameIsTakenAt, nameRuleProblem } from "../field-name-check";

const TOP = {
  surface: "collection",
  nested: false,
  lifecycleEnabled: false,
} as const;

describe("nameIsTakenAt", () => {
  it("is taken when a sibling holds a name the Builder would not spell", () => {
    expect(
      nameIsTakenAt("metaTitle", { ...TOP, siblingNames: ["metaTitle"] })
    ).toBe(true);
    expect(
      nameIsTakenAt("a".repeat(64), { ...TOP, siblingNames: ["a".repeat(64)] })
    ).toBe(true);
  });

  it("is not taken for its spelling or its length alone", () => {
    expect(nameIsTakenAt("metaTitle", { ...TOP, siblingNames: [] })).toBe(
      false
    );
    expect(nameIsTakenAt("a".repeat(64), { ...TOP, siblingNames: [] })).toBe(
      false
    );
  });

  it("is taken by a built-in column, and by Draft/Published only while it is on", () => {
    expect(nameIsTakenAt("created_at", { ...TOP, siblingNames: [] })).toBe(
      true
    );
    expect(nameIsTakenAt("status", { ...TOP, siblingNames: [] })).toBe(false);
    expect(
      nameIsTakenAt("status", {
        ...TOP,
        lifecycleEnabled: true,
        siblingNames: [],
      })
    ).toBe(true);
  });
});

describe("nameRuleProblem", () => {
  it("answers with the rule's kind and the panel's words", () => {
    expect(nameRuleProblem("created_at", TOP)).toEqual({
      kind: "reserved",
      message: "created_at is a built-in column here. Choose another name.",
    });
    expect(nameRuleProblem("body", TOP)).toBeNull();
  });

  // A field that makes no column (a field-group reference) carries its name in no column, so the
  // column's length does not reach it, as the save judges it.
  it("holds a name to the column's length only where the field makes a column", () => {
    const long = "a".repeat(64);
    expect(nameRuleProblem(long, TOP)?.kind).toBe("column-too-long");
    expect(nameRuleProblem(long, { ...TOP, producesColumn: true })?.kind).toBe(
      "column-too-long"
    );
    expect(nameRuleProblem(long, { ...TOP, producesColumn: false })).toBeNull();
  });

  // A field-group field's name is what its group's rows point back to it by, which keeps 255
  // characters: past that the name is refused whether or not the field makes a column.
  it("holds every name to the longest its parent pointer keeps", () => {
    const place = { ...TOP, producesColumn: false };
    expect(nameRuleProblem("a".repeat(255), place)).toBeNull();
    expect(nameRuleProblem("a".repeat(256), place)).toEqual({
      kind: "name-too-long",
      message: "Too long: a field's name may have at most 255 characters.",
    });
  });
});

describe("a copy of a plugin's camelCase field", () => {
  it("takes the next free suffix rather than the original's name", () => {
    const meta = {
      id: "f-meta",
      name: "metaTitle",
      label: "Meta title",
      type: "text",
      validation: {},
    } as BuilderField;
    const next = duplicatedFields([meta], "f-meta", { surface: "collection" });
    expect(next?.map(field => field.name)).toEqual([
      "metaTitle",
      "metaTitle_2",
    ]);
  });
});
