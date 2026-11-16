// How one column converts on the database it lives in: the plan each dialect builds from the live
// table. Reads the table and changes nothing; the statements are run by the change that applies
// safe differences.
//
// @module domains/schema/repair-columns/conversion

import { buildMysqlConversion } from "./mysql";
import { buildPostgresConversion } from "./postgres";
import { buildSqliteConversion } from "./sqlite";
import type { ColumnConversionPlan, ConversionRequest } from "./types";

export type {
  ColumnConversionPlan,
  ConversionRequest,
  NotCarried,
} from "./types";

/** The plan for converting `request`'s column, read from the live table through `db`. */
export async function buildColumnConversion(
  db: unknown,
  request: ConversionRequest
): Promise<ColumnConversionPlan> {
  switch (request.dialect) {
    case "postgresql":
      return buildPostgresConversion(db, request);
    case "mysql":
      return buildMysqlConversion(db, request);
    case "sqlite":
      return buildSqliteConversion(db, request);
  }
}
