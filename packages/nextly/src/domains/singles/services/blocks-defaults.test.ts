import { describe, expect, it } from "vitest";

import type { DocumentKind } from "@nextlyhq/blocks-engine";
import { DOCUMENT_FORMAT_VERSION } from "@nextlyhq/blocks-engine";

import type { FieldConfig } from "../../../collections/fields/types";
import { validateBlocksValue } from "../../../collections/fields/validators/blocks-validator";
import { NextlyError } from "../../../errors";

import { assertValidBlocksDefault, getDefaultValue } from "./single-utils";

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

/**
 * A single's defaults are inserted directly on first read, so a declared
 * default never meets the write path's validation. A function default is the
 * case that matters: its value exists only once resolved against real data, so
 * config-load validation cannot see it.
 */
describe("assertValidBlocksDefault", () => {
  const blocksField = (blocks?: {
    allow?: string[];
    kinds?: DocumentKind[];
  }): FieldConfig =>
    ({
      name: "content",
      type: "blocks",
      ...(blocks ? { blocks } : {}),
    }) as FieldConfig;

  const emptyPage = {
    formatVersion: DOCUMENT_FORMAT_VERSION,
    kind: "page" as const,
    nodes: [],
  };

  it("accepts a valid document", () => {
    expect(() =>
      assertValidBlocksDefault(blocksField(), emptyPage, "homepage")
    ).not.toThrow();
  });

  it("rejects a value that is not a document", () => {
    expect(() =>
      assertValidBlocksDefault(blocksField(), { nodes: [] }, "homepage")
    ).toThrow(NextlyError);
  });

  it("rejects a document whose kind the field does not accept", () => {
    expect(() =>
      assertValidBlocksDefault(
        blocksField({ kinds: ["template"] }),
        emptyPage,
        "homepage"
      )
    ).toThrow(NextlyError);
  });

  it("reports the field's own issues rather than a generic failure", () => {
    // The engine's issue codes travel through unchanged, so the same defect
    // carries the same name here as it does on the write path.
    const issues = validateBlocksValue(emptyPage, "content", "content", {
      kinds: ["template"],
    });
    expect(issues.length).toBeGreaterThan(0);

    try {
      assertValidBlocksDefault(
        blocksField({ kinds: ["template"] }),
        emptyPage,
        "homepage"
      );
      expect.unreachable("expected a validation error");
    } catch (error) {
      expect(error).toBeInstanceOf(NextlyError);
      expect((error as NextlyError).publicData).toEqual({ errors: issues });
    }
  });

  it("ignores fields of every other type", () => {
    const text = { name: "title", type: "text" } as FieldConfig;
    expect(() =>
      assertValidBlocksDefault(text, { anything: true }, "homepage")
    ).not.toThrow();
  });
});
