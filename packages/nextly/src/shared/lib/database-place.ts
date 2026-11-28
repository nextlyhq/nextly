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
 *   path;
 * - `server`: the host (or socket), port and database, or `undefined`
 *   where any part is not what it should be.
 *
 * `disagrees` is set where `DB_DIALECT` names a dialect other than the one
 * the URL's scheme names. Most commands connect with `DB_DIALECT`'s, but a
 * command that connects without the settings check reads the scheme's, so
 * such settings may reach either database.
 */
export type DatabaseAddress =
  | { kind: "none" }
  | { kind: "unrecognised" }
  | {
      kind: "sqlite";
      file: string | undefined;
      disagrees: boolean;
      /** A Windows network path (`\\\\server\\share\\app.db`): a file on another machine. */
      onShare: boolean;
    }
  | {
      kind: "server";
      dialect: Exclude<Dialect, "sqlite">;
      parts: ServerParts | undefined;
      disagrees: boolean;
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
 * The dialect the settings name, read as the CLI's settings check and the
 * site's own settings read it (`statedDialect`): `DB_DIALECT` when it names
 * one, else the one the URL's scheme implies; and whether the two name
 * different dialects. No default stands in where neither names one: an
 * address of no known dialect is not read as one.
 */
function dialectOf(
  url: string,
  stated: string | undefined
): { dialect: Dialect | undefined; disagrees: boolean } {
  const named = (DIALECTS as readonly string[]).includes(stated ?? "")
    ? (stated as Dialect)
    : undefined;
  const implied = dialectFromUrl(url);
  return {
    dialect: named ?? implied,
    disagrees:
      implied !== undefined && named !== undefined && implied !== named,
  };
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
/** A socket path written relative to the project folder, as MySQL's driver takes one. */
const RELATIVE_SOCKET = /^\.{0,2}\/?[a-z0-9._-][a-z0-9._/-]*$/i;
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
 * Whether the parser read credentials as something else: a `#` or `?` in a
 * password ends the address early, and the user name is read as the host
 * (`postgres://admin:2024#x@db/shop` is host `admin`, port `2024`).
 */
function credentialsMisread(parsed: URL): boolean {
  if (parsed.hash !== "") return true;
  return (
    parsed.href.includes("@") &&
    parsed.username === "" &&
    parsed.password === "" &&
    !/^[a-z]+:\/\/[^/?#]*@/i.test(parsed.href)
  );
}

/**
 * MySQL's socket as the driver opens it: its `path`, and whether that path was
 * `resolved` here from a relative one the URL wrote. A resolved path was read as
 * a path in the form it was written (`RELATIVE_SOCKET`), and is then spelled as
 * the platform spells the project folder: a drive and backslashes on Windows,
 * and any character the folder's own name holds.
 */
interface MysqlSocket {
  path: string;
  resolved: boolean;
}

/**
 * Whether each part is what it should be: a host or a socket's path, a port,
 * a database name, and a MySQL socket parameter that is a path.
 */
function partsReadable(
  parts: ServerParts,
  socket: MysqlSocket | null
): boolean {
  const resolvedSocket = socket?.resolved === true ? socket.path : undefined;
  return (
    (HOST.test(parts.host) ||
      SOCKET.test(parts.host) ||
      parts.host === resolvedSocket) &&
    PORT.test(parts.port) &&
    DATABASE.test(parts.database) &&
    // A socket parameter that is not a path is not MySQL's socket.
    (socket === null ||
      socket.path === "" ||
      socket.resolved ||
      SOCKET.test(socket.path))
  );
}

/** A parameter's value given twice or more, differently: no one reading of it. */
const AMBIGUOUS = Symbol("ambiguous");

/**
 * The value the URL gives parameter `name`: null where it gives none, and
 * `AMBIGUOUS` where it gives several that differ, which drivers read
 * differently (node-postgres keeps the last, mysql2 the first).
 */
function oneParameter(
  parsed: URL,
  name: string
): string | null | typeof AMBIGUOUS {
  const values = parsed.searchParams.getAll(name);
  if (values.length === 0) return null;
  return values.every(value => value === values[0]) ? values[0] : AMBIGUOUS;
}

/**
 * MySQL's `socketPath` parameter, as its driver opens it: a relative path
 * from the folder it runs in, as the adapter opens a relative SQLite file.
 */
function mysqlSocket(
  parsed: URL,
  folder: string
): MysqlSocket | null | typeof AMBIGUOUS {
  const named = oneParameter(parsed, "socketPath");
  if (typeof named !== "string") return named;
  const value = asMysqlReads(named);
  // `false`, `null`, `0`: no socket, so the driver connects to the host.
  if (value === null) return null;
  // `true` or a number names no path the driver could open.
  if (typeof value !== "string") return AMBIGUOUS;
  if (value.startsWith("/")) return { path: value, resolved: false };
  return RELATIVE_SOCKET.test(value)
    ? { path: resolve(folder, value), resolved: true }
    : { path: value, resolved: false };
}

/**
 * A URL parameter as MySQL's driver reads it: as JSON where the text parses
 * as JSON, else as the text. A value JSON reads as falsy comes back null.
 */
function asMysqlReads(text: string): unknown {
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch {
    return text;
  }
  return value ? value : null;
}

/**
 * node-postgres's socket form, `/run/postgresql shop`: a socket's path, then
 * the database, with the port its defaults give. Undefined where it is not
 * that form, or a part is not what it should be.
 */
function pgSocketString(
  url: string,
  env: Readonly<Record<string, string | undefined>>
): ServerParts | undefined {
  if (!url.startsWith("/")) return undefined;
  const [host, database = ""] = url.split(" ");
  const parts = {
    host,
    port: driverDefaults("postgresql", env).port,
    database,
  };
  return partsReadable(parts, null) ? parts : undefined;
}

/**
 * node-postgres's `socket:` form, `socket:/run/postgresql?db=shop`: the
 * socket's path, the database its `db` parameter names, and the port and
 * database its defaults give where those are left out.
 */
function pgSocketUrl(
  url: string,
  env: Readonly<Record<string, string | undefined>>
): ServerParts | undefined {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return undefined;
  }
  const host = decoded(parsed.pathname);
  const database = oneParameter(parsed, "db");
  if (host === undefined || database === AMBIGUOUS) return undefined;
  const defaults = driverDefaults("postgresql", env);
  const parts = {
    host,
    port: defaults.port,
    database: database ?? defaults.database,
  };
  return partsReadable(parts, null) ? parts : undefined;
}

/**
 * The host, port and database the driver connects with: the URL's own, a
 * PostgreSQL `host` or `port` parameter over them, MySQL's `socketPath`
 * over the host, and the driver's defaults for what is left out. Undefined
 * where a part is not what it should be, so nothing is decided on a guess: a
 * credential that held a slash or a `#`, or a parameter holding another
 * address.
 */
function serverParts(
  parsed: URL,
  dialect: keyof typeof DEFAULT_PORTS,
  env: Readonly<Record<string, string | undefined>>,
  folder: string
): ServerParts | undefined {
  const named = decoded(parsed.hostname);
  const database = decoded(parsed.pathname.replace(/^\//, ""));
  if (named === undefined || database === undefined) return undefined;
  if (credentialsMisread(parsed)) return undefined;
  const pg = dialect === "postgresql";
  const host = pg ? oneParameter(parsed, "host") : null;
  const port = pg ? oneParameter(parsed, "port") : null;
  const socket = pg ? null : mysqlSocket(parsed, folder);
  if (host === AMBIGUOUS || port === AMBIGUOUS || socket === AMBIGUOUS) {
    return undefined;
  }
  const defaults = driverDefaults(dialect, env);
  const parts = {
    host:
      socket?.path || host || (named === NO_HOST ? "" : named) || defaults.host,
    port: port || parsed.port || defaults.port,
    database: database || defaults.database,
  };
  return partsReadable(parts, socket) ? parts : undefined;
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
  const { dialect, disagrees } = dialectOf(url, input.dialect);
  if (dialect === undefined) return { kind: "unrecognised" };
  if (dialect === "sqlite") {
    return {
      kind: "sqlite",
      file: sqliteFile(url, input.folder ?? process.cwd()),
      disagrees,
      // A UNC path names a file server, before any resolving of it.
      onShare: /^(\\\\|\/\/)/.test(url.replace(/^file:/, "")),
    };
  }
  if (dialect === "postgresql" && /^(\/|socket:)/i.test(url)) {
    return {
      kind: "server",
      dialect,
      parts: url.startsWith("/")
        ? pgSocketString(url, input.env ?? {})
        : pgSocketUrl(url, input.env ?? {}),
      disagrees,
    };
  }
  const parsed = parseServerUrl(url);
  return {
    kind: "server",
    dialect,
    parts:
      parsed &&
      serverParts(
        parsed,
        dialect,
        input.env ?? {},
        input.folder ?? process.cwd()
      ),
    disagrees,
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
 * Whether the database at `address` is on this machine. A SQLite file or
 * memory is: the adapter opens nothing else. A server is local only by its
 * socket or its host. Nothing is ever local without a reason, so these are
 * live: an address that cannot be read, settings whose `DB_DIALECT` and URL
 * name different dialects, and no database at all.
 */
export function placeOf(address: DatabaseAddress): DatabasePlace {
  switch (address.kind) {
    case "sqlite":
      return address.file !== undefined &&
        !address.disagrees &&
        !address.onShare
        ? "local"
        : "live";
    case "server":
      return address.parts &&
        !address.disagrees &&
        hostIsThisMachine(address.parts.host)
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
