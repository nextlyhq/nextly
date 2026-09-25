/**
 * A DROP naming more than one table must be judged on ALL of them.
 *
 * `DROP TABLE a, b` is one statement and two tables. The parser read only the
 * first, so a module entitled to drop `a` could take `b` with it — belonging
 * to another stream, with the guard approving the statement because the name
 * it looked at was the legitimate one. The repository's own integration setup
 * writes comma-separated drops, so this shape is not hypothetical.
 */
import { describe, expect, it } from "vitest";

import { assertNoForeignDrops, tablesDroppedBy } from "../drop-guard";
import type { OwnerRecord } from "../owner-registry";

const owners = new Map<string, OwnerRecord>([
  [
    "app_notes",
    {
      tableName: "app_notes",
      ownerKind: "app",
      ownerId: "app",
      migratedBy: "app",
      ownerVersion: null,
      schemaVersion: null,
      state: "active",
    },
  ],
]);

describe("tablesDroppedBy", () => {
  it("names every table in a comma-separated drop", () => {
    expect(
      tablesDroppedBy(["DROP TABLE IF EXISTS fx__notes, app_notes"])
    ).toEqual(["fx__notes", "app_notes"]);
  });

  it("still reads a single drop, with its qualifier and quotes", () => {
    // The control: the common shape has to keep working.
    expect(tablesDroppedBy(['DROP TABLE "public"."fx__notes"'])).toEqual([
      "fx__notes",
    ]);
  });

  it("drops the CASCADE / RESTRICT tail rather than reading it as a table", () => {
    expect(tablesDroppedBy(["DROP TABLE fx__notes CASCADE;"])).toEqual([
      "fx__notes",
    ]);
  });
});

describe("assertNoForeignDrops", () => {
  it("refuses a multi-target drop that takes a foreign table with it", () => {
    expect(() =>
      assertNoForeignDrops({
        statements: ["DROP TABLE fx__notes, app_notes"],
        stream: "plugin:fx",
        owners,
        source: "plugin:fx/001",
      })
    ).toThrow(/different owner/i);
  });

  it("allows a multi-target drop of tables this stream owns", () => {
    // The control. A guard that refused every multi-target statement would
    // pass the case above while breaking legitimate migrations.
    expect(() =>
      assertNoForeignDrops({
        statements: ["DROP TABLE fx__notes, fx__tags"],
        stream: "plugin:fx",
        owners,
        source: "plugin:fx/001",
      })
    ).not.toThrow();
  });
});
