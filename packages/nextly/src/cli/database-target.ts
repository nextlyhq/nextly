/**
 * The database a command is about to use, as an operator names one: the
 * dialect, the target as that dialect names it, and whether it is on this
 * machine. For PostgreSQL and MySQL the target is the host, the port and the
 * database name, with the socket's path in place of the host where the URL
 * names a socket; for SQLite the file's path, resolved against the project
 * folder, or `:memory:`.
 *
 * All three come from one reading of the address (`readDatabaseAddress`),
 * the one the place rule judges, so the line can never name one database
 * and judge another. That reading takes the URL's named parts and nothing
 * else: a user name, a password and every query parameter are never read
 * into the answer, so a credential carried in a form nobody listed cannot
 * reach a terminal; a URL that cannot be read is never repeated.
 *
 * It imports no application module: the program asks it before a command's
 * work is loaded.
 *
 * @module cli/database-target
 */

import {
  placeOf,
  readDatabaseAddress,
  type DatabaseAddress,
  type DatabaseAddressInput,
  type DatabasePlace,
} from "../shared/lib/database-place";
import type { Dialect } from "../shared/lib/stated-dialect";

/** Each dialect as it is written. */
const NAMES: Record<Dialect, string> = {
  postgresql: "PostgreSQL",
  mysql: "MySQL",
  sqlite: "SQLite",
};

const UNREADABLE = "(address not readable)";

/** The database a command is about to use, in the words its line prints. */
export interface DatabaseTarget {
  /** Which kind of address was read: none set, unrecognised, SQLite or a server. */
  kind: DatabaseAddress["kind"];
  /** The dialect as it is written, or undefined where none is known. */
  dialect: string | undefined;
  /** Where it is, as that dialect names it; never a credential. */
  target: string;
  place: DatabasePlace;
}

/** The text of `address`, as its dialect names it. */
function targetText(address: DatabaseAddress): string {
  switch (address.kind) {
    case "none":
      return "none";
    case "unrecognised":
      return "(database not recognised)";
    case "sqlite":
      return address.file ?? UNREADABLE;
    case "server": {
      const { parts } = address;
      if (!parts) return UNREADABLE;
      const name = parts.database === "" ? "" : `/${parts.database}`;
      return parts.host.startsWith("/")
        ? `${parts.host}${name}`
        : `${parts.host}:${parts.port}${name}`;
    }
  }
}

/** The dialect `address` is read as, as it is written. */
function dialectName(address: DatabaseAddress): string | undefined {
  if (address.kind === "sqlite") return NAMES.sqlite;
  return address.kind === "server" ? NAMES[address.dialect] : undefined;
}

/**
 * The dialect, the target and the place of the database `input` names:
 * `PostgreSQL`, `db.internal:5432/shop`, `live`; `SQLite`,
 * `/srv/app/data/app.db`, `local`. `folder` is the project folder a SQLite
 * path is resolved against.
 */
export function databaseTarget(
  input: DatabaseAddressInput & { folder: string }
): DatabaseTarget {
  const address = readDatabaseAddress(input);
  return {
    kind: address.kind,
    dialect: dialectName(address),
    target: targetText(address),
    place: placeOf(address),
  };
}
