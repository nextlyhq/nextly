import { describe, expect, it } from "vitest";

import type { NumberFieldConfig } from "../../../collections/fields/types/number";

import { mapNumberField } from "./number";
import type { MappingContext } from "./types";

const baseCtx: MappingContext = {
  schemaRef: n => ({ $ref: `#/components/schemas/${n}` }),
  ownerSlug: "products",
  fieldPath: "fields[0]",
};

describe("mapNumberField", () => {
  it("minimal number field maps to a `number` schema", () => {
    const field: NumberFieldConfig = { name: "price", type: "number" };
    const { input } = mapNumberField(field, baseCtx);
    expect(input).toEqual({ type: "number" });
  });

  it("emits minimum and maximum from flat fields", () => {
    const field: NumberFieldConfig = {
      name: "price",
      type: "number",
      min: 0,
      max: 9999,
    };
    const { input } = mapNumberField(field, baseCtx);
    expect(input).toMatchObject({ minimum: 0, maximum: 9999 });
  });

  it("nested validation.min / validation.max wins over flat", () => {
    const field: NumberFieldConfig = {
      name: "price",
      type: "number",
      min: 0,
      max: 9999,
      validation: { min: 10, max: 100 },
    };
    const { input } = mapNumberField(field, baseCtx);
    expect(input).toMatchObject({ minimum: 10, maximum: 100 });
  });

  it("picks 'integer' when admin.step === 1", () => {
    const field: NumberFieldConfig = {
      name: "rating",
      type: "number",
      admin: { step: 1 },
    };
    const { input } = mapNumberField(field, baseCtx);
    expect(input.type).toBe("integer");
  });

  it("picks 'integer' when both min and max are integers (and step is unset)", () => {
    const field: NumberFieldConfig = {
      name: "rating",
      type: "number",
      min: 1,
      max: 5,
    };
    const { input } = mapNumberField(field, baseCtx);
    expect(input.type).toBe("integer");
  });

  it("stays 'number' when min or max is non-integer", () => {
    const field: NumberFieldConfig = {
      name: "price",
      type: "number",
      min: 0,
      max: 99.99,
    };
    const { input } = mapNumberField(field, baseCtx);
    expect(input.type).toBe("number");
  });

  it("emits multipleOf from admin.step when step !== 1", () => {
    const field: NumberFieldConfig = {
      name: "price",
      type: "number",
      admin: { step: 0.01 },
    };
    const { input } = mapNumberField(field, baseCtx);
    expect(input).toMatchObject({ type: "number", multipleOf: 0.01 });
  });

  it("does not emit multipleOf when step is 1 (it's implied by integer)", () => {
    const field: NumberFieldConfig = {
      name: "rating",
      type: "number",
      admin: { step: 1 },
    };
    const { input } = mapNumberField(field, baseCtx);
    expect(input).not.toHaveProperty("multipleOf");
  });

  it("hasMany flips to an array of number/integer", () => {
    const field: NumberFieldConfig = {
      name: "scores",
      type: "number",
      hasMany: true,
      min: 0,
      max: 100,
    };
    const { input } = mapNumberField(field, baseCtx);
    expect(input).toEqual({
      type: "array",
      items: { type: "integer", minimum: 0, maximum: 100 },
    });
  });

  it("hasMany honors minRows/maxRows as array minItems/maxItems", () => {
    const field: NumberFieldConfig = {
      name: "dims",
      type: "number",
      hasMany: true,
      minRows: 3,
      maxRows: 3,
    };
    const { input } = mapNumberField(field, baseCtx);
    expect(input).toMatchObject({ minItems: 3, maxItems: 3 });
  });

  it("admin.description wins over label", () => {
    const a: NumberFieldConfig = {
      name: "rating",
      type: "number",
      label: "Rating",
      admin: { description: "Stars from 1 to 5." },
    };
    expect(mapNumberField(a, baseCtx).input.description).toBe(
      "Stars from 1 to 5."
    );
  });
});
