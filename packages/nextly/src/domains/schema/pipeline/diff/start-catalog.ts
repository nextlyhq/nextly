/**
 * Reads a production start's catalog (`start-catalog-scope`): every relation, with the answers
 * `listTables()` and `tableExists()` would give for it, in one query, beside (on MySQL) how the
 * server compares table names. It asks which tables exist, never their shape.
 *
 * @module domains/schema/pipeline/diff/start-catalog
 */
import type { SupportedDialect } from "@nextlyhq/adapter-drizzle/types";
import { sql } from "drizzle-orm";

import { activePostgresSchema } from "../../services/postgres-schema";
import {
  readMysqlIdentifierCaseRules,
  type RawSqlExecutor,
} from "../../utils/read-identifier-case";
import { identifierCaseRules } from "../../utils/resolve-catalog-name";

import type { StartCatalog, StartCatalogRelation } from "./start-catalog-scope";

/** Begin reading the catalog through `db`; each part is read once, together. */
export function readStartCatalog(
  db: unknown,
  dialect: SupportedDialect
): StartCatalog {
  const relations = readRelations(db, dialect);
  const caseRules =
    dialect === "mysql"
      ? readMysqlIdentifierCaseRules(db as RawSqlExecutor)
      : Promise.resolve(identifierCaseRules({ dialect }));
  // Each part is awaited by whichever question needs it, and some starts ask none of them: a
  // rejection nobody awaited would otherwise end the process.
  for (const part of [relations, caseRules]) part.catch(() => {});
  return { relations, caseRules };
}

/** A driver result's rows: PostgreSQL's `{ rows }`, mysql2's `[rows, fields]`, or the rows. */
function rowsOf<Row>(raw: unknown): Row[] {
  if (Array.isArray(raw)) {
    return (Array.isArray(raw[0]) ? raw[0] : raw) as Row[];
  }
  const rows = (raw as { rows?: unknown } | null)?.rows;
  return Array.isArray(rows) ? (rows as Row[]) : [];
}

/**
 * Every relation of the database, in one query of the catalog's table listing:
 *
 * - PostgreSQL: `information_schema.tables` outside the system schemas. Listed when a base
 *   table of the installation's schema (`public`, or the one `db.postgres.schema` names), as
 *   `listTables()` lists them; reachable when it is the relation an
 *   unqualified name resolves to, as `tableExists()` resolves it.
 * - MySQL: the current database's tables and views, every one reachable, the base tables listed.
 * - SQLite: `sqlite_master`'s tables and views. Only a table is reachable, as `tableExists()`
 *   asks of `type = 'table'`; a table is listed unless SQLite's own.
 */
async function readRelations(
  db: unknown,
  dialect: SupportedDialect
): Promise<StartCatalogRelation[]> {
  if (dialect === "postgresql") {
    const raw = await (db as { execute(q: unknown): Promise<unknown> }).execute(
      sql`SELECT table_name AS name, table_schema AS schema, table_type AS kind,
                 (format('%I.%I', table_schema, table_name)::regclass
                    = to_regclass(quote_ident(table_name))) AS reachable
          FROM information_schema.tables
          WHERE table_schema NOT IN ('pg_catalog', 'information_schema')`
    );
    return rowsOf<{
      name: string;
      schema: string;
      kind: string;
      reachable: boolean;
    }>(raw).map(row => {
      const baseTable = row.kind === "BASE TABLE";
      return {
        name: row.name,
        baseTable,
        // The installation's schema: `public`, or the one `db.postgres.schema` names.
        listed: baseTable && row.schema === activePostgresSchema(),
        reachable: row.reachable === true,
      };
    });
  }
  if (dialect === "mysql") {
    const raw = await (db as { execute(q: unknown): Promise<unknown> }).execute(
      sql`SELECT TABLE_NAME AS name, TABLE_TYPE AS kind
          FROM information_schema.tables
          WHERE TABLE_SCHEMA = DATABASE()`
    );
    return rowsOf<{ name: string; kind: string }>(raw).map(row => {
      const baseTable = row.kind === "BASE TABLE";
      return { name: row.name, baseTable, listed: baseTable, reachable: true };
    });
  }
  const raw = await Promise.resolve(
    (db as { all(q: unknown): unknown }).all(
      sql`SELECT name, type FROM sqlite_master WHERE type IN ('table', 'view')`
    )
  );
  return rowsOf<{ name: string; type: string }>(raw).map(row => {
    const baseTable = row.type === "table";
    return {
      name: row.name,
      baseTable,
      listed: baseTable && !row.name.startsWith("sqlite_"),
      reachable: baseTable,
    };
  });
}
