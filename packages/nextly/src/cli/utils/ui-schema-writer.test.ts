/**
 * @module cli/utils/ui-schema-writer.test
 * @since v0.0.3-alpha (Plan D1)
 */
import { describe, expect, it } from "vitest";

import { parseUiSchema } from "../../schemas/_zod/ui-schema";

import { serializeUiSchema } from "./ui-schema-writer";

const MANIFEST = {
  version: 1 as const,
  collections: [
    {
      slug: "events",
      labels: { singular: "Event", plural: "Events" },
      admin: { useAsTitle: "title" },
      fields: [
        { name: "title", type: "text" as const, required: true },
        {
          name: "category",
          type: "select" as const,
          options: [{ label: "A", value: "a" }],
          required: true,
        },
      ],
    },
  ],
  singles: [],
  components: [],
};

describe("serializeUiSchema", () => {
  it("emits $schema → version → collections → singles → components order", () => {
    const out = serializeUiSchema(MANIFEST);
    const keys = Object.keys(JSON.parse(out));
    expect(keys).toEqual([
      "$schema",
      "version",
      "collections",
      "singles",
      "components",
    ]);
  });

  it("ends with a trailing newline and uses 2-space indent", () => {
    const out = serializeUiSchema(MANIFEST);
    expect(out.endsWith("\n")).toBe(true);
    expect(out).toContain('\n  "version": 1');
  });

  it("orders entity keys slug → labels → admin → fields", () => {
    const out = serializeUiSchema(MANIFEST);
    const coll = JSON.parse(out).collections[0];
    expect(Object.keys(coll)).toEqual(["slug", "labels", "admin", "fields"]);
  });

  it("orders field keys name → type → … with name/type first", () => {
    const out = serializeUiSchema(MANIFEST);
    const f = JSON.parse(out).collections[0].fields[1];
    expect(Object.keys(f).slice(0, 2)).toEqual(["name", "type"]);
  });

  it("is idempotent: serialize(parse(serialize(x))) === serialize(x)", () => {
    const once = serializeUiSchema(MANIFEST);
    const parsed = parseUiSchema(JSON.parse(once));
    expect(parsed.success).toBe(true);
    if (parsed.success) {
      expect(serializeUiSchema(parsed.data)).toBe(once);
    }
  });

  it("always writes the version field", () => {
    expect(serializeUiSchema(MANIFEST)).toContain('"version": 1');
  });
});
