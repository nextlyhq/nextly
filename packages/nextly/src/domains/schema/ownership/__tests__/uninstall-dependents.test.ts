/**
 * What a full plugin uninstall would take from other owners, found before it
 * runs: each kind with a positive case, and the plugin's own schema, which
 * goes with it, never counted.
 */
import { describe, expect, it } from "vitest";

import { NextlyError } from "../../../../errors/nextly-error";
import { definePlugin } from "../../../../plugins/plugin-context";
import type { DependentsSources } from "../../../collections/services/collection-dependents";
import { resolveIndexName } from "../../extension/compile";
import { col, defineTable } from "../../extension/dsl";
import { compileExtensionSchema } from "../../extension/publish";
import { enumCheckName } from "../../extension/enum-check";
import type { ExtensionSchemaRecord } from "../dependent-elements";
import type { OwnerRecord } from "../owner-registry";
import { planUninstall } from "../uninstall-plan";
import {
  findUninstallDependents,
  pluginEntities,
  type LiveTable,
} from "../uninstall-dependents";
import type { PluginDefinition } from "../../../../plugins/plugin-context";

const row = (over: Partial<OwnerRecord>): OwnerRecord => ({
  tableName: "fx__notes",
  ownerKind: "plugin",
  ownerId: "fx",
  migratedBy: "plugin:fx",
  ownerVersion: null,
  schemaVersion: null,
  state: "active",
  ...over,
});

const FX = { kind: "plugin" as const, id: "fx" };
const SSO = { kind: "plugin" as const, id: "sso" };

function schema(
  over: Partial<ExtensionSchemaRecord> = {}
): ExtensionSchemaRecord {
  return {
    specs: [],
    owners: new Map(),
    entityColumns: new Map(),
    entityIndexes: new Map(),
    elementOwners: new Map(),
    ...over,
  } as ExtensionSchemaRecord;
}

function sources(
  over: {
    extension?: ExtensionSchemaRecord | null;
    fields?: Awaited<ReturnType<DependentsSources["fieldOwners"]>>;
  } = {}
): DependentsSources {
  return {
    fieldOwners: () => Promise.resolve(over.fields ?? []),
    extensionSchema: () => Promise.resolve(over.extension ?? null),
    recordedElements: () => Promise.resolve([]),
  };
}

/** A foreign key the database holds, on the table named. */
interface LiveKey {
  table: string;
  name: string;
  referencesTable: string;
  referencesColumns: string[];
}

/** The live tables holding `keys`, each with only its keys read. */
function keysOn(keys: LiveKey[]): LiveTable[] {
  const tables = new Map<string, LiveTable>();
  for (const { table, ...key } of keys) {
    const spec: LiveTable = tables.get(table) ?? {
      name: table,
      foreignKeys: [],
    };
    spec.foreignKeys?.push({
      ...key,
      columns: [],
      onDelete: "no action",
      onUpdate: "no action",
    });
    tables.set(table, spec);
  }
  return [...tables.values()];
}

const find = (
  owned: OwnerRecord[],
  src: DependentsSources,
  recorded: OwnerRecord[] = [],
  live: LiveTable[] = []
) =>
  findUninstallDependents({
    pluginName: "fx",
    owned,
    collectionSlugs: ["fx-notes"],
    collectionSlugForTable: table =>
      table === "fx__notes" ? "fx-notes" : null,
    sources: src,
    recordedRowsOn: () => Promise.resolve(recorded),
    liveSchema: () => Promise.resolve(live),
  });

