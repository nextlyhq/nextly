// The `USING` clause of a PostgreSQL column-type change, for the migration-file renderer
// (`sql-templates/postgres.ts`) and the dev apply's emitter (`ddl-emitter/postgres.ts`) alike, so
// a change runs the same way whichever route carries it.

import { stringNarrowingLimit } from "../classifier/type-widening";

/**
 * `USING "<col>"::<toType>` dispatches to whichever cast PostgreSQL has for the pair, which a
 * cross-family change such as `text` → `jsonb` needs; with no cast at all the statement fails
 * loudly. A string narrowing to `varchar(N)` is the exception: the explicit length cast cuts an
 * overlong value to N characters without an error, while the assignment cast PostgreSQL applies to
 * the bare column refuses it ("value too long"), leaving the column and its values as they were.
 */
export function postgresAlterTypeUsing(
  quotedColumn: string,
  fromType: string,
  toType: string
): string {
  return stringNarrowingLimit(fromType, toType, "postgresql") === null
    ? `USING ${quotedColumn}::${toType}`
    : `USING ${quotedColumn}`;
}
