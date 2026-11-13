/**
 * CLI Database Adapter Utilities
 *
 * Helper functions for creating and managing database adapters
 * in CLI commands.
 *
 * @module cli/utils/adapter
 * @since 1.0.0
 */

import { existsSync } from "node:fs";
import { resolve } from "node:path";

import {
  activePostgresSchema,
  assertInstallationInConfiguredSchema,
  DEFAULT_POSTGRES_SCHEMA,
} from "../../domains/schema/services/postgres-schema";
import { dialectFromUrl } from "../../shared/lib/env";
import { reportDryRun } from "../dry-run";
import { announceMode } from "../environment";
import { connectionFailure, databaseEnvError } from "../errors/areas/database";

import type { Logger } from "./logger";

/**
 * Supported database dialects
 */
export type SupportedDialect = "postgresql" | "mysql" | "sqlite";

/**
 * Options for creating a database adapter
 */
export interface CreateCliAdapterOptions {
  /**
   * Database dialect (postgresql, mysql, sqlite)
   * If not provided, will be detected from DATABASE_URL or DB_DIALECT env var
   */
  dialect?: SupportedDialect;

  /**
   * Database connection URL
   * If not provided, will use DATABASE_URL env var
   */
  databaseUrl?: string;

  /**
   * Logger instance for output
   */
  logger?: Logger;

  /**
   * The PostgreSQL schema this command should resolve in.
   *
   * Defaults to whatever `loadConfig` published, which is what every command
   * that reads `nextly.config.ts` already has. Passed explicitly only by a
   * caller that has no config — a test, or a command operating on a database
   * named entirely on the command line.
   */
  schema?: string;
}

/**
 * Result of database environment validation
 */
export interface DatabaseEnvValidation {
  /** Whether the environment is valid */
  valid: boolean;
  /** Error messages if invalid */
  errors: string[];
  /**
   * The first thing to fix, when invalid: what the CLI's error code is chosen by, so the code
   * never depends on the wording of `errors`.
   */
  problem?: "url-missing" | "dialect-undetected" | "dialect-invalid";
  /** Detected dialect */
  dialect?: SupportedDialect;
  /** Database URL */
  databaseUrl?: string;
}

/**
 * Detect database dialect from connection URL
 *
 * @param url - Database connection URL
 * @returns Detected dialect or undefined
 */
export function detectDialectFromUrl(
  url: string
): SupportedDialect | undefined {
  // Delegates rather than restating. The environment schema resolves the
  // dialect for everything that reads `env.DB_DIALECT`, and a second copy of
  // these rules here meant the CLI and the runtime could disagree about the
  // same URL: this one accepted `.sqlite3` and that one did not.
  return dialectFromUrl(url);
}

/**
 * Validate database environment variables
 *
 * @returns Validation result with errors if any
 */
export function validateDatabaseEnv(): DatabaseEnvValidation {
  // Every command that reaches a database checks its settings here first, so
  // this is where the run names its mode and where its URL came from.
  announceMode();
  const errors: string[] = [];
  let problem: DatabaseEnvValidation["problem"];
  const databaseUrl = process.env.DATABASE_URL;
  const dialectEnv = process.env.DB_DIALECT as SupportedDialect | undefined;

  if (!databaseUrl) {
    errors.push("DATABASE_URL environment variable is required");
    problem = "url-missing";
  }

  let dialect: SupportedDialect | undefined = dialectEnv;
  if (!dialect && databaseUrl) {
    dialect = detectDialectFromUrl(databaseUrl);
  }

  if (!dialect) {
    errors.push(
      "Could not detect database dialect. Set DB_DIALECT to one of: postgresql, mysql, sqlite"
    );
    problem ??= "dialect-undetected";
  } else if (!["postgresql", "mysql", "sqlite"].includes(dialect)) {
    errors.push(
      `Invalid DB_DIALECT: ${dialect}. Must be one of: postgresql, mysql, sqlite`
    );
    problem ??= "dialect-invalid";
  }

  return {
    valid: errors.length === 0,
    errors,
    problem,
    dialect: errors.length === 0 ? dialect : undefined,
    databaseUrl: errors.length === 0 ? databaseUrl : undefined,
  };
}

/**
 * Database adapter interface (minimal for CLI use)
 */
export interface CLIDatabaseAdapter {
  dialect: SupportedDialect;
  connect(): Promise<void>;
  disconnect(): Promise<void>;
  isConnected(): boolean;
  getCapabilities(): { dialect: SupportedDialect };
}

