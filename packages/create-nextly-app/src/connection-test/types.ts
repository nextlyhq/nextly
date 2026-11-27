/** The databases the installer tests a connection to. SQLite needs none. */
export type ServerDialect = "postgresql" | "mysql";

/** Why a connection failed, in the terms the person is told. */
export type FailureCause =
  | "unreachable"
  | "login-refused"
  | "database-missing"
  | "version-unsupported"
  | "other";

/** A connection that worked. */
export interface Connected {
  ok: true;
  /** `PostgreSQL 17.2`, `MySQL 8.4.3`, or a MySQL-compatible server's own name. */
  server: string;
  /** The database connected to. */
  database: string;
  /**
   * The tables the database already holds: a Nextly site's, or others.
   * Left out for an empty database.
   */
  existingTables?: "nextly" | "other";
  /** Set for a MySQL-compatible server Nextly is not tested against. */
  variantWarning?: string;
}

/** A connection that failed, and what can be offered about it. */
export interface NotConnected {
  ok: false;
  cause: FailureCause;
  /** Plain words, naming no user, password or query. */
  message: string;
  /** The missing database's name, when the cause is `database-missing`. */
  database?: string;
  /** Whether the missing database may be created: on this machine, login accepted. */
  canCreate: boolean;
}

export type ConnectionResult = Connected | NotConnected;

/** One open connection, as the test uses it: read rows, then close. */
export interface OpenConnection {
  rows(sql: string): Promise<Record<string, unknown>[]>;
  close(): Promise<void>;
}

/** Opens a connection to `url`. The drivers by default; tests give their own. */
export type Connect = (
  dialect: ServerDialect,
  url: string
) => Promise<OpenConnection>;
