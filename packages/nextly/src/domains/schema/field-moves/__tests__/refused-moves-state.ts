/**
 * What a refused move must leave as it was, read the same way for every road that refuses it: each
 * of the entities' tables with its columns, indexes and rows, the registry rows, the migrations
 * folder and the definition file beside it.
 */
import { readdir, readFile } from "node:fs/promises";
import { join, relative } from "node:path";

import type { TestDialect } from "../../../../plugins/test-nextly";

type Run = <T>(statement: string) => Promise<T[]>;

const quote = (dialect: TestDialect, name: string) =>
  dialect === "mysql" ? `\`${name}\`` : `"${name}"`;

/** Every table whose name starts with `prefix`, the entities' own and their language tables. */
async function tableNames(
  run: Run,
  dialect: TestDialect,
  prefix: string
): Promise<string[]> {
  const rows = await run<{ name: string }>(
    dialect === "mysql"
      ? `SELECT TABLE_NAME AS name FROM information_schema.TABLES WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME LIKE '${prefix}%'`
      : dialect === "sqlite"
        ? `SELECT name FROM sqlite_master WHERE type = 'table' AND name LIKE '${prefix}%'`
        : `SELECT table_name AS name FROM information_schema.tables WHERE table_schema = current_schema() AND table_name LIKE '${prefix}%'`
  );
  return rows.map(row => row.name).sort();
}

async function columnsOf(run: Run, dialect: TestDialect, table: string) {
  const rows = await run<{ name: string; type: string }>(
    dialect === "mysql"
      ? `SELECT COLUMN_NAME AS name, COLUMN_TYPE AS type FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = '${table}'`
      : dialect === "sqlite"
        ? `SELECT name, type FROM pragma_table_info('${table}')`
        : `SELECT column_name AS name, data_type AS type FROM information_schema.columns WHERE table_schema = current_schema() AND table_name = '${table}'`
  );
  return rows.map(column => `${column.name} ${column.type}`).sort();
}

/** Each index of the table with what it is made of, a unique one so on MySQL. */
async function indexesOf(run: Run, dialect: TestDialect, table: string) {
  if (dialect === "mysql") {
    const rows = await run<{
      name: string;
      nonunique: number | string;
      col: string;
    }>(
      `SELECT INDEX_NAME AS name, NON_UNIQUE AS nonunique, COLUMN_NAME AS col FROM information_schema.STATISTICS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = '${table}' ORDER BY INDEX_NAME, SEQ_IN_INDEX`
    );
    const byName = new Map<string, string[]>();
    for (const row of rows) {
      const parts = byName.get(row.name) ?? [
        Number(row.nonunique) === 0 ? "unique" : "index",
      ];
      parts.push(row.col);
      byName.set(row.name, parts);
    }
    return [...byName.entries()]
      .map(([name, parts]) => `${name}: ${parts.join(",")}`)
      .sort();
  }
  const rows = await run<{ name: string; sql: string | null }>(
    dialect === "sqlite"
      ? `SELECT name, sql FROM sqlite_master WHERE type = 'index' AND tbl_name = '${table}'`
      : `SELECT indexname AS name, indexdef AS sql FROM pg_indexes WHERE schemaname = current_schema() AND tablename = '${table}'`
  );
  return rows.map(row => `${row.name}: ${row.sql ?? "auto"}`).sort();
}

async function rowsOf(run: Run, dialect: TestDialect, table: string) {
  return (
    await run<Record<string, unknown>>(`SELECT * FROM ${quote(dialect, table)}`)
  )
    .map(row => JSON.stringify(row, Object.keys(row).sort()))
    .sort();
}

/** The registry rows of the entities with `slugs`, each whole. */
async function registryRowsOf(
  run: Run,
  table: string,
  slugs: readonly string[]
) {
  const named = slugs.map(slug => `'${slug}'`).join(", ");
  return (
    await run<Record<string, unknown>>(
      `SELECT * FROM ${table} WHERE slug IN (${named})`
    )
  )
    .map(row => JSON.stringify(row, Object.keys(row).sort()))
    .sort();
}

/** Every file under `folder`, by path, with what it holds; a folder that is not there holds none. */
export async function folderFiles(
  folder: string
): Promise<Record<string, string>> {
  const names = await readdir(folder, {
    recursive: true,
    withFileTypes: true,
  }).catch(() => []);
  const files = names.filter(entry => entry.isFile());
  return Object.fromEntries(
    await Promise.all(
      files.map(async entry => {
        const path = join(entry.parentPath, entry.name);
        return [relative(folder, path), await readFile(path, "utf-8")] as const;
      })
    )
  );
}

/** Everything the entities' database, registry and migrations folder hold, to be compared whole. */
export async function databaseState(args: {
  run: Run;
  dialect: TestDialect;
  /** Each table an entity here owns starts with one of these. */
  tablePrefixes: readonly string[];
  /** The registry tables compared, each with the entities whose rows are. */
  registries: readonly { table: string; slugs: readonly string[] }[];
  /** The folder the migrations are written to, and any file beside it. */
  migrations: string;
  definitionFile?: string;
}): Promise<Record<string, unknown>> {
  const { run, dialect } = args;
  const tables = (
    await Promise.all(
      args.tablePrefixes.map(prefix => tableNames(run, dialect, prefix))
    )
  ).flat();
  return {
    tables: Object.fromEntries(
      await Promise.all(
        tables.map(async table => [
          table,
          {
            columns: await columnsOf(run, dialect, table),
            indexes: await indexesOf(run, dialect, table),
            rows: await rowsOf(run, dialect, table),
          },
        ])
      )
    ),
    registry: Object.fromEntries(
      await Promise.all(
        args.registries.map(async ({ table, slugs }) => [
          table,
          await registryRowsOf(run, table, slugs),
        ])
      )
    ),
    migrations: await folderFiles(args.migrations),
    ...(args.definitionFile === undefined
      ? {}
      : { definition: await readFile(args.definitionFile, "utf-8") }),
  };
}
