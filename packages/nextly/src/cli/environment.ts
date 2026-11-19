/**
 * The mode a CLI run is in, and the environment files it reads for that mode.
 *
 * The files are read by Next.js's own loader (`@next/env`), so a project's
 * `.env`, `.env.local`, `.env.<mode>` and `.env.<mode>.local` mean to the CLI
 * exactly what they mean to the app in the same folder, in the same order of
 * precedence, with a value already in the process environment winning over
 * every file. A second reading of those rules here would drift from Next.js's.
 *
 * The mode is `--mode` when given, else `NODE_ENV` (`production` or `test`),
 * else `development`, unset included. It is written back to `NODE_ENV` before
 * the files are read and before the configuration is evaluated, so a
 * configuration that branches on `NODE_ENV` declares, under `nextly migrate
 * --mode production`, the same schema `next build` evaluates it with.
 *
 * Nothing here imports an application module: the program runs this before a
 * command's work is loaded, because that code may read `process.env` as it
 * loads.
 *
 * @module cli/environment
 */

import { createRequire } from "node:module";
import { relative, resolve } from "node:path";

import type * as NextEnv from "@next/env";
import type { Command } from "commander";

import { databaseTarget } from "./database-target";

/** The modes a run can be in, as Next.js names them. */
export const CLI_MODES = ["development", "production", "test"] as const;

export type CliMode = (typeof CLI_MODES)[number];

/** What a run read: its mode, the folder its files came from, and those files. */
interface CliEnvironment {
  mode: CliMode;
  folder: string;
  /** Each file read, relative to `folder`, highest precedence first. */
  files: string[];
  /** The variables set before any file was read, which no file overrides. */
  preset: ReadonlySet<string>;
  /** Each file's own variables, in the order of `files`. */
  values: ReadonlyArray<Readonly<Record<string, string | undefined>>>;
}

let current: CliEnvironment | undefined;
let writeModeLine: ((line: string) => void) | undefined;
let modeLinePrinted = false;

function isMode(value: string | undefined): value is CliMode {
  return (CLI_MODES as readonly string[]).includes(value ?? "");
}

/**
 * The mode `--mode` and `nodeEnv` choose: `given` when it is one of the three
 * (Commander has refused any other value before an action runs), else
 * `NODE_ENV`'s `production` or `test`, else `development`.
 */
export function readMode(
  given: string | undefined,
  nodeEnv: string | undefined
): CliMode {
  if (isMode(given)) return given;
  return nodeEnv === "production" || nodeEnv === "test"
    ? nodeEnv
    : "development";
}

/**
 * The environment step of a run, given the program Commander has parsed: the
 * mode its `--mode` option holds, read from the one option definition, then
 * `loadCliEnvironment`. The entry point runs it before any command's action,
 * so an invocation that runs no action reads no file.
 */
export function loadProgramEnvironment(
  program: Command,
  folder: string = process.cwd()
): void {
  loadCliEnvironment(program.opts<{ mode?: string }>().mode, folder);
}

/**
 * Chooses the run's mode from `given` (`--mode`) and `NODE_ENV`, makes it
 * `NODE_ENV`, and reads the environment files of `folder` for it with
 * Next.js's loader. Runs before a command's work is imported.
 */
export function loadCliEnvironment(
  given: string | undefined,
  folder: string = process.cwd()
): void {
  const mode = readMode(given, process.env.NODE_ENV);
  // Next.js types `NODE_ENV` read-only, for app code; the CLI is what sets it
  // for the run, as `next build` and `next dev` do for theirs.
  Object.assign(process.env, { NODE_ENV: mode });
  const preset = new Set(Object.keys(process.env));
  const { loadEnvConfig } = nextEnv();
  // The loader announces each file it reads; the CLI prints its own line
  // instead, so only a file it could not read is reported.
  const { loadedEnvFiles } = loadEnvConfig(folder, mode === "development", {
    info: () => {},
    error: (...args: unknown[]) => console.error(...args),
  });
  // A run starts here, and its line is printed once a run.
  modeLinePrinted = false;
  current = {
    mode,
    folder,
    files: loadedEnvFiles.map(file =>
      relative(folder, resolve(folder, file.path))
    ),
    preset,
    values: loadedEnvFiles.map(file => file.env),
  };
}

