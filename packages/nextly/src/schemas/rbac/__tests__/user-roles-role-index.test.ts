/**
 * `user_roles_role_id_idx`: the index the last-super-admin guard reads through.
 *
 * The guard finds the accounts holding the super-admin role inside every write
 * it judges, under that role row's lock. Without an index leading on `role_id`
 * the read scans `user_roles`: the unique index on (`user_id`, `role_id`) leads
 * on the other column and cannot serve it.
 *
 * Declared once per dialect, and in the hand-written SQLite DDL that creates
 * and tops up a development database, so each is checked here. That an
 * existing database gains it is `user-roles-role-index-upgrade.integration.test.ts`.
 */
import { getTableConfig as mysqlTableConfig } from "drizzle-orm/mysql-core";
import { getTableConfig as pgTableConfig } from "drizzle-orm/pg-core";
import { getTableConfig as sqliteTableConfig } from "drizzle-orm/sqlite-core";
import { describe, expect, it } from "vitest";

import { generateSqliteCoreTableStatements } from "../../../database/sqlite-core-tables";
import { userRoles as userRolesMysql } from "../mysql";
import { userRoles as userRolesPg } from "../postgres";
import { userRoles as userRolesSqlite } from "../sqlite";

const INDEX_NAME = "user_roles_role_id_idx";

interface IndexConfigLike {
  indexes: readonly {
    config: { name: string; unique: boolean; columns: readonly unknown[] };
  }[];
}

const dialects = [
  ["sqlite", () => sqliteTableConfig(userRolesSqlite)],
  ["postgresql", () => pgTableConfig(userRolesPg)],
  ["mysql", () => mysqlTableConfig(userRolesMysql)],
] as const;

describe.each(dialects)("%s user_roles", (_name, read) => {
  it("declares a plain index on role_id alone", () => {
    const config = read() as unknown as IndexConfigLike;
    const found = config.indexes.find(
      index => index.config.name === INDEX_NAME
    );

    expect(found).toBeDefined();
    expect(
      found?.config.columns.map(column => (column as { name: string }).name)
    ).toEqual(["role_id"]);
    // A unique index would refuse a role held by two accounts.
    expect(found?.config.unique).toBe(false);
  });
});

describe("the SQLite core DDL", () => {
  it("creates the index, idempotently, so a replay tops up an existing database", () => {
    const statement = generateSqliteCoreTableStatements().find(sql =>
      sql.includes(`"${INDEX_NAME}"`)
    );

    expect(statement?.replace(/\s+/g, " ")).toBe(
      `CREATE INDEX IF NOT EXISTS "${INDEX_NAME}" ON "user_roles" ("role_id")`
    );
  });
});
