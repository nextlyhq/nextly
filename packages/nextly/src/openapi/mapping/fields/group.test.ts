import { describe, expect, it } from "vitest";

import type { GroupFieldConfig } from "../../../collections/fields/types/group";

import { composeFieldsToObjectSchema } from "./_compose";
import { mapGroupField } from "./group";
import type { MappingContext } from "./types";

const baseCtx: MappingContext = {
  schemaRef: n => ({ $ref: `#/components/schemas/${n}` }),
  ownerSlug: "Post",
  fieldPath: "fields[0]",
};

describe("mapGroupField (named groups)", () => {
  it("maps a named group to an inline object schema", () => {
    const field: GroupFieldConfig = {
      name: "seo",
      type: "group",
      fields: [
        { name: "title", type: "text", required: true },
        { name: "description", type: "textarea" },
      ],
    };
    const { input, output } = mapGroupField(field, baseCtx);
    expect(input).toMatchObject({
      type: "object",
      properties: {
        title: { type: "string" },
        description: { type: "string" },
      },
      required: ["title"],
    });
    expect(output).toMatchObject({
      type: "object",
      properties: {
        title: { type: "string" },
        description: { type: "string" },
      },
      required: ["title"],
    });
  });

  it("emits description on the group object", () => {
    const field: GroupFieldConfig = {
      name: "seo",
      type: "group",
      label: "SEO",
      fields: [{ name: "title", type: "text" }],
    };
    const { input } = mapGroupField(field, baseCtx);
    expect((input as { description?: string }).description).toBe("SEO");
  });
});

describe("composeFieldsToObjectSchema (unnamed group flattening)", () => {
  it("flattens unnamed-group fields into the parent object", () => {
    const fields = [
      { name: "title", type: "text" as const, required: true },
      {
        type: "group" as const,
        label: "SEO Section",
        fields: [
          { name: "metaTitle", type: "text" as const },
          { name: "metaDescription", type: "textarea" as const },
        ],
      },
      { name: "body", type: "textarea" as const },
    ];
    const { input } = composeFieldsToObjectSchema(fields, baseCtx);
    expect(input).toMatchObject({
      type: "object",
      properties: {
        title: { type: "string" },
        metaTitle: { type: "string" },
        metaDescription: { type: "string" },
        body: { type: "string" },
      },
      required: ["title"],
    });
    // Confirm no `seo` property was created (the group had no name).
    expect(
      (input as { properties?: Record<string, unknown> }).properties
    ).not.toHaveProperty("seo");
  });

  it("omits password fields from the output but keeps them in the input", () => {
    const fields = [
      { name: "email", type: "email" as const },
      { name: "password", type: "password" as const, required: true },
    ];
    const { input, output } = composeFieldsToObjectSchema(fields, baseCtx);
    const inputProps =
      (input as { properties?: Record<string, unknown> }).properties ?? {};
    const outputProps =
      (output as { properties?: Record<string, unknown> }).properties ?? {};

    expect(inputProps).toHaveProperty("password");
    expect(outputProps).not.toHaveProperty("password");

    // Required: password is required in input, not required in output
    expect((input as { required?: string[] }).required).toContain("password");
    expect((output as { required?: string[] }).required ?? []).not.toContain(
      "password"
    );
  });

  it("returns an object with no `required` key when nothing is required", () => {
    const { input, output } = composeFieldsToObjectSchema(
      [{ name: "title", type: "text" as const }],
      baseCtx
    );
    expect(input).not.toHaveProperty("required");
    expect(output).not.toHaveProperty("required");
  });
});
