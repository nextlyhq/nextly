/**
 * What a refused move must leave as it was, read the same way for every road that refuses it: each
 * of the entities' tables with its whole definition (`readTableDefinition`) and its rows, the
 * registry rows, the migrations folder and the definition file beside it.
 */
import { readdir, readFile } from "node:fs/promises";
import { join, relative } from "node:path";

import type { TestDialect } from "../../../../plugins/test-nextly";
import { readTableDefinition } from "../../__tests__/helpers/table-definition";

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

/**
 * A row as text, the same for the same values: every key at every depth, in an order of its own,
 * since a database that keeps JSON hands it out parsed, its keys in whatever order it keeps.
 */
export function rowAsText(row: unknown): string {
  return JSON.stringify(row ?? null, (_key, value: unknown) =>
    value !== null && typeof value === "object" && !Array.isArray(value)
      ? Object.fromEntries(
          Object.entries(value).sort(([a], [b]) => (a < b ? -1 : 1))
        )
      : value
  );
}

async function rowsOf(run: Run, dialect: TestDialect, table: string) {
  return (
    await run<Record<string, unknown>>(`SELECT * FROM ${quote(dialect, table)}`)
  )
    .map(rowAsText)
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
    .map(rowAsText)
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
            definition: await readTableDefinition(run, dialect, table),
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
