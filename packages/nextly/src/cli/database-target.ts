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

/**
 * The dialect the connection is made with: the one the URL implies, as the
 * command's own connection reads it, else the one stated (`DB_DIALECT`).
 */
function dialectOf(
  url: string,
  stated: string | undefined
): Dialect | undefined {
  return (
    dialectFromUrl(url) ??
    ((DIALECTS as readonly string[]).includes(stated ?? "")
      ? (stated as Dialect)
      : undefined)
  );
}

const UNREADABLE = "(address not readable)";

/**
 * A SQLite URL's file, resolved against `folder`, or `:memory:`. A value
 * that is another kind of address (it names a scheme, or holds an `@`) is
 * not a path, and is never printed as one.
 */
function sqliteTarget(url: string, folder: string): string {
  const path = url.replace(/^file:/, "").split("?")[0] ?? "";
  if (path === "" || path === ":memory:") return ":memory:";
  if (/^[a-z][a-z0-9+.-]*:\/\//i.test(path) || path.includes("@")) {
    return UNREADABLE;
  }
  return resolve(folder, path);
}

/** Stands in for the host of a URL that names none, so the rest of it can be read. */
const NO_HOST = "no-host.invalid";

/**
 * `url` parsed. A URL may leave the host out (`postgres:///shop`,
 * `postgres://user@/shop?host=/run/pg`), which the parser refuses: it is
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

/** `text` with its percent-escapes read, or undefined where one cannot be. */
function decoded(text: string): string | undefined {
  try {
    return decodeURIComponent(text);
  } catch {
    return undefined;
  }
}

/** The host, port and database a server's URL names, each as written or absent. */
function serverParts(
  parsed: URL,
  dialect: keyof typeof DEFAULT_PORTS
): { host: string; port: string; database: string } | undefined {
  const database = decoded(parsed.pathname.replace(/^\//, ""));
  const named = decoded(parsed.hostname);
  // A database name holding an `@` or a `/` is a credential that held a
  // slash, read into the wrong part: nothing of such a URL is certain.
  if (database === undefined || named === undefined || /[@/]/.test(database)) {
    return undefined;
  }
  // PostgreSQL reads a host and a port given as parameters over the URL's own.
  const parameter = (name: string) =>
    dialect === "postgresql" ? parsed.searchParams.get(name) : null;
  return {
    host: parameter("host") || (named === NO_HOST ? "" : named),
    port: parameter("port") || parsed.port || DEFAULT_PORTS[dialect],
    database,
  };
}

/**
 * A server's address: its socket where the URL names one, else its host and
 * port, then the database where the URL names one. A URL naming no host is
 * the driver's own default, the local machine.
 */
function serverTarget(
  url: string,
  dialect: keyof typeof DEFAULT_PORTS
): string | undefined {
  const parsed = parseServerUrl(url);
  const parts = parsed && serverParts(parsed, dialect);
  if (!parsed || !parts) return undefined;
  const name = parts.database === "" ? "" : `/${parts.database}`;
  // A socket is named by MySQL's own parameter, or by a path where
  // PostgreSQL's host goes.
  const socket =
    dialect === "mysql" ? parsed.searchParams.get("socketPath") : parts.host;
  if (socket?.startsWith("/")) return `${socket}${name}`;
  return `${parts.host || "localhost"}:${parts.port}${name}`;
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
  if (url === undefined || url === "") return "none";
  const dialect = dialectOf(url, args.dialect);
  if (dialect === undefined) return "(database not recognised)";
  if (dialect === "sqlite") {
    return `${NAMES.sqlite} ${sqliteTarget(url, args.folder)}`;
  }
  return `${NAMES[dialect]} ${serverTarget(url, dialect) ?? UNREADABLE}`;
}
