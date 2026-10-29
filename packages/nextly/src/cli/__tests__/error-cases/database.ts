/**
 * Cases for a database the CLI could not find or reach, through the helpers the commands call.
 *
 * @module cli/__tests__/error-cases/database
 */
import { databaseEnvError, databaseUnreachable } from "../../errors";

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
    databaseUnreachable(
      "postgresql",
      Object.assign(new Error("connect ECONNREFUSED 127.0.0.1:5432"), {
        code: "ECONNREFUSED",
      })
    ),
} satisfies ErrorCases;
