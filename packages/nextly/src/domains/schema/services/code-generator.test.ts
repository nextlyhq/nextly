// Tests for the collection-to-TypeScript serializer used by --promote.
import { describe, expect, it } from "vitest";

import { serializeCollection } from "./code-generator.js";

describe("serializeCollection", () => {
  it("produces unquoted identifier keys and double-quoted strings", () => {
    const out = serializeCollection({
      slug: "posts",
      fields: [{ name: "title", type: "text" }],
    });
    expect(out).toMatch(/slug: "posts"/);
    expect(out).toMatch(/name: "title"/);
    expect(out).toMatch(/type: "text"/);
    expect(out).not.toMatch(/"slug"/);
  });

  it("renders booleans and numbers without quotes", () => {
    const out = serializeCollection({
      slug: "products",
      fields: [{ name: "price", type: "number", required: true, min: 0 }],
    });
    expect(out).toMatch(/required: true/);
    expect(out).toMatch(/min: 0/);
  });

  it("omits undefined values instead of rendering them", () => {
    const out = serializeCollection({
      slug: "posts",
      fields: [],
      description: undefined,
    } as never);
    expect(out).not.toMatch(/description/);
  });

  it("indents nested arrays and objects with two spaces", () => {
    const out = serializeCollection({
      slug: "posts",
      fields: [
        {
          name: "status",
          type: "select",
          options: [{ label: "Draft", value: "draft" }],
        },
      ],
    });
    // Nested object inside array inside fields array inside collection =
    // 3 levels of indent (6 spaces) for the inner options entries.
    expect(out).toMatch(/ {6}label: "Draft"/);
  });

  it("falls back to JSON-quoted keys for identifiers with special chars", () => {
    const out = serializeCollection({
      slug: "posts",
      fields: [],
      "my-weird-key": "value",
    } as never);
    expect(out).toMatch(/"my-weird-key"/);
  });

  it("renders empty arrays and objects compactly", () => {
    const out = serializeCollection({
      slug: "empty",
      fields: [],
    });
    expect(out).toMatch(/fields: \[\]/);
  });
});
