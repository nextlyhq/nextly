/**
 * The connection test: before anything is written, connect with the string
 * the person gave, read the server's version, and see what the database
 * already holds. It writes nothing to the database; only `createDatabase`,
 * asked for by the person, does.
 */
import { classify, failureMessage, versionMessage } from "./causes";
import { connectWithDriver } from "./drivers";
import { readTarget } from "./target";
import type {
  Connect,
  ConnectionResult,
  OpenConnection,
  ServerDialect,
} from "./types";
import { judgeVersion } from "./version";

/**
 * Tables only Nextly makes. A database holding any of them holds a Nextly
 * site: its migration records, and its collections' and Singles' registry.
 */
export const NEXTLY_TABLES = [
  "nextly_schema_events",
  "nextly_migrations",
  "dynamic_collections",
  "dynamic_singles",
] as const;

const QUERIES: Record<
  ServerDialect,
  { version: string; database: string; tables: string }
> = {
  postgresql: {
    version: "SELECT version() AS version",
    database: "SELECT current_database() AS name",
    tables:
      "SELECT table_name AS name FROM information_schema.tables " +
      "WHERE table_schema = current_schema() AND table_type = 'BASE TABLE'",
  },
  mysql: {
    version: "SELECT VERSION() AS version",
    database: "SELECT DATABASE() AS name",
    tables:
      "SELECT table_name AS name FROM information_schema.tables " +
      "WHERE table_schema = DATABASE() AND table_type = 'BASE TABLE'",
  },
};

/** Reads one column of the first row, whatever case the server gives its name in. */
function first(rows: Record<string, unknown>[], column: string): string {
  const row = rows[0] ?? {};
  const key = Object.keys(row).find(k => k.toLowerCase() === column);
  const value = key === undefined ? undefined : row[key];
  if (typeof value === "string") return value;
  return typeof value === "number" ? String(value) : "";
}

/** Tests `url` for `dialect`. Never throws: a failure is a result. */
export async function testConnection(
  dialect: ServerDialect,
  url: string,
  connect: Connect = connectWithDriver
): Promise<ConnectionResult> {
  const target = readTarget(url, dialect);
  let connection: OpenConnection;
  try {
    connection = await connect(dialect, url);
  } catch (error) {
    const cause = classify(error);
    return {
      ok: false,
      cause,
      message: failureMessage(cause, dialect, target, error),
      ...(cause === "database-missing" && target.database
        ? { database: target.database }
        : {}),
      // The server answered "no such database", so it accepted the login.
      canCreate:
        cause === "database-missing" &&
        target.onThisMachine &&
        target.database !== undefined,
    };
  }

  try {
    const queries = QUERIES[dialect];
    const verdict = judgeVersion(
      dialect,
      first(await connection.rows(queries.version), "version")
    );
    if (!verdict.supported) {
      return {
        ok: false,
        cause: "version-unsupported",
        message: versionMessage(verdict.server, verdict.required),
        canCreate: false,
      };
    }

    const database = first(await connection.rows(queries.database), "name");
    // MySQL connects without a database when the string names none.
    if (!database) {
      return {
        ok: false,
        cause: "database-missing",
        message: failureMessage("database-missing", dialect, {
          ...target,
          database: undefined,
        }),
        canCreate: false,
      };
    }

    const tables = (await connection.rows(queries.tables)).map(row =>
      first([row], "name")
    );
    const existingTables =
      tables.length === 0
        ? undefined
        : tables.some(name =>
              (NEXTLY_TABLES as readonly string[]).includes(name)
            )
          ? ("nextly" as const)
          : ("other" as const);

    return {
      ok: true,
      server: verdict.server,
      database,
      ...(existingTables ? { existingTables } : {}),
      ...(verdict.supported && verdict.variantWarning
        ? { variantWarning: verdict.variantWarning }
        : {}),
    };
  } catch (error) {
    const cause = classify(error);
    return {
      ok: false,
      cause: cause === "database-missing" ? "other" : cause,
      message: failureMessage(
        cause === "database-missing" ? "other" : cause,
        dialect,
        target,
        error
      ),
      canCreate: false,
    };
  } finally {
    await connection.close();
  }
}

/** The line a working connection is reported with. */
export function connectedLine(result: {
  server: string;
  database: string;
}): string {
  return `Connected to ${result.server}, database "${result.database}" (tested)`;
}
