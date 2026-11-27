/**
 * Creates the database a connection string names, on a server on this
 * machine that accepted the login, when the person asks for it. It connects
 * to the server's own database (`postgres`) or to none (MySQL) with the same
 * credentials, so nothing but that one database is touched.
 */
import { classify, failureMessage } from "./causes";
import { connectWithDriver } from "./drivers";
import { readTarget } from "./target";
import type { Connect, ServerDialect } from "./types";

/** `name` as an identifier the server reads as exactly that name. */
export function quoteIdentifier(dialect: ServerDialect, name: string): string {
  return dialect === "postgresql"
    ? `"${name.replace(/"/g, '""')}"`
    : `\`${name.replace(/`/g, "``")}\``;
}

/** `url` with its database swapped for the server's own, or for none. */
export function serverUrl(dialect: ServerDialect, url: string): string {
  const parsed = new URL(url);
  parsed.pathname = dialect === "postgresql" ? "/postgres" : "/";
  return parsed.toString();
}

/** Undefined once the database exists; otherwise why it could not be made. */
export async function createDatabase(
  dialect: ServerDialect,
  url: string,
  connect: Connect = connectWithDriver
): Promise<string | undefined> {
  const target = readTarget(url, dialect);
  // Asked again here, not only where the offer is made: nothing is created
  // on a server that is not on this machine.
  if (!target.onThisMachine || !target.database) {
    return "Nextly creates a database only on a server on this machine. Create it on the server, then try again.";
  }
  let connection;
  try {
    connection = await connect(dialect, serverUrl(dialect, url));
  } catch (error) {
    const cause = classify(error);
    return failureMessage(
      cause === "database-missing" ? "other" : cause,
      dialect,
      target,
      error
    );
  }
  try {
    await connection.rows(
      `CREATE DATABASE ${quoteIdentifier(dialect, target.database)}`
    );
    return undefined;
  } catch (error) {
    const code = (error as { code?: unknown }).code;
    // The person may lack the right to create databases.
    return `The server did not create "${target.database}"${typeof code === "string" ? ` (${code})` : ""}. Create it yourself, or use a login that may create databases.`;
  } finally {
    await connection.close();
  }
}