/**
 * Create the CLI's own minimal database adapter, from environment or options.
 *
 * Named apart from `createAdapter` in `nextly/database`, which is a different
 * function returning a different type: that one builds the full
 * `DrizzleAdapter` an application runs on, this one builds the small
 * `CLIDatabaseAdapter` above, which is connect, disconnect and a dialect. Both
 * were published under one name from two entries, so an import site said
 * nothing about which had arrived or what it could do.
 *
 * @param options - Adapter creation options
 * @returns The CLI adapter instance
 * @throws Error if environment is invalid or adapter creation fails
 *
 * @example
 * ```typescript
 * const adapter = await createCliAdapter({ logger });
 * try {
 *   // Use adapter...
 * } finally {
 *   await adapter.disconnect();
 * }
 * ```
 */
export async function createCliAdapter(
  options: CreateCliAdapterOptions = {}
): Promise<CLIDatabaseAdapter> {
  const opened = await connectCliAdapter(options, false);
  // Only a read-only open reports a missing database; this one creates it.
  if ("missing" in opened) {
    throw connectionFailure(options.dialect ?? "sqlite", opened.missing);
  }
  return opened;
}

/** What a read-only open finds where the database it names is not there. */
export interface MissingDatabase {
  /** The sentence a dry run reports as the real run's refusal. */
  missing: string;
}

/**
 * Opens the database a dry run reads, changing nothing: SQLite's file is
 * opened read-only and neither it nor its folder is made, PostgreSQL's schema
 * is looked for and not created, and MySQL creates nothing on connect anyway.
 * A database that is not there comes back as `missing` instead of being made.
 */
export function openDryRunAdapter(
  options: CreateCliAdapterOptions = {}
): Promise<CLIDatabaseAdapter | MissingDatabase> {
  return connectCliAdapter(options, true);
}

/**
 * The database a command opens: as `createCliAdapter` opens it for a real run,
 * read-only for a dry run. A dry run whose database is not there reports that
 * as the real run's refusal and answers undefined, and the command then ends
 * with exit 0 having made nothing.
 */
export async function openCommandAdapter(
  options: CreateCliAdapterOptions & { dryRun?: boolean },
  logger: Logger
): Promise<CLIDatabaseAdapter | undefined> {
  if (options.dryRun !== true) return createCliAdapter(options);
  const opened = await openDryRunAdapter(options);
  if (!("missing" in opened)) return opened;
  reportDryRun(logger, { changes: [], refusals: [opened.missing] });
  return undefined;
}

/** PostgreSQL's code for a schema that does not exist. */
const INVALID_SCHEMA_NAME = "3F000";

/** The one connect behind `createCliAdapter` and `openDryRunAdapter`. */
async function connectCliAdapter(
  options: CreateCliAdapterOptions,
  readOnly: boolean
): Promise<CLIDatabaseAdapter | MissingDatabase> {
  // A command may connect without the settings check first, as
  // `plugins install` does; it names its mode here instead (once a run).
  announceMode();
  const { dialect, databaseUrl } = cliTarget(options);
  options.logger?.debug(`Creating ${dialect} adapter...`);
  const missing = readOnly
    ? missingSqliteFile(dialect, databaseUrl)
    : undefined;
  if (missing) return missing;
  return createUnderEnv(options, readOnly, dialect, databaseUrl);
}

/**
 * The dialect and URL a command connects with: given, or read from the
 * environment, the dialect detected from the URL when not given. Refused with
 * the errors the environment check gives, so a command that connects without
 * checking first still ends with the code for what is missing.
 */
function cliTarget(options: CreateCliAdapterOptions): {
  dialect: SupportedDialect;
  databaseUrl: string;
} {
  const databaseUrl = options.databaseUrl ?? process.env.DATABASE_URL;
  const dialect =
    options.dialect ??
    (databaseUrl ? detectDialectFromUrl(databaseUrl) : undefined) ??
    (process.env.DB_DIALECT as SupportedDialect | undefined);
  if (!databaseUrl) {
    throw databaseEnvError({
      valid: false,
      errors: [],
      problem: "url-missing",
    });
  }
  if (!dialect) {
    throw databaseEnvError({
      valid: false,
      errors: [],
      problem: "dialect-undetected",
    });
  }
  return { dialect, databaseUrl };
}

/**
 * The file the SQLite adapter would open, by its own rule, when it is not
 * there: a read-only open must not make it. Undefined for any other dialect,
 * an in-memory database, or a file that exists.
 */
