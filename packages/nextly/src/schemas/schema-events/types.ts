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
  | "core_apply"; // core (system) schema was reconciled/created

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
  | "dev-server"
  | "admin-ui"
  | "cli-sync"
  | "legacy-prebackfill"; // synthesized core_apply row during `nextly upgrade`

/** Scope the event touched. */
export type SchemaEventScopeKind =
  | "collection"
  | "single"
  | "component"
  | "core"
  | "global";
