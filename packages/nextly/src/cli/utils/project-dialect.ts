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
import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { join, resolve } from "node:path";

import * as p from "@clack/prompts";

import { canPrompt } from "../../domains/schema/migrate/can-prompt";
import { headerLinesOf } from "../../domains/schema/migrate/history-line";
import { compareMigrationBaseNames } from "../../domains/schema/migrate/migration-order";
import { ignoredByGit } from "../../domains/schema/ui-schema/committed-definition";
import { databaseEnvError, dialectNotStated } from "../errors/areas/database";
import { exitWithError } from "../errors/report";

import { environmentDialect, type SupportedDialect } from "./adapter";
import type { Logger } from "./logger";
import { discoverMigrationGroups } from "./migration-discovery";
import { answered } from "./prompt-cancelled";

/** The dialect each migration file's header names, by the name it prints. */
const BY_HEADER: Record<string, SupportedDialect> = {
  PostgreSQL: "postgresql",
  MySQL: "mysql",
  SQLite: "sqlite",
};

/** The line of a generated migration file's header that names its dialect. */
const HEADER = /^-- Dialect: (\S+)\s*$/m;

/**
 * The dialect the migration history was written for, from its newest migration that says: one
 * written as one dialect's file alone (`<base>.sqlite.sql`) by that file's name, one written as a
 * single file by the dialect its header names (`headerLinesOf`, never a comment among its
 * statements). None where the folder holds no such migration, or its newest is written as files
 * for several dialects, which says it serves several.
 */
async function historyDialect(
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
    const dialects = new Set(group.variants.map(variant => variant.dialect));
    if (dialects.size > 1) return undefined;
    const [only] = dialects;
    if (only !== undefined) return only;
    const named = await headerDialect(
      join(migrationsDir, group.variants[0].file)
    );
    if (named !== undefined) return named;
  }
  return undefined;
}

/** The dialect `file`'s header names, or none where it names none or cannot be read. */
async function headerDialect(
  file: string
): Promise<SupportedDialect | undefined> {
  let text: string;
  try {
    text = await readFile(file, "utf-8");
  } catch {
    return undefined;
  }
  const header = headerLinesOf(text).join("\n");
  return BY_HEADER[HEADER.exec(header)?.[1] ?? ""];
}

/**
 * The dialect the environment names without a connection (`environmentDialect`): none where it
 * names nothing. A `DB_DIALECT` Nextly does not run on, or a `DATABASE_URL` whose scheme names no
 * database, is refused as every command refuses it, never passed over.
 */
function dialectFromEnvironment(
  env: Readonly<Record<string, string | undefined>>
): SupportedDialect | undefined {
  if (!env.DB_DIALECT && !env.DATABASE_URL) return undefined;
  const named = environmentDialect(env);
  if ("problem" in named) {
    throw databaseEnvError({
      valid: false,
      errors: [],
      problem: named.problem,
    });
  }
  return named.dialect;
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
async function projectDialect(args: {
  flag?: SupportedDialect;
  migrationsDir: string;
  env?: Readonly<Record<string, string | undefined>>;
  /** The question at a terminal; `askDialect` where omitted. */
  ask?: () => Promise<SupportedDialect>;
}): Promise<SupportedDialect> {
  if (args.flag !== undefined) return args.flag;
  const fromHistory = await historyDialect(args.migrationsDir);
  if (fromHistory !== undefined) return fromHistory;
  const fromEnvironment = dialectFromEnvironment(args.env ?? process.env);
  if (fromEnvironment !== undefined) return fromEnvironment;
  if (canPrompt()) return (args.ask ?? askDialect)();
  throw dialectNotStated();
}

/**
 * What `migrate:check` and `migrate:create` read before they compare, with no database: the
 * dialect (`projectDialect`), the command ending in the error shape where nothing says; and the
 * Schema Builder's definition file, whether it is there and whether git ignores it. The changes
 * are computed from what the project commits, so each command answers an ignored file:
 * `migrate:check` refuses it whether or not the checkout holds it (a CI checkout of a project that
 * ignores it never does), and `migrate:create` warns where it writes from one.
 */
export async function readWithoutDatabase(args: {
  flag: SupportedDialect | undefined;
  projectRoot: string;
  /** The migrations folder, absolute. */
  migrationsDir: string;
  /** `db.uiSchemaFile`, relative to the project. */
  definitionFile: string;
  logger: Pick<Logger, "getOptions">;
}): Promise<{
  dialect: SupportedDialect;
  definitionPresent: boolean;
  definitionIgnored: boolean;
}> {
  let dialect: SupportedDialect;
  try {
    dialect = await projectDialect({
      ...(args.flag !== undefined ? { flag: args.flag } : {}),
      migrationsDir: args.migrationsDir,
    });
  } catch (error) {
    return exitWithError(args.logger, error);
  }
  return {
    dialect,
    definitionPresent: existsSync(
      resolve(args.projectRoot, args.definitionFile)
    ),
    // git judges a path by its rules whether or not the file exists.
    definitionIgnored: await ignoredByGit(
      args.projectRoot,
      args.definitionFile
    ),
  };
}
