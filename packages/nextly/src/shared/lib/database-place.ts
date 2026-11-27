/**
 * Whether a database is on this machine (`local`) or anywhere else (`live`),
 * read from where its address points and from nothing else.
 *
 * A database is local when it is a SQLite file or an in-memory SQLite
 * database, when it is reached through a Unix socket, or when its host is
 * `localhost`, a loopback address (`127.0.0.0/8`, `::1`, in any spelling
 * Node reads as one) or `host.docker.internal`. Every other address is live:
 * a remote host, a private network address (`10.0.0.5`, `172.17.0.2`), a
 * Docker Compose service name (`db`), and an address that cannot be read.
 * `NODE_ENV`, `--mode` and every other flag or variable are never read here:
 * a laptop whose `.env` holds a production URL is talking to production,
 * whatever mode it runs in.
 *
 * The narrow rule fails safe. A private address can be a cloud network's
 * production database, and a short host name can't be told from a remote
 * one, so both stay live until the database itself is marked as a
 * development copy; the worst case is one mark.
 *
 * This is the one place that decides it. The CLI reads it for the line a
 * command prints before it uses a database, and a running site reads the
 * same answer for its own role, so the two never disagree about one
 * database. It imports no CLI or application module, and nothing that loads
 * a dialect, so a site's start-up and a command's first line can both ask
 * it before anything heavy loads.
 *
 * @module shared/lib/database-place
 */

import { BlockList, isIP } from "node:net";
import { resolve } from "node:path";

import { DIALECTS, dialectFromUrl, type Dialect } from "./stated-dialect";

/** Where a database is: on this machine, or anywhere else. */
export type DatabasePlace = "local" | "live";

/** The parts of a server's address, each as the driver will use it. */
export interface ServerParts {
  /** A host name, or a socket's path. */
  host: string;
  port: string;
  database: string;
}

/**
 * A database's address, as its driver will read it:
 * - `none`: no URL is set;
 * - `unrecognised`: a URL that names no dialect this package supports;
 * - `sqlite`: the file's path resolved against the folder, `:memory:`, or
 *   `undefined` where the URL holds something that is not the file's own
 *   path (the adapter still opens a file on this machine);
 * - `server`: the host (or socket), port and database, or `undefined`
 *   where any part is not what it should be.
 */
export type DatabaseAddress =
  | { kind: "none" }
  | { kind: "unrecognised" }
  | { kind: "sqlite"; file: string | undefined }
  | {
      kind: "server";
      dialect: Exclude<Dialect, "sqlite">;
      parts: ServerParts | undefined;
    };

/** What a database's address is read from. */
export interface DatabaseAddressInput {
  /** `DATABASE_URL`. */
  url: string | undefined;
  /** `DB_DIALECT`, where the environment states one. */
  dialect?: string | undefined;
  /** The folder a relative SQLite path resolves against; the process's own by default. */
  folder?: string;
  /** The process environment, for what a driver reads from it; none by default. */
  env?: Readonly<Record<string, string | undefined>>;
}

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

/**
 * A SQLite URL's file, resolved against `folder`, or `:memory:`: the text
 * after `file:`, which is what the adapter opens. A value that would not be
 * the file's own path is not read as one: another kind of address (it names
 * a scheme, or holds an `@`), or a URL with a query part, which the adapter
 * takes into the file's name.
 */
function sqliteFile(url: string, folder: string): string | undefined {
  const path = url.replace(/^file:/, "");
  if (path === "" || path === ":memory:") return ":memory:";
  if (/^[a-z][a-z0-9+.-]*:\/\//i.test(path) || /[@?]/.test(path)) {
    return undefined;
  }
  return resolve(folder, path);
}

/** Stands in for the host of a URL that names none, so the rest of it can be read. */
const NO_HOST = "no-host.invalid";

/**
 * `url` parsed. A URL may leave the host out (`postgres:///shop`,
 * `postgres://user@/shop?host=/run/pg`), which the parser refuses: it is
 * read with a stand-in host, which is never taken for the host.
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
 * PostgreSQL `host` or `port` parameter over them, MySQL's `socketPath`
 * over the host, and the driver's defaults for what is left out. Undefined
 * where a part is not what it should be, so nothing is decided on a guess: a
 * credential that held a slash, or a parameter holding another address.
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
 * The address of the database `input` names, as its driver will read it.
 * Built from the URL's named parts and the driver's own defaults only: a
 * user name, a password and every query parameter but the ones that name
 * where the server is are never read into it.
 */
export function readDatabaseAddress(
  input: DatabaseAddressInput
): DatabaseAddress {
  const { url } = input;
  if (url === undefined || url === "") return { kind: "none" };
  const dialect = dialectOf(url, input.dialect);
  if (dialect === undefined) return { kind: "unrecognised" };
  if (dialect === "sqlite") {
    return {
      kind: "sqlite",
      file: sqliteFile(url, input.folder ?? process.cwd()),
    };
  }
  const parsed = parseServerUrl(url);
  return {
    kind: "server",
    dialect,
    parts: parsed && serverParts(parsed, dialect, input.env ?? {}),
  };
}

/** Every loopback address, IPv4 and IPv6, including IPv4 addresses written as IPv6. */
const LOOPBACK = new BlockList();
LOOPBACK.addSubnet("127.0.0.0", 8, "ipv4");
LOOPBACK.addAddress("::1", "ipv6");

/** The host names that reach this machine by name. */
const LOCAL_NAMES: ReadonlySet<string> = new Set([
  "localhost",
  "host.docker.internal",
]);

/**
 * Whether `host` is this machine: a socket's path, one of the local names,
 * or a loopback address. A URL writes an IPv6 address in brackets, and a
 * name may end in the root's dot; neither changes what it names.
 */
function hostIsThisMachine(host: string): boolean {
  if (host.startsWith("/")) return true;
  const bare = host
    .toLowerCase()
    .replace(/^\[(.*)\]$/, "$1")
    .replace(/\.$/, "");
  if (LOCAL_NAMES.has(bare)) return true;
  const family = isIP(bare);
  if (family === 0) return false;
  return LOOPBACK.check(bare, family === 4 ? "ipv4" : "ipv6");
}

/**
 * Whether the database at `address` is on this machine. A SQLite database
 * always is: the adapter opens only a file, or memory. A server is local
 * only by its socket or its host; one whose address cannot be read is live,
 * as is no database at all, so nothing is ever local without a reason.
 */
export function placeOf(address: DatabaseAddress): DatabasePlace {
  switch (address.kind) {
    case "sqlite":
      return "local";
    case "server":
      return address.parts && hostIsThisMachine(address.parts.host)
        ? "local"
        : "live";
    default:
      return "live";
  }
}

/** Whether the database `input` names is on this machine. */
export function databasePlace(input: DatabaseAddressInput): DatabasePlace {
  return placeOf(readDatabaseAddress(input));
}