/** Next.js's own loader of environment files, typed from its declarations. */
function nextEnv(): typeof NextEnv {
  // `@next/env` is a bundled CommonJS file whose exports Node's ESM loader
  // cannot name, so it is loaded through `require`. Loaded when asked, not
  // when this module is imported: the app's dev boot imports the database
  // check that prints the run's line, and never reads environment files
  // through the CLI.
  return createRequire(import.meta.url)("@next/env") as typeof NextEnv;
}

/**
 * Reads the environment files of a second project folder, for a command told
 * to work in another folder than the one the CLI ran in: the files Next.js
 * reads there for the run's mode, in its order of precedence, each setting
 * only what nothing has set yet. A value the first folder's files or the
 * process environment gave stays as it is.
 */
export function readFurtherEnvironment(folder: string): void {
  if (!current) return;
  const { loadEnvConfig, updateInitialEnv } = nextEnv();
  // The loader starts a second reading from the environment it first saw.
  // Told that what is set now is that environment, it keeps every value
  // already read and adds only what is missing.
  updateInitialEnv({ ...process.env });
  const { loadedEnvFiles } = loadEnvConfig(
    folder,
    current.mode === "development",
    { info: () => {}, error: (...args: unknown[]) => console.error(...args) },
    true
  );
  // Recorded after the first folder's files, which won where both set a value.
  current = {
    ...current,
    files: [
      ...current.files,
      ...loadedEnvFiles.map(file =>
        relative(current?.folder ?? folder, resolve(folder, file.path))
      ),
    ],
    values: [...current.values, ...loadedEnvFiles.map(file => file.env)],
  };
}

/**
 * Where `name`'s value came from: the process environment, the file of
 * highest precedence that sets it (the one Next.js takes it from), or nowhere.
 */
function sourceOf(environment: CliEnvironment, name: string): string {
  if (environment.preset.has(name)) return "from the process environment";
  const index = environment.values.findIndex(
    values => values[name] !== undefined
  );
  return index === -1 ? "not set" : `from ${environment.files[index]}`;
}

/**
 * The environment files this run read, as absolute paths, highest precedence
 * first; none when no environment was loaded, as in a test that calls a
 * command directly.
 */
export function environmentFilesRead(): string[] {
  if (!current) return [];
  const { folder, files } = current;
  return files.map(file => resolve(folder, file));
}

/**
 * The folder this run's environment files were read from, which is where its
 * database settings came from; `undefined` when no environment was loaded, as
 * in a test that calls a command directly.
 */
export function environmentFolder(): string | undefined {
  return current?.folder;
}

/**
 * The line naming the database a run is about to use, its mode and where its
 * URL came from, as `Database: PostgreSQL db.internal:5432/shop (production;
 * DATABASE_URL from .env.production)`; `undefined` when no environment was
 * loaded, as in a test that calls a command directly. Of the URL it says the
 * target alone (`databaseTarget`): never a user name, a password or a query
 * parameter.
 */
export function modeLine(): string | undefined {
  if (!current) return undefined;
  const target = databaseTarget({
    url: process.env.DATABASE_URL,
    dialect: process.env.DB_DIALECT,
    folder: current.folder,
  });
  return `Database: ${target} (${current.mode}; DATABASE_URL ${sourceOf(current, "DATABASE_URL")})`;
}

/**
 * Where the run's line goes, set by the program once it has read `--quiet`:
 * `undefined` prints nothing.
 */
export function setModeLineWriter(
  write: ((line: string) => void) | undefined
): void {
  writeModeLine = write;
}

/**
 * Prints the run's line once a run, through the writer the program set. Called
 * where a command first validates its database settings, so every command
 * that reaches a database names the database, the mode it runs in and where its URL
 * came from, and a command that does not stays as quiet as it was.
 */
export function announceMode(): void {
  if (modeLinePrinted || !writeModeLine) return;
  const line = modeLine();
  if (line === undefined) return;
  modeLinePrinted = true;
  writeModeLine(line);
}
