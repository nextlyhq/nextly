/**
 * Which element owner rows are retired: only those whose element is gone from
 * both the config and the database.
 */
import { describe, expect, it } from "vitest";

import type { OwnerRecord } from "../owner-registry";
import { retiredElementRows } from "../retired-elements";

function row(
  kind: "table" | "column" | "index",
  name: string,
  table = "fx__notes"
): OwnerRecord {
  return {
    tableName: table,
    elementKind: kind,
    elementName: kind === "table" ? "" : name,
    ownerKind: "app",
    ownerId: "app",
    migratedBy: "app",
    ownerVersion: null,
    schemaVersion: null,
    state: "active",
  };
}

const liveWith = (columns: string[], indexes?: string[]) => ({
  tables: [
    {
      name: "fx__notes",
      columns: columns.map(name => ({ name, type: "text", nullable: true })),
      ...(indexes !== undefined
        ? {
            indexes: indexes.map(name => ({
              name,
              columns: [],
              unique: false,
            })),
          }
        : {}),
    },
  ],
});

describe("retiredElementRows", () => {
  it("retires an element gone from both config and database", () => {
    const stale = row("column", "app_ref");
    expect(
      retiredElementRows({
        rows: [stale],
        declared: new Map(),
        live: liveWith(["id"]),
      })
    ).toEqual([stale]);
  });

  it("keeps an element the config still declares, even before it exists", () => {
    // A migration still to run: the row is already true.
    expect(
      retiredElementRows({
        rows: [row("column", "app_ref")],
        declared: new Map([
          ["fx__notes", [{ elementKind: "column", elementName: "app_ref" }]],
        ]),
        live: liveWith(["id"]),
      })
    ).toEqual([]);
  });

  it("keeps an undeclared element that still exists in the database", () => {
    // A drop still to run: stripping the row now would hand the live element
    // to the table owner's reconcile as if it were the owner's.
    expect(
      retiredElementRows({
        rows: [row("column", "app_ref")],
        declared: new Map(),
        live: liveWith(["id", "app_ref"]),
      })
    ).toEqual([]);
  });

  it("keeps a row whose kind the live side did not track", () => {
    expect(
      retiredElementRows({
        rows: [row("index", "idx_fx_notes_app")],
        declared: new Map(),
        live: liveWith(["id"]),
      })
    ).toEqual([]);
  });

  it("retires an element whose table is gone", () => {
    const stale = row("column", "app_ref", "fx__gone");
    expect(
      retiredElementRows({
        rows: [stale],
        declared: new Map(),
        live: liveWith(["id"]),
      })
    ).toEqual([stale]);
  });

  it("never retires a table-level row", () => {
    expect(
      retiredElementRows({
        rows: [row("table", "")],
        declared: new Map(),
        live: { tables: [] },
      })
    ).toEqual([]);
  });
});
