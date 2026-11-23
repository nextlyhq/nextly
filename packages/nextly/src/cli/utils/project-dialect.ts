/**
 * The dialect a command that reads no database works in (`migrate:check`, `migrate:create`), so it
 * runs with neither a connection nor its credentials. Asked in this order:
 *
 * 1. `--dialect`, where given;
 * 2. the migration history: the newest migration file that says which dialect it was written for
 *    (`-- Dialect: PostgreSQL`), where the folder's newest migration is written for one dialect;
 * 3. the environment, read without connecting: `DB_DIALECT`, else the scheme of `DATABASE_URL`;
 * 4. a question, at a terminal;
 * 5. otherwise the command refuses, naming `--dialect` (`DIALECT_NOT_STATED`).
 *
 * @module cli/utils/project-dialect
 */
import { readFile } from "node:fs/promises";
import { join } from "node:path";

import * as p from "@clack/prompts";

import { canPrompt } from "../../domains/schema/migrate/can-prompt";
import { compareMigrationBaseNames } from "../../domains/schema/migrate/migration-order";
import { DIALECTS } from "../dialect-option";
import { dialectNotStated } from "../errors/areas/database";

import { detectDialectFromUrl, type SupportedDialect } from "./adapter";
import { discoverMigrationGroups } from "./migration-discovery";
import { answered } from "./prompt-cancelled";

/** The dialect each migration file's header names, by the name it prints. */
const BY_HEADER: Record<string, SupportedDialect> = {
  PostgreSQL: "postgresql",
  MySQL: "mysql",
  SQLite: "sqlite",
};

/** The header a generated migration file starts with, naming its dialect. */
const HEADER = /^-- Dialect: (\S+)\s*$/m;

/** Whether `value` is a dialect Nextly runs on. */
function isDialect(value: string | undefined): value is SupportedDialect {
  return value !== undefined && (DIALECTS as readonly string[]).includes(value);
}

/**
 * The dialect the migration history was written for: the newest migration file whose header names
 * one. None where the folder holds no such file, or its newest migration is written as one file per
 * dialect, which says it serves several.
 */
export async function historyDialect(
  migrationsDir: string
): Promise<SupportedDialect | undefined> {
  let groups;
  try {
    groups = await discoverMigrationGroups(migrationsDir);
  } catch {
    return undefined;
  }
  const newestFirst = [...groups.values()].sort((a, b) =>
    compareMigrationBaseNames(b.baseName, a.baseName)
  );
  for (const group of newestFirst) {
    if (group.variants.some(variant => variant.dialect !== undefined)) {
      return undefined;
    }
    for (const variant of group.variants) {
      let text: string;
      try {
        text = await readFile(join(migrationsDir, variant.file), "utf-8");
      } catch {
        continue;
      }
      const named = BY_HEADER[HEADER.exec(text)?.[1] ?? ""];
      if (named !== undefined) return named;
    }
  }
  return undefined;
}

/** The dialect the environment names without a connection: `DB_DIALECT`, else `DATABASE_URL`'s. */
function environmentDialect(
  env: Readonly<Record<string, string | undefined>>
): SupportedDialect | undefined {
  if (isDialect(env.DB_DIALECT)) return env.DB_DIALECT;
  const url = env.DATABASE_URL;
  return url === undefined || url === ""
    ? undefined
    : detectDialectFromUrl(url);
}

/** The terminal's question for the dialect. */
async function askDialect(): Promise<SupportedDialect> {
  return answered(
    await p.select<SupportedDialect>({
      message: "Which database are the migrations for?",
      options: [
        { value: "postgresql", label: "PostgreSQL" },
        { value: "mysql", label: "MySQL" },
        { value: "sqlite", label: "SQLite" },
      ],
    })
  );
}

/**
 * The dialect the command works in (see the module's order).
 *
 * @throws {CliError} `DIALECT_NOT_STATED` where nothing says and nobody can be asked
 */
export async function projectDialect(args: {
  flag?: SupportedDialect;
  migrationsDir: string;
  env?: Readonly<Record<string, string | undefined>>;
  /** The question at a terminal; `askDialect` where omitted. */
  ask?: () => Promise<SupportedDialect>;
}): Promise<SupportedDialect> {
  if (args.flag !== undefined) return args.flag;
  const fromHistory = await historyDialect(args.migrationsDir);
  if (fromHistory !== undefined) return fromHistory;
  const fromEnvironment = environmentDialect(args.env ?? process.env);
  if (fromEnvironment !== undefined) return fromEnvironment;
  if (canPrompt()) return (args.ask ?? askDialect)();
  throw dialectNotStated();
}
