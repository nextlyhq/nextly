/**
 * Turns a table today's Schema Builder makes back into one an earlier version made, for tests of
 * how a save treats such a table the first time it meets it.
 *
 * An earlier version's Builder wrote no migrations, so its table has no history, and its create
 * made a slightly different table: no index on `created_at`; on PostgreSQL a field group's parent
 * columns `varchar(255)`; on MySQL a text field's column `text`. The first save adopts the table as
 * it stands, and every difference from what Nextly now declares is a conversion the person
 * confirms before it is written.
 *
 * The same for a collection, a Single and a field group: each takes the table and its own columns.
 */
import { rm } from "node:fs/promises";
import { join } from "node:path";

import type {
  TestDialect,
  TestNextly,
} from "../../../../../plugins/test-nextly";
import { STORAGE_FORMAT } from "../../../../../schemas/storage-format";
import {
  readTableDefinition,
  type TableDefinition,
} from "../../../__tests__/helpers/table-definition";

/** The migrations folder a test instance writes to when its config names none. */
const DEFAULT_MIGRATIONS = join("src", "db", "migrations");

const quote = (dialect: TestDialect, name: string) =>
  dialect === "mysql" ? `\`${name}\`` : `"${name}"`;

/** Runs `statement` on the instance's own database, as the Builder's saves reach it. */
export function execOn(t: TestNextly) {
  return <T>(statement: string): Promise<T[]> =>
    (
      t.adapter as unknown as {
        executeQuery<R>(sql: string): Promise<R[]>;
      }
    ).executeQuery<T>(statement);
}

/** `table` as the instance's database holds it, whole. */
export function tableOf(
  t: TestNextly,
  dialect: TestDialect,
  table: string
): Promise<TableDefinition> {
  return readTableDefinition(execOn(t), dialect, table);
}

/** The index on `created_at` today's create makes, which an earlier version's did not. */
export function createdAtIndexOf(table: string): string {
  return `${STORAGE_FORMAT.indexPrefix}${table}_created_at`;
}

/**
 * Forgets the history today's saves record, as a table an earlier Builder made has none: the
 * migration files and snapshots under `migrationsDir` (relative to the instance's base path), and
 * their applies. The next save adopts the table as it stands.
 */
export async function withNoHistory(
  t: TestNextly,
  dialect: TestDialect,
  migrationsDir: string = DEFAULT_MIGRATIONS
): Promise<void> {
  await rm(join(t.basePath, migrationsDir), { recursive: true, force: true });
  const q = (name: string) => quote(dialect, name);
  await execOn(t)(
    `DELETE FROM ${q("nextly_schema_events")} WHERE ${q("event_type")} = 'file_apply'`
  );
}

/**
 * Gives `column` of `table` the column DEFAULT `value`, as an earlier version's create wrote one for
 * a field that stated a default, where today's writes none. SQLite cannot set a column's default
 * in place, so there the table is rebuilt under the same name from its own definition, with its
 * rows and indexes; a column whose type takes no literal DEFAULT on MySQL (`text`) is refused there.
 */
export async function withStrayDefault(
  t: TestNextly,
  dialect: TestDialect,
  table: string,
  column: string,
  value: string
): Promise<void> {
  const exec = execOn(t);
  const q = (name: string) => quote(dialect, name);
  const literal = `'${value.replace(/'/g, "''")}'`;
  if (dialect !== "sqlite") {
    await exec(
      `ALTER TABLE ${q(table)} ALTER COLUMN ${q(column)} SET DEFAULT ${literal}`
    );
    return;
  }
  const [created] = await exec<{ sql: string }>(
    `SELECT sql FROM sqlite_master WHERE type = 'table' AND name = '${table}'`
  );
  const indexes = await exec<{ sql: string }>(
    `SELECT sql FROM sqlite_master WHERE type = 'index' AND tbl_name = '${table}' AND sql IS NOT NULL`
  );
  // The column's declaration is its quoted name and its type, then whatever constraints follow.
  const declaration = new RegExp(`("${column}"\\s+[a-z]+(?:\\(\\d+\\))?)`, "i");
  if (created === undefined || !declaration.test(created.sql)) {
    throw new Error(`no column ${column} declared in ${table}`);
  }
  const before = `${table}__before_default`;
  await exec(`ALTER TABLE "${table}" RENAME TO "${before}"`);
  await exec(created.sql.replace(declaration, `$1 DEFAULT ${literal}`));
  await exec(`INSERT INTO "${table}" SELECT * FROM "${before}"`);
  // Dropping the renamed table drops its indexes, so each is made again on the rebuilt one.
  await exec(`DROP TABLE "${before}"`);
  for (const index of indexes) await exec(index.sql);
}

/**
 * Turns `table`, as today's create made it, into the table an earlier version's create made: no
 * `created_at` index; on MySQL each of `textColumns` (a text field's column) `text`; on PostgreSQL
 * the parent columns a field group's table carries `varchar(255)`.
 */
export async function asCreatedBefore(
  t: TestNextly,
  dialect: TestDialect,
  table: string,
  textColumns: readonly string[] = []
): Promise<void> {
  const exec = execOn(t);
  const q = (name: string) => quote(dialect, name);
  const current = await tableOf(t, dialect, table);
  const index = createdAtIndexOf(table);
  if (current.indexes.some(i => i.name === index)) {
    await exec(
      dialect === "mysql"
        ? `DROP INDEX ${q(index)} ON ${q(table)}`
        : `DROP INDEX ${q(index)}`
    );
  }
  if (dialect === "mysql") {
    for (const column of textColumns) {
      await exec(
        `ALTER TABLE ${q(table)} MODIFY COLUMN ${q(column)} text NULL`
      );
    }
    return;
  }
  if (dialect === "postgresql") {
    const { parentTable, parentField } = STORAGE_FORMAT.columns;
    const held = new Set(current.columns.map(c => c.name));
    for (const column of [parentTable, parentField].filter(c => held.has(c))) {
      await exec(
        `ALTER TABLE ${q(table)} ALTER COLUMN ${q(column)} TYPE varchar(255)`
      );
    }
  }
}
