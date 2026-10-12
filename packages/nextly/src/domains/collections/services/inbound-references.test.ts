import { describe, expect, it, vi } from "vitest";

import { NextlyError } from "../../../errors/nextly-error";

import {
  assertNothingPointsAt,
  fieldsPointingAt,
  findInboundReferences,
  findReferencesIntoSet,
  referencedCollectionsConflict,
  type InboundReferenceAdapter,
} from "./inbound-references";

type Rows = Record<string, { slug: string; fields: unknown }[]>;

/** An adapter holding these registry rows; a table not listed does not exist on it. */
function adapterWith(
  rows: Rows,
  dialect: "postgresql" | "mysql" | "sqlite" = "postgresql"
): InboundReferenceAdapter {
  return {
    dialect,
    getDrizzle: () => ({}) as never,
    listTables: async () => Object.keys(rows),
    select: vi.fn(async (table: string) => {
      if (table in rows) return rows[table] as never[];
      throw Object.assign(new Error(`relation "${table}" does not exist`), {
        code: "42P01",
      });
    }),
  };
}

const registryName = async () => "dynamic_components";

describe("fieldsPointingAt", () => {
  it("finds relationship and upload fields, with one target or several", () => {
    const fields = [
      { name: "tags", type: "relationship", relationTo: "tags" },
      { name: "cover", type: "upload", relationTo: "tags" },
      { name: "either", type: "relationship", relationTo: ["posts", "tags"] },
      { name: "author", type: "relationship", relationTo: "users" },
      { name: "title", type: "text" },
    ];

    expect(fieldsPointingAt(fields, "tags")).toEqual([
      "tags",
      "cover",
      "either",
    ]);
  });

  it("follows repeaters and groups, and names the field by its path", () => {
    const fields = [
      {
        name: "sections",
        type: "repeater",
        fields: [
          {
            name: "meta",
            type: "group",
            fields: [
              { name: "topic", type: "relationship", relationTo: "tags" },
            ],
          },
        ],
      },
    ];

    expect(fieldsPointingAt(fields, "tags")).toEqual(["sections.meta.topic"]);
  });

  it("does not read a relationTo on a field that holds no reference", () => {
    // A contributed type may carry its own `relationTo` option; only these two types point at rows.
    const fields = [{ name: "picker", type: "select", relationTo: "tags" }];

    expect(fieldsPointingAt(fields, "tags")).toEqual([]);
  });

  it("does not read nested fields under a type that does not nest them", () => {
    const fields = [
      {
        name: "block",
        type: "json",
        fields: [{ name: "t", type: "relationship", relationTo: "tags" }],
      },
    ];

    expect(fieldsPointingAt(fields, "tags")).toEqual([]);
  });
});

describe("findInboundReferences", () => {
  it("reads collections, Singles and Field Groups, stored as text or as JSON", async () => {
    const adapter = adapterWith({
      dynamic_collections: [
        {
          slug: "posts",
          fields: JSON.stringify([
            { name: "tags", type: "relationship", relationTo: "tags" },
          ]),
        },
      ],
      dynamic_singles: [
        {
          slug: "settings",
          fields: [
            { name: "featured", type: "relationship", relationTo: "tags" },
          ],
        },
      ],
      dynamic_components: [
        {
          slug: "seo",
          fields: [{ name: "topic", type: "relationship", relationTo: "tags" }],
        },
      ],
    });

    await expect(
      findInboundReferences(adapter, "tags", {
        fieldGroupRegistryName: registryName,
      })
    ).resolves.toEqual([
      { entityType: "collection", entitySlug: "posts", fieldPath: "tags" },
      { entityType: "single", entitySlug: "settings", fieldPath: "featured" },
      { entityType: "fieldGroup", entitySlug: "seo", fieldPath: "topic" },
    ]);
  });

  it("does not count the collection's own fields, or those of collections deleted with it", async () => {
    const adapter = adapterWith({
      dynamic_collections: [
        {
          slug: "tags",
          fields: [
            { name: "parent", type: "relationship", relationTo: "tags" },
          ],
        },
        {
          slug: "archive",
          fields: [{ name: "old", type: "relationship", relationTo: "tags" }],
        },
      ],
      dynamic_singles: [],
      dynamic_components: [],
    });

    await expect(
      findInboundReferences(adapter, "tags", {
        deletedTogether: ["archive"],
        fieldGroupRegistryName: registryName,
      })
    ).resolves.toEqual([]);
  });

  it("counts a Single or Field Group that shares the deleted collection's slug", async () => {
    // A collection, a Single and a Field Group may share one slug. Only the collection goes, so only
    // its own fields stop counting.
    const adapter = adapterWith({
      dynamic_collections: [
        {
          slug: "tags",
          fields: [
            { name: "parent", type: "relationship", relationTo: "tags" },
          ],
        },
      ],
      dynamic_singles: [
        {
          slug: "tags",
          fields: [
            { name: "featured", type: "relationship", relationTo: "tags" },
          ],
        },
      ],
      dynamic_components: [
        {
          slug: "tags",
          fields: [{ name: "topic", type: "relationship", relationTo: "tags" }],
        },
      ],
    });

    await expect(
      findInboundReferences(adapter, "tags", {
        fieldGroupRegistryName: registryName,
      })
    ).resolves.toEqual([
      { entityType: "single", entitySlug: "tags", fieldPath: "featured" },
      { entityType: "fieldGroup", entitySlug: "tags", fieldPath: "topic" },
    ]);
  });

  it("reads a registry that does not exist yet as holding nothing", async () => {
    const adapter = adapterWith({ dynamic_collections: [] });

    await expect(
      findInboundReferences(adapter, "tags", {
        fieldGroupRegistryName: registryName,
      })
    ).resolves.toEqual([]);
  });

  it("fails closed when a registry cannot be read for any other reason", async () => {
    const adapter = adapterWith({ dynamic_collections: [] });
    vi.mocked(adapter.select).mockRejectedValueOnce(
      Object.assign(
        new Error("permission denied for table dynamic_collections"),
        { code: "42501" }
      )
    );

    await expect(
      findInboundReferences(adapter, "tags", {
        fieldGroupRegistryName: registryName,
      })
    ).rejects.toThrow("permission denied");
  });

  it("fails closed when a stored field list does not parse", async () => {
    const adapter = adapterWith({
      dynamic_collections: [{ slug: "posts", fields: "{not json" }],
      dynamic_singles: [],
      dynamic_components: [],
    });

    await expect(
      findInboundReferences(adapter, "tags", {
        fieldGroupRegistryName: registryName,
      })
    ).rejects.toBeInstanceOf(NextlyError);
  });
});

