/**
 * Which PostgreSQL schema this installation's tables live in.
 *
 * One answer, asked by four things that must agree: the adapter (which sets
 * `search_path`), drizzle-kit (which introspects), the migrate lock and the
 * ledger (which are ordinary tables and so follow the path). Two of them
 * disagreeing means the pipeline compares a schema it is not writing to, and
 * every diff proposes creating tables that already exist somewhere else.
 *
 * The value is process-level for the same reason the active extension schema
 * is: the CLI never boots a container and still has to reach the same answer.
 *
 * @module domains/schema/services/postgres-schema
 * @since 1.0.0
 */
import { isValidSchemaName } from "@nextlyhq/adapter-drizzle/schema-name";
import { sql, type SQL } from "drizzle-orm";

import { NextlyError } from "../../../errors/nextly-error";

/** Where PostgreSQL puts things when nobody says otherwise. */
export const DEFAULT_POSTGRES_SCHEMA = "public";

/**
 * Pinned on `globalThis` rather than held in a module-level variable.
 *
 * Boot publishes from a static import, but first-run reaches `freshPushSchema`
 * through a dynamic one, and a bundler may resolve the two to different
 * instances of this module. A module-level value would then read `public` in
 * exactly the push that decides which core tables a new schema receives.
 */
const globalForPostgresSchema = globalThis as unknown as {
  __nextly_active_postgres_schema?: string;
};

/**
 * Validate a configured schema name, or refuse it.
 *
 * Refused at BOOT rather than at first query: a bad name reaches SQL through
 * `search_path`, where the failure is a connection that works and finds
 * nothing rather than an error naming the setting that caused it.
 */
export function validatePostgresSchema(name: string): string {
  // The ADAPTER's rule, asked rather than restated: it is the thing that
  // interpolates the value, and a second copy here is a second answer to one
  // question. This wrapper exists only to give the refusal the config path
  // that produced it, which the adapter cannot know.
  if (!isValidSchemaName(name)) {
    throw NextlyError.validation({
      errors: [
        {
          path: "db.postgres.schema",
          code: "INVALID",
          message: `"${name}" is not a usable schema name. Use lower-case letters, digits and underscores, starting with a letter or underscore (max 63 characters), and not beginning with "pg_".`,
        },
      ],
      logContext: { reason: "postgres-schema-invalid", name },
    });
  }
  return name;
}

/**
 * Resolve the configured schema for this dialect, warning where it cannot apply.
 *
 * MySQL and SQLite have no equivalent — MySQL's "schema" IS its database, and
 * SQLite has one file — so the option is IGNORED there rather than refused. A
 * config shared across dialects is the ordinary case, and refusing would make
 * one setting stop an app that runs perfectly. It warns, because silently
 * ignoring it is how someone concludes the option does not work.
 */
export function resolvePostgresSchema(
  configured: string | undefined,
  dialect: string,
  warn?: (message: string) => void
): string {
  if (configured === undefined) return DEFAULT_POSTGRES_SCHEMA;
  const name = validatePostgresSchema(configured);
  if (dialect !== "postgresql") {
    warn?.(
      `db.postgres.schema is set to "${name}" but the dialect is ${dialect}, which has no schema namespace. The setting is ignored.`
    );
    return DEFAULT_POSTGRES_SCHEMA;
  }
  // PostgreSQL honours the name: the adapter sets it as `search_path`, and the
  // push reconciles that namespace (`pushInActiveSchema`), so every managed and
  // extension table is created and migrated there.
  return name;
}

/**
 * The environment flag that lets a first start create an installation in a
 * schema while another schema of the same database already holds one.
 *
 * Read only by {@link refuseMovedInstallation}. Once the new schema holds its
 * own history the flag is no longer consulted, so it never needs removing.
 */
const NEW_SCHEMA_INSTALL_ENV = "NEXTLY_POSTGRES_SCHEMA_NEW_INSTALL";

