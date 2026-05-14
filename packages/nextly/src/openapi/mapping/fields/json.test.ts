import { describe, expect, it } from "vitest";

import type { JSONFieldConfig } from "../../../collections/fields/types/json";

import { mapJsonField } from "./json";
import type { MappingContext } from "./types";

const baseCtx: MappingContext = {
  schemaRef: n => ({ $ref: `#/components/schemas/${n}` }),
  ownerSlug: "Post",
  fieldPath: "fields[0]",
};

describe("mapJsonField", () => {
  it("with no jsonSchema, emits a permissive empty object (any JSON allowed)", () => {
    const field: JSONFieldConfig = { name: "meta", type: "json" };
    const { input, output } = mapJsonField(field, baseCtx);
    expect(input).toEqual({});
    expect(output).toEqual({});
  });

  it("passes through an attached jsonSchema as-is", () => {
    const field: JSONFieldConfig = {
      name: "config",
      type: "json",
      jsonSchema: {
        type: "object",
        properties: {
          items: { type: "array", items: { type: "string" } },
          enabled: { type: "boolean" },
        },
        required: ["items"],
      },
    };
    const { input, output } = mapJsonField(field, baseCtx);
    expect(input).toMatchObject({
      type: "object",
      properties: {
        items: { type: "array", items: { type: "string" } },
        enabled: { type: "boolean" },
      },
      required: ["items"],
    });
    expect(output).toMatchObject({
      type: "object",
      properties: {
        items: { type: "array", items: { type: "string" } },
        enabled: { type: "boolean" },
      },
    });
  });

  it("emits description from admin.description / label even with no jsonSchema", () => {
    const field: JSONFieldConfig = {
      name: "meta",
      type: "json",
      label: "Metadata",
    };
    const { input } = mapJsonField(field, baseCtx);
    expect((input as { description?: string }).description).toBe("Metadata");
  });

  it("preserves user-provided description on top of jsonSchema description", () => {
    const field: JSONFieldConfig = {
      name: "meta",
      type: "json",
      admin: { description: "Free-form JSON object." },
      jsonSchema: {
        type: "object",
        description: "Schema-level description.",
        properties: {},
      },
    };
    const { input } = mapJsonField(field, baseCtx);
    // admin.description wins (it's the user's authoring intent)
    expect((input as { description?: string }).description).toBe(
      "Free-form JSON object."
    );
  });

  it("returns distinct input/output objects (safe to mutate)", () => {
    const field: JSONFieldConfig = {
      name: "meta",
      type: "json",
      jsonSchema: { type: "object" },
    };
    const { input, output } = mapJsonField(field, baseCtx);
    expect(input).not.toBe(output);
  });
});
