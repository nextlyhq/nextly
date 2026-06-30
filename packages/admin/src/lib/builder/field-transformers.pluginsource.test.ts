// Regression for P8: the Builder locks + labels plugin-contributed fields only
// if their provenance survives the API → BuilderField conversion. Real-world
// testing caught `convertToBuilderField` silently dropping source/owner/locked,
// so the SEO fields on a UI collection rendered fully editable. Pin it here.
import { describe, expect, it } from "vitest";

import type { FieldDefinition } from "@admin/types/collection";

import { convertToBuilderField } from "./field-transformers";

describe("convertToBuilderField — plugin provenance (P8)", () => {
  it("propagates source/owner/locked so the Builder can lock + label plugin fields", () => {
    const field = {
      name: "metaTitle",
      label: "Meta Title",
      type: "text",
      source: "plugin",
      owner: "@acme/plugin-example",
      locked: true,
    } as unknown as FieldDefinition;

    const bf = convertToBuilderField(field, 0);

    expect(bf.source).toBe("plugin");
    expect(bf.owner).toBe("@acme/plugin-example");
    expect(bf.locked).toBe(true);
  });

  it("leaves provenance undefined for a plain user field (stays editable)", () => {
    const bf = convertToBuilderField(
      {
        name: "body",
        label: "Body",
        type: "text",
      } as unknown as FieldDefinition,
      0
    );

    expect(bf.source).toBeUndefined();
    expect(bf.owner).toBeUndefined();
    expect(bf.locked).toBeUndefined();
  });
});
