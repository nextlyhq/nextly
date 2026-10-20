/**
 * Which table a name reaches, as a token the database keeps for that table.
 *
 * A name alone cannot say whether the table under it is the one that was
 * there before: code that renames a table away and creates another under its
 * name leaves the name in place. Each dialect's catalog keeps something that
 * follows the table rather than the name:
 *
 * - PostgreSQL: the table's oid, the one an unqualified statement resolves
 *   the name to (`to_regclass`). It is kept through a rename, `TRUNCATE` and
 *   `ALTER TABLE`, and no table created later is given it.
 * - MySQL: `information_schema.TABLES.CREATE_TIME`, which needs no privilege
 *   beyond reading the table. It is kept through a rename and `TRUNCATE`;
 *   any `ALTER TABLE`, an added column included, sets a new one, so an
 *   altered table reads as another (measured on MySQL 8.0). Its resolution
 *   is a second, so a replacement created within the second its original was
 *   cannot be told apart. The exact identifier, InnoDB's `TABLE_ID`, needs
 *   the PROCESS privilege and changes on `TRUNCATE`.
 * - SQLite: the table's root page (`sqlite_master.rootpage`), kept through a
 *   rename, an added column and deleted rows. A page can be given again: a
 *   table dropped and created again may get the page it freed, and one
 *   created after a `VACUUM` may get the page a renamed table moved off, and
 *   the original can be renamed into a name another table held. So on
 *   SQLite a caller also needs to know whether the schema changed at all
 *   (`readSqliteSchemaVersion`).
 *
 * Every other gap is either a table read as another one, which a caller
 * refuses on, or a replacement where nothing of the original survives.
 *
 * @module cli/commands/table-identity
 */
import type { DrizzleAdapter } from "@nextlyhq/adapter-drizzle";
import type { SupportedDialect } from "@nextlyhq/adapter-drizzle/types";
import { sql } from "drizzle-orm";

import { PG_CLASS_IS_THE_RELATION_THE_WRITES_HIT } from "../../domains/schema/pipeline/pg-visible-relation";

/** What the reader needs of the adapter: one statement, its rows. */
type RowReader = Pick<DrizzleAdapter, "queryStatement">;

/**
 * Each of `tables` that exists as a table, with its identity token; null
 * where the catalog reports the table but no identity for it. A name no
 * table holds is absent, and so is one a view holds: a view is not the table
 * that was there. Names are matched as stored, as `tableExists` matches them.
 */
export async function readTableIdentities(
  adapter: RowReader,
  dialect: SupportedDialect,
  tables: readonly string[]
): Promise<ReadonlyMap<string, string | null>> {
  const names = [...new Set(tables)];
  if (names.length === 0) return new Map();
  const namesIn = sql.join(
    names.map(name => sql`${name}`),
    sql`, `
  );
  const rows = await adapter.queryStatement<Record<string, unknown>>(
    dialect === "postgresql"
      ? // The relation an unqualified statement resolves the name to,
        // wherever on the search path that is; ordinary and partitioned
        // tables only.
        sql`SELECT t.relname AS name, t.oid::text AS identity
            FROM pg_class t
            WHERE t.relkind IN ('r', 'p')
              AND t.relname IN (${namesIn})
              AND ${PG_CLASS_IS_THE_RELATION_THE_WRITES_HIT}`
      : dialect === "mysql"
        ? sql`SELECT TABLE_NAME AS name, CREATE_TIME AS identity
              FROM information_schema.TABLES
              WHERE TABLE_SCHEMA = DATABASE()
                AND TABLE_TYPE = 'BASE TABLE'
                AND TABLE_NAME IN (${namesIn})`
        : sql`SELECT name, rootpage AS identity FROM sqlite_master
              WHERE type = 'table' AND name IN (${namesIn})`
  );
  const out = new Map<string, string | null>();
  for (const { name, identity } of rows) {
    if (typeof name === "string" && names.includes(name)) {
      out.set(name, identityToken(identity));
    }
  }
  return out;
}

/**
 * A catalog value as a comparable token: an oid as text, a creation time as
 * a Date or text (the driver decides), a root page as a number. Null for a
 * value the catalog did not give, which a caller counts as changed.
 */
function identityToken(value: unknown): string | null {
  if (value instanceof Date) {
    return Number.isNaN(value.getTime()) ? null : value.toISOString();
  }
  if (typeof value === "number") return value > 0 ? String(value) : null;
  return typeof value === "string" && value !== "" ? value : null;
}

/**
 * SQLite's schema version, which every change to the schema moves, `VACUUM`
 * included, and changes to rows do not; null when it cannot be read. Stored
 * in the database file, so a change made through any connection moves it.
 */
export async function readSqliteSchemaVersion(
  adapter: RowReader
): Promise<number | null> {
  const [row] = await adapter.queryStatement<Record<string, unknown>>(
    sql`PRAGMA schema_version`
  );
  const version = row?.schema_version;
  return typeof version === "number" ? version : null;
}
