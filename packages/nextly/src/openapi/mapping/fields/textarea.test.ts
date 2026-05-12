import { describe, expect, it } from "vitest";

import type { TextareaFieldConfig } from "../../../collections/fields/types/textarea";

import { mapTextareaField } from "./textarea";
import type { MappingContext } from "./types";

const baseCtx: MappingContext = {
  schemaRef: n => ({ $ref: `#/components/schemas/${n}` }),
  ownerSlug: "posts",
  fieldPath: "fields[0]",
};

describe("mapTextareaField", () => {
  it("minimal textarea maps to a plain string schema", () => {
    const field: TextareaFieldConfig = { name: "body", type: "textarea" };
    const { input, output } = mapTextareaField(field, baseCtx);
    expect(input).toEqual({ type: "string" });
    expect(output).toEqual({ type: "string" });
  });

  it("does NOT emit format (textareas are plain strings, no email/uri/etc.)", () => {
    const field: TextareaFieldConfig = { name: "body", type: "textarea" };
    const { input } = mapTextareaField(field, baseCtx);
    expect((input as { format?: string }).format).toBeUndefined();
  });

  it("emits minLength and maxLength from nested validation", () => {
    const field: TextareaFieldConfig = {
      name: "body",
      type: "textarea",
      validation: { minLength: 50, maxLength: 500 },
    };
    const { input } = mapTextareaField(field, baseCtx);
    expect(input).toMatchObject({ minLength: 50, maxLength: 500 });
  });

  it("emits minLength and maxLength from flat fields (legacy form)", () => {
    const field: TextareaFieldConfig = {
      name: "body",
      type: "textarea",
      minLength: 10,
      maxLength: 200,
    };
    const { input } = mapTextareaField(field, baseCtx);
    expect(input).toMatchObject({ minLength: 10, maxLength: 200 });
  });

  it("nested validation wins over flat fields", () => {
    const field: TextareaFieldConfig = {
      name: "body",
      type: "textarea",
      minLength: 10,
      maxLength: 200,
      validation: { minLength: 20, maxLength: 100 },
    };
    const { input } = mapTextareaField(field, baseCtx);
    expect(input).toMatchObject({ minLength: 20, maxLength: 100 });
  });

  it("admin.description wins, label is the fallback", () => {
    const a: TextareaFieldConfig = {
      name: "body",
      type: "textarea",
      label: "Body",
      admin: { description: "Full article body." },
    };
    const b: TextareaFieldConfig = {
      name: "body",
      type: "textarea",
      label: "Body",
    };
    expect(mapTextareaField(a, baseCtx).input.description).toBe(
      "Full article body."
    );
    expect(mapTextareaField(b, baseCtx).input.description).toBe("Body");
  });

  it("returns distinct input/output objects", () => {
    const field: TextareaFieldConfig = { name: "body", type: "textarea" };
    const { input, output } = mapTextareaField(field, baseCtx);
    expect(input).not.toBe(output);
  });
});
