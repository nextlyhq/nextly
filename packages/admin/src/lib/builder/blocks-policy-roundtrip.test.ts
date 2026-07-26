import { describe, expect, it } from "vitest";

import { convertToFieldDefinition } from "./field-transformers";
import { mapBuilderFieldToManifest } from "./to-manifest-entity";

import type { BuilderFieldInput } from "./to-manifest-entity";

import type { BuilderField } from "@admin/components/features/schema-builder/types";

/**
 * A blocks field's policy has to survive both builder serializers. Saving any
 * schema edit rebuilds every field through them, so a dropped policy widens a
 * restricted field back to accepting everything — without the user touching it.
 */
const FIELD = {
  id: "f1",
  name: "content",
  type: "blocks",
  label: "Content",
  blocks: { allow: ["core/*"], kinds: ["page"] },
} as unknown as BuilderField & BuilderFieldInput;

describe("blocks policy round-trip through the builder", () => {
  it("survives conversion to a field definition", () => {
    expect(convertToFieldDefinition(FIELD).blocks).toEqual({
      allow: ["core/*"],
      kinds: ["page"],
    });
  });

  it("survives conversion to a manifest field", () => {
    expect(mapBuilderFieldToManifest(FIELD).blocks).toEqual({
      allow: ["core/*"],
      kinds: ["page"],
    });
  });

  it("stays absent when the field declares no policy", () => {
    const plain = { ...FIELD, blocks: undefined };
    expect(convertToFieldDefinition(plain).blocks).toBeUndefined();
    expect(mapBuilderFieldToManifest(plain).blocks).toBeUndefined();
  });
});