/** The table whose presence marks a schema as holding a Nextly installation. */
const INSTALLATION_MARKER_TABLE = "nextly_schema_events";

/**
 * The schemas of this database that hold a Nextly installation, by the
 * migration history (`nextly_schema_events`) each keeps.
 *
 * Read from the catalogue rather than through `search_path`: the question is
 * where an installation is OTHER than the configured schema, which a query
 * resolved through the path cannot see.
 */
async function schemasHoldingAnInstallation(db: {
  execute(query: SQL): Promise<unknown>;
}): Promise<string[]> {
  const result = await db.execute(
    sql`SELECT n.nspname AS schema
          FROM pg_catalog.pg_class c
          JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
         WHERE c.relname = ${INSTALLATION_MARKER_TABLE}
           AND c.relkind IN ('r', 'p')
         ORDER BY n.nspname`
  );
  const rows = Array.isArray(result)
    ? result
    : ((result as { rows?: unknown[] }).rows ?? []);
  return rows
    .map(row => (row as { schema?: unknown }).schema)
    .filter((schema): schema is string => typeof schema === "string");
}

/**
 * Refuse a start whose configured schema holds no installation while another
 * schema of the database does.
 *
 * The case this exists for is `db.postgres.schema` changed, or removed, on an
 * existing site: the start would otherwise create a second, empty
 * installation in the newly named schema and serve it, so the site looks as if
 * its content had been deleted. A database with no installation anywhere is a
 * first install, and one whose configured schema already holds its history is
 * the ordinary start; both pass.
 *
 * A second, separate installation sharing the database is legitimate, and
 * indistinguishable from a moved setting until its first start has run. So
 * the refusal is lifted by {@link NEW_SCHEMA_INSTALL_ENV} for that first
 * start, and the message says so.
 *
 * @param configured - The schema the configuration resolved to
 * @param holding - {@link schemasHoldingAnInstallation}'s answer
 * @param allowNewInstallation - Whether the flag is set
 */
export function refuseMovedInstallation(
  configured: string,
  holding: readonly string[],
  allowNewInstallation: boolean
): void {
  if (holding.length === 0 || holding.includes(configured)) return;
  if (allowNewInstallation) return;
  const where = holding.map(name => `"${name}"`).join(", ");
  const setting =
    configured === DEFAULT_POSTGRES_SCHEMA
      ? `db.postgres.schema is not set (so "${DEFAULT_POSTGRES_SCHEMA}")`
      : `db.postgres.schema is "${configured}"`;
  const backTo =
    holding.length === 1 && holding[0] === DEFAULT_POSTGRES_SCHEMA
      ? "remove db.postgres.schema"
      : `set db.postgres.schema to ${holding.length === 1 ? where : `the one it uses (${where})`}`;
  throw new NextlyError({
    code: "NEXTLY_POSTGRES_SCHEMA_MOVED",
    publicMessage:
      `${setting}, but this database's Nextly installation is in ${where}. ` +
      `Starting would create a second, empty installation in "${configured}" and serve it instead of the existing one. ` +
      `To keep using the existing installation, ${backTo}. ` +
      `To start a separate installation in "${configured}" on purpose, set ${NEW_SCHEMA_INSTALL_ENV}=1 for its first start.`,
    logContext: {
      reason: "postgres-schema-moved",
      configured,
      holding: [...holding],
    },
  });
}

/**
 * Read where this database's installations are, and refuse a start that would
 * set up a second one by accident ({@link refuseMovedInstallation}).
 *
 * Run once the adapter is connected and before anything creates or migrates a
 * table: first-run setup, the development push and `nextly migrate` would
 * otherwise build the new, empty installation this refuses.
 */
export async function assertInstallationInConfiguredSchema(
  db: { execute(query: SQL): Promise<unknown> },
  configured: string,
  env: Record<string, string | undefined> = process.env
): Promise<void> {
  refuseMovedInstallation(
    configured,
    await schemasHoldingAnInstallation(db),
    env[NEW_SCHEMA_INSTALL_ENV] === "1"
  );
}

