/**
 * Which delivery table a dialect uses.
 *
 * The three dialect definitions are interchangeable at the call site and the
 * choice between them is one question, so it is answered here rather than at
 * each caller. A second switch written elsewhere would agree on the day it was
 * written and silently stop agreeing the moment a dialect is added — and the
 * caller that kept the old mapping would read and write a table nothing else
 * touches, which looks like data going missing rather than like a bug.
 *
 * @module domains/email/deliveries-table
 */

import { NextlyError } from "../../errors";
import { emailDeliveriesMysql } from "../../schemas/email-deliveries/mysql";
import { emailDeliveriesPg } from "../../schemas/email-deliveries/postgres";
import { emailDeliveriesSqlite } from "../../schemas/email-deliveries/sqlite";

/** The delivery table, as one of the three dialect bundles defines it. */
export type EmailDeliveriesTable =
  | typeof emailDeliveriesPg
  | typeof emailDeliveriesMysql
  | typeof emailDeliveriesSqlite;

/**
 * Resolve the delivery table for a dialect.
 *
 * Throws rather than falling back, because every fallback here is wrong: a
 * default table would be the wrong dialect's, and returning undefined would
 * turn "this dialect is not supported" into "this install has no deliveries",
 * which reads as an empty log rather than as a missing capability.
 */
export function deliveriesTableFor(dialect: string): EmailDeliveriesTable {
  switch (dialect) {
    case "postgresql":
      return emailDeliveriesPg;
    case "mysql":
      return emailDeliveriesMysql;
    case "sqlite":
      return emailDeliveriesSqlite;
    default:
      throw NextlyError.internal({
        logContext: {
          reason: "unsupported dialect for the email delivery log",
          dialect: String(dialect),
        },
      });
  }
}
