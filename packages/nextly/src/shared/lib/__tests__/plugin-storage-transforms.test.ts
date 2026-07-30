/**
 * A plugin field's column is built from its storage primitive, so the value
 * written into it has to be shaped by that primitive too. Both decisions are
 * made on `field.type`, which for a plugin type names none of the built-in
 * branches: the column would be JSON or a timestamp while the value stayed a
 * raw object or a string.
 */
import { afterEach, describe, expect, it } from "vitest";

import type { FieldConfig } from "../../../collections/fields/types";
import {
  clearFieldTypes,
  registerFieldType,
} from "../../../domains/schema/field-types/field-type-registry";
import { shouldTreatAsJson } from "../../../domains/field-groups/services/field-group-utils";
import { coerceDateFieldsToDate } from "../field-transform";

afterEach(() => {
  clearFieldTypes();
});

describe("value transforms for plugin field types", () => {
  it("serializes a json-backed type as JSON", () => {
    registerFieldType({
      type: "chart",
      storage: "json",
      component: "@acme/charts/admin#Chart",
      surfaces: ["entries", "singles", "components"],
    });

    expect(
      shouldTreatAsJson({
        name: "data",
        type: "chart",
      } as unknown as FieldConfig)
    ).toBe(true);
  });

  it("leaves a text-backed type alone", () => {
    registerFieldType({
      type: "slugish",
      storage: "text",
      component: "@acme/slugs/admin#Slug",
      surfaces: ["entries", "singles", "components"],
    });

    expect(
      shouldTreatAsJson({
        name: "handle",
        type: "slugish",
      } as unknown as FieldConfig)
    ).toBe(false);
  });

  it("coerces a timestamp-backed type to a Date", () => {
    registerFieldType({
      type: "occurred",
      storage: "timestamp",
      component: "@acme/time/admin#When",
      surfaces: ["entries", "singles", "components"],
    });

    const data: Record<string, unknown> = { at: "2026-07-30T00:00:00.000Z" };
    coerceDateFieldsToDate(data, [{ name: "at", type: "occurred" }]);

    // Drizzle refuses to bind a string to a timestamp column, so leaving it
    // would fail the write rather than store the wrong thing.
    expect(data.at).toBeInstanceOf(Date);
  });

  it("leaves a number-backed type as it was given", () => {
    registerFieldType({
      type: "tally",
      storage: "number",
      component: "@acme/tally/admin#Tally",
      surfaces: ["entries", "singles", "components"],
    });

    const data: Record<string, unknown> = { hits: "7" };
    coerceDateFieldsToDate(data, [{ name: "hits", type: "tally" }]);

    expect(data.hits).toBe("7");
  });

  it("still reads the declared type for a built-in", () => {
    // The resolution must not displace the built-in decisions it sits in front
    // of: an unregistered token is not a plugin type and keeps its own meaning.
    expect(
      shouldTreatAsJson({ name: "body", type: "richText" } as FieldConfig)
    ).toBe(true);
    expect(
      shouldTreatAsJson({ name: "title", type: "text" } as FieldConfig)
    ).toBe(false);

    const data: Record<string, unknown> = { at: "2026-07-30T00:00:00.000Z" };
    coerceDateFieldsToDate(data, [{ name: "at", type: "date" }]);
    expect(data.at).toBeInstanceOf(Date);
  });
});
