/**
 * What a connection string points at, in words that are safe to print: the
 * server's host and port and the database's name. Never the user name, the
 * password or the query, which `lib/connection-string.ts` keeps out of every
 * message.
 */
import type { ServerDialect } from "./types";

export interface Target {
  /** `localhost:5432`, or `a socket` when the string names no host. */
  server: string;
  /** The database the string names, or undefined when it names none. */
  database: string | undefined;
  /** Whether the server is on this machine, where a missing database may be created. */
  onThisMachine: boolean;
}

/** The names a server on this machine is reached by, besides a socket. */
const LOCAL_HOSTS = new Set(["localhost", "host.docker.internal"]);

/**
 * Whether `host` is this machine: `localhost`, `host.docker.internal`, or a
 * loopback address (`127.0.0.0/8`, `::1`). Any other address is a live server,
 * where the installer creates nothing.
 */
export function isLocalHost(host: string): boolean {
  const bare = host.replace(/^\[|\]$/g, "").toLowerCase();
  if (bare === "" || LOCAL_HOSTS.has(bare)) return true;
  if (/^127(?:\.\d{1,3}){3}$/.test(bare)) return true;
  return bare === "::1" || bare === "0:0:0:0:0:0:0:1";
}

/** The default port a dialect's driver uses when the string names none. */
const DEFAULT_PORTS: Record<ServerDialect, string> = {
  postgresql: "5432",
  mysql: "3306",
};

/**
 * Reads `url`'s server and database. A string `URL` cannot read (a password
 * holding an unencoded `#`, say) gives an unnamed server that is not on this
 * machine, so nothing is ever created for it.
 */
export function readTarget(url: string, dialect: ServerDialect): Target {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return {
      server: "the server in the connection string",
      database: undefined,
      onThisMachine: false,
    };
  }
  const database = decodeURIComponent(parsed.pathname.replace(/^\//, ""));
  // A socket: no host, or a `host=` query naming a path (PostgreSQL).
  const socketHost = parsed.searchParams.get("host") ?? "";
  if (parsed.hostname === "" || socketHost.startsWith("/")) {
    return {
      server: "a socket on this machine",
      database: database || undefined,
      onThisMachine: true,
    };
  }
  const port = parsed.port || DEFAULT_PORTS[dialect];
  return {
    server: `${parsed.hostname}:${port}`,
    database: database || undefined,
    onThisMachine: isLocalHost(parsed.hostname),
  };
}
