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
 * The dialect a command connects with, as its settings check decides it: the
 * one stated (`DB_DIALECT`) when it names one, else the one the URL implies.
 */
function dialectOf(
  url: string,
  stated: string | undefined
): Dialect | undefined {
  return (DIALECTS as readonly string[]).includes(stated ?? "")
    ? (stated as Dialect)
    : dialectFromUrl(url);
}

const UNREADABLE = "(address not readable)";

/**
 * A SQLite URL's file, resolved against `folder`, or `:memory:`: the text
 * after `file:`, which is what the adapter opens. A value that would not be
 * the file's own path is never printed as one: another kind of address (it
 * names a scheme, or holds an `@`), or a URL with a query part, which the
 * adapter takes into the file's name.
 */
function sqliteTarget(url: string, folder: string): string {
  const path = url.replace(/^file:/, "");
  if (path === "" || path === ":memory:") return ":memory:";
  if (/^[a-z][a-z0-9+.-]*:\/\//i.test(path) || /[@?]/.test(path)) {
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

/** What each part of an address may hold. Anything else is not that part. */
const HOST = /^[a-z0-9._:[\]-]+$/i;
const SOCKET = /^\/[a-z0-9._/-]*$/i;
const PORT = /^\d{1,5}$/;
const DATABASE = /^[^@/?#\s]*$/;

/** The parts of a server's address, each as the driver will use it. */
interface ServerParts {
  /** A host name, or a socket's path. */
  host: string;
  port: string;
  database: string;
}

/**
 * What the URL leaves for the driver to decide. node-postgres fills a
 * missing host, port or database from `PGHOST`, `PGPORT` and `PGDATABASE`;
 * MySQL's driver reads no such variable.
 */
function driverDefaults(
  dialect: keyof typeof DEFAULT_PORTS,
  env: Readonly<Record<string, string | undefined>>
): ServerParts {
  const pg = dialect === "postgresql";
  return {
    host: (pg && env.PGHOST) || "localhost",
    port: (pg && env.PGPORT) || DEFAULT_PORTS[dialect],
    database: (pg && env.PGDATABASE) || "",
  };
}

/**
 * The host, port and database the driver connects with: the URL's own, a
 * PostgreSQL `host` or `port` parameter over them, and the driver's
 * defaults for what is left out. Undefined where a part is not what it
 * should be, so no part is printed on a guess: a credential that held a
 * slash, or a parameter holding another address.
 */
function serverParts(
  parsed: URL,
  dialect: keyof typeof DEFAULT_PORTS,
  env: Readonly<Record<string, string | undefined>>
): ServerParts | undefined {
  const defaults = driverDefaults(dialect, env);
  const named = decoded(parsed.hostname);
  const database = decoded(parsed.pathname.replace(/^\//, ""));
  const parameter = (name: string) =>
    dialect === "postgresql" ? parsed.searchParams.get(name) : null;
  const socket =
    dialect === "mysql" ? parsed.searchParams.get("socketPath") : null;
  const parts = {
    host:
      socket ||
      parameter("host") ||
      (named === NO_HOST ? "" : named) ||
      defaults.host,
    port: parameter("port") || parsed.port || defaults.port,
    database: database || defaults.database,
  };
  const readable =
    named !== undefined &&
    database !== undefined &&
    (HOST.test(parts.host) || SOCKET.test(parts.host)) &&
    PORT.test(parts.port) &&
    DATABASE.test(parts.database) &&
    // A socket parameter that is not a path is not MySQL's socket.
    (socket === null || socket === "" || SOCKET.test(socket));
  return readable ? parts : undefined;
}

/**
 * A server's address: its socket where one is named, else its host and
 * port, then the database where one is named.
 */
function serverTarget(
  url: string,
  dialect: keyof typeof DEFAULT_PORTS,
  env: Readonly<Record<string, string | undefined>>
): string | undefined {
  const parsed = parseServerUrl(url);
  const parts = parsed && serverParts(parsed, dialect, env);
  if (!parts) return undefined;
  const name = parts.database === "" ? "" : `/${parts.database}`;
  return parts.host.startsWith("/")
    ? `${parts.host}${name}`
    : `${parts.host}:${parts.port}${name}`;
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
  /** The process environment, for what a driver reads from it; none by default. */
  env?: Readonly<Record<string, string | undefined>>;
}): string {
  const { url } = args;
  if (url === undefined || url === "") return "none";
  const dialect = dialectOf(url, args.dialect);
  if (dialect === undefined) return "(database not recognised)";
  if (dialect === "sqlite") {
    return `${NAMES.sqlite} ${sqliteTarget(url, args.folder)}`;
  }
  return `${NAMES[dialect]} ${serverTarget(url, dialect, args.env ?? {}) ?? UNREADABLE}`;
}
