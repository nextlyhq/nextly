import { describe, expect, it } from "vitest";

import type { DateFieldConfig } from "../../../collections/fields/types/date";

import { mapDateField } from "./date";
import type { MappingContext } from "./types";

const baseCtx: MappingContext = {
  schemaRef: n => ({ $ref: `#/components/schemas/${n}` }),
  ownerSlug: "posts",
  fieldPath: "fields[0]",
};

describe("mapDateField", () => {
  it("defaults to format: 'date-time' when no pickerAppearance is set", () => {
    const field: DateFieldConfig = { name: "publishedAt", type: "date" };
    const { input, output } = mapDateField(field, baseCtx);
    expect(input).toMatchObject({ type: "string", format: "date-time" });
    expect(output).toMatchObject({ type: "string", format: "date-time" });
  });

  it("uses format: 'date' for pickerAppearance: 'dayOnly'", () => {
    const field: DateFieldConfig = {
      name: "birthDate",
      type: "date",
      admin: { date: { pickerAppearance: "dayOnly" } },
    };
    const { input } = mapDateField(field, baseCtx);
    expect(input).toMatchObject({ type: "string", format: "date" });
  });

  it("uses format: 'time' for pickerAppearance: 'timeOnly'", () => {
    const field: DateFieldConfig = {
      name: "openingTime",
      type: "date",
      admin: { date: { pickerAppearance: "timeOnly" } },
    };
    const { input } = mapDateField(field, baseCtx);
    expect(input).toMatchObject({ type: "string", format: "time" });
  });

  it("uses format: 'date-time' for 'dayAndTime' (and 'monthOnly')", () => {
    const dayTime: DateFieldConfig = {
      name: "eventStart",
      type: "date",
      admin: { date: { pickerAppearance: "dayAndTime" } },
    };
    const monthly: DateFieldConfig = {
      name: "expiration",
      type: "date",
      admin: { date: { pickerAppearance: "monthOnly" } },
    };
    expect(mapDateField(dayTime, baseCtx).input).toMatchObject({
      format: "date-time",
    });
    expect(mapDateField(monthly, baseCtx).input).toMatchObject({
      format: "date-time",
    });
  });

  it("emits x-nextly-picker-appearance when set", () => {
    const field: DateFieldConfig = {
      name: "birthDate",
      type: "date",
      admin: { date: { pickerAppearance: "dayOnly" } },
    };
    const { input } = mapDateField(field, baseCtx);
    expect(input).toMatchObject({
      "x-nextly-picker-appearance": "dayOnly",
    });
  });

  it("uses admin.description, falling back to label", () => {
    const a: DateFieldConfig = {
      name: "publishedAt",
      type: "date",
      label: "Published",
      admin: { description: "When this article went live." },
    };
    const b: DateFieldConfig = {
      name: "publishedAt",
      type: "date",
      label: "Published",
    };
    expect(mapDateField(a, baseCtx).input.description).toBe(
      "When this article went live."
    );
    expect(mapDateField(b, baseCtx).input.description).toBe("Published");
  });
});