describe("findUninstallDependents", () => {
  it("finds a foreign key another plugin points into its table", async () => {
    const found = await find(
      [row({})],
      sources({
        extension: schema({
          specs: [
            {
              name: "sso__links",
              columns: [],
              foreignKeys: [
                {
                  name: "fk_sso_note",
                  columns: ["note_id"],
                  referencesTable: "fx__notes",
                  referencesColumns: ["id"],
                },
              ],
            },
          ] as unknown as ExtensionSchemaRecord["specs"],
          owners: new Map([["sso__links", SSO]]),
        }),
      })
    );
    expect(found).toEqual([
      expect.objectContaining({
        kind: "foreign key",
        name: "fk_sso_note",
        owner: 'plugin "sso"',
      }),
    ]);
  });

  it("finds a relationship field elsewhere pointing at one of its collections", async () => {
    const found = await find(
      [row({})],
      sources({
        fields: [
          {
            entityType: "collection",
            entitySlug: "posts",
            fields: [
              { name: "note", type: "relationship", relationTo: "fx-notes" },
            ],
          },
        ],
      })
    );
    expect(found).toEqual([
      expect.objectContaining({ kind: "relationship field", name: "note" }),
    ]);
  });

  it("finds an index that uses a column it contributed to another owner's table", async () => {
    const found = await find(
      [
        row({}),
        row({
          tableName: "users",
          elementKind: "column",
          elementName: "fx_handle",
        }),
      ],
      sources({
        extension: schema({
          entityIndexes: new Map([
            [
              "users",
              [
                {
                  name: "idx_users_handle",
                  columns: ["fx_handle"],
                  unique: false,
                },
              ],
            ],
          ]) as ExtensionSchemaRecord["entityIndexes"],
        }),
      })
    );
    expect(found).toEqual([
      expect.objectContaining({
        kind: "index",
        name: "idx_users_handle",
        table: "users",
      }),
    ]);
  });

  it("counts a recorded element there whose columns nothing can describe", async () => {
    const found = await find(
      [
        row({}),
        row({
          tableName: "users",
          elementKind: "column",
          elementName: "fx_handle",
        }),
      ],
      sources({ extension: schema() }),
      [
        row({
          tableName: "users",
          elementKind: "index",
          elementName: "idx_removed_owner",
          ownerId: "audit",
          migratedBy: "plugin:audit",
        }),
      ]
    );
    expect(found).toEqual([
      expect.objectContaining({
        name: "idx_removed_owner",
        owner: expect.stringContaining("cannot be read"),
      }),
    ]);
  });

  it("keeps an index and a foreign key that share a name on one table apart", async () => {
    // SQLite gives indexes and constraints separate names, so both may be
    // called `users_handle`. The index uses the column fx contributed; the
    // key, declared after it, does not.
    const found = await find(
      [
        row({}),
        row({
          tableName: "users",
          elementKind: "column",
          elementName: "fx_handle",
        }),
      ],
      sources({
        extension: schema({
          specs: [
            {
              name: "users",
              columns: [],
              indexes: [
                { name: "users_handle", columns: ["fx_handle"], unique: false },
              ],
              foreignKeys: [
                {
                  name: "users_handle",
                  columns: ["org_id"],
                  referencesTable: "orgs",
                  referencesColumns: ["id"],
                },
              ],
            },
          ] as unknown as ExtensionSchemaRecord["specs"],
        }),
      })
    );
    expect(found).toEqual([
      expect.objectContaining({
        kind: "index",
        name: "users_handle",
        table: "users",
      }),
    ]);
  });

  it("finds a foreign key on another table that references a column it contributed", async () => {
    const found = await find(
      [
        row({}),
        row({
          tableName: "users",
          elementKind: "column",
          elementName: "fx_handle",
        }),
      ],
      sources({
        extension: schema({
          specs: [
            {
              name: "sso__links",
              columns: [],
              foreignKeys: [
                {
                  name: "fk_sso_handle",
                  columns: ["handle"],
                  referencesTable: "users",
                  referencesColumns: ["fx_handle"],
                },
                // CONTROL: a key into the same table that references a
                // column fx did not contribute is not its DOWN's to break.
                {
                  name: "fk_sso_user",
                  columns: ["user_id"],
                  referencesTable: "users",
                  referencesColumns: ["id"],
                },
              ],
            },
          ] as unknown as ExtensionSchemaRecord["specs"],
          owners: new Map([["sso__links", SSO]]),
        }),
      })
    );
    expect(found).toEqual([
      {
        kind: "foreign key",
        name: "fk_sso_handle",
        table: "sso__links",
        owner: 'plugin "sso", referencing column "users.fx_handle"',
      },
    ]);
  });

  it("does not take a recorded index for described because a key on its table has its name", async () => {
    const found = await find(
      [
        row({}),
        row({
          tableName: "users",
          elementKind: "column",
          elementName: "fx_handle",
        }),
      ],
      sources({
        extension: schema({
          specs: [
            {
              name: "users",
              columns: [],
              foreignKeys: [
                {
                  name: "users_handle",
                  columns: ["org_id"],
                  referencesTable: "orgs",
                  referencesColumns: ["id"],
                },
              ],
            },
          ] as unknown as ExtensionSchemaRecord["specs"],
        }),
      }),
      [
        row({
          tableName: "users",
          elementKind: "index",
          elementName: "users_handle",
          ownerId: "audit",
          migratedBy: "plugin:audit",
        }),
      ]
    );
    expect(found).toEqual([
      expect.objectContaining({
        kind: "index",
        name: "users_handle",
        owner: expect.stringContaining("cannot be read"),
      }),
    ]);
  });

  it("reads which columns a configured check uses from its expression", async () => {
    const contributed = row({
      tableName: "users",
      elementKind: "column",
      elementName: "fx_handle",
    });
    // The app's checks on its own table, recorded as element rows too.
    const recordedCheck = (name: string) =>
      row({
        tableName: "users",
        elementKind: "check",
        elementName: name,
        ownerKind: "app",
        ownerId: "app",
        migratedBy: "app",
      });
    const found = await find(
      [row({}), contributed],
      sources({
        extension: schema({
          specs: [
            {
              name: "users",
              columns: [],
              checks: [
                { name: "ck_users_price", sql: '"price" >= 0' },
                // CONTROL: one naming the contributed column counts.
                { name: "ck_users_handle", sql: "length(`FX_HANDLE`) > 2" },
              ],
            },
          ] as unknown as ExtensionSchemaRecord["specs"],
        }),
      }),
      [recordedCheck("ck_users_price"), recordedCheck("ck_users_handle")]
    );
    expect(found).toEqual([
      {
        kind: "check",
        name: "ck_users_handle",
        table: "users",
        owner: expect.stringContaining(
          'the app, whose expression names column "fx_handle"'
        ),
      },
    ]);
  });

  it("describes the check an enum column contributed to the table by that column", async () => {
    const tier = { name: "tier", enumValues: ["a", "b"], contributedBy: SSO };
    const found = await find(
      [
        row({}),
        row({
          tableName: "users",
          elementKind: "column",
          elementName: "fx_handle",
        }),
      ],
      sources({
        extension: schema({
          entityColumns: new Map([
            ["users", [tier]],
          ]) as unknown as ExtensionSchemaRecord["entityColumns"],
        }),
      }),
      [
        row({
          tableName: "users",
          elementKind: "check",
          elementName: enumCheckName("users", tier),
          ownerId: "sso",
          migratedBy: "plugin:sso",
        }),
      ]
    );
    expect(found).toEqual([]);
  });

  it("reads an expression index and a partial index by the columns their SQL names", async () => {
    const found = await find(
      [
        row({}),
        row({
          tableName: "users",
          elementKind: "column",
          elementName: "fx_handle",
        }),
      ],
      sources({
        extension: schema({
          entityIndexes: new Map([
            [
              "users",
              [
                {
                  name: "idx_users_handle_lower",
                  columns: [],
                  unique: false,
                  expression: 'lower("fx_handle")',
                },
                // CONTROL: an expression over another column does not.
                {
                  name: "idx_users_email_lower",
                  columns: [],
                  unique: false,
                  expression: 'lower("email")',
                },
              ],
            ],
          ]) as ExtensionSchemaRecord["entityIndexes"],
          specs: [
            {
              name: "users",
              columns: [],
              indexes: [
                {
                  name: "idx_users_org_handled",
                  columns: ["org_id"],
                  unique: false,
                  where: "fx_handle IS NOT NULL",
                },
              ],
            },
          ] as unknown as ExtensionSchemaRecord["specs"],
        }),
      }),
      [
        row({
          tableName: "users",
          elementKind: "index",
          elementName: "idx_users_handle_lower",
          ownerKind: "app",
          ownerId: "app",
          migratedBy: "app",
        }),
      ]
    );
    expect(found.map(dependent => dependent.name).sort()).toEqual([
      "idx_users_handle_lower",
      "idx_users_org_handled",
    ]);
  });

  it("names an entity index declared without a name as the compiler does", async () => {
    const onEmail = { columns: ["email"], unique: false };
    const onHandle = { columns: ["fx_handle"], unique: true };
    const recordedIndex = (name: string) =>
      row({
        tableName: "users",
        elementKind: "index",
        elementName: name,
        ownerKind: "app",
        ownerId: "app",
        migratedBy: "app",
      });
    const found = await find(
      [
        row({}),
        row({
          tableName: "users",
          elementKind: "column",
          elementName: "fx_handle",
        }),
      ],
      sources({
        extension: schema({
          entityIndexes: new Map([
            ["users", [onEmail, onHandle]],
          ]) as ExtensionSchemaRecord["entityIndexes"],
        }),
      }),
      [
        recordedIndex(resolveIndexName("users", onEmail)),
        recordedIndex(resolveIndexName("users", onHandle)),
      ]
    );
    // The index on another column is described, and is no reason to refuse;
    // CONTROL: the one on the contributed column counts, by its derived name.
    expect(found).toEqual([
      expect.objectContaining({
        kind: "index",
        name: resolveIndexName("users", onHandle),
        owner: expect.stringContaining('using column "fx_handle"'),
      }),
    ]);
  });

  it("finds a live foreign key into its table whose declaration is gone", async () => {
    const live = (table: string, name: string, referencesTable: string) => ({
      table,
      name,
      referencesTable,
      referencesColumns: ["id"],
    });
    const found = await find(
      [row({})],
      sources({ extension: schema() }),
      [
        // Recorded as sso's, which no longer declares it.
        row({
          tableName: "sso__links",
          elementKind: "fk",
          elementName: "fk_sso_note",
          ownerId: "sso",
          migratedBy: "plugin:sso",
        }),
        // CONTROL: one recorded as fx's own goes with it.
        row({
          tableName: "fx__tags",
          elementKind: "fk",
          elementName: "fk_fx_tag_note",
        }),
      ],
      keysOn([
        live("sso__links", "fk_sso_note", "fx__notes"),
        // Nothing records it at all.
        live("app_links", "FK_APP_NOTE", "FX__NOTES"),
        live("fx__tags", "fk_fx_tag_note", "fx__notes"),
        // CONTROL: one on its own table goes with the table, and one into
        // another table is not this uninstall's.
        live("fx__notes", "fk_fx_self", "fx__notes"),
        live("app_links", "fk_app_user", "users"),
      ])
    );
    expect(found).toEqual([
      {
        kind: "foreign key",
        name: "fk_sso_note",
        table: "sso__links",
        owner: 'plugin "sso", which no longer declares it',
      },
      {
        kind: "foreign key",
        name: "FK_APP_NOTE",
        table: "app_links",
        owner: expect.stringContaining("an owner nothing records"),
      },
    ]);
  });

  it("finds a live foreign key referencing a column it contributed, and reads a declared one once", async () => {
    const found = await find(
      [
        row({}),
        row({
          tableName: "users",
          elementKind: "column",
          elementName: "fx_handle",
        }),
      ],
      sources({
        extension: schema({
          specs: [
            {
              name: "sso__links",
              columns: [],
              foreignKeys: [
                {
                  name: "fk_sso_handle",
                  columns: ["handle"],
                  referencesTable: "users",
                  referencesColumns: ["fx_handle"],
                },
              ],
            },
          ] as unknown as ExtensionSchemaRecord["specs"],
          owners: new Map([["sso__links", SSO]]),
        }),
      }),
      [],
      keysOn([
        {
          table: "app_links",
          name: "fk_app_handle",
          referencesTable: "users",
          referencesColumns: ["FX_HANDLE"],
        },
        {
          table: "sso__links",
          name: "fk_sso_handle",
          referencesTable: "users",
          referencesColumns: ["fx_handle"],
        },
      ])
    );
    expect(found.map(dependent => dependent.name)).toEqual([
      "fk_sso_handle",
      "fk_app_handle",
    ]);
    // The declared key keeps its declared owner.
    expect(found[0]?.owner).toContain('plugin "sso"');
  });

  it("judges a declared index and check by the definitions the database holds for them", async () => {
    // sso changed both declarations in code and never migrated: the
    // database's index and check still use the column fx contributed.
    const users = {
      name: "users",
      columns: [],
      indexes: [
        { name: "users_lookup", columns: ["email"], unique: false },
        { name: "users_email", columns: ["email"], unique: false },
      ],
      checks: [{ name: "ck_users_lookup", sql: "email <> ''" }],
    };
    const found = await find(
      [
        row({}),
        row({
          tableName: "users",
          elementKind: "column",
          elementName: "fx_handle",
        }),
      ],
      sources({
        extension: schema({
          specs: [users] as unknown as ExtensionSchemaRecord["specs"],
          owners: new Map([["users", SSO]]),
        }),
      }),
      [
        row({
          tableName: "users",
          elementKind: "index",
          elementName: "users_lookup",
          ownerId: "sso",
          migratedBy: "plugin:sso",
        }),
        row({
          tableName: "users",
          elementKind: "check",
          elementName: "ck_users_lookup",
          ownerId: "sso",
          migratedBy: "plugin:sso",
        }),
      ],
      [
        {
          name: "users",
          indexes: [
            { name: "USERS_LOOKUP", columns: ["fx_handle"], unique: false },
            // CONTROL: one the database holds as declared is not counted.
            { name: "users_email", columns: ["email"], unique: false },
          ],
          foreignKeys: [],
          checks: [{ name: "ck_users_lookup", sql: "(fx_handle <> '')" }],
        },
      ]
    );
    expect(found).toEqual([
      {
        kind: "index",
        name: "users_lookup",
        table: "users",
        owner:
          'plugin "sso", which in the database still uses column "fx_handle", though its declaration does not',
      },
      {
        kind: "check",
        name: "ck_users_lookup",
        table: "users",
        owner:
          'plugin "sso", which in the database still uses column "fx_handle", though its declaration does not',
      },
    ]);
  });

  it("counts a declared index whose definition the database's catalog was not read for", async () => {
    const found = await find(
      [
        row({}),
        row({
          tableName: "users",
          elementKind: "column",
          elementName: "fx_handle",
        }),
      ],
      sources({
        extension: schema({
          specs: [
            {
              name: "users",
              columns: [],
              indexes: [
                { name: "users_lookup", columns: ["email"], unique: false },
              ],
            },
          ] as unknown as ExtensionSchemaRecord["specs"],
          owners: new Map([["users", SSO]]),
        }),
      }),
      [],
      // Its keys and checks were read; its indexes were not.
      [{ name: "users", foreignKeys: [], checks: [] }]
    );
    expect(found).toEqual([
      expect.objectContaining({
        kind: "index",
        name: "users_lookup",
        owner: expect.stringContaining("could not be read"),
      }),
    ]);
  });

  it("finds a live key its declaration names whose declaration references another table or column", async () => {
    const key = (
      name: string,
      references: [string, string]
    ): Record<string, unknown> => ({
      name,
      columns: ["ref"],
      referencesTable: references[0],
      referencesColumns: [references[1]],
    });
    const spec = (name: string, fk: Record<string, unknown>) => ({
      name,
      columns: [],
      foreignKeys: [fk],
    });
    const found = await find(
      [
        row({}),
        row({
          tableName: "users",
          elementKind: "column",
          elementName: "fx_handle",
        }),
      ],
      sources({
        extension: schema({
          specs: [
            // Retargeted in code to its own table, never migrated.
            spec("sso__links", key("fk_sso_note", ["sso__targets", "id"])),
            // Retargeted in code to another column of users.
            spec("sso__handles", key("fk_sso_handle", ["users", "email"])),
            // CONTROL: declared as the database holds it, found once.
            spec("sso__refs", key("fk_sso_ref", ["fx__notes", "id"])),
          ] as unknown as ExtensionSchemaRecord["specs"],
          owners: new Map([
            ["sso__links", SSO],
            ["sso__handles", SSO],
            ["sso__refs", SSO],
          ]),
        }),
      }),
      [],
      keysOn([
        {
          table: "sso__links",
          name: "fk_sso_note",
          referencesTable: "fx__notes",
          referencesColumns: ["id"],
        },
        {
          table: "sso__handles",
          name: "FK_SSO_HANDLE",
          referencesTable: "users",
          referencesColumns: ["fx_handle"],
        },
        {
          table: "sso__refs",
          name: "fk_sso_ref",
          referencesTable: "fx__notes",
          referencesColumns: ["id"],
        },
      ])
    );
    expect(found).toEqual([
      expect.objectContaining({ name: "fk_sso_ref", owner: 'plugin "sso"' }),
      {
        kind: "foreign key",
        name: "fk_sso_note",
        table: "sso__links",
        owner:
          'plugin "sso", declared to reference "sso__targets" (id), while the key the database holds references "fx__notes" (id)',
      },
      {
        kind: "foreign key",
        name: "FK_SSO_HANDLE",
        table: "sso__handles",
        owner:
          'plugin "sso", declared to reference "users" (email), while the key the database holds references "users" (fx_handle)',
      },
    ]);
  });

  it("CONTROL: never counts the plugin's own schema", async () => {
    const found = await find(
      [
        row({}),
        row({
          tableName: "users",
          elementKind: "column",
          elementName: "fx_handle",
        }),
      ],
      sources({
        extension: schema({
          entityIndexes: new Map([
            [
              "users",
              [
                {
                  name: "idx_fx_own",
                  columns: ["fx_handle"],
                  unique: false,
                  contributedBy: FX,
                },
              ],
            ],
          ]) as ExtensionSchemaRecord["entityIndexes"],
        }),
        fields: [
          {
            entityType: "collection",
            entitySlug: "fx-notes",
            fields: [
              { name: "self", type: "relationship", relationTo: "fx-notes" },
            ],
          },
        ],
      }),
      [
        row({
          tableName: "users",
          elementKind: "index",
          elementName: "idx_fx_own",
        }),
      ]
    );
    expect(found).toEqual([]);
  });
});

