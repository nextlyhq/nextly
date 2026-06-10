/**
 * Raw `CREATE TABLE` + index DDL for `nextly_schema_events`, per dialect.
 *
 * Used by `nextly upgrade` to create the events table on an existing DB that
 * predates it (fresh installs get it via `getCoreSchema` + boot-apply). Kept
 * as raw DDL — rather than the adapter's column-only `createTable` — so the
 * partial unique index and secondary indexes are created too.
 *
 * @module domains/schema/events/schema-events-ddl
 * @since v0.0.3-alpha (Plan B)
 */

type Dialect = "postgresql" | "mysql" | "sqlite";

/** Returns the ordered DDL statements that create the events table + indexes. */
export function getSchemaEventsDdl(dialect: Dialect): string[] {
  switch (dialect) {
    case "postgresql":
      return [
        `CREATE TABLE IF NOT EXISTS nextly_schema_events (
          id TEXT PRIMARY KEY,
          event_type TEXT NOT NULL,
          status TEXT NOT NULL,
          source TEXT NOT NULL,
          filename TEXT,
          sha256 TEXT,
          scope_kind TEXT,
          scope_slug TEXT,
          started_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
          ended_at TIMESTAMPTZ,
          duration_ms INTEGER,
          applied_by TEXT,
          note TEXT,
          statements_planned INTEGER,
          statements_executed INTEGER,
          renames_applied INTEGER,
          error_code TEXT,
          error_message TEXT,
          error_json JSONB,
          superseded_event_ids JSONB,
          superseded_at TIMESTAMPTZ,
          superseded_by TEXT
        )`,
        `CREATE UNIQUE INDEX IF NOT EXISTS nextly_schema_events_filename_applied_idx
          ON nextly_schema_events (filename)
          WHERE event_type = 'file_apply' AND status = 'applied'`,
        `CREATE INDEX IF NOT EXISTS nextly_schema_events_started_at_idx ON nextly_schema_events (started_at)`,
        `CREATE INDEX IF NOT EXISTS nextly_schema_events_scope_idx ON nextly_schema_events (scope_kind, scope_slug)`,
      ];
    case "mysql":
      // MySQL has no partial indexes; "one applied row per file" is enforced
      // in application code (SchemaEventsRepository).
      return [
        `CREATE TABLE IF NOT EXISTS nextly_schema_events (
          id VARCHAR(36) PRIMARY KEY,
          event_type VARCHAR(32) NOT NULL,
          status VARCHAR(32) NOT NULL,
          source VARCHAR(32) NOT NULL,
          filename VARCHAR(255),
          sha256 VARCHAR(64),
          scope_kind VARCHAR(32),
          scope_slug VARCHAR(255),
          started_at DATETIME(3) NOT NULL,
          ended_at DATETIME(3),
          duration_ms INT,
          applied_by VARCHAR(255),
          note TEXT,
          statements_planned INT,
          statements_executed INT,
          renames_applied INT,
          error_code VARCHAR(64),
          error_message TEXT,
          error_json JSON,
          superseded_event_ids JSON,
          superseded_at DATETIME(3),
          superseded_by VARCHAR(36)
        )`,
        `CREATE INDEX nextly_schema_events_started_at_idx ON nextly_schema_events (started_at)`,
        `CREATE INDEX nextly_schema_events_scope_idx ON nextly_schema_events (scope_kind, scope_slug)`,
      ];
    case "sqlite":
      return [
        // PK is `NOT NULL` to match the Drizzle def: SQLite (unlike PG/MySQL)
        // treats a bare `TEXT PRIMARY KEY` as nullable, so without it drizzle-kit
        // sees a nullability diff and rebuilds the table on every push.
        `CREATE TABLE IF NOT EXISTS nextly_schema_events (
          id TEXT PRIMARY KEY NOT NULL,
          event_type TEXT NOT NULL,
          status TEXT NOT NULL,
          source TEXT NOT NULL,
          filename TEXT,
          sha256 TEXT,
          scope_kind TEXT,
          scope_slug TEXT,
          started_at INTEGER NOT NULL,
          ended_at INTEGER,
          duration_ms INTEGER,
          applied_by TEXT,
          note TEXT,
          statements_planned INTEGER,
          statements_executed INTEGER,
          renames_applied INTEGER,
          error_code TEXT,
          error_message TEXT,
          error_json TEXT,
          superseded_event_ids TEXT,
          superseded_at INTEGER,
          superseded_by TEXT
        )`,
        // No partial unique index on SQLite — see schemas/schema-events/sqlite.ts.
        // "One applied row per file" is enforced in app code (matching MySQL).
        `CREATE INDEX IF NOT EXISTS nextly_schema_events_started_at_idx ON nextly_schema_events (started_at)`,
        `CREATE INDEX IF NOT EXISTS nextly_schema_events_scope_idx ON nextly_schema_events (scope_kind, scope_slug)`,
      ];
    default: {
      const _exhaustive: never = dialect;
      throw new Error(`Unsupported dialect: ${String(_exhaustive)}`);
    }
  }
}
