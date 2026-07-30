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
import { NextlyError } from "../../../../errors/nextly-error";
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

  it("refuses an unparseable string instead of forwarding it", () => {
    // Nothing upstream rejects it: `date` validates as
    // `z.union([z.date(), z.string()])` and a plugin type falls to
    // `z.unknown()`. Forwarding it reaches the driver, whose failure the create
    // path reads as a missing table — so the caller would be told the value was
    // stored when it was dropped.
    let thrown: unknown;
    try {
      coerceUserExtValue("not a date", { name: "birthday", type: "date" });
    } catch (error) {
      thrown = error;
    }

    expect(NextlyError.isValidation(thrown)).toBe(true);
    const data = (thrown as NextlyError).publicData as
      | { errors?: Array<{ path: string }> }
      | undefined;
    expect(data?.errors?.[0]?.path).toBe("birthday");
  });

  it("refuses an unparseable value for a timestamp-backed plugin type too", () => {
    registerFieldType({
      type: "occurred2",
      storage: "timestamp",
      component: "c",
      surfaces: ["users"],
    });

    expect(() =>
      coerceUserExtValue("nonsense", { name: "at", type: "occurred2" })
    ).toThrow(NextlyError);
  });

  it("refuses a value the column cannot hold", () => {
    registerFieldType({
      type: "metric",
      storage: "number",
      component: "c",
      surfaces: ["users"],
    });
    registerFieldType({
      type: "toggle",
      storage: "boolean",
      component: "c",
      surfaces: ["users"],
    });

    // Nothing upstream looks at these: a plugin user field validates through
    // `z.unknown()`, and a failed user_ext insert is read as the table being
    // absent, so an unusable value is dropped rather than reported.
    expect(() =>
      coerceUserExtValue({ nested: true }, { name: "score", type: "metric" })
    ).toThrow(NextlyError);
    expect(() =>
      coerceUserExtValue("yes", { name: "flag", type: "toggle" })
    ).toThrow(NextlyError);
  });

  it("refuses an Invalid Date object", () => {
    registerFieldType({
      type: "occurred3",
      storage: "timestamp",
      component: "c",
      surfaces: ["users"],
    });

    expect(() =>
      coerceUserExtValue(new Date("nope"), { name: "at", type: "occurred3" })
    ).toThrow(NextlyError);
  });

  it("accepts the values each primitive can hold", () => {
    registerFieldType({
      type: "metric2",
      storage: "number",
      component: "c",
      surfaces: ["users"],
    });

    expect(coerceUserExtValue(7, { name: "score", type: "metric2" })).toBe(7);
    expect(
      coerceUserExtValue(null, { name: "score", type: "metric2" })
    ).toBeNull();
  });

  it("passes through what is not a string", () => {
    expect(coerceUserExtValue(null, { type: "date" })).toBeNull();
    const already = new Date("2026-07-30T00:00:00.000Z");
    expect(coerceUserExtValue(already, { type: "date" })).toBe(already);
  });
});
