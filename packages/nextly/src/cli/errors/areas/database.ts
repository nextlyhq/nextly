/**
 * Codes for a database the CLI could not find or reach.
 *
 * Raised by the commands themselves, from the environment check and the connection attempt, so
 * this area has no mappings, only the helpers those commands call. A connection string is never
 * printed: it carries the password.
 *
 * @module cli/errors/areas/database
 */

import { NextlyError } from "../../../errors/nextly-error";
import type {
  DatabaseEnvValidation,
  SupportedDialect,
} from "../../utils/adapter";
import { CliError } from "../cli-error";
import { defineCodes } from "../define";
import { deepestMessage } from "../messages";

export const DATABASE_CODES = defineCodes({
  DATABASE_URL_MISSING: {
    cause: "`DATABASE_URL` is not set, so the command has no database to use.",
  },
  DATABASE_DIALECT_UNKNOWN: {
    cause:
      "The database type could not be told from `DATABASE_URL`, and `DB_DIALECT` is not set.",
  },
  DATABASE_DIALECT_INVALID: {
    cause: "`DB_DIALECT` names a database Nextly does not support.",
  },
  DATABASE_ADAPTER_MISSING: {
    cause:
      "The database adapter package for the dialect `DATABASE_URL` names is not installed.",
  },
  DATABASE_UNREACHABLE: {
    cause:
      "The command could not connect to the database `DATABASE_URL` names.",
  },
});

const DIALECTS = "`postgresql`, `mysql` or `sqlite`";

/** The error for a failed environment check, naming the first thing to fix. */
export function databaseEnvError(validation: DatabaseEnvValidation): CliError {
  switch (validation.problem) {
    case "dialect-undetected":
      return new CliError("DATABASE_DIALECT_UNKNOWN", {
        what: "The database type could not be told from `DATABASE_URL`.",
        why: "It starts with none of `postgres://`, `mysql://` or `file:`, and `DB_DIALECT` is not set.",
        next: `Set \`DB_DIALECT\` to ${DIALECTS} in \`.env\`.`,
      });
    case "dialect-invalid":
      return new CliError("DATABASE_DIALECT_INVALID", {
        what: `\`DB_DIALECT\` is \`${process.env.DB_DIALECT ?? ""}\`, which is not a database Nextly supports.`,
        why: "Nextly runs on PostgreSQL, MySQL and SQLite.",
        next: `Set \`DB_DIALECT\` to ${DIALECTS}, or remove it to read the type from \`DATABASE_URL\`.`,
      });
    case "url-missing":
    default:
      return new CliError("DATABASE_URL_MISSING", {
        what: "`DATABASE_URL` is not set, so there is no database to use.",
        why: "The command reads the database from `DATABASE_URL`, in the environment or the project's `.env` file.",
        next: "Set `DATABASE_URL` in `.env`, for example `DATABASE_URL=postgres://user:password@localhost:5432/app`.",
      });
  }
}

const DIALECT_NAMES: Record<SupportedDialect, string> = {
  postgresql: "PostgreSQL",
  mysql: "MySQL",
  sqlite: "SQLite",
};

/** The error for a connection that failed, with the driver's own reason. */
function databaseUnreachable(
  dialect: SupportedDialect,
  error: unknown
): CliError {
  return new CliError(
    "DATABASE_UNREACHABLE",
    {
      what: `The command could not connect to the ${DIALECT_NAMES[dialect]} database.`,
      why: deepestMessage(error) ?? "The driver gave no reason.",
      next: "Check that the database is running and that `DATABASE_URL` names its host, port, database, user and password.",
    },
    error instanceof Error ? error : undefined
  );
}

const ADAPTER_PACKAGES: Record<SupportedDialect, string> = {
  postgresql: "@nextlyhq/adapter-postgres",
  mysql: "@nextlyhq/adapter-mysql",
  sqlite: "@nextlyhq/adapter-sqlite",
};

/**
 * A failure to open the database, as the code for what failed.
 *
 * Every command opens its database through `createCliAdapter`, so this one place tells apart the
 * three things that fail there: an error that already has its code (a PostgreSQL schema Nextly
 * cannot use) keeps it; the adapter's package not being installed, which the factory reports as
 * "Failed to load database adapter"; and the connection itself.
 */
export function connectionFailure(
  dialect: SupportedDialect,
  error: unknown
): NextlyError {
  if (NextlyError.is(error)) return error;
  if (
    error instanceof Error &&
    error.message.startsWith("Failed to load database adapter")
  ) {
    const pkg = ADAPTER_PACKAGES[dialect];
    return new CliError(
      "DATABASE_ADAPTER_MISSING",
      {
        what: `The ${DIALECT_NAMES[dialect]} adapter, \`${pkg}\`, is not installed.`,
        why: `\`DATABASE_URL\` names a ${DIALECT_NAMES[dialect]} database, and Nextly reaches it through that package.`,
        next: `Install it in the project, for example \`pnpm add ${pkg}\`, then run the command again.`,
      },
      error
    );
  }
  return databaseUnreachable(dialect, error);
}