function missingSqliteFile(
  dialect: SupportedDialect,
  databaseUrl: string
): MissingDatabase | undefined {
  if (dialect !== "sqlite") return undefined;
  const file = databaseUrl.replace(/^file:/, "");
  if (file === ":memory:" || existsSync(resolve(file))) return undefined;
  return { missing: `The database does not exist: ${file}.` };
}

/**
 * Creates the adapter with the dialect and URL set in the environment the
 * factory reads, put back afterwards, and the static system tables resolvable
 * on it. A read-only open whose PostgreSQL schema is not there answers
 * `missing`; any other failure ends with the one code every command that
 * opens a database ends with.
 */
async function createUnderEnv(
  options: CreateCliAdapterOptions,
  readOnly: boolean,
  dialect: SupportedDialect,
  databaseUrl: string
): Promise<CLIDatabaseAdapter | MissingDatabase> {
  const { createAdapterFromEnv } = await import("../../database/factory");
  const originalDialect = process.env.DB_DIALECT;
  const originalUrl = process.env.DATABASE_URL;
  // The CONFIGURED schema, not the default. `migrate` applying DDL through
  // `public` while the application it is migrating runs in `cms` splits the
  // lock and the ledger and leaves the tables where nothing reads them.
  const schema = options.schema ?? activePostgresSchema();
  try {
    process.env.DB_DIALECT = dialect;
    process.env.DATABASE_URL = databaseUrl;
    const adapter = await createAdapterFromEnv({
      ...(schema === DEFAULT_POSTGRES_SCHEMA ? {} : { schema }),
      ...(readOnly ? { readOnly: true } : {}),
    });
    // The static system tables, resolvable by name from the moment the adapter exists. The
    // adapter writes only to a table its resolver holds, and several commands install no resolver
    // of their own before they write one: the schema lock seeds its field-group row through a
    // transaction insert, inside `migrate:resolve`, `migrate:baseline`, `migrate:down`, `upgrade`
    // and plugin install and uninstall. A command that installs its own resolver replaces this one.
    // Loaded here, as the factory is, so the CLI's light entry points do not import the tables.
    const { installRegistryResolver } = await import("./registry-resolver");
    installRegistryResolver(adapter);
    // Before the command creates or migrates anything: with the setting moved
    // on an existing site, `migrate` and `db:sync` would build a second, empty
    // installation in the newly named schema.
    if (dialect === "postgresql") {
      try {
        await assertInstallationInConfiguredSchema(
          adapter.getDrizzle(),
          schema
        );
      } catch (error) {
        await adapter.disconnect().catch(() => {});
        throw error;
      }
    }
    return adapter;
  } catch (error) {
    if (
      readOnly &&
      (error as { code?: unknown }).code === INVALID_SCHEMA_NAME
    ) {
      return {
        missing: `The database does not exist: PostgreSQL has no schema "${schema}".`,
      };
    }
    // Read here, once, so every command that opens a database ends with the same code for it.
    throw connectionFailure(dialect, error);
  } finally {
    if (originalDialect !== undefined) process.env.DB_DIALECT = originalDialect;
    if (originalUrl !== undefined) process.env.DATABASE_URL = originalUrl;
  }
}

/**
 * Execute a function with a database adapter, ensuring cleanup
 *
 * @param fn - Function to execute with the adapter
 * @param options - Adapter creation options
 * @returns Result of the function
 *
 * @example
 * ```typescript
 * const result = await withAdapter(async (adapter) => {
 *   return await someOperation(adapter);
 * }, { logger });
 * ```
 */
export async function withAdapter<T>(
  fn: (adapter: CLIDatabaseAdapter) => Promise<T>,
  options: CreateCliAdapterOptions = {}
): Promise<T> {
  const adapter = await createCliAdapter(options);
  try {
    return await fn(adapter);
  } finally {
    await adapter.disconnect();
  }
}

/**
 * A dialect's human-readable name; it lives with the migration file writer,
 * which the server also runs, and is re-exported for the commands.
 */
export { getDialectDisplayName } from "../../domains/schema/migrate-create/dialect-name";

/**
 * Check if a dialect supports a specific feature
 *
 * @param dialect - Database dialect
 * @param feature - Feature to check
 * @returns Whether the feature is supported
 */
export function dialectSupports(
  dialect: SupportedDialect,
  feature: "transactions" | "jsonb" | "arrays" | "uuids"
): boolean {
  switch (feature) {
    case "transactions":
      return true;
    case "jsonb":
      return dialect === "postgresql";
    case "arrays":
      return dialect === "postgresql";
    case "uuids":
      return dialect === "postgresql";
    default:
      return false;
  }
}
