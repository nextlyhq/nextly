import { describe, expect, it } from "vitest";

import type { SelectFieldConfig } from "../../../collections/fields/types/select";

import { mapSelectField } from "./select";
import type { MappingContext } from "./types";

const baseCtx: MappingContext = {
  schemaRef: n => ({ $ref: `#/components/schemas/${n}` }),
  ownerSlug: "posts",
  fieldPath: "fields[0]",
};

describe("mapSelectField", () => {
  it("single-value select maps to string with enum of option values", () => {
    const field: SelectFieldConfig = {
      name: "status",
      type: "select",
      options: [
        { label: "Draft", value: "draft" },
        { label: "Published", value: "published" },
      ],
    };
    const { input, output } = mapSelectField(field, baseCtx);
    expect(input).toMatchObject({
      type: "string",
      enum: ["draft", "published"],
    });
    expect(output).toMatchObject({
      type: "string",
      enum: ["draft", "published"],
    });
  });

  it("hasMany select maps to array of enum strings", () => {
    const field: SelectFieldConfig = {
      name: "tags",
      type: "select",
      hasMany: true,
      options: [
        { label: "Tech", value: "tech" },
        { label: "Design", value: "design" },
        { label: "Marketing", value: "marketing" },
      ],
    };
    const { input } = mapSelectField(field, baseCtx);
    expect(input).toEqual({
      type: "array",
      items: { type: "string", enum: ["tech", "design", "marketing"] },
    });
  });

  it("emits ONLY option values, not labels, in the enum", () => {
    const field: SelectFieldConfig = {
      name: "priority",
      type: "select",
      options: [
        { label: "Low priority", value: "low" },
        { label: "High priority", value: "high" },
      ],
    };
    const { input } = mapSelectField(field, baseCtx);
    expect((input as { enum?: string[] }).enum).toEqual(["low", "high"]);
  });

  it("admin.description wins over label", () => {
    const a: SelectFieldConfig = {
      name: "status",
      type: "select",
      label: "Status",
      admin: { description: "Lifecycle stage of this post." },
      options: [{ label: "Draft", value: "draft" }],
    };
    const b: SelectFieldConfig = {
      name: "status",
      type: "select",
      label: "Status",
      options: [{ label: "Draft", value: "draft" }],
    };
    expect(mapSelectField(a, baseCtx).input.description).toBe(
      "Lifecycle stage of this post."
    );
    expect(mapSelectField(b, baseCtx).input.description).toBe("Status");
  });

  it("hasMany description sits on the array, not the items", () => {
    const field: SelectFieldConfig = {
      name: "tags",
      type: "select",
      hasMany: true,
      label: "Tags",
      options: [{ label: "Tech", value: "tech" }],
    };
    const { input } = mapSelectField(field, baseCtx);
    expect((input as { description?: string }).description).toBe("Tags");
    const items = (input as { items?: { description?: string } }).items;
    expect(items?.description).toBeUndefined();
  });

  it("returns distinct input/output objects", () => {
    const field: SelectFieldConfig = {
      name: "status",
      type: "select",
      options: [{ label: "Draft", value: "draft" }],
    };
    const { input, output } = mapSelectField(field, baseCtx);
    expect(input).not.toBe(output);
  });
});
