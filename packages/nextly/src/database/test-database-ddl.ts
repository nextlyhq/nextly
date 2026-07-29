// DDL for the throwaway databases the test harness provisions, one statement
// per dialect.
//
// Creating and dropping a database is the one operation Drizzle's query
// builder cannot express: `CREATE DATABASE` is outside any schema, takes no
// bind parameters in either dialect, and has no builder representation. The
// repository's answer to that elsewhere is a named DDL module rather than
// strings inline at the call site — see `getSchemaEventsDdl` and
// `generateSqliteCoreTableStatements` — so the same applies here: the
// statements live in one place, with the identifier rule enforced once for
// every caller instead of at each site that interpolates a name.
//
// SQLite is absent on purpose. It has no server and no databases to create;
// the harness runs it in memory.

import { NextlyError } from "../errors/nextly-error";

/** The dialects that have a server on which a database can be created. */
export type ProvisionableDialect = "postgresql" | "mysql";

/**
 * Names this module will interpolate.
 *
 * Deliberately narrower than either dialect allows: the harness generates
 * these names itself, so anything outside the pattern means a caller is
 * passing something it should not, and there is no quoting to fall back on.
 */
const SAFE_DATABASE_NAME = /^[a-z][a-z0-9_]{0,62}$/;

function assertSafeName(name: string): string {
  if (!SAFE_DATABASE_NAME.test(name)) {
    throw NextlyError.internal({
      logContext: {
        reason:
          `Refusing to build database DDL for the name "${name}". Test ` +
          `database names must match ${String(SAFE_DATABASE_NAME)}.`,
      },
    });
  }
  return name;
}

/** `CREATE DATABASE` for a name this process generated. */
export function createDatabaseStatement(
  _dialect: ProvisionableDialect,
  name: string
): string {
  return `CREATE DATABASE ${assertSafeName(name)}`;
}

/**
 * `DROP DATABASE` for a name this process generated.
 *
 * Deliberately without PostgreSQL's `WITH (FORCE)`. Forcing terminates any
 * session still attached, and the server reports that termination to the
 * client as a fatal error on a connection the driver still considers live —
 * which surfaces as an unhandled exception and fails the whole run rather
 * than the one connection. Callers disconnect before dropping instead, so
 * there is nothing to force.
 */
export function dropDatabaseStatement(
  _dialect: ProvisionableDialect,
  name: string
): string {
  return `DROP DATABASE IF EXISTS ${assertSafeName(name)}`;
}
