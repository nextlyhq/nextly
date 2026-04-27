// What: shared connect-time DB version check.
// Why: each dialect has version-dependent capabilities (RENAME COLUMN on
// SQLite 3.25+, transactional DDL on MySQL 8+, etc). This helper hard-fails
// at connect on real dialects below minimum, lets recognized cloud variants
// (MariaDB, TiDB, Aurora, PlanetScale, Vitess) proceed with a warning, and
// hard-fails on completely unparseable strings. F17 in the schema
// architecture plan.

// Why local imports only: adapter-drizzle is upstream of @revnixhq/nextly
// in the dep graph. Importing from @revnixhq/nextly here would create a
// circular dependency. SupportedDialect and DatabaseError already exist
// in adapter-drizzle's own type system.
import type { SupportedDialect } from "./types";
import type { DatabaseError } from "./types/error";

// Why these minimums: PG 15 ships native MERGE + nbtree dedup needed for
// our schema rename pipeline. MySQL 8.0 ships native RENAME COLUMN.
// SQLite 3.38 ships strict tables + native unixepoch(). Older versions
// would force fallback paths that v1 explicitly does not implement.
export const NEXTLY_MIN_DB_VERSIONS = {
  postgresql: { major: 15, minor: 0 },
  mysql: { major: 8, minor: 0 },
  sqlite: { major: 3, minor: 38 },
} as const;

// What: typed error thrown when a real DB version is below minimum or a
// version string cannot be parsed.
// Why: implements adapter-drizzle's DatabaseError interface so existing
// isDatabaseError() type guards work. Stores dialect + detected/required
// versions on the instance so callers can build upgrade-guidance UI from
// the error fields without parsing the message.
export class UnsupportedDialectVersionError
  extends Error
  implements DatabaseError
{
  public readonly kind = "unsupported_version" as const;
  public readonly dialect: SupportedDialect;
  public readonly detectedVersion: string;
  public readonly requiredVersion: string;
  public override readonly cause?: Error;

  constructor(args: {
    dialect: SupportedDialect;
    detectedVersion: string;
    requiredVersion: string;
    message: string;
    cause?: Error;
  }) {
    super(args.message);
    this.name = "UnsupportedDialectVersionError";
    this.dialect = args.dialect;
    this.detectedVersion = args.detectedVersion;
    this.requiredVersion = args.requiredVersion;
    this.cause = args.cause;
  }
}

// What: minimal duck-typed query interface so this helper does not pull in
// pg / mysql2 / better-sqlite3 types directly.
// Why: keeps adapter-drizzle dependency-free of the per-dialect drivers.
// query() returns unknown because Promise<unknown> is already a subtype of
// unknown; the helper awaits at the call site, which works for both sync
// and async return shapes.
export interface VersionQueryClient {
  query?: (sql: string) => unknown;
  prepare?: (sql: string) => { get: () => unknown };
}

// What: optional callback so adapters can route the variant warning through
// their own logger.
// Why: the helper itself does not depend on a logger module; the adapter
// owns logger config and is the right place to surface the warning.
export interface CheckDialectVersionOptions {
  onWarning?: (message: string) => void;
}

// What: doc URL embedded in error messages.
// Why: gives users a single landing page with upgrade instructions per
// dialect + cloud provider. Filled in PR-2.
const DOCS_URL = "https://nextlyhq.com/docs/database/support";

// What: recognized MySQL-protocol-compatible variants. Detection of any of
// these tokens in the version string causes a warning instead of a hard-
// fail.
// Why: these databases speak the MySQL wire protocol but use their own
// version schemes (MariaDB 10.x, TiDB 6.x advertising MySQL 5.7, Aurora's
// custom suffix). Hard-failing them would lock out a large fraction of
// real cloud users on first install. We warn so the user knows we have not
// regression-tested against their variant; we proceed because the wire
// protocol is compatible enough that most operations work.
const VARIANT_TOKENS = [
  "mariadb",
  "tidb",
  "aurora",
  "planetscale",
  "vitess",
] as const;

const POSTGRES_REGEX = /^PostgreSQL (\d+)\.(\d+)/;
const MYSQL_REGEX = /^(\d+)\.(\d+)\.(\d+)/;
const SQLITE_REGEX = /^(\d+)\.(\d+)\.(\d+)/;

interface ParsedVersion {
  major: number;
  minor: number;
}

function parsePostgres(raw: string): ParsedVersion | null {
  const match = POSTGRES_REGEX.exec(raw);
  if (!match) return null;
  return { major: Number(match[1]), minor: Number(match[2]) };
}

function parseMySQL(raw: string): ParsedVersion | null {
  const match = MYSQL_REGEX.exec(raw);
  if (!match) return null;
  return { major: Number(match[1]), minor: Number(match[2]) };
}

function parseSQLite(raw: string): ParsedVersion | null {
  const match = SQLITE_REGEX.exec(raw);
  if (!match) return null;
  return { major: Number(match[1]), minor: Number(match[2]) };
}

function detectVariant(raw: string): string | null {
  const lower = raw.toLowerCase();
  for (const token of VARIANT_TOKENS) {
    if (lower.includes(token)) return token;
  }
  return null;
}

// What: compares detected version to required minimum.
// Why: simple major-minor comparison is sufficient; we do not gate on patch.
function meetsMinimum(
  detected: ParsedVersion,
  required: { major: number; minor: number }
): boolean {
  if (detected.major > required.major) return true;
  if (detected.major < required.major) return false;
  return detected.minor >= required.minor;
}

