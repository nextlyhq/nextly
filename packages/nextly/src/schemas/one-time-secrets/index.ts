/**
 * The one-time secrets table for each dialect.
 *
 * @module schemas/one-time-secrets
 */

import type { SupportedDialect } from "@nextlyhq/adapter-drizzle/types";

import { NextlyError } from "../../errors/nextly-error";

import * as my from "./mysql";
import * as pg from "./postgres";
import * as sl from "./sqlite";

export { pg, my, sl };
export { ONE_TIME_SECRETS_TABLE } from "./table-name";

function secretsForDialect(dialect: SupportedDialect) {
  switch (dialect) {
    case "postgresql":
      return pg.nextlyOneTimeSecrets;
    case "mysql":
      return my.nextlyOneTimeSecrets;
    case "sqlite":
      return sl.nextlyOneTimeSecrets;
    default: {
      const _exhaustive: never = dialect;
      throw NextlyError.internal({
        logContext: {
          reason: "no one-time secrets table for this dialect",
          dialect: String(_exhaustive),
        },
      });
    }
  }
}

/** The table, keyed as `getCoreSchema` spreads it. */
export function oneTimeSecretsTables(dialect: SupportedDialect) {
  return { nextlyOneTimeSecrets: secretsForDialect(dialect) };
}
