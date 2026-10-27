import { describe, expect, it, vi } from "vitest";

import { NextlyError } from "../../../errors/nextly-error";
import type { ExtensionSchemaRecord } from "../../schema/ownership/dependent-elements";

import {
  assertNothingDependsOn,
  fieldsPointingAt,
  findCollectionDependents,
  readFieldOwners,
  type DependentsAdapter,
  type DependentsSources,
  type FieldOwner,
} from "./collection-dependents";

/** An extension schema holding only what a test gives it. */
function schemaWith(
  parts: Partial<ExtensionSchemaRecord> = {}
): ExtensionSchemaRecord {
  return {
    specs: [],
    owners: new Map(),
    entityColumns: new Map(),
    entityIndexes: new Map(),
    elementOwners: new Map(),
    ...parts,
  };
}

/** Sources answering from fixed values; a value that is an Error is thrown. */
function sources(input: {
  owners?: readonly FieldOwner[] | Error;
  schema?: ExtensionSchemaRecord | null | Error;
  recorded?: Awaited<ReturnType<DependentsSources["recordedElements"]>> | Error;
}): DependentsSources {
  const answer = <T>(value: T | Error): Promise<T> =>
    value instanceof Error ? Promise.reject(value) : Promise.resolve(value);
  return {
    fieldOwners: () => answer(input.owners ?? []),
    extensionSchema: () =>
      answer(input.schema === undefined ? null : input.schema),
    recordedElements: () => answer(input.recorded ?? []),
  };
}

const TAGS = { slug: "tags", tables: ["dc_tags", "dc_tags_locales"] };

async function refusalOf(attempt: Promise<unknown>): Promise<NextlyError> {
  const outcome = await attempt.then(
    () => undefined,
    (error: unknown) => error
  );
  if (!NextlyError.is(outcome)) throw new Error("expected a NextlyError");
  return outcome;
}

