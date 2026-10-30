/**
 * Cases for a database the CLI could not find or reach, through the helpers the commands call.
 *
 * @module cli/__tests__/error-cases/database
 */
import { connectionFailure } from "../../errors/areas/database";
import { databaseEnvError } from "../../errors";

import type { ErrorCases } from "./types";

export const DATABASE_CASES = {
  DATABASE_URL_MISSING: () =>
    databaseEnvError({ valid: false, errors: [], problem: "url-missing" }),
  DATABASE_DIALECT_UNKNOWN: () =>
    databaseEnvError({
      valid: false,
      errors: [],
      problem: "dialect-undetected",
    }),
  DATABASE_DIALECT_INVALID: () => {
    const previous = process.env.DB_DIALECT;
    process.env.DB_DIALECT = "mssql";
    try {
      return databaseEnvError({
        valid: false,
        errors: [],
        problem: "dialect-invalid",
      });
    } finally {
      if (previous === undefined) delete process.env.DB_DIALECT;
      else process.env.DB_DIALECT = previous;
    }
  },
  DATABASE_UNREACHABLE: () =>
    connectionFailure(
      "postgresql",
      Object.assign(new Error("connect ECONNREFUSED 127.0.0.1:5432"), {
        code: "ECONNREFUSED",
      })
    ),
  // The factory's own wording when the adapter's package cannot be imported.
  DATABASE_ADAPTER_MISSING: () =>
    connectionFailure(
      "mysql",
      new Error(
        "Failed to load database adapter for \"mysql\". Make sure @nextlyhq/adapter-mysql is installed:\n\n  npm install @nextlyhq/adapter-mysql\n\nOriginal error: Cannot find package '@nextlyhq/adapter-mysql'"
      )
    ),
  // As the PostgreSQL adapter's version check throws it at connect.
  DATABASE_VERSION_UNSUPPORTED: () =>
    connectionFailure(
      "postgresql",
      Object.assign(
        new Error(
          "PostgreSQL 12.4 is not supported; Nextly needs 15 or later."
        ),
        {
          kind: "unsupported_version",
          dialect: "postgresql",
          detectedVersion: "12.4",
          requiredVersion: "15",
        }
      )
    ),
} satisfies ErrorCases;
