import { describe, expect, it } from "vitest";

import type { RadioFieldConfig } from "../../../collections/fields/types/radio";

import { mapRadioField } from "./radio";
import type { MappingContext } from "./types";

const baseCtx: MappingContext = {
  schemaRef: n => ({ $ref: `#/components/schemas/${n}` }),
  ownerSlug: "orders",
  fieldPath: "fields[0]",
};

describe("mapRadioField", () => {
  it("always maps to a single-value string with enum", () => {
    const field: RadioFieldConfig = {
      name: "size",
      type: "radio",
      options: [
        { label: "Small", value: "small" },
        { label: "Medium", value: "medium" },
        { label: "Large", value: "large" },
      ],
    };
    const { input, output } = mapRadioField(field, baseCtx);
    expect(input).toMatchObject({
      type: "string",
      enum: ["small", "medium", "large"],
    });
    expect(output).toMatchObject({
      type: "string",
      enum: ["small", "medium", "large"],
    });
  });

  it("emits ONLY option values in the enum (not labels)", () => {
    const field: RadioFieldConfig = {
      name: "paymentMethod",
      type: "radio",
      options: [
        { label: "Credit Card", value: "credit_card" },
        { label: "PayPal", value: "paypal" },
      ],
    };
    const { input } = mapRadioField(field, baseCtx);
    expect((input as { enum?: string[] }).enum).toEqual([
      "credit_card",
      "paypal",
    ]);
  });

  it("does NOT produce an array (radio has no hasMany)", () => {
    const field: RadioFieldConfig = {
      name: "size",
      type: "radio",
      options: [{ label: "S", value: "small" }],
    };
    const { input } = mapRadioField(field, baseCtx);
    expect((input as { type?: string }).type).toBe("string");
    expect((input as { type?: string }).type).not.toBe("array");
  });

  it("admin.description wins, label is the fallback", () => {
    const a: RadioFieldConfig = {
      name: "size",
      type: "radio",
      label: "Size",
      admin: { description: "Pick one size." },
      options: [{ label: "S", value: "small" }],
    };
    const b: RadioFieldConfig = {
      name: "size",
      type: "radio",
      label: "Size",
      options: [{ label: "S", value: "small" }],
    };
    expect(mapRadioField(a, baseCtx).input.description).toBe("Pick one size.");
    expect(mapRadioField(b, baseCtx).input.description).toBe("Size");
  });

  it("returns distinct input/output objects", () => {
    const field: RadioFieldConfig = {
      name: "size",
      type: "radio",
      options: [{ label: "S", value: "small" }],
    };
    const { input, output } = mapRadioField(field, baseCtx);
    expect(input).not.toBe(output);
  });
});