/**
 * Refuse an adapter whose schema is not the one the config resolved to.
 *
 * An adapter Nextly builds from the environment is handed
 * `db.postgres.schema`, so it always agrees. One the application builds itself
 * carries its own `schema` option, and Nextly does not reconfigure it: that
 * adapter is the caller's object, possibly shared with code Nextly cannot see.
 * Left alone, the two answers split the installation — drizzle-kit, the
 * migrate lock and the ledger follow the published schema while every service
 * query follows the adapter's `search_path` — and nothing errors, it simply
 * creates and reads tables in two places.
 *
 * Absent on either side means `public`, because that is what each side then
 * uses: the config resolves to it, and an adapter with no `search_path` of its
 * own falls back to the server default.
 *
 * @param resolved - What {@link resolvePostgresSchema} answered
 * @param adapterSchema - What the adapter reports, `undefined` for none
 */
export function assertAdapterPostgresSchema(
  resolved: string,
  adapterSchema: string | undefined
): void {
  const adapterEffective = adapterSchema ?? DEFAULT_POSTGRES_SCHEMA;
  if (adapterEffective === resolved) return;
  const configDescription =
    resolved === DEFAULT_POSTGRES_SCHEMA
      ? `db.postgres.schema is not set (so "${DEFAULT_POSTGRES_SCHEMA}")`
      : `db.postgres.schema is "${resolved}"`;
  const adapterDescription =
    adapterSchema === undefined
      ? `the database adapter passed to Nextly sets no schema (so "${DEFAULT_POSTGRES_SCHEMA}")`
      : `the database adapter passed to Nextly uses schema "${adapterSchema}"`;
  // Each remedy is phrased as the edit that makes that side match the other,
  // so dropping a setting is offered where dropping it is what matches.
  const fixAdapter =
    resolved === DEFAULT_POSTGRES_SCHEMA
      ? "create the adapter without a schema option"
      : `create the adapter with { schema: "${resolved}" }`;
  const fixConfig =
    adapterSchema === undefined
      ? "remove db.postgres.schema"
      : `set db.postgres.schema to "${adapterEffective}"`;
  throw new NextlyError({
    code: "NEXTLY_POSTGRES_SCHEMA_MISMATCH",
    publicMessage:
      `${configDescription}, but ${adapterDescription}. ` +
      `Both must name the same schema, or tables and migrations end up split between them. ` +
      `To fix it, ${fixAdapter}, or ${fixConfig}.`,
    logContext: {
      reason: "postgres-schema-mismatch",
      configured: resolved,
      adapter: adapterSchema,
    },
  });
}

/** Publish the resolved schema for every later consumer. */
export function setActivePostgresSchema(name: string): void {
  globalForPostgresSchema.__nextly_active_postgres_schema =
    validatePostgresSchema(name);
}

/** The schema every consumer reads. `public` until boot says otherwise. */
export function activePostgresSchema(): string {
  return (
    globalForPostgresSchema.__nextly_active_postgres_schema ??
    DEFAULT_POSTGRES_SCHEMA
  );
}

/** Reset to the default. For tests and for a reload that failed. */
export function clearActivePostgresSchema(): void {
  globalForPostgresSchema.__nextly_active_postgres_schema =
    DEFAULT_POSTGRES_SCHEMA;
}

/**
 * The DDL that makes the schema exist.
 *
 * Run before anything that writes: `search_path` naming a schema that is not
 * there does not fail, it silently falls through to whatever else is on the
 * path — so the first migration would create its tables in `public` and the
 * option would appear to do nothing.
 */
export function createSchemaSql(name: string): string {
  return `CREATE SCHEMA IF NOT EXISTS ${validatePostgresSchema(name)}`;
}
