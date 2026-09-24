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

let active = DEFAULT_POSTGRES_SCHEMA;

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
  return name;
}

/** Publish the resolved schema for every later consumer. */
export function setActivePostgresSchema(name: string): void {
  active = validatePostgresSchema(name);
}

/** The schema every consumer reads. `public` until boot says otherwise. */
export function activePostgresSchema(): string {
  return active;
}

/** Reset to the default. For tests and for a reload that failed. */
export function clearActivePostgresSchema(): void {
  active = DEFAULT_POSTGRES_SCHEMA;
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
