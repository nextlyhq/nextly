/**
 * The diff does not compare a primary key's nullability.
 *
 * SQLite writes `id text PRIMARY KEY` with no NOT NULL — only INTEGER
 * PRIMARY KEY is implicitly non-null there — and reports it back as nullable,
 * while the desired side calls it required. No ALTER can settle that: SQLite
 * has no statement that adds NOT NULL to an existing column. Left in, the op
 * is produced on every reconcile, so the run never sees a clean database and
 * keeps rebuilding tables to fix something it cannot fix — and on SQLite a
 * rebuild takes the table's indexes with it.
 */
import { describe, expect, it } from "vitest";

import { diffSnapshots } from "../diff";
import type { NextlySchemaSnapshot } from "../types";

const nullableOps = (prev: NextlySchemaSnapshot, cur: NextlySchemaSnapshot) =>
  diffSnapshots(prev, cur).filter(op => op.type === "change_column_nullable");

describe("primary-key nullability is not diffed", () => {
  it("emits nothing when a live nullable primary key faces a required one", () => {
    // Exactly the SQLite shape: introspection reports the stored truth, the
    // desired side reports the intent, and they disagree forever.
    const live: NextlySchemaSnapshot = {
      tables: [
        { name: "t", columns: [{ name: "id", type: "text", nullable: true }] },
      ],
    };
    const desired: NextlySchemaSnapshot = {
      tables: [
        {
          name: "t",
          columns: [
            { name: "id", type: "text", nullable: false, primaryKey: true },
          ],
        },
      ],
    };

    expect(nullableOps(live, desired)).toEqual([]);
  });

  it("still emits for an ordinary column on the same table", () => {
    // The exemption is scoped to the primary key, not to tables that have
    // one — a real NOT NULL change beside it must survive.
    const live: NextlySchemaSnapshot = {
      tables: [
        {
          name: "t",
          columns: [
            { name: "id", type: "text", nullable: true },
            { name: "title", type: "text", nullable: true },
          ],
        },
      ],
    };
    const desired: NextlySchemaSnapshot = {
      tables: [
        {
          name: "t",
          columns: [
            { name: "id", type: "text", nullable: false, primaryKey: true },
            { name: "title", type: "text", nullable: false },
          ],
        },
      ],
    };

    expect(nullableOps(live, desired)).toEqual([
      {
        type: "change_column_nullable",
        tableName: "t",
        columnName: "title",
        fromNullable: true,
        toNullable: false,
      },
    ]);
  });

  it("emits for a column no side marks as a primary key", () => {
    // Guards against the exemption widening into "skip nullability entirely":
    // without a primaryKey marker the comparison must behave as it always did.
    const live: NextlySchemaSnapshot = {
      tables: [
        { name: "t", columns: [{ name: "id", type: "text", nullable: true }] },
      ],
    };
    const desired: NextlySchemaSnapshot = {
      tables: [
        { name: "t", columns: [{ name: "id", type: "text", nullable: false }] },
      ],
    };

    expect(nullableOps(live, desired)).toHaveLength(1);
  });
});
