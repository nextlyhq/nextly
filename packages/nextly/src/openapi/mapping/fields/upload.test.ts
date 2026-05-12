import { describe, expect, it } from "vitest";

import type { UploadFieldConfig } from "../../../collections/fields/types/upload";

import { mapUploadField } from "./upload";
import type { MappingContext } from "./types";

const baseCtx: MappingContext = {
  schemaRef: n => ({ $ref: `#/components/schemas/${n}` }),
  ownerSlug: "posts",
  fieldPath: "fields[0]",
};

describe("mapUploadField", () => {
  it("single upload: input string ID, output oneOf [string, $ref(Media)]", () => {
    const field: UploadFieldConfig = {
      name: "cover",
      type: "upload",
      relationTo: "media",
    };
    const { input, output } = mapUploadField(field, baseCtx);
    expect(input).toMatchObject({
      type: "string",
      description: expect.stringMatching(/Document ID/i) as unknown,
    });
    expect(output).toEqual(
      expect.objectContaining({
        oneOf: [{ type: "string" }, { $ref: "#/components/schemas/Media" }],
      })
    );
  });

  it("hasMany upload: input array<string>, output oneOf of arrays", () => {
    const field: UploadFieldConfig = {
      name: "gallery",
      type: "upload",
      relationTo: "media",
      hasMany: true,
      minRows: 1,
      maxRows: 12,
    };
    const { input, output } = mapUploadField(field, baseCtx);
    expect(input).toMatchObject({
      type: "array",
      items: { type: "string" },
      minItems: 1,
      maxItems: 12,
    });
    expect(output).toEqual(
      expect.objectContaining({
        oneOf: [
          { type: "array", items: { type: "string" } },
          { type: "array", items: { $ref: "#/components/schemas/Media" } },
        ],
      })
    );
  });

  it("polymorphic upload: input { relationTo, value }, output oneOf with each target", () => {
    const field: UploadFieldConfig = {
      name: "asset",
      type: "upload",
      relationTo: ["images", "documents"],
    };
    const { input, output } = mapUploadField(field, baseCtx);
    expect(input).toEqual(
      expect.objectContaining({
        type: "object",
        required: ["relationTo", "value"],
        properties: {
          relationTo: { type: "string", enum: ["images", "documents"] },
          value: { type: "string", description: "Document ID" },
        },
        "x-nextly-relation-to": ["images", "documents"],
      })
    );
    const outOneOf = (output as { oneOf?: unknown[] }).oneOf;
    expect(outOneOf).toEqual(
      expect.arrayContaining([
        { $ref: "#/components/schemas/Image" },
        { $ref: "#/components/schemas/Document" },
      ])
    );
  });

  it("description from admin.description, label fallback", () => {
    const a: UploadFieldConfig = {
      name: "cover",
      type: "upload",
      relationTo: "media",
      label: "Cover",
      admin: { description: "16:9 image preferred." },
    };
    const b: UploadFieldConfig = {
      name: "cover",
      type: "upload",
      relationTo: "media",
      label: "Cover",
    };
    expect(mapUploadField(a, baseCtx).input.description).toBe(
      "16:9 image preferred."
    );
    expect(mapUploadField(b, baseCtx).input.description).toBe("Cover");
  });
});