describe("fieldsPointingAt", () => {
  it("finds relationship and upload fields, with one target or several, in either spelling", () => {
    const fields = [
      { name: "tags", type: "relationship", relationTo: "tags" },
      { name: "cover", type: "upload", relationTo: "tags" },
      { name: "either", type: "relationship", relationTo: ["posts", "tags"] },
      // How the Builder stores a target.
      { name: "picked", type: "relationship", options: { target: "tags" } },
      { name: "author", type: "relationship", relationTo: "users" },
      { name: "title", type: "text" },
    ];

    expect(fieldsPointingAt(fields, "tags")).toEqual([
      "tags",
      "cover",
      "either",
      "picked",
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

  it("reads no target on a field that holds no reference, nor nested fields under a type that nests none", () => {
    const fields = [
      { name: "picker", type: "select", relationTo: "tags" },
      {
        name: "blob",
        type: "json",
        fields: [{ name: "t", type: "relationship", relationTo: "tags" }],
      },
    ];

    expect(fieldsPointingAt(fields, "tags")).toEqual([]);
  });
});

describe("findCollectionDependents", () => {
  const posts: FieldOwner = {
    entityType: "collection",
    entitySlug: "posts",
    fields: [{ name: "tag", type: "relationship", relationTo: "tags" }],
  };

  it("does not count the collection's own fields, or those of collections deleted with it", async () => {
    const self: FieldOwner = {
      entityType: "collection",
      entitySlug: "tags",
      fields: [{ name: "parent", type: "relationship", relationTo: "tags" }],
    };

    await expect(
      findCollectionDependents([TAGS], sources({ owners: [self] }))
    ).resolves.toEqual(new Map());
    await expect(
      findCollectionDependents(
        [TAGS, { slug: "posts", tables: ["dc_posts"] }],
        sources({ owners: [self, posts] })
      )
    ).resolves.toEqual(new Map());
  });

  it("still counts a Single's or a field group's field when a collection of that slug goes too", async () => {
    // Only a collection goes with the set: a Single sharing the slug stays.
    const single: FieldOwner = { ...posts, entityType: "single" };

    const found = await findCollectionDependents(
      [TAGS, { slug: "posts", tables: ["dc_posts"] }],
      sources({ owners: [single] })
    );

    expect(found.get("tags")?.fields).toEqual([
      { entityType: "single", entitySlug: "posts", fieldPath: "tag" },
    ]);
  });

  it("finds a declared key into any of the collection's tables, owned by its table's owner or its contributor", async () => {
    const schema = schemaWith({
      specs: [
        {
          name: "plg__links",
          columns: [],
          foreignKeys: [
            {
              name: "fk_links_tag",
              columns: ["tag_id"],
              referencesTable: "dc_tags_locales",
              referencesColumns: ["id"],
              onDelete: "no action",
              onUpdate: "no action",
            },
            {
              name: "fk_links_app",
              columns: ["app_id"],
              referencesTable: "dc_tags",
              referencesColumns: ["id"],
              onDelete: "no action",
              onUpdate: "no action",
            },
          ],
        },
      ],
      owners: new Map([["plg__links", { kind: "plugin", id: "plg" }]]),
      elementOwners: new Map([
        [
          "plg__links",
          [
            {
              elementKind: "fk" as const,
              elementName: "fk_links_app",
              owner: { kind: "app" as const },
            },
          ],
        ],
      ]),
    });

    const found = await findCollectionDependents([TAGS], sources({ schema }));

    expect(found.get("tags")?.foreignKeys).toEqual([
      {
        owner: { kind: "plugin", id: "plg" },
        table: "plg__links",
        name: "fk_links_tag",
        referencesTable: "dc_tags_locales",
      },
      {
        owner: { kind: "app" },
        table: "plg__links",
        name: "fk_links_app",
        referencesTable: "dc_tags",
      },
    ]);
  });

  it("does not count a key from a table deleted in the same operation", async () => {
    const schema = schemaWith({
      specs: [
        {
          name: "dc_tags_locales",
          columns: [],
          foreignKeys: [
            {
              name: "fk_own",
              columns: ["parent"],
              referencesTable: "dc_tags",
              referencesColumns: ["id"],
              onDelete: "cascade",
              onUpdate: "no action",
            },
          ],
        },
      ],
    });

    await expect(
      findCollectionDependents([TAGS], sources({ schema }))
    ).resolves.toEqual(new Map());
  });

  it("lists another owner's element once when the compiled schema and the recorded rows both hold it", async () => {
    const schema = schemaWith({
      entityColumns: new Map([
        [
          "dc_tags",
          [
            {
              key: "marker",
              name: "marker",
              kind: "shortText",
              nullable: true,
              hidden: true,
              contributedBy: { kind: "plugin", id: "plg" },
            },
          ],
        ],
      ]),
    });

    const found = await findCollectionDependents(
      [TAGS],
      sources({
        schema,
        recorded: [
          {
            owner: { kind: "plugin", id: "plg" },
            kind: "column",
            name: "marker",
            table: "dc_tags",
          },
          {
            owner: { kind: "plugin", id: "gone" },
            kind: "index",
            name: "idx_dc_tags_locales_x",
            table: "dc_tags_locales",
          },
        ],
      })
    );

    expect(found.get("tags")?.elements).toEqual([
      {
        owner: { kind: "plugin", id: "plg" },
        kind: "column",
        name: "marker",
        table: "dc_tags",
      },
      {
        owner: { kind: "plugin", id: "gone" },
        kind: "index",
        name: "idx_dc_tags_locales_x",
        table: "dc_tags_locales",
      },
    ]);
  });

  it("names every record it could not read, and counts none of them as empty", async () => {
    const refusal = await refusalOf(
      findCollectionDependents(
        [TAGS],
        sources({
          owners: new Error("registry gone"),
          schema: new Error("hook threw"),
        })
      )
    );

    expect(refusal.code).toBe("SERVICE_UNAVAILABLE");
    expect(refusal.publicMessage).toBe(
      `"tags" was not deleted, because the fields of collections, Singles and field groups, the foreign keys plugins and the app declare and the record of columns, indexes, foreign keys and checks other owners added to its tables could not be read, so whether anything depends on it is unknown. Nothing was removed. Fix the cause in the server log and try again.`
    );
  });

  it("refuses when only the recorded rows cannot be read", async () => {
    const refusal = await refusalOf(
      findCollectionDependents(
        [TAGS],
        sources({ recorded: new Error("owners table damaged") })
      )
    );

    expect(refusal.publicMessage).toContain(
      "the record of columns, indexes, foreign keys and checks other owners added to its tables could not be read"
    );
  });
});

describe("assertNothingDependsOn", () => {
  it("names what depends on each collection, and says how to proceed for each kind", async () => {
    const refusal = await refusalOf(
      assertNothingDependsOn(
        [TAGS, { slug: "notes", tables: ["dc_notes"] }],
        sources({
          owners: [
            {
              entityType: "fieldGroup",
              entitySlug: "seo",
              fields: [
                { name: "topic", type: "relationship", relationTo: "tags" },
              ],
            },
          ],
          recorded: [
            {
              owner: { kind: "app" },
              kind: "check",
              name: "ck_dc_notes_x",
              table: "dc_notes",
            },
          ],
        })
      )
    );

    expect(refusal.code).toBe("CONFLICT");
    expect(refusal.publicMessage).toBe(
      `Nothing was deleted, because other schema depends on "tags" and "notes". "tags": Fields that point at it: the field group seo.topic. "notes": What other owners added to its tables: the check constraint "ck_dc_notes_x" on "dc_notes" (the app). Remove those fields, or point them at another collection, and have each owner named remove its foreign keys, columns, indexes and checks (a plugin's go when the plugin stops declaring them or is uninstalled), then try again.`
    );
  });

  it("resolves when nothing depends on the collection", async () => {
    await expect(
      assertNothingDependsOn([TAGS], sources({}))
    ).resolves.toBeUndefined();
  });
});

describe("readFieldOwners", () => {
  /** An adapter holding these registry rows; a table not listed does not exist. */
  function adapterWith(
    rows: Record<string, { slug: string; fields: unknown }[]>
  ): DependentsAdapter {
    return {
      dialect: "postgresql",
      getDrizzle: () => ({}) as never,
      listTables: () => Promise.resolve(Object.keys(rows)),
      select: vi.fn((table: string) => {
        if (table in rows) return Promise.resolve(rows[table] as never[]);
        return Promise.reject(
          Object.assign(new Error(`relation "${table}" does not exist`), {
            code: "42P01",
          })
        );
      }),
    };
  }
  const registryName = () => Promise.resolve("dynamic_components");

  it("reads every registry, stored as text or as JSON, and takes a missing one for empty", async () => {
    const owners = await readFieldOwners(
      adapterWith({
        dynamic_collections: [
          {
            slug: "posts",
            fields: JSON.stringify([{ name: "tag", type: "relationship" }]),
          },
        ],
        dynamic_components: [{ slug: "seo", fields: [] }],
      }),
      { fieldGroupRegistryName: registryName }
    );

    expect(owners).toEqual([
      {
        entityType: "collection",
        entitySlug: "posts",
        fields: [{ name: "tag", type: "relationship" }],
      },
      { entityType: "fieldGroup", entitySlug: "seo", fields: [] },
    ]);
  });

  it("throws on a field list that is not a list, and on a registry it cannot read", async () => {
    await expect(
      readFieldOwners(
        adapterWith({
          dynamic_collections: [{ slug: "posts", fields: '"damaged"' }],
        }),
        { fieldGroupRegistryName: registryName }
      )
    ).rejects.toThrow();

    const adapter = adapterWith({});
    vi.mocked(adapter.select).mockRejectedValueOnce(
      new Error("permission denied for table dynamic_collections")
    );
    await expect(
      readFieldOwners(adapter, { fieldGroupRegistryName: registryName })
    ).rejects.toThrow("permission denied");
  });
});