describe("what the plugin owns", () => {
  it("names a collection by the slug a host renamed it to", async () => {
    const own = await pluginEntities({
      name: "fx",
      version: "1.0.0",
      contributes: { collections: [{ slug: "notes", fields: [] }] },
      renameMap: { notes: "site_notes" },
    } as unknown as PluginDefinition);
    expect(own.collectionSlugs).toEqual(["site_notes"]);
    expect(own.collectionSlugForTable("dc_site_notes")).toBe("site_notes");
    expect(own.collectionSlugForTable("dc_notes")).toBeNull();
  });

  it("does not count a field of its own Single that points at its own collection", async () => {
    const found = await findUninstallDependents({
      pluginName: "fx",
      owned: [row({})],
      collectionSlugs: ["fx-notes"],
      collectionSlugForTable: table =>
        table === "fx__notes" ? "fx-notes" : null,
      ownEntities: { single: ["fx-settings"], fieldGroup: [] },
      sources: sources({
        fields: [
          {
            entityType: "single",
            entitySlug: "fx-settings",
            fields: [
              {
                name: "featured",
                type: "relationship",
                relationTo: "fx-notes",
              },
            ],
          },
        ],
      }),
      recordedRowsOn: () => Promise.resolve([]),
      liveSchema: () => Promise.resolve([]),
    });
    expect(found).toEqual([]);
  });

  it("names a field group by the slug a host renamed it to, and does not count its fields", async () => {
    const own = await pluginEntities({
      name: "fx",
      version: "1.0.0",
      contributes: {
        collections: [{ slug: "fx-notes", fields: [] }],
        fieldGroups: [{ slug: "note-card", fields: [] }],
      },
      renameMap: { "note-card": "site-note-card" },
    } as unknown as PluginDefinition);
    expect(own.fieldGroup).toEqual(["site-note-card"]);

    const found = await findUninstallDependents({
      pluginName: "fx",
      owned: [row({})],
      collectionSlugs: ["fx-notes"],
      collectionSlugForTable: table =>
        table === "fx__notes" ? "fx-notes" : null,
      ownEntities: own,
      sources: sources({
        fields: [
          {
            entityType: "fieldGroup",
            entitySlug: "site-note-card",
            fields: [
              { name: "note", type: "relationship", relationTo: "fx-notes" },
            ],
          },
          // CONTROL: the slug it was declared under is not its own once
          // renamed, so a group stored under it counts.
          {
            entityType: "fieldGroup",
            entitySlug: "note-card",
            fields: [
              { name: "note", type: "relationship", relationTo: "fx-notes" },
            ],
          },
        ],
      }),
      recordedRowsOn: () => Promise.resolve([]),
      liveSchema: () => Promise.resolve([]),
    });
    expect(found).toEqual([
      expect.objectContaining({
        kind: "relationship field",
        table: 'fieldGroup "note-card"',
      }),
    ]);
  });

  it("does not count a relationship field its extend added to another owner's entity", async () => {
    const own = await pluginEntities({
      name: "fx",
      version: "1.0.0",
      contributes: {
        collections: [{ slug: "fx-notes", fields: [] }],
        extend: [
          {
            target: "posts",
            fields: [
              {
                name: "fxNote",
                type: "group",
                fields: [
                  {
                    name: "pick",
                    type: "relationship",
                    relationTo: "fx-notes",
                  },
                ],
              },
            ],
          },
        ],
      },
    } as unknown as PluginDefinition);

    const found = await findUninstallDependents({
      pluginName: "fx",
      owned: [row({})],
      collectionSlugs: ["fx-notes"],
      collectionSlugForTable: table =>
        table === "fx__notes" ? "fx-notes" : null,
      ownEntities: own,
      sources: sources({
        fields: [
          {
            entityType: "collection",
            entitySlug: "posts",
            fields: [
              {
                name: "fxNote",
                type: "group",
                fields: [
                  {
                    name: "pick",
                    type: "relationship",
                    relationTo: "fx-notes",
                  },
                ],
              },
              // CONTROL: the app's own field on the same entity still counts.
              { name: "appNote", type: "relationship", relationTo: "fx-notes" },
            ],
          },
        ],
      }),
      recordedRowsOn: () => Promise.resolve([]),
      liveSchema: () => Promise.resolve([]),
    });
    expect(found).toEqual([
      expect.objectContaining({ kind: "relationship field", name: "appNote" }),
    ]);
  });

  it("does not count a relationship field its transform added to another owner's entity", async () => {
    // As the fold's ownership ledgers record it: fx's transform added
    // `fxNote` to the app's `posts`, and sso's added `ssoNote`.
    const own = await pluginEntities(
      {
        name: "fx",
        version: "1.0.0",
        contributes: { collections: [{ slug: "fx-notes", fields: [] }] },
      } as unknown as PluginDefinition,
      new Map([
        [
          "posts",
          new Map([
            ["fxNote", "fx"],
            ["ssoNote", "sso"],
          ]),
        ],
      ])
    );

    const found = await findUninstallDependents({
      pluginName: "fx",
      owned: [row({})],
      collectionSlugs: ["fx-notes"],
      collectionSlugForTable: table =>
        table === "fx__notes" ? "fx-notes" : null,
      ownEntities: own,
      sources: sources({
        fields: [
          {
            entityType: "collection",
            entitySlug: "posts",
            fields: [
              { name: "fxNote", type: "relationship", relationTo: "fx-notes" },
              // CONTROL: another plugin's field still counts.
              { name: "ssoNote", type: "relationship", relationTo: "fx-notes" },
            ],
          },
        ],
      }),
      recordedRowsOn: () => Promise.resolve([]),
      liveSchema: () => Promise.resolve([]),
    });
    expect(found).toEqual([
      expect.objectContaining({ kind: "relationship field", name: "ssoNote" }),
    ]);
  });

  it("does not count a relationship field its transform put inside another owner's group", async () => {
    // As the fold's ownership ledgers record it: fx's transform nested
    // `fxNote` in the app's `settings` group, which stays the app's.
    const own = await pluginEntities(
      {
        name: "fx",
        version: "1.0.0",
        contributes: { collections: [{ slug: "fx-notes", fields: [] }] },
      } as unknown as PluginDefinition,
      new Map([["posts", new Map([["settings.fxNote", "fx"]])]])
    );

    const found = await findUninstallDependents({
      pluginName: "fx",
      owned: [row({})],
      collectionSlugs: ["fx-notes"],
      collectionSlugForTable: table =>
        table === "fx__notes" ? "fx-notes" : null,
      ownEntities: own,
      sources: sources({
        fields: [
          {
            entityType: "collection",
            entitySlug: "posts",
            fields: [
              {
                name: "settings",
                type: "group",
                fields: [
                  {
                    name: "fxNote",
                    type: "relationship",
                    relationTo: "fx-notes",
                  },
                  // CONTROL: the app's own field in the same group counts.
                  {
                    name: "appNote",
                    type: "relationship",
                    relationTo: "fx-notes",
                  },
                ],
              },
            ],
          },
        ],
      }),
      recordedRowsOn: () => Promise.resolve([]),
      liveSchema: () => Promise.resolve([]),
    });
    expect(found).toEqual([
      expect.objectContaining({
        kind: "relationship field",
        name: "settings.appNote",
      }),
    ]);
  });
});

