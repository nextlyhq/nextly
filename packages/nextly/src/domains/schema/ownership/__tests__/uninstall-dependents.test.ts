/**
 * What a full plugin uninstall would take from other owners, found before it
 * runs: each kind with a positive case, and the plugin's own schema, which
 * goes with it, never counted.
 */
import { describe, expect, it } from "vitest";

import type { DependentsSources } from "../../../collections/services/collection-dependents";
import { resolveIndexName } from "../../extension/compile";
import { enumCheckName } from "../../extension/enum-check";
import type { ExtensionSchemaRecord } from "../dependent-elements";
import type { OwnerRecord } from "../owner-registry";
import {
  findUninstallDependents,
  pluginEntities,
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

const find = (
  owned: OwnerRecord[],
  src: DependentsSources,
  recorded: OwnerRecord[] = []
) =>
  findUninstallDependents({
    pluginName: "fx",
    owned,
    collectionSlugs: ["fx-notes"],
    collectionSlugForTable: table =>
      table === "fx__notes" ? "fx-notes" : null,
    sources: src,
    recordedRowsOn: () => Promise.resolve(recorded),
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
    });
    expect(found).toEqual([
      expect.objectContaining({ kind: "relationship field", name: "appNote" }),
    ]);
  });
});
