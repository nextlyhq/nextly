import { describe, expect, it, vi } from "vitest";

import { NextlyError } from "../../../errors/nextly-error";
import type { ExtensionSchemaRecord } from "../../schema/ownership/dependent-elements";

import {
  assertNothingDependsOn,
  fieldGroupPlacementCounts,
  fieldsPlacing,
  fieldsPointingAt,
  findEntityDependents,
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

  it("looks through a group with no name, naming its fields at the level they are stored", () => {
    const fields = [
      {
        type: "group",
        label: "Layout",
        fields: [
          { name: "tag", type: "relationship", relationTo: "tags" },
          {
            name: "meta",
            type: "group",
            fields: [
              {
                type: "group",
                fields: [
                  { name: "topic", type: "relationship", relationTo: "tags" },
                ],
              },
            ],
          },
        ],
      },
    ];

    expect(fieldsPointingAt(fields, "tags")).toEqual(["tag", "meta.topic"]);
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

describe("findEntityDependents", () => {
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
      findEntityDependents([TAGS], sources({ owners: [self] }))
    ).resolves.toEqual(new Map());
    await expect(
      findEntityDependents(
        [TAGS, { slug: "posts", tables: ["dc_posts"] }],
        sources({ owners: [self, posts] })
      )
    ).resolves.toEqual(new Map());
  });

  it("matches fields against the slug they name a collection by, and none when nothing can name it", async () => {
    const single: FieldOwner = {
      entityType: "single",
      entitySlug: "settings",
      fields: [
        { name: "featured", type: "relationship", relationTo: "labels" },
      ],
    };
    // Called "labels" in the refusal, but no field can name it: a surviving
    // collection holds that slug.
    const unnamed = { slug: "labels", tables: ["dc_labels"], fieldSlug: null };
    const named = { slug: "dc_tags", tables: ["dc_tags"], fieldSlug: "tags" };
    const pointsAtTags: FieldOwner = {
      ...single,
      fields: [{ name: "featured", type: "relationship", relationTo: "tags" }],
    };

    await expect(
      findEntityDependents([unnamed], sources({ owners: [single] }))
    ).resolves.toEqual(new Map());
    const found = await findEntityDependents(
      [named],
      sources({ owners: [pointsAtTags] })
    );
    expect(found.get("dc_tags")?.fields).toEqual([
      { entityType: "single", entitySlug: "settings", fieldPath: "featured" },
    ]);
  });

  it("still counts a Single's or a field group's field when a collection of that slug goes too", async () => {
    // Only a collection goes with the set: a Single sharing the slug stays.
    const single: FieldOwner = { ...posts, entityType: "single" };

    const found = await findEntityDependents(
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

    const found = await findEntityDependents([TAGS], sources({ schema }));

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
      findEntityDependents([TAGS], sources({ schema }))
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

    const found = await findEntityDependents(
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
      findEntityDependents(
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
      findEntityDependents(
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

describe("a field group's and a Single's dependents", () => {
  const SEO = {
    kind: "fieldGroup" as const,
    slug: "seo",
    tables: ["comp_seo", "comp_seo_locales"],
  };
  const HOME = {
    kind: "single" as const,
    slug: "home",
    tables: ["single_home", "single_home_locales"],
  };
  /** A collection placing SEO at the top, and inside a repeater and a group, beside a relationship to a collection called "seo". */
  const pages: FieldOwner = {
    entityType: "collection",
    entitySlug: "pages",
    fields: [
      { name: "meta", type: "component", component: "seo" },
      {
        name: "blocks",
        type: "repeater",
        fields: [
          {
            name: "hero",
            type: "group",
            fields: [
              {
                name: "either",
                type: "component",
                components: ["card", "seo"],
              },
            ],
          },
        ],
      },
      { name: "related", type: "relationship", relationTo: "seo" },
    ],
  };

  it("finds every field that places a field group, at any depth, and no relationship to a collection of its slug", () => {
    expect(fieldsPlacing(pages.fields, "seo")).toEqual([
      "meta",
      "blocks.hero.either",
    ]);
    expect(fieldsPointingAt(pages.fields, "seo")).toEqual(["related"]);
  });

  it("matches a field group's placements, and a collection's relationships, each only against its own kind", async () => {
    const asFieldGroup = await findEntityDependents(
      [SEO],
      sources({ owners: [pages] })
    );
    const asCollection = await findEntityDependents(
      [{ slug: "seo", tables: ["dc_seo"] }],
      sources({ owners: [pages] })
    );

    expect(asFieldGroup.get("seo")?.fields).toEqual([
      { entityType: "collection", entitySlug: "pages", fieldPath: "meta" },
      {
        entityType: "collection",
        entitySlug: "pages",
        fieldPath: "blocks.hero.either",
      },
    ]);
    expect(asCollection.get("seo")?.fields).toEqual([
      { entityType: "collection", entitySlug: "pages", fieldPath: "related" },
    ]);
  });

  it("names a field group and a collection of the same slug deleted together each with its own dependents", async () => {
    const found = await findEntityDependents(
      [SEO, { slug: "seo", tables: ["dc_seo"] }],
      sources({ owners: [pages] })
    );

    expect([...found.keys()]).toEqual(["seo", "seo (collection)"]);
    expect(found.get("seo")?.fields.map(field => field.fieldPath)).toEqual([
      "meta",
      "blocks.hero.either",
    ]);
    expect(
      found.get("seo (collection)")?.fields.map(field => field.fieldPath)
    ).toEqual(["related"]);
  });

  it("does not count a host deleted in the same operation, but counts a Single of the same slug that stays", async () => {
    await expect(
      findEntityDependents(
        [SEO, { slug: "pages", tables: ["dc_pages"] }],
        sources({ owners: [pages] })
      )
    ).resolves.toEqual(new Map());

    const found = await findEntityDependents(
      [SEO, { slug: "pages", tables: ["dc_pages"] }],
      sources({ owners: [{ ...pages, entityType: "single" }] })
    );
    expect(found.get("seo")?.fields.map(field => field.entityType)).toEqual([
      "single",
      "single",
    ]);
  });

  it("does not count a field group deleted with the one it places", async () => {
    const card: FieldOwner = {
      entityType: "fieldGroup",
      entitySlug: "card",
      fields: [{ name: "seo", type: "fieldGroup", fieldGroup: "seo" }],
    };

    await expect(
      findEntityDependents(
        [SEO, { kind: "fieldGroup", slug: "card", tables: ["comp_card"] }],
        sources({ owners: [card] })
      )
    ).resolves.toEqual(new Map());
    const alone = await findEntityDependents(
      [SEO],
      sources({ owners: [card] })
    );
    expect(alone.get("seo")?.fields).toEqual([
      { entityType: "fieldGroup", entitySlug: "card", fieldPath: "seo" },
    ]);
  });

  it("names no field for a Single, and finds a declared key into its tables", async () => {
    const pointing: FieldOwner = {
      entityType: "collection",
      entitySlug: "pages",
      fields: [{ name: "home", type: "relationship", relationTo: "home" }],
    };
    const schema = schemaWith({
      specs: [
        {
          name: "plg__links",
          columns: [],
          foreignKeys: [
            {
              name: "fk_links_home",
              columns: ["home_id"],
              referencesTable: "single_home",
              referencesColumns: ["id"],
              onDelete: "no action",
              onUpdate: "no action",
            },
          ],
        },
      ],
      owners: new Map([["plg__links", { kind: "plugin", id: "plg" }]]),
    });

    const found = await findEntityDependents(
      [HOME],
      sources({ owners: [pointing], schema })
    );

    expect(found.get("home")).toEqual({
      kind: "single",
      fields: [],
      foreignKeys: [
        {
          owner: { kind: "plugin", id: "plg" },
          table: "plg__links",
          name: "fk_links_home",
          referencesTable: "single_home",
        },
      ],
      retainedKeys: [],
      elements: [],
    });
  });

  it("says what places a field group and how to proceed", async () => {
    const refusal = await refusalOf(
      assertNothingDependsOn([SEO], sources({ owners: [pages] }))
    );

    expect(refusal.code).toBe("CONFLICT");
    expect(refusal.publicMessage).toBe(
      `"seo" cannot be deleted while other schema depends on it. Fields that place it: pages.meta, pages.blocks.hero.either. Remove those fields, or have them place another field group, then delete "seo".`
    );
    expect(refusal.logContext).toMatchObject({
      reason: "field-group-has-dependents",
    });
  });

  it("says how to proceed for a collection's and a field group's fields together", async () => {
    const refusal = await refusalOf(
      assertNothingDependsOn(
        [SEO, { slug: "seo_pages", tables: ["dc_seo_pages"] }],
        sources({
          owners: [
            pages,
            {
              entityType: "single",
              entitySlug: "home",
              fields: [
                { name: "list", type: "relationship", relationTo: "seo_pages" },
              ],
            },
          ],
        })
      )
    );

    expect(refusal.publicMessage).toBe(
      `Nothing was deleted, because other schema depends on "seo" and "seo_pages". "seo": Fields that place it: pages.meta, pages.blocks.hero.either. "seo_pages": Fields that point at it: the Single home.list. Remove those fields, or point them at another collection, or have them place another field group, then try again.`
    );
    expect(refusal.logContext).toMatchObject({
      reason: "entity-has-dependents",
    });
  });

  it("refuses a Single whose records cannot be read, and logs it as a Single's", async () => {
    const refusal = await refusalOf(
      findEntityDependents(
        [HOME],
        sources({ recorded: new Error("owners table damaged") })
      )
    );

    expect(refusal.code).toBe("SERVICE_UNAVAILABLE");
    expect(refusal.publicMessage).toBe(
      `"home" was not deleted, because the record of columns, indexes, foreign keys and checks other owners added to its tables could not be read, so whether anything depends on it is unknown. Nothing was removed. Fix the cause in the server log and try again.`
    );
    expect(refusal.logContext).toMatchObject({
      reason: "single-dependents-unreadable",
    });
  });
});

describe("keys the database holds that no configuration declares", () => {
  const SEO = {
    kind: "fieldGroup" as const,
    slug: "seo",
    tables: ["comp_seo", "comp_seo_locales"],
  };
  /** Sources whose live catalog holds `live`, recording which tables it was asked about. */
  function withLive(
    live:
      | Awaited<ReturnType<NonNullable<DependentsSources["liveKeysInto"]>>>
      | Error,
    rest: Parameters<typeof sources>[0] = {}
  ) {
    const asked: string[][] = [];
    return {
      asked,
      sources: {
        ...sources(rest),
        liveKeysInto: (tables: readonly string[]) => {
          asked.push([...tables]);
          return live instanceof Error
            ? Promise.reject(live)
            : Promise.resolve(live);
        },
      } satisfies DependentsSources,
    };
  }

  it("counts a key into a field group's table that nothing declares, with its table's recorded owner", async () => {
    const { sources: read } = withLive([
      {
        table: "plg__links",
        referencesTable: "comp_seo",
        owner: { kind: "plugin", id: "plg" },
      },
      { table: "stray", referencesTable: "comp_seo_locales", owner: null },
    ]);

    const refusal = await refusalOf(assertNothingDependsOn([SEO], read));

    expect(refusal.publicMessage).toBe(
      `"seo" cannot be deleted while other schema depends on it. Foreign keys that point at its tables: a key on "plg__links" (plugin "plg", which no longer declares it), a key on "stray" (an owner nothing records). Remove the keys no configuration declares any more, by running the migration that drops them or by hand, then delete "seo".`
    );
  });

  it("does not count a key twice when the configuration still declares it, nor one from a table deleted with it", async () => {
    const schema = schemaWith({
      specs: [
        {
          name: "plg__links",
          columns: [],
          foreignKeys: [
            {
              name: "fk_links_seo",
              columns: ["seo_id"],
              referencesTable: "comp_seo",
              referencesColumns: ["id"],
              onDelete: "no action",
              onUpdate: "no action",
            },
          ],
        },
      ],
      owners: new Map([["plg__links", { kind: "plugin", id: "plg" }]]),
    });
    const { sources: read } = withLive(
      [
        {
          table: "plg__links",
          referencesTable: "comp_seo",
          owner: { kind: "plugin", id: "plg" },
        },
        { table: "comp_seo_locales", referencesTable: "comp_seo", owner: null },
      ],
      { schema }
    );

    const found = await findEntityDependents([SEO], read);

    expect(found.get("seo")?.foreignKeys.map(key => key.name)).toEqual([
      "fk_links_seo",
    ]);
    expect(found.get("seo")?.retainedKeys).toEqual([]);
  });

  it("asks the catalog only about Singles' and field groups' tables, never a collection's", async () => {
    const { sources: read, asked } = withLive([
      { table: "dc_posts", referencesTable: "dc_tags", owner: null },
    ]);

    await expect(
      findEntityDependents([{ slug: "tags", tables: ["dc_tags"] }], read)
    ).resolves.toEqual(new Map());
    expect(asked).toEqual([]);

    await findEntityDependents(
      [{ slug: "tags", tables: ["dc_tags"] }, SEO],
      read
    );
    expect(asked).toEqual([["comp_seo", "comp_seo_locales"]]);
  });

  it("refuses when the catalog cannot be read, naming it", async () => {
    const { sources: read } = withLive(new Error("catalog unreadable"));

    const refusal = await refusalOf(findEntityDependents([SEO], read));

    expect(refusal.code).toBe("SERVICE_UNAVAILABLE");
    expect(refusal.publicMessage).toBe(
      `"seo" was not deleted, because the foreign keys the database holds into its tables could not be read, so whether anything depends on it is unknown. Nothing was removed. Fix the cause in the server log and try again.`
    );
  });
});

describe("fieldGroupPlacementCounts", () => {
  /** Field group "card" places "seo"; collection "pages" places both. */
  const owners: FieldOwner[] = [
    {
      entityType: "fieldGroup",
      entitySlug: "card",
      fields: [{ name: "meta", type: "component", component: "seo" }],
    },
    {
      entityType: "collection",
      entitySlug: "pages",
      fields: [
        { name: "teaser", type: "component", component: "card" },
        {
          name: "blocks",
          type: "repeater",
          fields: [
            { name: "either", type: "component", components: ["card", "seo"] },
          ],
        },
        { name: "related", type: "relationship", relationTo: "seo" },
      ],
    },
    { entityType: "single", entitySlug: "home", fields: [] },
  ];

  it("counts one field group's use of another when both are asked about together", async () => {
    const counts = await fieldGroupPlacementCounts(
      ["card", "seo", "unused"],
      sources({ owners })
    );
    // card: pages.teaser and pages.blocks.either; seo: card.meta and
    // pages.blocks.either. A delete of both together would leave card's use
    // of seo out, as going with it; a list asks about each on its own.
    expect(counts).toEqual(
      new Map([
        ["card", 2],
        ["seo", 2],
        ["unused", 0],
      ])
    );
  });

  it("gives each field group the number of fields its own delete refusal would name", async () => {
    const counts = await fieldGroupPlacementCounts(
      ["card", "seo"],
      sources({ owners })
    );
    for (const slug of ["card", "seo"]) {
      const alone = await findEntityDependents(
        [{ kind: "fieldGroup", slug, tables: [] }],
        sources({ owners })
      );
      expect(counts.get(slug)).toBe(alone.get(slug)?.fields.length ?? 0);
    }
  });

  it("does not count a field group's reference to itself, as its own delete does not", async () => {
    // "tree" places itself and is placed once by "pages"; its delete takes
    // its own fields with it, so only the outside use refuses it.
    const withSelf: FieldOwner[] = [
      ...owners,
      {
        entityType: "fieldGroup",
        entitySlug: "tree",
        fields: [{ name: "children", type: "component", component: "tree" }],
      },
      {
        entityType: "collection",
        entitySlug: "menus",
        fields: [{ name: "root", type: "component", component: "tree" }],
      },
    ];
    const counts = await fieldGroupPlacementCounts(
      ["tree"],
      sources({ owners: withSelf })
    );
    const alone = await findEntityDependents(
      [{ kind: "fieldGroup", slug: "tree", tables: [] }],
      sources({ owners: withSelf })
    );
    expect(counts.get("tree")).toBe(1);
    expect(counts.get("tree")).toBe(alone.get("tree")?.fields.length);
  });

  it("reads the field owners once, however many field groups it is asked about", async () => {
    const fieldOwners = vi.fn(() => Promise.resolve(owners));
    await fieldGroupPlacementCounts(["card", "seo", "unused"], {
      ...sources({ owners }),
      fieldOwners,
    });
    expect(fieldOwners).toHaveBeenCalledTimes(1);
  });

  it("rejects when the field owners cannot be read, leaving the caller to say so", async () => {
    await expect(
      fieldGroupPlacementCounts(
        ["card"],
        sources({ owners: new Error("down") })
      )
    ).rejects.toThrow("down");
  });
});
