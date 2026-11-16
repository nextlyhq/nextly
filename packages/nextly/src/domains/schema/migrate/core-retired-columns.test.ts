/**
 * What a core upgrade names as deleted, and the push bundle that carries a
 * retired column as the live database has it.
 */
import { getTableName, isTable } from "drizzle-orm";
import { getTableConfig as pgTableConfig } from "drizzle-orm/pg-core";
import { describe, expect, it } from "vitest";

import { loadDialectTables } from "../../../database/dialect-tables";
import { getDialectTablesForPush } from "../../../database/index";
import { isDestructive } from "../pipeline/classifier/modes";
import type { Operation } from "../pipeline/diff/types";

import {
  bundleCarryingRetiredColumns,
  coreDeletionOf,
} from "./core-retired-columns";

describe("coreDeletionOf", () => {
  const destructive: Operation[] = [
    {
      type: "drop_column",
      tableName: "dynamic_collections",
      columnName: "access_rules",
      columnType: "jsonb",
    },
    { type: "drop_table", tableName: "legacy_extra" },
    {
      type: "change_column_type",
      tableName: "users",
      columnName: "name",
      fromType: "text",
      toType: "varchar",
    },
    {
      type: "change_column_nullable",
      tableName: "users",
      columnName: "name",
      fromNullable: true,
      toNullable: false,
    },
    {
      type: "add_column",
      tableName: "users",
      column: { name: "tier", type: "text", nullable: false },
    },
    {
      type: "drop_index",
      tableName: "users",
      index: { name: "users_tier_idx", columns: ["tier"], unique: false },
    },
  ];

  it("names every change isDestructive selects as a deletion in Nextly's own tables", () => {
    for (const op of destructive) {
      expect(isDestructive(op), op.type).toBe(true);
      expect(coreDeletionOf(op).core, op.type).toBe(true);
    }
  });

  it("names a known retired column with why it goes", () => {
    expect(coreDeletionOf(destructive[0])).toEqual({
      kind: "column",
      table: "dynamic_collections",
      column: "access_rules",
      core: true,
      reason:
        "the collections' stored access rules, no longer enforced since 0.0.2-alpha.66",
    });
  });

  it("leaves a change it cannot name to the consent without targets", () => {
    expect(coreDeletionOf(destructive[5])).toMatchObject({
      kind: "unnamed",
      core: true,
      description: expect.stringContaining("users_tier_idx"),
    });
  });
});

describe("bundleCarryingRetiredColumns", () => {
  it("puts the retired column back on its table, typed with its PostgreSQL width", async () => {
    await loadDialectTables("postgresql");
    const bundle = getDialectTablesForPush("postgresql", {});
    const carried = bundleCarryingRetiredColumns(
      bundle,
      [
        {
          table: "dynamic_collections",
          column: {
            name: "legacy_code",
            type: "varchar",
            typeModifier: "40",
            nullable: false,
            default: "'x'::character varying",
          },
        },
      ],
      "postgresql"
    );

    const table = Object.values(carried).find(
      entry => isTable(entry) && getTableName(entry) === "dynamic_collections"
    );
    const column = pgTableConfig(table as never).columns.find(
      c => c.name === "legacy_code"
    );
    expect(column?.getSQLType()).toBe("varchar(40)");
    expect(column?.notNull).toBe(true);
    expect(column?.hasDefault).toBe(true);

    // The core definition itself is left as it was.
    const original = Object.values(bundle).find(
      entry => isTable(entry) && getTableName(entry) === "dynamic_collections"
    );
    expect(
      pgTableConfig(original as never).columns.map(c => c.name)
    ).not.toContain("legacy_code");
  });
});
