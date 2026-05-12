import { describe, expect, it } from "vitest";

import type { CodeFieldConfig } from "../../../collections/fields/types/code";

import { mapCodeField } from "./code";
import type { MappingContext } from "./types";

const baseCtx: MappingContext = {
  schemaRef: n => ({ $ref: `#/components/schemas/${n}` }),
  ownerSlug: "posts",
  fieldPath: "fields[0]",
};

describe("mapCodeField", () => {
  it("minimal code field maps to a plain string schema", () => {
    const field: CodeFieldConfig = { name: "snippet", type: "code" };
    const { input } = mapCodeField(field, baseCtx);
    expect(input).toEqual({ type: "string" });
  });

  it("emits x-nextly-code-language when admin.language is set", () => {
    const field: CodeFieldConfig = {
      name: "snippet",
      type: "code",
      admin: { language: "typescript" },
    };
    const { input, output } = mapCodeField(field, baseCtx);
    expect(input).toMatchObject({
      type: "string",
      "x-nextly-code-language": "typescript",
    });
    expect(output).toMatchObject({
      "x-nextly-code-language": "typescript",
    });
  });

  it("does NOT emit x-nextly-code-language when language is omitted", () => {
    const field: CodeFieldConfig = { name: "snippet", type: "code" };
    const { input } = mapCodeField(field, baseCtx);
    expect(input).not.toHaveProperty("x-nextly-code-language");
  });

  it("emits minLength / maxLength / pattern from nested validation", () => {
    const field: CodeFieldConfig = {
      name: "config",
      type: "code",
      validation: { minLength: 1, maxLength: 5000, pattern: "^\\{" },
    };
    const { input } = mapCodeField(field, baseCtx);
    expect(input).toMatchObject({
      minLength: 1,
      maxLength: 5000,
      pattern: "^\\{",
    });
  });

  it("admin.description wins, label is the fallback", () => {
    const a: CodeFieldConfig = {
      name: "config",
      type: "code",
      label: "Config",
      admin: { description: "Enter valid JSON." },
    };
    const b: CodeFieldConfig = {
      name: "config",
      type: "code",
      label: "Config",
    };
    expect(mapCodeField(a, baseCtx).input.description).toBe(
      "Enter valid JSON."
    );
    expect(mapCodeField(b, baseCtx).input.description).toBe("Config");
  });
});
