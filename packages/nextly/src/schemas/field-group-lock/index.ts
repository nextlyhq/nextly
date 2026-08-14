/**
 * `nextly_field_group_lock` — dialect-aware barrel.
 *
 * @module schemas/field-group-lock
 */

import type { SupportedDialect } from "@nextlyhq/adapter-drizzle/types";
import { getTableConfig as mysqlTableConfig } from "drizzle-orm/mysql-core";
import { getTableConfig as pgTableConfig } from "drizzle-orm/pg-core";
import { getTableConfig as sqliteTableConfig } from "drizzle-orm/sqlite-core";

import { NextlyError } from "../../errors/nextly-error";

import * as my from "./mysql";
import * as pg from "./postgres";
import * as sl from "./sqlite";

export { pg, my, sl };

/** A column the lock table is made of. */
export type FieldGroupLockColumn = "id" | "owner" | "expires_at";

/**
 * The physical type each lock column is declared with, read out of the declaration itself.
 *
 * The bootstrap DDL has to name a type per column, and the declarations above already carry one.
 * Restating them there would be a second answer to the same question, drifting silently: the
 * bootstrap would keep creating the old shape while a reconcile proposed the new one on every run.
 * Reading `getSQLType()` makes the declaration the only place a type is chosen.
 *
 * Read through each dialect's own `getTableConfig` rather than the table object's own accessor,
 * which the drizzle-v1 gate bars, following the prior art in the declaration-parity test.
 */
export function fieldGroupLockColumnTypes(
  dialect: SupportedDialect
): Record<FieldGroupLockColumn, string> {
  const columns =
    dialect === "postgresql"
      ? pgTableConfig(pg.nextlyFieldGroupLock).columns
      : dialect === "mysql"
        ? mysqlTableConfig(my.nextlyFieldGroupLock).columns
        : sqliteTableConfig(sl.nextlyFieldGroupLock).columns;
  const declared = new Map(
    columns.map(column => [column.name, column.getSQLType()])
  );

  const read = (name: FieldGroupLockColumn): string => {
    const type = declared.get(name);
    if (type === undefined) {
      // The declaration lost a column the bootstrap needs. `internal` because only a code change
      // can produce it, and failing here beats emitting a CREATE with a hole in it.
      throw NextlyError.internal({
        logContext: {
          reason: "field-group lock declaration is missing a column",
          dialect,
          column: name,
        },
      });
    }
    return type;
  };

  return {
    id: read("id"),
    owner: read("owner"),
    expires_at: read("expires_at"),
  };
}

/** The lock table for the requested dialect. */
export function fieldGroupLockTables(dialect: SupportedDialect) {
  switch (dialect) {
    case "postgresql":
      return { nextlyFieldGroupLock: pg.nextlyFieldGroupLock };
    case "mysql":
      return { nextlyFieldGroupLock: my.nextlyFieldGroupLock };
    case "sqlite":
      return { nextlyFieldGroupLock: sl.nextlyFieldGroupLock };
    default: {
      // Exhaustiveness check — TypeScript flags any missing dialect at compile time, so reaching
      // here at runtime means a dialect was added without a table for it. `internal` because that
      // is a programming mistake rather than a state an operator can be in or fix.
      const _exhaustive: never = dialect;
      throw NextlyError.internal({
        logContext: {
          reason: "no field-group lock table for this dialect",
          dialect: String(_exhaustive),
        },
      });
    }
  }
}
