/**
 * What most commands need before they do their work: a database named by the environment, the
 * configuration, and a connection. Each ends the command in the error shape when it cannot be
 * had, so a command reads its prerequisites in one line each and every command fails them alike.
 *
 * @module cli/utils/command-prerequisites
 */

import { databaseEnvError } from "../errors/areas/database";
import { exitWithError } from "../errors/report";

import {
  createCliAdapter,
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
