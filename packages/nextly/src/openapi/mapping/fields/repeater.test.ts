import { describe, expect, it } from "vitest";

import type { RepeaterFieldConfig } from "../../../collections/fields/types/repeater";

import { mapRepeaterField } from "./repeater";
import type { MappingContext } from "./types";

const baseCtx: MappingContext = {
  schemaRef: n => ({ $ref: `#/components/schemas/${n}` }),
  ownerSlug: "Post",
  fieldPath: "fields[0]",
};

describe("mapRepeaterField", () => {
  it("emits an array with items as a $ref to the row-item schema", () => {
    const field: RepeaterFieldConfig = {
      name: "blocks",
      type: "repeater",
      fields: [
        { name: "heading", type: "text" },
        { name: "body", type: "textarea" },
      ],
    };
    const { input, output } = mapRepeaterField(field, baseCtx);
    expect(input).toMatchObject({
      type: "array",
      items: { $ref: "#/components/schemas/Post__BlocksItem" },
    });
    expect(output).toMatchObject({
      type: "array",
      items: { $ref: "#/components/schemas/Post__BlocksItem" },
    });
  });

  it("uses Post__<FieldName>Item naming with PascalCase field name", () => {
    const field: RepeaterFieldConfig = {
      name: "social_links",
      type: "repeater",
      fields: [{ name: "url", type: "text" }],
    };
    const { input } = mapRepeaterField(field, baseCtx);
    expect((input as { items?: { $ref?: string } }).items?.$ref).toBe(
      "#/components/schemas/Post__SocialLinksItem"
    );
  });

  it("emits minItems / maxItems from minRows / maxRows", () => {
    const field: RepeaterFieldConfig = {
      name: "blocks",
      type: "repeater",
      fields: [],
      minRows: 1,
      maxRows: 12,
    };
    const { input } = mapRepeaterField(field, baseCtx);
    expect(input).toMatchObject({ minItems: 1, maxItems: 12 });
  });

  it("uses admin.description, falling back to label", () => {
    const a: RepeaterFieldConfig = {
      name: "blocks",
      type: "repeater",
      label: "Blocks",
      admin: { description: "Sections of the article." },
      fields: [],
    };
    const b: RepeaterFieldConfig = {
      name: "blocks",
      type: "repeater",
      label: "Blocks",
      fields: [],
    };
    expect(mapRepeaterField(a, baseCtx).input.description).toBe(
      "Sections of the article."
    );
    expect(mapRepeaterField(b, baseCtx).input.description).toBe("Blocks");
  });
});
