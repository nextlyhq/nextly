/**
 * What saving an entity not created yet will do, for its review: every field
 * it is saved with is added, and the save is a change even with no fields,
 * since the entity itself is created. Built here rather than asked of the
 * server, whose preview reads an entity that already exists.
 */
import { describe, expect, it } from "vitest";

import type { FieldDefinition } from "@admin/types/collection";

import { createPreview } from "../create-preview";

const title: FieldDefinition = {
  name: "headline",
  label: "Headline",
  type: "text",
  required: true,
};
const price: FieldDefinition = {
  name: "price",
  label: "Price",
  type: "number",
  defaultValue: 0,
};

describe("createPreview", () => {
  it("adds every field the entity is saved with", () => {
    const preview = createPreview([title, price]);
    expect(preview.changes.added).toEqual([
      {
        name: "headline",
        type: "text",
        required: true,
        hasDefault: false,
        classification: "safe",
      },
      {
        name: "price",
        type: "number",
        required: false,
        hasDefault: true,
        classification: "safe",
      },
    ]);
    expect(preview.changes.removed).toEqual([]);
    expect(preview.changes.changed).toEqual([]);
  });

  it("is a change even with no fields, since the entity is created", () => {
    expect(createPreview([]).hasChanges).toBe(true);
  });

  it("asks nothing of the person and warns of nothing", () => {
    const preview = createPreview([title]);
    expect(preview.hasDestructiveChanges).toBe(false);
    expect(preview.interactiveFields).toEqual([]);
    expect(preview.renamed).toEqual([]);
    expect(preview.warnings).toEqual([]);
  });
});
