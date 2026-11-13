/**
 * `nextly migrate` letting go of the inline UNIQUE an earlier release's Schema Builder gave a
 * one-to-one relationship, once no field makes its column unique any more.
 *
 * An earlier release created a one-to-one's column with `UNIQUE` written into the column itself,
 * which no snapshot records: a migration file cannot drop what it does not know is there, and on
 * another database (one whose tables came from migration files) the constraint does not exist at
 * all, so a file that dropped it would fail there. So each run judges its own database, once its
 * files have run: a constraint stays until the registry, with its definition applied, has no field
 * making that column unique, and then goes, so a one-to-one edited into a many-to-one takes
 * repeats, as the push already lets it.
 *
 * Only the exact shapes that release's DDL left are dropped, and only on a Builder table (registry
 * source `ui`) whose definition has reached the database (`applied`, `synced`) and on the column
 * of one of its relationships:
 *
 * - PostgreSQL: a single-column UNIQUE constraint named exactly as PostgreSQL names a column's
 *   inline one (`postgresInlineUniqueName`).
 * - MySQL: a single-column, whole-value unique index named exactly after its column, and only
 *   where another index still serves the column's foreign key.
 *
 * Anything else, a near-miss name included, is not this release's and is never dropped. SQLite
 * keeps its inline UNIQUE: only a rebuild of the table removes it, and the rebuild cannot yet
 * carry the foreign key an earlier-shaped relationship holds.
 *
 * @module domains/schema/migrate/earlier-inline-uniques
 */
import { sql } from "drizzle-orm";

import type { SupportedDialect } from "../../../database/schema-registry";
import type { FieldDefinition } from "../../../schemas/dynamic-collections";
import { builderColumnIsUnique } from "../../dynamic-collections/services/dynamic-collection-schema-service";
import { resolveLocalizedFieldNames } from "../../i18n/classify-fields";
import { querySqlRows } from "../pipeline/classifier/count-helpers";
import { dropConstraintSql } from "../pipeline/sql-templates/common-statements";
import { fieldsByColumnOf } from "../required-column-registries";

import {
  registeredEntities,
  type RegisteredEntity,
} from "./unique-column-guard";

/** What the step names itself as in its report. */
const STEP = "Letting go of earlier one-to-one uniqueness";

/** The registry statuses whose definition has reached the database. */
const REACHED_THE_DATABASE: ReadonlySet<string> = new Set([
  "applied",
  "synced",
]);

/** What the step needs: the database, and how to run a statement on it and say what it did. */
export interface EarlierInlineUniquesDeps {
  db: unknown;
  dialect: SupportedDialect;
  executeQuery: (statement: string) => Promise<unknown>;
  logger: { info(message: string): void };
}

/** An inline UNIQUE the step drops: whose column it is, and the statement that drops it. */
interface InlineUnique {
  slug: string;
  field: string;
  statement: string;
}

/** The longest name PostgreSQL stores, in bytes (`NAMEDATALEN - 1`). */
const POSTGRES_NAME_BYTES = 63;

const utf8 = new TextEncoder();

/** The first `bytes` bytes of `name`, cut back to whole characters, as `pg_mbcliplen` cuts. */
function clippedTo(name: string, bytes: number): string {
  let kept = "";
  let used = 0;
  for (const char of name) {
    used += utf8.encode(char).length;
    if (used > bytes) break;
    kept += char;
  }
  return kept;
}

/**
 * The name PostgreSQL gives a column's inline UNIQUE: `<table>_<column>_key`, made by its
 * `makeObjectName`, which, while the whole would pass 63 bytes, shortens the longer of the table
 * and the column one byte at a time before adding the suffix.
 */
export function postgresInlineUniqueName(
  table: string,
  column: string
): string {
  // `_` between the names, and `_key` after them.
  const available = POSTGRES_NAME_BYTES - "_key".length - 1;
  let tableBytes = utf8.encode(table).length;
  let columnBytes = utf8.encode(column).length;
  while (tableBytes + columnBytes > available) {
    if (tableBytes > columnBytes) tableBytes -= 1;
    else columnBytes -= 1;
  }
  return `${clippedTo(table, tableBytes)}_${clippedTo(column, columnBytes)}_key`;
}

/**
 * The column of each relationship of `registered` that is on its main table and that no field
 * makes unique (`builderColumnIsUnique`), keyed by column, lower-cased, with its field's name.
 * Undefined for an entity the step leaves alone: not a Builder table, or one whose definition has
 * not reached the database, which may still be about to make the column unique.
 */
function releasedColumns(
  registered: RegisteredEntity,
  dialect: SupportedDialect
): Map<string, string> | undefined {
  if (registered.source !== "ui") return undefined;
  if (!REACHED_THE_DATABASE.has(registered.migrationStatus)) return undefined;
  const translated = new Set(
    resolveLocalizedFieldNames(registered.fields, registered.localized)
  );
  const onMainTable = registered.fields.filter(
    f => typeof f?.name === "string" && !translated.has(f.name)
  );
  const byColumn = fieldsByColumnOf(onMainTable, dialect, false);
  const wanted = new Set([
    ...fieldsByColumnOf(
      onMainTable.filter(builderColumnIsUnique),
      dialect,
      false
    ).keys(),
  ]);
  const relationships = new Set(
    onMainTable
      .filter((f: FieldDefinition) => f.type === "relationship")
      .map(f => f.name)
  );
  return new Map(
    [...byColumn].filter(
      ([column, field]) => relationships.has(field) && !wanted.has(column)
    )
  );
}

