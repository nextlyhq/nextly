/**
 * A required single field with no declared default is seeded on first read, so
 * the seeded value has to suit the column its type stores in. A plugin type
 * names none of the built-in cases, so without resolving its storage primitive
 * it fell through to the text default and put `""` into a numeric or boolean
 * column.
 */
import { afterEach, describe, expect, it } from "vitest";

import type { FieldConfig } from "../../../collections/fields/types";
import {
  clearFieldTypes,
  registerFieldType,
} from "../../schema/field-types/field-type-registry";
import { getDefaultValue } from "../services/single-utils";

afterEach(() => clearFieldTypes());

function field(type: string): FieldConfig {
  return { name: "v", type } as unknown as FieldConfig;
}

describe("getDefaultValue for plugin field types", () => {
  it("seeds a number-backed type with a number", () => {
    registerFieldType({
      type: "tally",
      storage: "number",
      component: "c",
      surfaces: ["entries", "singles"],
    });

    expect(getDefaultValue(field("tally"))).toBe(0);
  });

  it("seeds a boolean-backed type with a boolean", () => {
    registerFieldType({
      type: "flag",
      storage: "boolean",
      component: "c",
      surfaces: ["entries", "singles"],
    });

    expect(typeof getDefaultValue(field("flag"))).toBe("boolean");
  });

  it("seeds a text-backed type with a string", () => {
    registerFieldType({
      type: "slugish",
      storage: "text",
      component: "c",
      surfaces: ["entries", "singles"],
    });

    expect(getDefaultValue(field("slugish"))).toBe("");
  });

  it("seeds a required timestamp-backed type with a real date", () => {
    registerFieldType({
      type: "occurred",
      storage: "timestamp",
      component: "c",
      surfaces: ["entries", "singles"],
    });

    // A required field's column is NOT NULL, so null fails the insert and the
    // single is never created on first read.
    const required = {
      name: "at",
      type: "occurred",
      required: true,
    } as unknown as FieldConfig;

    expect(getDefaultValue(required)).toBeInstanceOf(Date);
  });

  it("still seeds an optional timestamp with null", () => {
    registerFieldType({
      type: "occurred2",
      storage: "timestamp",
      component: "c",
      surfaces: ["entries", "singles"],
    });

    // Its column is nullable, and null is what "no value yet" means there.
    expect(getDefaultValue(field("occurred2"))).toBeNull();
  });

  it("seeds a required built-in date the same way", () => {
    const required = {
      name: "at",
      type: "date",
      required: true,
    } as unknown as FieldConfig;

    expect(getDefaultValue(required)).toBeInstanceOf(Date);
  });

  it("still seeds a built-in by its own type", () => {
    expect(getDefaultValue(field("number"))).toBe(0);
    expect(getDefaultValue(field("text"))).toBe("");
  });
});
