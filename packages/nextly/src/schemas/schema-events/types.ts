/**
 * Dialect-agnostic types for the `nextly_schema_events` table (spec §4.3).
 *
 * Replaces `nextly_migrations` (file ledger) and `nextly_migration_journal`
 * (apply audit) with a single events log. The pipeline (Plan C) writes rows
 * via SchemaEventsRepository; `nextly upgrade` (Plan B) backfills legacy rows.
 *
 * @module schemas/schema-events/types
 * @since v0.0.3-alpha (Plan B)
 */

/** What kind of schema change produced this row. */
export type SchemaEventType =
  | "file_apply" // a committed .sql migration file was applied
  | "dev_push" // HMR/dev-time push (source=code)
  | "ui_save" // admin-UI-driven schema change
  | "db_sync" // `nextly db:sync` ran
  | "core_apply" // core (system) schema was reconciled/created
  // A rollback of an applied migration file or plugin module that failed.
  // Its own type, so readers of a migration's applied state — which read
  // `file_apply` rows only — never take it for a change of that state.
  | "file_rollback"
  // A plugin's lifecycle state changed: `nextly plugins install` finished, or
  // `uninstall` began or finished. Recorded for every plugin, schema or none,
  // so a plugin that owns no table has a state the boot and the next install
  // read. Never pruned: the newest one IS the state.
  | "plugin_lifecycle";

/** Lifecycle state of an event row. */
export type SchemaEventStatus =
  | "in_progress"
  | "applied"
  | "failed"
  | "rolled_back"
  | "superseded";

/** Which surface triggered the event. */
export type SchemaEventSource =
  | "cli-migrate"
  | "cli-plugin-migrate"
  | "dev-server"
  | "admin-ui"
  | "cli-sync"
  | "legacy-prebackfill"; // synthesized core_apply row during `nextly upgrade`

/**
 * The longest `filename` the ledger stores, in characters.
 *
 * MySQL's column is `VARCHAR(255)`; PostgreSQL and SQLite store `TEXT`. The
 * narrowest one bounds every key, because a key one dialect records and
 * another refuses — or, in MySQL's non-strict mode, truncates into another
 * key — is a migration that applies on one and not the other.
 */
export const SCHEMA_EVENTS_FILENAME_MAX_LENGTH = 255;

/** Scope the event touched. */
export type SchemaEventScopeKind =
  | "plugin"
  | "collection"
  | "single"
  | "component"
  | "core"
  | "global";
