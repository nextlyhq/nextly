/**
 * A `user_ext` value has to match the column its field maps to. When it does
 * not, the create path reads the resulting insert failure as the extension
 * table being absent: it disables the extension for the process and writes the
 * user without the value, so the wrong shape is lost rather than reported.
 */
import { afterEach, describe, expect, it } from "vitest";

import {
  clearFieldTypes,
  registerFieldType,
} from "../../../schema/field-types/field-type-registry";
import { coerceUserExtValue } from "../user-mutation-service";

afterEach(() => clearFieldTypes());

describe("coerceUserExtValue", () => {
  it("turns a timestamp-backed plugin value into a Date", () => {
    registerFieldType({
      type: "occurred",
      storage: "timestamp",
      component: "c",
      surfaces: ["users"],
    });

    const value = coerceUserExtValue("2026-07-30T00:00:00.000Z", {
      type: "occurred",
    });

    expect(value).toBeInstanceOf(Date);
    expect((value as Date).toISOString()).toBe("2026-07-30T00:00:00.000Z");
  });

  it("turns a built-in date value into a Date", () => {
    // The column builder maps `date` to a timestamp column on every dialect,
    // so this field had the same mismatch before any plugin type existed.
    const value = coerceUserExtValue("2026-07-30T00:00:00.000Z", {
      type: "date",
    });

    expect(value).toBeInstanceOf(Date);
  });

  it("leaves a text-backed plugin value alone", () => {
    registerFieldType({
      type: "slugish",
      storage: "text",
      component: "c",
      surfaces: ["users"],
    });

    expect(coerceUserExtValue("hello", { type: "slugish" })).toBe("hello");
  });

  it("leaves an unparseable string as it was given", () => {
    // Reporting a bad value belongs to validation; substituting an Invalid
    // Date would store a null-ish value for something the caller supplied.
    expect(coerceUserExtValue("not a date", { type: "date" })).toBe(
      "not a date"
    );
  });

  it("passes through what is not a string", () => {
    expect(coerceUserExtValue(null, { type: "date" })).toBeNull();
    const already = new Date("2026-07-30T00:00:00.000Z");
    expect(coerceUserExtValue(already, { type: "date" })).toBe(already);
  });
});
