import { describe, expect, it } from "vitest";

import type { ChipsFieldConfig } from "../../../collections/fields/types/chips";

import { mapChipsField } from "./chips";
import type { MappingContext } from "./types";

const baseCtx: MappingContext = {
  schemaRef: n => ({ $ref: `#/components/schemas/${n}` }),
  ownerSlug: "posts",
  fieldPath: "fields[0]",
};

describe("mapChipsField", () => {
  it("always maps to an array of strings", () => {
    const field: ChipsFieldConfig = { name: "tags", type: "chips" };
    const { input, output } = mapChipsField(field, baseCtx);
    expect(input).toMatchObject({
      type: "array",
      items: { type: "string" },
    });
    expect(output).toMatchObject({
      type: "array",
      items: { type: "string" },
    });
  });

  it("emits minItems / maxItems from minChips / maxChips", () => {
    const field: ChipsFieldConfig = {
      name: "categories",
      type: "chips",
      minChips: 1,
      maxChips: 5,
    };
    const { input } = mapChipsField(field, baseCtx);
    expect(input).toMatchObject({ minItems: 1, maxItems: 5 });
  });

  it("emits uniqueItems: true (chips dedupe by design)", () => {
    const field: ChipsFieldConfig = { name: "tags", type: "chips" };
    const { input } = mapChipsField(field, baseCtx);
    expect(input).toMatchObject({ uniqueItems: true });
  });

  it("admin.description wins, label is the fallback", () => {
    const a: ChipsFieldConfig = {
      name: "tags",
      type: "chips",
      label: "Tags",
      admin: { description: "Press Enter to add a tag." },
    };
    const b: ChipsFieldConfig = {
      name: "tags",
      type: "chips",
      label: "Tags",
    };
    expect(mapChipsField(a, baseCtx).input.description).toBe(
      "Press Enter to add a tag."
    );
    expect(mapChipsField(b, baseCtx).input.description).toBe("Tags");
  });
});
