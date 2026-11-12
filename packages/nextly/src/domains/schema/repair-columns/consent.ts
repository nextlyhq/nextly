// Which data-loss consent covers clearing a lossy column's values.
//
// The consent is the one every command shares (`--accept-data-loss`, `NEXTLY_ACCEPT_DATA_LOSS`),
// parsed once by `migrate/data-loss-consent`. A repair runs against a live database with no
// reviewed file behind it, so it takes the consent only where it names the column, as
// `table.column`: the form without a list, and a list naming only the table, cover drops elsewhere
// but never clear a repaired column's values. Each says so, with the consent that would cover it,
// so a variable left set for another command neither clears values nor stops the safe repairs.
//
// @module domains/schema/repair-columns/consent

import {
  ACCEPT_DATA_LOSS_FLAG,
  type DataLossConsent,
} from "../migrate/data-loss-consent";

/** Whether the run's consent covers clearing one column's values, and what to tell its owner. */
export interface ColumnConsent {
  covered: boolean;
  /** Why a consent that was given does not cover the column; null where none was or it does. */
  notice: string | null;
  /** The consent that covers the column, as its owner would type it. */
  flag: string;
}

/** The consent naming one column, as its owner would type it. */
export function consentFlagFor(table: string, column: string): string {
  return `${ACCEPT_DATA_LOSS_FLAG}=${table}.${column}`;
}

/** Whether `consent` names `table`.`column`, matched as the report prints it, ignoring case. */
export function consentForColumn(
  consent: DataLossConsent,
  table: string,
  column: string
): ColumnConsent {
  const flag = consentFlagFor(table, column);
  const given = consent.given;
  if (given === null) return { covered: false, notice: null, flag };
  if (given.targets === "all") {
    return {
      covered: false,
      notice: `${ACCEPT_DATA_LOSS_FLAG} without a list does not cover a repair: name the column, ${flag}`,
      flag,
    };
  }
  const wanted = `${table}.${column}`.toLowerCase();
  for (const named of given.targets.columns) {
    if (named.toLowerCase() === wanted) {
      return { covered: true, notice: null, flag };
    }
  }
  for (const named of given.targets.tables) {
    if (named.toLowerCase() === table.toLowerCase()) {
      return {
        covered: false,
        notice: `${ACCEPT_DATA_LOSS_FLAG} names the table ${table}, not the column: a repair clears values only in a column named, ${flag}`,
        flag,
      };
    }
  }
  return { covered: false, notice: null, flag };
}