describe("assertNothingPointsAt", () => {
  it("refuses with a conflict naming every dependent, by kind", async () => {
    const adapter = adapterWith({
      dynamic_collections: [
        {
          slug: "posts",
          fields: [{ name: "tags", type: "relationship", relationTo: "tags" }],
        },
      ],
      dynamic_singles: [
        {
          slug: "settings",
          fields: [
            { name: "featured", type: "relationship", relationTo: "tags" },
          ],
        },
      ],
      dynamic_components: [],
    });

    const refusal = await assertNothingPointsAt(adapter, "tags", {
      fieldGroupRegistryName: registryName,
    }).catch((error: unknown) => error);

    expect(NextlyError.is(refusal)).toBe(true);
    expect((refusal as NextlyError).code).toBe("CONFLICT");
    expect((refusal as NextlyError).publicMessage).toBe(
      '"tags" cannot be deleted while other fields point at it: posts.tags, the Single settings.featured. Remove those fields, or point them at another collection, then delete "tags".'
    );
  });

  it("lets a delete go on when nothing points at the collection", async () => {
    const adapter = adapterWith({
      dynamic_collections: [
        { slug: "posts", fields: [{ name: "title", type: "text" }] },
      ],
      dynamic_singles: [],
      dynamic_components: [],
    });

    await expect(
      assertNothingPointsAt(adapter, "tags", {
        fieldGroupRegistryName: registryName,
      })
    ).resolves.toBeUndefined();
  });
});

describe("findReferencesIntoSet", () => {
  it("lists only the collections a field outside the set points at", async () => {
    const adapter = adapterWith({
      dynamic_collections: [
        {
          slug: "tags",
          fields: [
            { name: "featured", type: "relationship", relationTo: "posts" },
          ],
        },
        {
          slug: "posts",
          fields: [{ name: "tags", type: "relationship", relationTo: "tags" }],
        },
        {
          slug: "articles",
          fields: [{ name: "tag", type: "relationship", relationTo: "tags" }],
        },
      ],
      dynamic_singles: [],
      dynamic_components: [],
    });

    const blocked = await findReferencesIntoSet(adapter, ["tags", "posts"], {
      fieldGroupRegistryName: registryName,
    });

    expect([...blocked]).toEqual([
      [
        "tags",
        [
          {
            entityType: "collection",
            entitySlug: "articles",
            fieldPath: "tag",
          },
        ],
      ],
    ]);
  });

  it("reads each registry once, however many collections the set holds", async () => {
    const adapter = adapterWith({
      dynamic_collections: [],
      dynamic_singles: [],
      dynamic_components: [],
    });

    await findReferencesIntoSet(adapter, ["a", "b", "c", "d"], {
      fieldGroupRegistryName: registryName,
    });

    expect(
      vi.mocked(adapter.select).mock.calls.map(([table]) => table)
    ).toEqual(["dynamic_collections", "dynamic_singles", "dynamic_components"]);
  });
});

describe("referencedCollectionsConflict", () => {
  it("names each collection that cannot go, with the fields that point at it, by kind", async () => {
    const adapter = adapterWith({
      dynamic_collections: [
        {
          slug: "articles",
          fields: [{ name: "tag", type: "relationship", relationTo: "tags" }],
        },
      ],
      dynamic_singles: [
        {
          slug: "settings",
          fields: [{ name: "logo", type: "upload", relationTo: "media" }],
        },
      ],
      dynamic_components: [],
    });
    const blocked = await findReferencesIntoSet(adapter, ["tags", "media"], {
      fieldGroupRegistryName: registryName,
    });

    const refusal = referencedCollectionsConflict(blocked);

    expect(refusal.code).toBe("CONFLICT");
    expect(refusal.publicMessage).toBe(
      'Nothing was deleted, because other fields still point at "tags" (articles.tag); "media" (the Single settings.logo). Remove those fields, or point them at another collection, then try again.'
    );
  });

  it("finds nothing to refuse in a set whose collections only point at each other", async () => {
    const adapter = adapterWith({
      dynamic_collections: [
        {
          slug: "tags",
          fields: [
            { name: "featured", type: "relationship", relationTo: "posts" },
          ],
        },
        {
          slug: "posts",
          fields: [{ name: "tags", type: "relationship", relationTo: "tags" }],
        },
      ],
      dynamic_singles: [],
      dynamic_components: [],
    });

    const blocked = await findReferencesIntoSet(adapter, ["tags", "posts"], {
      fieldGroupRegistryName: registryName,
    });

    expect(blocked.size).toBe(0);
  });
});
