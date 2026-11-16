/**
 * What most commands need before they do their work: a database named by the environment, the
 * configuration, and a connection. Each ends the command in the error shape when it cannot be
 * had, so a command reads its prerequisites in one line each and every command fails them alike.
 *
 * @module cli/utils/command-prerequisites
 */

import { resolve } from "node:path";

import { assertPluginFieldDeclarations } from "../../shared/lib/assert-plugin-field-declarations";
import { configDeclarationError } from "../errors/areas/config";
import { databaseEnvError } from "../errors/areas/database";
import { exitWithError } from "../errors/report";

import {
  createCliAdapter,
  openCommandAdapter,
  validateDatabaseEnv,
  type CLIDatabaseAdapter,
  type CreateCliAdapterOptions,
  type DatabaseEnvValidation,
  type SupportedDialect,
} from "./adapter";
import {
  loadConfig,
  type LoadConfigOptions,
  type LoadConfigResult,
} from "./config-loader";
import type { Logger } from "./logger";

/** An environment check that passed: the dialect and the URL are both known. */
export type ValidDatabaseEnv = DatabaseEnvValidation & {
  valid: true;
  dialect: SupportedDialect;
  databaseUrl: string;
};

/**
 * The environment's database, or the error naming what is missing, thrown: for a command whose
 * own catch must run first, such as one that disconnects before it ends.
 */
export function databaseEnvOrThrow(): ValidDatabaseEnv {
  const validation = validateDatabaseEnv();
  if (
    !validation.valid ||
    validation.dialect === undefined ||
    validation.databaseUrl === undefined
  ) {
    throw databaseEnvError(validation);
  }
  return {
    ...validation,
    valid: true,
    dialect: validation.dialect,
    databaseUrl: validation.databaseUrl,
  };
}

/** The environment's database, or the command ends naming what is missing. */
export function requireDatabaseEnv(logger: Logger): ValidDatabaseEnv {
  try {
    return databaseEnvOrThrow();
  } catch (error) {
    exitWithError(logger, error);
  }
}

/** The configuration, or the command ends with the reason it could not be read. */
export async function loadConfigOrExit(
  options: LoadConfigOptions,
  logger: Logger
): Promise<LoadConfigResult> {
  try {
    return await loadConfig(options);
  } catch (error) {
    exitWithError(logger, error);
  }
}

/**
 * The database a command works on: under a dry run opened read-only, and
 * undefined when it is not there, which has been said and ends the command;
 * otherwise a connection, or the command ends with its failure's code.
 */
export async function openOrConnect(
  connection: CreateCliAdapterOptions & { dialect: SupportedDialect },
  dryRun: boolean,
  logger: Logger
): Promise<CLIDatabaseAdapter | undefined> {
  return dryRun
    ? openCommandAdapter({ ...connection, dryRun: true }, logger)
    : connectOrExit(connection, logger);
}

/** A connection to the database, or the command ends with the code `createCliAdapter` gave its failure. */
export async function connectOrExit(
  options: CreateCliAdapterOptions & { dialect: SupportedDialect },
  logger: Logger
): Promise<CLIDatabaseAdapter> {
  try {
    return await createCliAdapter(options);
  } catch (error) {
    exitWithError(logger, error);
  }
}

/**
 * The configuration, with each plugin field declaration in it checked, or the
 * command ends with the reason. `loadConfig` has registered
 * `contributes.fieldTypes` by now, which is the first moment an unknown field
 * type can be told apart from one a plugin had not contributed yet: the
 * `define*` validators defer that question because the config bundle is
 * evaluated before any plugin registers. Asked here, a misspelled or
 * wrong-surface token fails the command instead of silently generating
 * primitive fallback types and a snapshot that production boot then refuses.
 *
 * An invalid declaration is reported and the command exits, so it reads like
 * every other failure instead of an unhandled crash, unless `reportedAsRefusal`
 * answers that it reported it (a dry run names it as its refusal): then the
 * answer is undefined, and the command ends there.
 */
export async function loadDeclaredConfigOrExit(
  options: LoadConfigOptions,
  logger: Logger,
  reportedAsRefusal: (error: unknown) => boolean = () => false
): Promise<LoadConfigResult | undefined> {
  const configResult = await loadConfigOrExit(options, logger);
  try {
    assertPluginFieldDeclarations({
      collections: configResult.config.collections,
      singles: configResult.config.singles,
      fieldGroups: configResult.config.fieldGroups,
    });
  } catch (error) {
    if (reportedAsRefusal(error)) return undefined;
    exitWithError(logger, configDeclarationError(error) ?? error);
  }
  return configResult;
}

/** What a command that reads the migrations folder takes from its command line. */
interface MigrationCommandOptions {
  config?: string;
  cwd?: string;
  verbose?: boolean;
  dryRun?: boolean;
}

/**
 * A migration command's prerequisites, and its database: the database the
 * environment names, the configuration, the migrations folder that
 * configuration names (resolved against the command's working directory), and
 * the database opened, read-only under a dry run. Undefined when a dry run's
 * database is not there: that has been said, and the command ends there.
 */
export async function openMigrationCommand(
  options: MigrationCommandOptions,
  logger: Logger
): Promise<
  | {
      dbValidation: ValidDatabaseEnv;
      configResult: LoadConfigResult;
      cwd: string;
      migrationsDir: string;
      adapter: CLIDatabaseAdapter;
    }
  | undefined
> {
  const dbValidation = requireDatabaseEnv(logger);
  const configResult = await loadConfig({
    configPath: options.config,
    cwd: options.cwd,
    debug: options.verbose,
  });
  const cwd = options.cwd ?? process.cwd();
  const adapter = await openCommandAdapter(
    {
      dialect: dbValidation.dialect,
      databaseUrl: dbValidation.databaseUrl,
      logger: options.verbose ? logger : undefined,
      dryRun: options.dryRun,
    },
    logger
  );
  if (adapter === undefined) return undefined;
  return {
    dbValidation,
    configResult,
    cwd,
    migrationsDir: resolve(cwd, configResult.config.db.migrationsDir),
    adapter,
  };
}