/** The single-column UNIQUE constraints of a PostgreSQL table: each one's name and column. */
async function postgresUniqueConstraints(
  db: unknown,
  table: string
): Promise<{ name: string; column: string }[]> {
  return querySqlRows<{ name: string; column: string }>(
    db,
    "postgresql",
    sql`SELECT con.conname AS ${sql.identifier("name")}, a.attname AS ${sql.identifier("column")}
        FROM pg_constraint con
        JOIN pg_attribute a ON a.attrelid = con.conrelid AND a.attnum = con.conkey[1]
        WHERE con.contype = 'u' AND con.conrelid = to_regclass(${table})
          AND array_length(con.conkey, 1) = 1`
  );
}

/**
 * The indexes of a MySQL table, each with its columns in order and whether it is unique over
 * whole values: a prefix or an expression keys only part of what it covers.
 */
async function mysqlIndexes(
  db: unknown,
  table: string
): Promise<{ name: string; columns: string[]; uniqueWhole: boolean }[]> {
  const rows = await querySqlRows<{
    name: string;
    column: string | null;
    nonUnique: number | string;
    subPart: number | string | null;
  }>(
    db,
    "mysql",
    sql`SELECT INDEX_NAME AS ${sql.identifier("name")}, COLUMN_NAME AS ${sql.identifier("column")},
          NON_UNIQUE AS ${sql.identifier("nonUnique")}, SUB_PART AS ${sql.identifier("subPart")}
        FROM information_schema.STATISTICS
        WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ${table}
        ORDER BY INDEX_NAME, SEQ_IN_INDEX`
  );
  const byName = new Map<
    string,
    { name: string; columns: string[]; uniqueWhole: boolean }
  >();
  for (const row of rows) {
    const index = byName.get(row.name) ?? {
      name: row.name,
      columns: [],
      uniqueWhole: Number(row.nonUnique) === 0,
    };
    if (row.column === null || row.subPart !== null) index.uniqueWhole = false;
    if (row.column !== null) index.columns.push(row.column.toLowerCase());
    byName.set(row.name, index);
  }
  return [...byName.values()];
}

const quoted = (dialect: SupportedDialect) => (name: string) =>
  dialect === "mysql" ? `\`${name}\`` : `"${name}"`;

/** The inline UNIQUEs of one PostgreSQL table the step drops. */
async function postgresInlineUniques(
  db: unknown,
  table: string,
  released: ReadonlyMap<string, string>
): Promise<{ field: string; statement: string }[]> {
  return (await postgresUniqueConstraints(db, table)).flatMap(constraint => {
    const field = released.get(constraint.column.toLowerCase());
    if (
      field === undefined ||
      constraint.name !== postgresInlineUniqueName(table, constraint.column)
    ) {
      return [];
    }
    const statement = dropConstraintSql(
      table,
      constraint.name,
      "DROP CONSTRAINT",
      quoted("postgresql")
    );
    return [{ field, statement }];
  });
}

/**
 * The inline UNIQUEs of one MySQL table the step drops: each kept where no other index begins
 * with its column, since MySQL refuses to drop the last index a foreign key can use.
 */
async function mysqlInlineUniques(
  db: unknown,
  table: string,
  released: ReadonlyMap<string, string>
): Promise<{ field: string; statement: string }[]> {
  const indexes = await mysqlIndexes(db, table);
  return indexes.flatMap(index => {
    const [column] = index.columns;
    const field = column === undefined ? undefined : released.get(column);
    const inline =
      field !== undefined &&
      index.uniqueWhole &&
      index.columns.length === 1 &&
      index.name.toLowerCase() === column;
    const served = indexes.some(
      other => other.name !== index.name && other.columns[0] === column
    );
    if (!inline || !served) return [];
    const statement = dropConstraintSql(
      table,
      index.name,
      "DROP INDEX",
      quoted("mysql")
    );
    return [{ field, statement }];
  });
}

/** Every inline UNIQUE the step drops on this database. */
async function inlineUniquesToDrop(
  db: unknown,
  dialect: SupportedDialect
): Promise<InlineUnique[]> {
  if (dialect === "sqlite") return [];
  const found: InlineUnique[] = [];
  for (const registered of await registeredEntities(db, dialect)) {
    const released = releasedColumns(registered, dialect);
    if (released === undefined || released.size === 0) continue;
    const drops =
      dialect === "postgresql"
        ? await postgresInlineUniques(db, registered.table, released)
        : await mysqlInlineUniques(db, registered.table, released);
    found.push(
      ...drops.map(drop => ({ slug: registered.entity.slug, ...drop }))
    );
  }
  return found;
}

/**
 * Drop each inline UNIQUE an earlier release's Builder gave a one-to-one whose column no field
 * makes unique any more. A run that finds none changes nothing, so the next run after one stopped
 * part-way drops only what is still there.
 *
 * @returns how many were dropped
 */
export async function letGoOfEarlierInlineUniques(
  deps: EarlierInlineUniquesDeps
): Promise<number> {
  const drops = await inlineUniquesToDrop(deps.db, deps.dialect);
  for (const drop of drops) await deps.executeQuery(drop.statement);
  if (drops.length > 0) {
    deps.logger.info(
      `${STEP}: ${drops.map(d => `${d.slug}.${d.field}`).join(", ")}.`
    );
  }
  return drops.length;
}
