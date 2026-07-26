import { describe, expect, it } from "vitest";

import type { FieldConfig } from "../../../collections/fields/types";
import { validateBlocksValue } from "../../../collections/fields/validators/blocks-validator";

import { getDefaultValue } from "./single-utils";

/**
 * A single is auto-created on first read, so a required field with no declared
 * default is seeded from here. For a blocks field the generic `"{}"` every
 * other JSON type gets is not a document, and the row would hold a value its
 * own validator rejects.
 */
describe("getDefaultValue for a blocks field", () => {
  const field = { name: "content", type: "blocks" } as FieldConfig;

  it("seeds a document rather than an empty object", () => {
    const seeded = JSON.parse(String(getDefaultValue(field))) as {
      formatVersion?: unknown;
      kind?: unknown;
      nodes?: unknown;
    };
    expect(typeof seeded.formatVersion).toBe("number");
    expect(seeded.kind).toBe("page");
    expect(seeded.nodes).toEqual([]);
  });

  it("seeds a document the blocks validator accepts", () => {
    const seeded: unknown = JSON.parse(String(getDefaultValue(field)));
    expect(validateBlocksValue(seeded, "content", "Content", {})).toEqual([]);
  });
});
