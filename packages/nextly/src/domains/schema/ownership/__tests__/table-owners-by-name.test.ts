/**
 * The drop guard must see who owns the TABLE, not who owns an element on it.
 *
 * Ownership became element-granular, so one table carries a row for itself and
 * a row for every column or index another owner contributed — all sharing a
 * `tableName`. Both drop checks built their map keyed by that name alone, so
 * the last row read won. An app element on a plugin's table therefore made the
 * map say the table was app-owned, and an app migration was allowed to drop a
 * plugin's table and its data.
 */
import { describe, expect, it } from "vitest";

import type { OwnerRecord } from "../owner-registry";
import { tableOwnersByName } from "../schema-owners-repository";

const base = {
  migratedBy: "x",
  ownerVersion: null,
  schemaVersion: null,
  state: "active" as const,
};

const tableRow: OwnerRecord = {
  ...base,
  tableName: "fx__notes",
  elementKind: "table",
  elementName: "",
  ownerKind: "plugin",
  ownerId: "@acme/fx",
};

/** The app adding a column to the plugin's table — read AFTER the table row. */
const elementRow: OwnerRecord = {
  ...base,
  tableName: "fx__notes",
  elementKind: "column",
  elementName: "app_note",
  ownerKind: "app",
  ownerId: "app",
};

describe("the owner the drop guard reads", () => {
  it("is the TABLE's owner, whatever elements follow it", () => {
    const owners = tableOwnersByName([tableRow, elementRow]);
    expect(owners.get("fx__notes")?.ownerKind).toBe("plugin");
    expect(owners.get("fx__notes")?.ownerId).toBe("@acme/fx");
  });

  it("is the same whichever order the rows arrive in", () => {
    // The defect was order-dependent, so a test fixing one order proves half.
    const owners = tableOwnersByName([elementRow, tableRow]);
    expect(owners.get("fx__notes")?.ownerKind).toBe("plugin");
  });

  it("treats a row with no elementKind as the table's own", () => {
    // Rows written before the registry became element-granular carry none,
    // and they are exactly the table-level claims.
    const legacy = { ...tableRow, elementKind: undefined } as OwnerRecord;
    expect(tableOwnersByName([legacy]).get("fx__notes")?.ownerKind).toBe(
      "plugin"
    );
  });

  it("claims nothing for a table with only element rows", () => {
    // The control. An element row says who may change that element, never who
    // owns the table — and a table with no owner row is never dropped.
    expect(tableOwnersByName([elementRow]).has("fx__notes")).toBe(false);
  });
});
