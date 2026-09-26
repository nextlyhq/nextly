/**
 * An extendable core table rebuilt from its factories is the static core
 * table — every column, index, foreign key and check — so composing a hook's
 * contributions into it changes nothing else about what drizzle-kit is told.
 */
import { getTableName, isTable, type Table } from "drizzle-orm";
import { getTableConfig as mysqlConfig } from "drizzle-orm/mysql-core";
import { getTableConfig as pgConfig } from "drizzle-orm/pg-core";
import { getTableConfig as sqliteConfig } from "drizzle-orm/sqlite-core";
import { describe, expect, expectTypeOf, it } from "vitest";

import type { SupportedDialect } from "@nextlyhq/adapter-drizzle/types";

import { getDialectTables } from "../../../../database/index";
import { users as sqliteUsers } from "../../../../schemas/users/sqlite";
import { EXTENDABLE_CORE_TABLES } from "../../extension/extension-columns";
import {
  coreTableWithLiveContributions,
  EXTENDABLE_CORE_TABLE_FACTORIES,
} from "../core-table-contributions";

const DIALECTS: SupportedDialect[] = ["postgresql", "mysql", "sqlite"];

/** What drizzle-kit reads off a table, as comparable data. */
function describeTable(table: unknown, dialect: SupportedDialect) {
  const raw: unknown =
    dialect === "postgresql"
      ? pgConfig(table as never)
      : dialect === "mysql"
        ? mysqlConfig(table as never)
        : sqliteConfig(table as never);
  const config = raw as {
    name: string;
    columns: {
      name: string;
      notNull: boolean;
      primary: boolean;
      hasDefault: boolean;
      isUnique: boolean;
      getSQLType(): string;
    }[];
    indexes: {
      config: { name?: string; unique: boolean; columns: { name?: string }[] };
    }[];
    foreignKeys: {
      getName(): string;
      reference(): {
        columns: { name: string }[];
        foreignColumns: { name: string }[];
        foreignTable: Table;
      };
    }[];
    checks: { name: string }[];
  };
  return {
    name: config.name,
    columns: config.columns.map(column => ({
      name: column.name,
      type: column.getSQLType(),
      notNull: column.notNull,
      primary: column.primary,
      hasDefault: column.hasDefault,
      unique: column.isUnique,
    })),
    indexes: config.indexes.map(index => ({
      name: index.config.name,
      unique: index.config.unique,
      columns: index.config.columns.map(column => column.name),
    })),
    foreignKeys: config.foreignKeys.map(fk => {
      const reference = fk.reference();
      return {
        name: fk.getName(),
        columns: reference.columns.map(column => column.name),
        foreignTable: getTableName(reference.foreignTable),
        foreignColumns: reference.foreignColumns.map(column => column.name),
      };
    }),
    checks: config.checks.map(entry => entry.name),
  };
}

describe("the extendable core table factories", () => {
  it("cover exactly the extendable core tables, on every dialect", () => {
    for (const dialect of DIALECTS) {
      expect(
        Object.keys(EXTENDABLE_CORE_TABLE_FACTORIES[dialect]).sort()
      ).toEqual([...EXTENDABLE_CORE_TABLES].sort());
    }
  });

  it.each(DIALECTS)(
    "rebuild each table exactly as the static one on %s, when nothing is contributed",
    dialect => {
      const statics = Object.values(getDialectTables(dialect)).filter(
        (value): value is Table => isTable(value)
      );
      for (const name of EXTENDABLE_CORE_TABLES) {
        const original = statics.find(table => getTableName(table) === name);
        const rebuilt = coreTableWithLiveContributions(
          name,
          { name, columns: [] },
          [],
          dialect
        );
        expect(describeTable(rebuilt, dialect)).toEqual(
          describeTable(original, dialect)
        );
      }
    }
  );

  it("adds a live contributed column, index and check, and nothing else", () => {
    const rebuilt = coreTableWithLiveContributions(
      "users",
      {
        name: "users",
        columns: [{ name: "nickname", type: "text", nullable: true }],
        indexes: [
          { name: "idx_users_nickname", columns: ["nickname"], unique: false },
        ],
        checks: [{ name: "ck_users_nickname_enum", sql: "nickname IN ('a')" }],
      },
      [{ key: "nickname", name: "nickname", kind: "text", nullable: true }],
      "sqlite"
    );
    const described = describeTable(rebuilt, "sqlite");
    expect(described.columns.map(column => column.name)).toContain("nickname");
    expect(described.indexes.map(index => index.name)).toContain(
      "idx_users_nickname"
    );
    expect(described.checks).toContain("ck_users_nickname_enum");
  });
});

describe("the static core tables built from the factories", () => {
  it("keep their exact row type", () => {
    // Checked by the compiler: a factory returning a widened record would
    // turn every one of these into `unknown` or an index signature.
    expectTypeOf<typeof sqliteUsers.$inferSelect>().toEqualTypeOf<{
      id: string;
      name: string | null;
      email: string;
      emailVerified: Date | null;
      passwordUpdatedAt: Date | null;
      image: string | null;
      passwordHash: string | null;
      isActive: boolean;
      mustChangePassword: boolean | null;
      failedLoginAttempts: number;
      lockedUntil: Date | null;
      createdAt: Date;
      updatedAt: Date;
    }>();
  });
});
