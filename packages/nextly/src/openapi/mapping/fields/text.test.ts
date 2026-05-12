import { describe, expect, it } from "vitest";

import type { TextFieldConfig } from "../../../collections/fields/types/text";

import { mapTextField } from "./text";
import type { MappingContext } from "./types";

const baseCtx: MappingContext = {
  schemaRef: n => ({ $ref: `#/components/schemas/${n}` }),
  ownerSlug: "posts",
  fieldPath: "fields[0]",
};

describe("mapTextField", () => {
  it("minimal text field maps to a plain string schema", () => {
    const field: TextFieldConfig = { name: "title", type: "text" };
    const { input, output } = mapTextField(field, baseCtx);
    expect(input).toEqual({ type: "string" });
    expect(output).toEqual({ type: "string" });
  });

  it("emits minLength and maxLength from nested validation", () => {
    const field: TextFieldConfig = {
      name: "title",
      type: "text",
      validation: { minLength: 3, maxLength: 200 },
    };
    const { input } = mapTextField(field, baseCtx);
    expect(input).toMatchObject({
      type: "string",
      minLength: 3,
      maxLength: 200,
    });
  });

  it("emits minLength and maxLength from flat fields (legacy form)", () => {
    const field: TextFieldConfig = {
      name: "title",
      type: "text",
      minLength: 5,
      maxLength: 100,
    };
    const { input } = mapTextField(field, baseCtx);
    expect(input).toMatchObject({
      type: "string",
      minLength: 5,
      maxLength: 100,
    });
  });

  it("nested validation wins over flat when both are present", () => {
    const field: TextFieldConfig = {
      name: "title",
      type: "text",
      minLength: 5,
      maxLength: 100,
      validation: { minLength: 10, maxLength: 50 },
    };
    const { input } = mapTextField(field, baseCtx);
    expect(input).toMatchObject({ minLength: 10, maxLength: 50 });
  });

  it("emits pattern from nested validation", () => {
    const field: TextFieldConfig = {
      name: "slug",
      type: "text",
      validation: { pattern: "^[a-z0-9-]+$" },
    };
    const { input } = mapTextField(field, baseCtx);
    expect(input).toMatchObject({ pattern: "^[a-z0-9-]+$" });
  });

  it("uses admin.description as the schema description", () => {
    const field: TextFieldConfig = {
      name: "title",
      type: "text",
      label: "Title",
      admin: { description: "The article headline." },
    };
    const { input } = mapTextField(field, baseCtx);
    expect(input.description).toBe("The article headline.");
  });

  it("falls back to label when admin.description is missing", () => {
    const field: TextFieldConfig = {
      name: "title",
      type: "text",
      label: "Title",
    };
    const { input } = mapTextField(field, baseCtx);
    expect(input.description).toBe("Title");
  });

  it("emits no description when neither admin.description nor label is set", () => {
    const field: TextFieldConfig = { name: "title", type: "text" };
    const { input } = mapTextField(field, baseCtx);
    expect(input.description).toBeUndefined();
  });

  it("hasMany flips the schema to an array of strings", () => {
    const field: TextFieldConfig = {
      name: "tags",
      type: "text",
      hasMany: true,
    };
    const { input, output } = mapTextField(field, baseCtx);
    expect(input).toEqual({ type: "array", items: { type: "string" } });
    expect(output).toEqual({ type: "array", items: { type: "string" } });
  });

  it("hasMany applies minLength/maxLength to the items schema, not the array", () => {
    const field: TextFieldConfig = {
      name: "tags",
      type: "text",
      hasMany: true,
      validation: { minLength: 1, maxLength: 30 },
    };
    const { input } = mapTextField(field, baseCtx);
    expect(input).toEqual({
      type: "array",
      items: { type: "string", minLength: 1, maxLength: 30 },
    });
  });

  it("hasMany honors minRows/maxRows as array minItems/maxItems", () => {
    const field: TextFieldConfig = {
      name: "tags",
      type: "text",
      hasMany: true,
      validation: { minRows: 1, maxRows: 10 },
    };
    const { input } = mapTextField(field, baseCtx);
    expect(input).toMatchObject({ minItems: 1, maxItems: 10 });
  });

  it("returns distinct input/output objects so callers can mutate safely", () => {
    const field: TextFieldConfig = { name: "title", type: "text" };
    const { input, output } = mapTextField(field, baseCtx);
    expect(input).not.toBe(output);
  });
});