// What: queries the DB for its version string and validates it under the
// hybrid policy.
// Why: called as the first DB-content step inside each adapter's connect()
// method.
//
// Decision tree:
//   1. Variant token present (MariaDB/TiDB/Aurora/PlanetScale/Vitess)?
//      -> emit warning via options.onWarning, return successfully.
//   2. Strict regex matches and version >= minimum?
//      -> return successfully.
//   3. Strict regex matches but version < minimum?
//      -> throw UnsupportedDialectVersionError (real-DB-too-old path).
//   4. Strict regex does not match AND no variant token detected?
//      -> throw UnsupportedDialectVersionError (truly unparseable path).
export async function checkDialectVersion(
  client: VersionQueryClient,
  dialect: SupportedDialect,
  options?: CheckDialectVersionOptions
): Promise<void> {
  const required = NEXTLY_MIN_DB_VERSIONS[dialect];
  const requiredStr = `${required.major}.${required.minor}+`;

  let raw: string;
  if (dialect === "sqlite") {
    raw = await querySqliteVersion(client);
  } else if (dialect === "postgresql") {
    raw = await queryPostgresVersion(client);
  } else {
    raw = await queryMysqlVersion(client);
  }

  // Step 1: variant check. Only meaningful for MySQL — Postgres-flavored
  // services (Neon, Supabase, RDS PG, Aurora PG) all return canonical
  // "PostgreSQL X.Y..." strings and pass the strict regex naturally.
  const variant = dialect === "mysql" ? detectVariant(raw) : null;
  if (variant) {
    const warning =
      `Detected ${variant} ('${raw}'). Nextly is regression-tested ` +
      `against real MySQL 8.0+ only; this MySQL-compatible variant is not ` +
      `officially supported in v1 but most operations should work. ` +
      `See ${DOCS_URL}.`;
    if (options?.onWarning) options.onWarning(warning);
    return;
  }

  // Step 2/3: strict regex parse for real dialects.
  let parsed: ParsedVersion | null;
  if (dialect === "postgresql") parsed = parsePostgres(raw);
  else if (dialect === "mysql") parsed = parseMySQL(raw);
  else parsed = parseSQLite(raw);

  if (!parsed) {
    // Step 4: truly unparseable. Hard-fail so we surface the issue at boot
    // rather than silently letting the user proceed and hit cryptic errors
    // later.
    throw new UnsupportedDialectVersionError({
      dialect,
      detectedVersion: raw,
      requiredVersion: requiredStr,
      message:
        `Could not parse ${dialect} version from '${raw}'. ` +
        `Nextly requires ${dialect} ${requiredStr}. ` +
        `If you are on a known MySQL-compatible variant we did not detect, ` +
        `please file an issue. See ${DOCS_URL}.`,
    });
  }

  if (!meetsMinimum(parsed, required)) {
    const labels: Record<SupportedDialect, string> = {
      postgresql: "PostgreSQL",
      mysql: "MySQL",
      sqlite: "SQLite",
    };
    throw new UnsupportedDialectVersionError({
      dialect,
      detectedVersion: `${parsed.major}.${parsed.minor}`,
      requiredVersion: requiredStr,
      message:
        `${labels[dialect]} ${requiredStr} required; detected ` +
        `${parsed.major}.${parsed.minor}. See ${DOCS_URL}.`,
    });
  }
}

// What: PG version query.
// Why: pg's Client/PoolClient.query() returns { rows: [{ version: "..." }] }.
async function queryPostgresVersion(
  client: VersionQueryClient
): Promise<string> {
  if (!client.query) {
    throw new Error("PostgreSQL client missing query() method");
  }
  const result = (await client.query("SELECT version()")) as {
    rows?: Array<{ version?: unknown }>;
  };
  const row = result.rows?.[0];
  const version = row?.version;
  if (typeof version !== "string") {
    throw new Error(
      `Unexpected response shape from SELECT version(): ${JSON.stringify(result)}`
    );
  }
  return version;
}

// What: MySQL version query.
// Why: mysql2's Connection.query() returns [rows, fields] where rows[0]
// has the column aliased as 'version'.
async function queryMysqlVersion(client: VersionQueryClient): Promise<string> {
  if (!client.query) {
    throw new Error("MySQL client missing query() method");
  }
  const result = (await client.query("SELECT VERSION() AS version")) as Array<
    Array<{ version?: unknown }>
  >;
  const row = result?.[0]?.[0];
  const version = row?.version;
  if (typeof version !== "string") {
    throw new Error(
      `Unexpected response shape from SELECT VERSION(): ${JSON.stringify(result)}`
    );
  }
  return version;
}

// What: SQLite version query via better-sqlite3's prepare/get.
// Why: better-sqlite3 is synchronous, so this is a plain function returning
// a resolved Promise. The helper awaits it uniformly with PG/MySQL paths.
function querySqliteVersion(client: VersionQueryClient): Promise<string> {
  if (!client.prepare) {
    return Promise.reject(new Error("SQLite client missing prepare() method"));
  }
  const stmt = client.prepare("SELECT sqlite_version() AS version");
  const row = stmt.get() as { version?: unknown } | undefined;
  const version = row?.version;
  if (typeof version !== "string") {
    return Promise.reject(
      new Error(
        `Unexpected response shape from SELECT sqlite_version(): ${JSON.stringify(row)}`
      )
    );
  }
  return Promise.resolve(version);
}
