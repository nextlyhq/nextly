/**
 * The database a command is about to use, as an operator names one: the
 * dialect, and the target as that dialect names it. For PostgreSQL and MySQL
 * the host, the port and the database name, with the socket's path in place
 * of the host where the URL names a socket; for SQLite the file's path,
 * resolved against the project folder, or `:memory:`.
 *
 * Built from the URL's named parts and from nothing else. A user name, a
 * password and every query parameter are never read into the answer, so a
 * credential carried in a form nobody listed cannot reach a terminal; a URL
 * that cannot be read is never repeated.
 *
 * It imports no application module: the program asks it before a command's
 * work is loaded.
 *
 * @module cli/database-target
 */

import { resolve } from "node:path";

import {
  DIALECTS,
  dialectFromUrl,
  type Dialect,
} from "../shared/lib/stated-dialect";

/** Each dialect as it is written, and the port its server listens on unless told. */
const NAMES: Record<Dialect, string> = {
  postgresql: "PostgreSQL",
  mysql: "MySQL",
  sqlite: "SQLite",
};
const DEFAULT_PORTS = { postgresql: "5432", mysql: "3306" } as const;

/** The query parameter each dialect's URL names a socket with. */
const SOCKET_PARAMETERS = { postgresql: "host", mysql: "socketPath" } as const;

/** The dialect stated (`DB_DIALECT`) when it names one, else the one the URL implies. */
function dialectOf(
  url: string,
  stated: string | undefined
): Dialect | undefined {
  return (DIALECTS as readonly string[]).includes(stated ?? "")
    ? (stated as Dialect)
    : dialectFromUrl(url);
}

/** A SQLite URL's file, resolved against `folder`, or `:memory:`. */
function sqliteTarget(url: string, folder: string): string {
  const path = url.replace(/^file:/, "").split("?")[0] ?? "";
  return path === "" || path === ":memory:"
    ? ":memory:"
    : resolve(folder, path);
}

/** Stands in for the host of a URL that names none, so the rest of it can be read. */
const NO_HOST = "no-host.invalid";

/**
 * `url` parsed. A URL naming a socket may leave the host out
 * (`postgres://user@/shop?host=/run/pg`), which the parser refuses: it is
 * read with a stand-in host, which is never printed.
 */
function parseServerUrl(url: string): URL | undefined {
  for (const candidate of [
    url,
    url.replace(/^([a-z]+:\/\/(?:[^@/]*@)?)\//i, `$1${NO_HOST}/`),
  ]) {
    try {
      return new URL(candidate);
    } catch {
      // The next reading, or none.
    }
  }
  return undefined;
}

/** A server's address: its socket where the URL names one, else host and port, then the database. */
function serverTarget(
  url: string,
  dialect: keyof typeof DEFAULT_PORTS
): string | undefined {
  const parsed = parseServerUrl(url);
  if (parsed === undefined) return undefined;
  const database = decodeURIComponent(parsed.pathname.replace(/^\//, ""));
  const host = decodeURIComponent(parsed.hostname);
  // A socket is named by the dialect's own parameter, or, for PostgreSQL, by
  // a path in the host's place.
  const socket =
    parsed.searchParams.get(SOCKET_PARAMETERS[dialect]) ??
    (host.startsWith("/") ? host : undefined);
  if (socket?.startsWith("/")) return `${socket}/${database}`;
  if (host === "" || host === NO_HOST) return undefined;
  return `${host}:${parsed.port || DEFAULT_PORTS[dialect]}/${database}`;
}

/**
 * The dialect and target of `url`, as one phrase: `PostgreSQL
 * db.internal:5432/shop`, `SQLite /srv/app/data/app.db`. `folder` is the
 * project folder a SQLite path is resolved against.
 */
export function databaseTarget(args: {
  url: string | undefined;
  /** `DB_DIALECT`, where the environment states one. */
  dialect?: string | undefined;
  folder: string;
}): string {
  const { url } = args;
  if (url === undefined || url === "") return "(DATABASE_URL not set)";
  const dialect = dialectOf(url, args.dialect);
  if (dialect === undefined) return "(database not recognised)";
  if (dialect === "sqlite") {
    return `${NAMES.sqlite} ${sqliteTarget(url, args.folder)}`;
  }
  return `${NAMES[dialect]} ${serverTarget(url, dialect) ?? "(address not readable)"}`;
}
