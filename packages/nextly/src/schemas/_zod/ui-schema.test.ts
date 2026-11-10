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

  it("keeps a relationship's options as the registry stores them, whole", () => {
    // A plugin or API save sends a relationship as the registry stores it; the
    // definition holds it as sent, so a deploy's registry row keeps its
    // foreign-key actions and its junction table.
    const options = {
      target: "people",
      relationType: "manyToOne",
      onDelete: "set null",
      onUpdate: "cascade",
    };
    const tags = {
      target: "tags",
      relationType: "manyToMany",
      junctionTable: "posts_tags",
    };
    const r = parseUiSchema({
      collections: [
        {
          slug: "notes",
          fields: [
            { name: "author", type: "relationship", options },
            { name: "tags", type: "relationship", options: tags },
          ],
        },
      ],
    });
    expect(r.success).toBe(true);
    if (r.success) {
      expect(r.data.collections[0]?.fields.map(f => f.options)).toEqual([
        options,
        tags,
      ]);
    }
  });

  it("keeps any field's registry options as stored, whole", () => {
    // A plugin or API save sends a long text or a formatted number with the
    // registry's options object; the definition holds it as sent.
    const r = parseUiSchema({
      collections: [
        {
          slug: "x",
          fields: [
            { name: "bio", type: "text", options: { variant: "long" } },
            { name: "price", type: "number", options: { format: "float" } },
          ],
        },
      ],
    });
    expect(r.success).toBe(true);
    if (r.success) {
      expect(r.data.collections[0]?.fields.map(f => f.options)).toEqual([
        { variant: "long" },
        { format: "float" },
      ]);
    }
  });

  it("still requires a select's choices as a list", () => {
    const r = parseUiSchema({
      collections: [
        {
          slug: "x",
          fields: [{ name: "a", type: "select", options: { variant: "long" } }],
        },
      ],
    });
    expect(r.success).toBe(false);
  });

  it("refuses a relationship whose options name no target and that has no relationTo", () => {
    const r = parseUiSchema({
      collections: [
        {
          slug: "x",
          fields: [
            {
              name: "a",
              type: "relationship",
              options: { relationType: "manyToOne" },
            },
          ],
        },
      ],
    });
    expect(r.success).toBe(false);
  });

  it("still accepts a file written before relationships carried options", () => {
    expect(parseUiSchema(VALID).success).toBe(true);
  });

  it("accepts a field named with capitals, as the registry does", () => {
    const named = (name: string) =>
      parseUiSchema({
        collections: [{ slug: "x", fields: [{ name, type: "text" }] }],
      }).success;
    expect(named("firstName")).toBe(true);
    expect(named("first_name")).toBe(true);
    expect(named("1stName")).toBe(false);
    expect(named("first-name")).toBe(false);
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

  // The sibling rule judges two fields of one name where the entity's last
  // definition is known (a save, the migrate commands), so a manifest holding
  // a pair an entity already has still loads.
  it("leaves two fields of one name in a collection to the sibling rule", () => {
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
    expect(r.success).toBe(true);
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

describe("a manifest hook is validated as the executor requires it", () => {
  // A hook the executor can actually run: `StoredHookExecutor` reads `config`
  // and `order` off every entry, so those are as load-bearing as `hookId`.
  const RUNNABLE = {
    hookId: "auto-slug",
    hookType: "beforeChange",
    enabled: true,
    config: { sourceField: "title", targetField: "slug" },
    order: 0,
  };

  function manifestWithHooks(hooks: unknown) {
    return {
      version: 1,
      collections: [
        {
          slug: "articles",
          labels: { singular: "Article", plural: "Articles" },
          fields: [{ name: "title", type: "text" }],
          hooks,
        },
      ],
    };
  }

  it("KEEPS a runnable hook rather than merely accepting it", () => {
    // 🔴 The control the rejection below needs, and it asserts the value
    // SURVIVES rather than that the parse succeeded. Zod strips what a schema
    // does not declare, so a manifest whose hooks are silently dropped parses
    // exactly as cleanly as one whose hooks are carried — and the deployed
    // collection then runs no hooks, which is the failure this key exists to
    // prevent.
    const result = parseUiSchema(manifestWithHooks([RUNNABLE]));
    expect(result.success).toBe(true);
    expect(result.data?.collections[0]?.hooks).toEqual([RUNNABLE]);
  });

  it("REFUSES a hook missing the fields the executor destructures", () => {
    // 🔴 The shape a hand-written manifest most plausibly carries: the three
    // keys a reader would guess, and neither of the two the executor reads.
    // Accepted, it deploys and then throws on the next content write — an
    // accepted manifest turning into failed writes, which is strictly worse
    // than a refused one because the refusal names the file.
    const { config: _config, order: _order, ...missingBoth } = RUNNABLE;
    expect(parseUiSchema(manifestWithHooks([missingBoth])).success).toBe(false);
  });

  it("REFUSES a hookType the runtime cannot dispatch", () => {
    // A plausible typo, and the one a loose record could never catch: the
    // value is a string of the right type and simply names no lifecycle point.
    expect(
      parseUiSchema(
        manifestWithHooks([{ ...RUNNABLE, hookType: "beforeSave" }])
      ).success
    ).toBe(false);
  });
});
