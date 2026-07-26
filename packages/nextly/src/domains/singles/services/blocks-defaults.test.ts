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

  it("seeds a kind the field actually accepts", () => {
    // Seeding a page document into a template-only field would put a value in
    // the field that its own policy rejects.
    const templateOnly = {
      name: "content",
      type: "blocks",
      blocks: { kinds: ["template"] },
    } as unknown as FieldConfig;
    const seeded: unknown = JSON.parse(String(getDefaultValue(templateOnly)));
    expect((seeded as { kind?: string }).kind).toBe("template");
    expect(
      validateBlocksValue(seeded, "content", "Content", { kinds: ["template"] })
    ).toEqual([]);
  });

  it("prefers page when the field accepts several kinds", () => {
    const many = {
      name: "content",
      type: "blocks",
      blocks: { kinds: ["pattern", "page"] },
    } as unknown as FieldConfig;
    const seeded: unknown = JSON.parse(String(getDefaultValue(many)));
    expect((seeded as { kind?: string }).kind).toBe("page");
  });
});
