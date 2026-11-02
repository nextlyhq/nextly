/**
 * What a full plugin uninstall would take from other owners, found before it
 * runs: each kind with a positive case, and the plugin's own schema, which
 * goes with it, never counted.
 */
import { describe, expect, it } from "vitest";

import type { DependentsSources } from "../../../collections/services/collection-dependents";
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
  it("names a collection by the slug a host renamed it to", () => {
    const own = pluginEntities({
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
});
