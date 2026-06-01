/**
 * @module schemas/_zod/ui-schema.test
 * @since v0.0.3-alpha (Plan D1)
 */
import { describe, expect, it } from "vitest";

import { parseUiSchema, uiSchemaJsonSchema } from "./ui-schema";

const VALID = {
  version: 1,
  collections: [
    {
      slug: "events",
      labels: { singular: "Event", plural: "Events" },
      admin: { useAsTitle: "title", defaultColumns: ["title", "venue"] },
      fields: [
        { name: "title", type: "text", required: true },
        { name: "venue", type: "text" },
        {
          name: "category",
          type: "select",
          options: [{ label: "A", value: "a" }],
          required: true,
        },
        {
          name: "organizers",
          type: "relationship",
          relationTo: "users",
          hasMany: true,
        },
        { name: "hero", type: "upload", relationTo: "media" },
      ],
    },
  ],
};

describe("parseUiSchema", () => {
  it("accepts a valid manifest", () => {
    const r = parseUiSchema(VALID);
    expect(r.success).toBe(true);
  });

  it("treats an empty object as an empty manifest (version defaulted)", () => {
    const r = parseUiSchema({});
    expect(r.success).toBe(true);
    if (r.success) {
      expect(r.data.collections).toEqual([]);
      expect(r.data.singles).toEqual([]);
      expect(r.data.components).toEqual([]);
    }
  });

  it("rejects an invalid slug", () => {
    const r = parseUiSchema({
      collections: [
        { slug: "Bad Slug", fields: [{ name: "a", type: "text" }] },
      ],
    });
    expect(r.success).toBe(false);
  });

  it("rejects a reserved slug prefix", () => {
    const r = parseUiSchema({
      collections: [
        { slug: "nextly_x", fields: [{ name: "a", type: "text" }] },
      ],
    });
    expect(r.success).toBe(false);
  });

  it("rejects an unknown field type", () => {
    const r = parseUiSchema({
      collections: [{ slug: "x", fields: [{ name: "a", type: "wat" }] }],
    });
    expect(r.success).toBe(false);
  });

  it("rejects a select without options", () => {
    const r = parseUiSchema({
      collections: [{ slug: "x", fields: [{ name: "a", type: "select" }] }],
    });
    expect(r.success).toBe(false);
  });

  it("rejects a relationship without relationTo", () => {
    const r = parseUiSchema({
      collections: [
        { slug: "x", fields: [{ name: "a", type: "relationship" }] },
      ],
    });
    expect(r.success).toBe(false);
  });

  it("rejects duplicate slugs", () => {
    const r = parseUiSchema({
      collections: [
        { slug: "x", fields: [{ name: "a", type: "text" }] },
        { slug: "x", fields: [{ name: "b", type: "text" }] },
      ],
    });
    expect(r.success).toBe(false);
  });

  it("rejects duplicate field names within a collection", () => {
    const r = parseUiSchema({
      collections: [
        {
          slug: "x",
          fields: [
            { name: "a", type: "text" },
            { name: "a", type: "text" },
          ],
        },
      ],
    });
    expect(r.success).toBe(false);
  });

  it("rejects a reserved field name", () => {
    const r = parseUiSchema({
      collections: [{ slug: "x", fields: [{ name: "id", type: "text" }] }],
    });
    expect(r.success).toBe(false);
  });

  it("rejects useAsTitle referencing a missing field", () => {
    const r = parseUiSchema({
      collections: [
        {
          slug: "x",
          admin: { useAsTitle: "ghost" },
          fields: [{ name: "a", type: "text" }],
        },
      ],
    });
    expect(r.success).toBe(false);
  });

  it("rejects validation.min > max", () => {
    const r = parseUiSchema({
      collections: [
        {
          slug: "x",
          fields: [
            { name: "a", type: "number", validation: { min: 5, max: 1 } },
          ],
        },
      ],
    });
    expect(r.success).toBe(false);
  });

  it("rejects an unparseable validation.pattern", () => {
    const r = parseUiSchema({
      collections: [
        {
          slug: "x",
          fields: [{ name: "a", type: "text", validation: { pattern: "(" } }],
        },
      ],
    });
    expect(r.success).toBe(false);
  });

  it("uiSchemaJsonSchema returns a JSON-schema object", () => {
    const js = uiSchemaJsonSchema() as Record<string, unknown>;
    expect(typeof js).toBe("object");
    expect(js).toHaveProperty("properties");
  });
});
