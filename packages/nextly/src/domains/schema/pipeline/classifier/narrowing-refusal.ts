// The one refusal for a string narrowing that would cut stored values short, raised before any DDL
// by the classifier (a narrowing it can see) and by the pre-resolution executor (one a confirmed
// rename carries, which the classifier saw only as a drop and an add). One builder, so the two
// cannot come to describe the same refusal differently.

import { NextlyError } from "../../../../errors";

export function narrowingRefusal(args: {
  tableName: string;
  columnName: string;
  toType: string;
  limit: number;
  longer: number;
  fromType?: string;
}): NextlyError {
  const { tableName, columnName, toType, limit, longer } = args;
  return NextlyError.validation({
    errors: [
      {
        path: `schema.${tableName}.${columnName}`,
        code: "NARROWING_WOULD_TRUNCATE",
        message:
          `${tableName}.${columnName} cannot become ${toType}: ` +
          `${String(longer)} row(s) hold a value longer than ${String(limit)} characters. ` +
          `Shorten those values, or give the field a type that holds them (a textarea, ` +
          `or a larger maxLength), then apply again.`,
      },
    ],
    logContext: {
      table: tableName,
      column: columnName,
      fromType: args.fromType,
      toType,
      longer,
    },
  });
}
