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
 * Refuse any schema but `public`, until the push can create tables elsewhere.
 *
 * Everything else about the setting works — the adapter's `search_path`, the
 * publication, the CLI agreeing with the server — but drizzle-kit reads the
 * desired tables as belonging to `public`. Asked to reconcile any other
 * schema, it finds none of them wanted there, creates nothing, and proposes
 * dropping the schema itself. A first boot would then run with no core tables
 * at all, so the option is refused outright rather than half-honoured.
 *
 * The one check for every path that reads the option or builds an adapter
 * from it, so the server and each CLI command refuse identically.
 */
export function assertSupportedPostgresSchema(name: string): string {
  if (name === DEFAULT_POSTGRES_SCHEMA) return name;
  throw new NextlyError({
    code: "NEXTLY_POSTGRES_SCHEMA_UNSUPPORTED",
    publicMessage:
      `db.postgres.schema is "${name}", but a PostgreSQL schema other than "${DEFAULT_POSTGRES_SCHEMA}" is not supported yet: ` +
      `Nextly can only create and migrate its tables in "${DEFAULT_POSTGRES_SCHEMA}". ` +
      `Remove db.postgres.schema (and any schema option on the database adapter), or set it to "${DEFAULT_POSTGRES_SCHEMA}".`,
    logContext: { reason: "postgres-schema-unsupported", name },
  });
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
  // PostgreSQL only: on the other dialects the value is ignored above, so
  // refusing it there would stop an app over a setting that changes nothing.
  return assertSupportedPostgresSchema(name);
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
