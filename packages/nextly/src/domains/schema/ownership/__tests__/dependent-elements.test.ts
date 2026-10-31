import { describe, expect, it } from "vitest";

import { indexNameForColumns } from "../../services/index-name";
import {
  elementsAddedTo,
  elementsFromOwnerRows,
  type ExtensionSchemaRecord,
} from "../dependent-elements";
import type { OwnerRecord } from "../owner-registry";

function schemaWith(
  parts: Partial<ExtensionSchemaRecord>
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

describe("elementsAddedTo", () => {
  it("names an index added to an entity table as its spec names it, explicit or derived", async () => {
    const plugin = { kind: "plugin" as const, id: "plg" };
    const schema = schemaWith({
      entityIndexes: new Map([
        [
          "dc_tags",
          [
            { columns: ["marker"], unique: false, contributedBy: plugin },
            {
              columns: ["marker", "label"],
              unique: true,
              name: "uq_tags_marker_label",
              contributedBy: { kind: "app" },
            },
          ],
        ],
      ]),
    });

    expect(await elementsAddedTo(schema, ["dc_tags"])).toEqual([
      {
        owner: plugin,
        kind: "index",
        name: indexNameForColumns("dc_tags", ["marker"], false),
        table: "dc_tags",
      },
      {
        owner: { kind: "app" },
        kind: "index",
        name: "uq_tags_marker_label",
        table: "dc_tags",
      },
    ]);
  });

  it("reads only the tables asked about", async () => {
    const schema = schemaWith({
      elementOwners: new Map([
        [
          "plg__other",
          [
            {
              elementKind: "column" as const,
              elementName: "x",
              owner: { kind: "app" as const },
            },
          ],
        ],
      ]),
    });

    expect(await elementsAddedTo(schema, ["dc_tags"])).toEqual([]);
  });
});

describe("elementsFromOwnerRows", () => {
  const row = (parts: Partial<OwnerRecord>): OwnerRecord => ({
    tableName: "dc_tags",
    ownerKind: "plugin",
    ownerId: "plg",
    migratedBy: "plugin:plg",
    ownerVersion: null,
    schemaVersion: null,
    state: "active",
    ...parts,
  });

  it("keeps element rows and drops the table-level row, naming each row's owner", () => {
    expect(
      elementsFromOwnerRows([
        row({}),
        row({ elementKind: "table", elementName: "" }),
        row({ elementKind: "column", elementName: "marker" }),
        row({
          elementKind: "fk",
          elementName: "fk_x",
          ownerKind: "app",
          ownerId: "app",
        }),
      ])
    ).toEqual([
      {
        owner: { kind: "plugin", id: "plg" },
        kind: "column",
        name: "marker",
        table: "dc_tags",
      },
      { owner: { kind: "app" }, kind: "fk", name: "fk_x", table: "dc_tags" },
    ]);
  });
});
