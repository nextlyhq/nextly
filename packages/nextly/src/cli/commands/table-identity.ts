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
 *   beyond reading the table. It is kept through a rename and `TRUNCATE`; a
 *   table rebuilt by a copying `ALTER` reads as another table. Its resolution
 *   is a second, so a replacement created within the second its original was
 *   cannot be told apart. The exact identifier, InnoDB's `TABLE_ID`, needs
 *   the PROCESS privilege and changes on `TRUNCATE`.
 * - SQLite: the table's root page (`sqlite_master.rootpage`), kept through a
 *   rename, an added column and deleted rows. `VACUUM` renumbers it, and a
 *   table dropped and created again may be given the page it freed.
 *
 * Every gap is either a table read as another one, which a caller refuses
 * on, or a replacement where nothing of the original survives.
 *
 * @module cli/commands/table-identity
 */
import type { SupportedDialect } from "@nextlyhq/adapter-drizzle/types";
import { sql } from "drizzle-orm";

interface PgMysqlExecute {
  execute(query: unknown): Promise<unknown>;
}

interface SqliteAll {
  all(query: unknown): unknown[] | Promise<unknown[]>;
}

/**
 * Each of `tables` that exists, with its identity token; null where the
 * catalog reports the table but no identity for it. A table that does not
 * exist is absent. Names are matched without regard to case, as the uninstall
 * checks read them.
 */
export async function readTableIdentities(
  db: unknown,
  dialect: SupportedDialect,
  tables: readonly string[]
): Promise<ReadonlyMap<string, string | null>> {
  const names = [...new Set(tables)];
  if (names.length === 0) return new Map();
  const found = await identitiesByLoweredName(db, dialect, names);
  const out = new Map<string, string | null>();
  for (const table of names) {
    const identity = found.get(table.toLowerCase());
    if (identity !== undefined) out.set(table, identity);
  }
  return out;
}

/** The catalog's rows for `names`, keyed by lower-cased table name. */
async function identitiesByLoweredName(
  db: unknown,
  dialect: SupportedDialect,
  names: readonly string[]
): Promise<Map<string, string | null>> {
  const rows =
    dialect === "postgresql"
      ? await postgresRows(db, names)
      : dialect === "mysql"
        ? await mysqlRows(db, names)
        : await sqliteRows(db, names);
  return new Map(rows.map(row => [row.name.toLowerCase(), row.identity]));
}

interface IdentityRow {
  name: string;
  identity: string | null;
}

/**
 * The oid each name resolves to, as an unqualified statement resolves it,
 * wherever on the search path that is. Only ordinary and partitioned tables:
 * a view or sequence of the name is not a table a DOWN drops.
 */
async function postgresRows(
  db: unknown,
  names: readonly string[]
): Promise<IdentityRow[]> {
  const values = sql.join(
    names.map(name => sql`(${name}::text)`),
    sql`, `
  );
  const result = (await (db as PgMysqlExecute).execute(
    sql`SELECT n.name, c.oid::text AS identity
        FROM (VALUES ${values}) AS n(name)
        JOIN pg_class c ON c.oid = to_regclass(quote_ident(n.name))
        WHERE c.relkind IN ('r', 'p')`
  )) as { rows: Array<{ name: string; identity: string | null }> };
  return result.rows.map(row => ({
    name: row.name,
    identity: row.identity ?? null,
  }));
}

/** Each base table's creation time in the current database. */
async function mysqlRows(
  db: unknown,
  names: readonly string[]
): Promise<IdentityRow[]> {
  const namesIn = sql.join(
    names.map(name => sql`${name.toLowerCase()}`),
    sql`, `
  );
  const result = await (db as PgMysqlExecute).execute(
    sql`SELECT TABLE_NAME AS name, CREATE_TIME AS created
        FROM information_schema.TABLES
        WHERE TABLE_SCHEMA = DATABASE()
          AND TABLE_TYPE = 'BASE TABLE'
          AND LOWER(TABLE_NAME) IN (${namesIn})`
  );
  // mysql2 answers `[rows, fieldPackets]`; a wrapper may hand the rows alone.
  const rows: unknown[] = Array.isArray(result)
    ? Array.isArray(result[0])
      ? (result[0] as unknown[])
      : result
    : [];
  return rows.flatMap(row => {
    const { name, created } = (row ?? {}) as Record<string, unknown>;
    if (typeof name !== "string") return [];
    return [{ name, identity: timeToken(created) }];
  });
}

/** A creation time as a comparable token: the driver may give a Date or text. */
function timeToken(value: unknown): string | null {
  if (value instanceof Date) {
    return Number.isNaN(value.getTime()) ? null : value.toISOString();
  }
  return typeof value === "string" && value !== "" ? value : null;
}

/** Each table's root page. */
async function sqliteRows(
  db: unknown,
  names: readonly string[]
): Promise<IdentityRow[]> {
  const namesIn = sql.join(
    names.map(name => sql`${name.toLowerCase()}`),
    sql`, `
  );
  const rows: unknown = await Promise.resolve(
    (db as SqliteAll).all(
      sql`SELECT name, rootpage FROM sqlite_master
          WHERE type = 'table' AND lower(name) IN (${namesIn})`
    )
  );
  return (Array.isArray(rows) ? rows : []).flatMap((row: unknown) => {
    const { name, rootpage } = (row ?? {}) as Record<string, unknown>;
    if (typeof name !== "string") return [];
    return [
      {
        name,
        identity:
          typeof rootpage === "number" && rootpage > 0
            ? String(rootpage)
            : null,
      },
    ];
  });
}
