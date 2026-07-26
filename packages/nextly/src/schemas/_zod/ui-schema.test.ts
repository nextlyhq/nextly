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

describe("parseUiSchema — blocks fields", () => {
  const withBlocks = (field: Record<string, unknown>) => ({
    version: 1,
    collections: [
      {
        slug: "pages",
        fields: [{ name: "title", type: "text" }, field],
      },
    ],
  });

  it("accepts a blocks field and keeps its policy", () => {
    // Zod strips undeclared keys, so an unparsed `blocks` option would persist
    // a field accepting everything the submitted schema meant to exclude.
    const r = parseUiSchema(
      withBlocks({
        name: "content",
        type: "blocks",
        blocks: { allow: ["core/*"], kinds: ["page"] },
      })
    );
    expect(r.success).toBe(true);
    const field = r.success
      ? (r.data.collections[0].fields[1] as {
          blocks?: { allow?: string[]; kinds?: string[] };
        })
      : undefined;
    expect(field?.blocks?.allow).toEqual(["core/*"]);
    expect(field?.blocks?.kinds).toEqual(["page"]);
  });

  it("accepts a blocks field with no policy", () => {
    expect(
      parseUiSchema(withBlocks({ name: "content", type: "blocks" })).success
    ).toBe(true);
  });

  it("rejects a document kind that does not exist", () => {
    expect(
      parseUiSchema(
        withBlocks({
          name: "content",
          type: "blocks",
          blocks: { kinds: ["nonsense"] },
        })
      ).success
    ).toBe(false);
  });

  it("rejects a default that is an object but not a document", () => {
    // The admin seeds a read-only control from this value, so a malformed
    // default leaves something the user cannot correct on the form.
    for (const bad of [
      { foo: "bar" },
      { formatVersion: "1", kind: "page", nodes: [] },
      { formatVersion: 1, kind: "nonsense", nodes: [] },
      { formatVersion: 1, kind: "page" },
      { formatVersion: 1, kind: "page", nodes: {} },
    ]) {
      expect(
        parseUiSchema(
          withBlocks({ name: "content", type: "blocks", defaultValue: bad })
        ).success,
        JSON.stringify(bad)
      ).toBe(false);
    }
  });

  it("accepts a document as a blocks default", () => {
    expect(
      parseUiSchema(
        withBlocks({
          name: "content",
          type: "blocks",
          defaultValue: { formatVersion: 1, kind: "page", nodes: [] },
        })
      ).success
    ).toBe(true);
  });
});

describe("parseUiSchema", () => {
  it("accepts a valid manifest", () => {
    const r = parseUiSchema(VALID);
    expect(r.success).toBe(true);
  });

  it("accepts an upload field WITHOUT relationTo (builder default shape)", () => {
    // The builder's upload editor deliberately collects no relationTo (the
    // runtime always targets the media library), so the manifest must
    // accept the builder's default output or every builder upload field
    // fails the mirror write while the DB apply succeeds.
    const r = parseUiSchema({
      collections: [
        { slug: "pages", fields: [{ name: "hero", type: "upload" }] },
      ],
    });
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

  it("accepts a plugin-contributed field type slug", () => {
    // Plugin field types (e.g. the page builder's "page-builder") aren't in the
    // canonical enum. The manifest accepts any slug-shaped token so the real type
    // round-trips to production; the field-type registry resolves it to a column.
    const r = parseUiSchema({
      collections: [
        { slug: "x", fields: [{ name: "a", type: "page-builder" }] },
      ],
    });
    expect(r.success).toBe(true);
  });

  it("rejects a malformed (non-slug) field type", () => {
    const r = parseUiSchema({
      collections: [{ slug: "x", fields: [{ name: "a", type: "Not A Type" }] }],
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
