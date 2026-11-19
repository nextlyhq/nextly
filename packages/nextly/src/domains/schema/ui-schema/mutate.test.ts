/**
 * @module domains/schema/ui-schema/mutate.test
 * @since v0.0.3-alpha (Plan D3)
 */
import { describe, expect, it } from "vitest";

import { uiSchemaManifest } from "../../../schemas/_zod/ui-schema";

import { mutateManifest } from "./mutate";

const base = uiSchemaManifest.parse({
  collections: [{ slug: "events", fields: [{ name: "title", type: "text" }] }],
});

describe("mutateManifest", () => {
  it("upserts a new collection (append)", () => {
    const next = mutateManifest(base, {
      type: "upsert",
      kind: "collections",
      entity: { slug: "venues", fields: [{ name: "name", type: "text" }] },
    });
    expect(next.collections.map(c => c.slug)).toEqual(["events", "venues"]);
  });

  it("upserts an existing collection (replace by slug)", () => {
    const next = mutateManifest(base, {
      type: "upsert",
      kind: "collections",
      entity: {
        slug: "events",
        fields: [
          { name: "title", type: "text" },
          { name: "venue", type: "text" },
        ],
      },
    });
    expect(next.collections).toHaveLength(1);
    expect(next.collections[0].fields.map(f => f.name)).toEqual([
      "title",
      "venue",
    ]);
  });

  it("deletes a collection by slug", () => {
    const next = mutateManifest(base, {
      type: "delete",
      kind: "collections",
      slug: "events",
    });
    expect(next.collections).toEqual([]);
  });

  it("delete is idempotent when the slug is absent", () => {
    const next = mutateManifest(base, {
      type: "delete",
      kind: "collections",
      slug: "ghost",
    });
    expect(next.collections.map(c => c.slug)).toEqual(["events"]);
  });

  it("throws NEXTLY_UI_SCHEMA_INVALID when the upsert is invalid", () => {
    expect(() =>
      mutateManifest(base, {
        type: "upsert",
        kind: "collections",
        entity: { slug: "Bad Slug", fields: [] },
      })
    ).toThrowError(
      expect.objectContaining({ code: "NEXTLY_UI_SCHEMA_INVALID" })
    );
  });

  it("upserts a single and a component", () => {
    const withSingle = mutateManifest(base, {
      type: "upsert",
      kind: "singles",
      entity: { slug: "home", fields: [{ name: "hero", type: "text" }] },
    });
    expect(withSingle.singles.map(s => s.slug)).toEqual(["home"]);
    const withComponent = mutateManifest(withSingle, {
      type: "upsert",
      kind: "components",
      entity: { slug: "seo", fields: [{ name: "meta_title", type: "text" }] },
    });
    expect(withComponent.components.map(c => c.slug)).toEqual(["seo"]);
  });

  it("rejects a structurally-partial upsert (missing fields) — Zod guards full-replace", () => {
    expect(() =>
      mutateManifest(base, {
        type: "upsert",
        kind: "collections",
        entity: { slug: "events" }, // no `fields` — would clobber on replace
      })
    ).toThrowError(
      expect.objectContaining({ code: "NEXTLY_UI_SCHEMA_INVALID" })
    );
    // The original entity is untouched (mutateManifest is pure; caller writes nothing).
    expect(base.collections[0].fields.map(f => f.name)).toEqual(["title"]);
  });

  it("allows turning status off via a complete upsert (full-replace preserves unset)", () => {
    const withStatus = mutateManifest(base, {
      type: "upsert",
      kind: "collections",
      entity: {
        slug: "events",
        status: true,
        fields: [{ name: "title", type: "text" }],
      },
    });
    expect(withStatus.collections[0].status).toBe(true);

    const off = mutateManifest(withStatus, {
      type: "upsert",
      kind: "collections",
      entity: {
        slug: "events",
        status: false,
        fields: [{ name: "title", type: "text" }],
      },
    });
    expect(off.collections[0].status).toBe(false);
  });
});

describe("mutateManifest and sibling fields", () => {
  const withPair = uiSchemaManifest.parse({
    collections: [
      {
        slug: "events",
        fields: [
          { name: "title", type: "text" },
          { name: "title", type: "textarea" },
        ],
      },
    ],
  });

  it("refuses a write that creates a pair of sibling fields, naming both", () => {
    expect(() =>
      mutateManifest(base, {
        type: "upsert",
        kind: "collections",
        entity: {
          slug: "events",
          fields: [
            { name: "title", type: "text" },
            { name: "note", type: "text" },
            { name: "note", type: "textarea" },
          ],
        },
      })
    ).toThrow(
      expect.objectContaining({
        publicData: {
          errors: [
            {
              path: "fields",
              code: "FIELD_NAME_DUPLICATE",
              message:
                "Collection 'events': fields 'note' and 'note' at the top level share the column 'note'. Rename one of them so each has its own column.",
            },
          ],
        },
      })
    );
    expect(() =>
      mutateManifest(base, {
        type: "upsert",
        kind: "components",
        entity: {
          slug: "hero",
          fields: [
            { name: "cta", type: "text" },
            { name: "cta", type: "text" },
          ],
        },
      })
    ).toThrow(
      expect.objectContaining({
        publicData: {
          errors: [
            expect.objectContaining({
              message: expect.stringContaining("Field group 'hero'"),
            }),
          ],
        },
      })
    );
  });

  // Two fields sharing one column are refused though the stored entry holds them: the write must
  // rename one.
  it("refuses a pair sharing a column that the stored entry already holds", () => {
    expect(() =>
      mutateManifest(withPair, {
        type: "upsert",
        kind: "collections",
        entity: {
          slug: "events",
          fields: [
            { name: "title", type: "text" },
            { name: "title", type: "textarea" },
            { name: "venue", type: "text" },
          ],
        },
      })
    ).toThrow(
      expect.objectContaining({
        publicData: {
          errors: [
            {
              path: "fields",
              code: "FIELD_NAME_DUPLICATE",
              message:
                "Collection 'events': fields 'title' and 'title' at the top level share the column 'title'. Rename one of them so each has its own column.",
            },
          ],
        },
      })
    );
  });

  // A manifest that describes a definition already stored (the entity before a save) is read, not
  // written: its pairs are judged where a definition is written.
  it("describes a stored definition holding a pair when asked not to judge it", () => {
    const next = mutateManifest(
      withPair,
      {
        type: "upsert",
        kind: "collections",
        entity: withPair.collections[0],
      },
      { judgeSiblings: false }
    );
    expect(next.collections[0].fields.map(f => f.name)).toEqual([
      "title",
      "title",
    ]);
  });

  // Two names that differ only in case inside a group share no stored value: held, they stay.
  it("keeps a pair sharing no stored value that the stored entry already holds", () => {
    const seo = {
      name: "seo",
      type: "group",
      fields: [
        { name: "Ab", type: "text" },
        { name: "aB", type: "text" },
      ],
    };
    const held = uiSchemaManifest.parse({
      collections: [{ slug: "events", fields: [seo] }],
    });
    const next = mutateManifest(held, {
      type: "upsert",
      kind: "collections",
      entity: {
        slug: "events",
        fields: [seo, { name: "venue", type: "text" }],
      },
    });
    expect(next.collections[0].fields.map(f => f.name)).toEqual([
      "seo",
      "venue",
    ]);
  });
});
