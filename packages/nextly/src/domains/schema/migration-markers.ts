/**
 * Header markers that identify migrations which are snapshot-less by design.
 *
 * These live in their own dependency-free module because both the writer (which
 * runs inside the request pipeline, behind the DI container) and `migrate:check`
 * (a CLI command that must not pull the container in) need the same string.
 */

/**
 * Stamped on every migration written by a Schema Builder save. Such a file
 * records the DDL the apply pipeline already executed rather than a diff
 * against a snapshot, so `migrate:check` skips the snapshot-pairing checks for
 * it instead of failing MISSING_SNAPSHOT after every UI edit.
 */
export const BUILDER_MIGRATION_MARKER = "-- Generated: schema-builder";
