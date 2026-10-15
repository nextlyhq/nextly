/**
 * `nextly_spent_challenges` — dialect-aware barrel.
 *
 * @module schemas/spent-challenges
 */

import type { SupportedDialect } from "@nextlyhq/adapter-drizzle/types";

import { NextlyError } from "../../errors/nextly-error";

import * as my from "./mysql";
import * as pg from "./postgres";
import * as sl from "./sqlite";

export { pg, my, sl };

// Re-exported from the leaf that declares it, so this barrel stays one of
// the readers rather than becoming a second author. See `./table-name`.
export { SPENT_CHALLENGES_TABLE } from "./table-name";

/**
 * The one place a dialect is turned into the spent challenges' table. The
 * `never` assignment makes the compiler demand a case for a dialect added
 * later, rather than handing back another dialect's table.
 */
function spentChallengesForDialect(dialect: SupportedDialect) {
  switch (dialect) {
    case "postgresql":
      return pg.nextlySpentChallenges;
    case "mysql":
      return my.nextlySpentChallenges;
    case "sqlite":
      return sl.nextlySpentChallenges;
    default: {
      const _exhaustive: never = dialect;
      throw NextlyError.internal({
        logContext: {
          reason: "no spent challenges table for this dialect",
          dialect: String(_exhaustive),
        },
      });
    }
  }
}

/** The spent challenges' table for the requested dialect, as a schema fragment. */
export function spentChallengesTables(dialect: SupportedDialect) {
  return { nextlySpentChallenges: spentChallengesForDialect(dialect) };
}