describe("relations pointing into the plugin's tables", () => {
  const edge = (key: string, targetTable: string) => ({
    key,
    kind: "one" as const,
    fromColumn: `${key}Id`,
    targetTable,
  });

  it("finds a relation another owner declares into its table, and names who added one to a third table", async () => {
    const found = await find(
      [row({})],
      sources({
        extension: schema({
          relations: new Map([
            ["sso__links", [edge("note", "fx__notes")]],
            // The app's table, carrying a relation sso added to it.
            ["app_pages", [edge("pinned", "fx__notes")]],
            // CONTROL: fx's own edge between its own tables, and an edge
            // elsewhere, go with it or are not its business.
            ["fx__notes", [edge("parent", "fx__notes")]],
            ["sso__other", [edge("user", "users")]],
          ]),
          tables: [
            {
              name: "app_pages",
              relations: [
                {
                  name: "pinned",
                  kind: "one",
                  targetTable: "fx__notes",
                  contributedBy: SSO,
                },
              ],
            },
          ] as unknown as ExtensionSchemaRecord["tables"],
          owners: new Map([
            ["sso__links", SSO],
            ["sso__other", SSO],
            ["app_pages", { kind: "app" as const }],
            ["fx__notes", FX],
          ]),
        }),
      })
    );
    expect(found).toEqual([
      {
        kind: "relation",
        name: "note",
        table: "sso__links",
        owner: 'plugin "sso"',
      },
      {
        kind: "relation",
        name: "pinned",
        table: "app_pages",
        owner: 'plugin "sso"',
      },
    ]);
  });

  it("finds a disabled plugin's relation, compiled as boot compiles it, and the full uninstall is refused", async () => {
    const notes = defineTable("notes", { id: col.id() });
    const links = defineTable("links", {
      id: col.id(),
      noteId: col.ref("fx__notes"),
    });
    const plugins = [
      definePlugin({
        name: "fx",
        version: "1.0.0",
        nextly: "*",
        contributes: { schema: { prefix: "fx", tables: [notes] } },
      }),
      definePlugin({
        name: "sso",
        version: "1.0.0",
        nextly: "*",
        enabled: false,
        optionalDependsOn: { fx: "*" },
        contributes: { schema: { prefix: "sso", tables: [links] } },
      }),
    ];
    const compiled = await compileExtensionSchema({
      dialect: "sqlite",
      plugins,
      config: {},
      logger: { warn: () => {} },
    });
    const found = await find(
      [row({})],
      sources({ extension: compiled ?? null })
    );
    expect(found).toEqual([
      {
        kind: "relation",
        name: "note",
        table: "sso__links",
        owner: 'plugin "sso"',
      },
    ]);
    // An optional dependency of a disabled plugin is no requirement the
    // dependency check refuses on, so the relation is what stops it.
    const refused = (() => {
      try {
        planUninstall({
          pluginName: "fx",
          enabled: [{ name: "fx", dependsOn: [] }],
          disabled: [{ name: "sso", requires: [] }],
          owned: [row({})],
          dependents: found,
          modules: [{ name: "001", reversible: true }],
          keepData: false,
        });
      } catch (error) {
        return error instanceof NextlyError ? error.publicMessage : error;
      }
      return "planned";
    })();
    expect(String(refused)).toMatch(/relation "note" on sso__links/);
  });
});
