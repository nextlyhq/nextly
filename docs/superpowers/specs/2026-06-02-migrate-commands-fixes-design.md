# Migrate-Command Fixes — Design

**Date:** 2026-06-02
**Status:** Approved (design)
**Scope:** Four independent, pre-existing defects in the `nextly migrate*` command suite, found during CLI E2E. None are related to the fresh-push drop-guard work (which is already merged); these predate it.

## Background

A CLI-driven E2E against isolated SQLite (the drop-guard verification) surfaced four defects in the migration commands. The drop-guard itself works correctly end-to-end. These four are separate and are fixed here.

## Issues & fixes

### #1 — `migrate --dry-run` crashes on a fresh DB

**Symptom:** `✗ no such table: nextly_schema_events`.

**Root cause:** `runMigrate`'s dry-run branch calls `findPendingFiles` →
`SchemaEventsRepository.isFileApplied`, which runs a `SELECT` against
`nextly_schema_events`. On a fresh DB that table does not exist yet (only the
real `migrate` bootstraps it in Phase 1), so the query throws.
(`packages/nextly/src/cli/commands/migrate.ts:211-223, 283-296`)

**Fix:** Keep dry-run strictly **read-only** — it must never bootstrap. In the
dry-run path, check `adapter.tableExists("nextly_schema_events")` first; if the
ledger is absent, every discovered migration is **pending** (a fresh DB has
applied nothing) and we skip the `isFileApplied` loop entirely. This requires
threading the adapter's `tableExists` into `findPendingFiles` (it currently
receives only `db`). Pass the adapter (or a `tableExists` callback) through.

**Verdict:** Matches standard migration-tool behavior (Prisma/Rails show all
pending on a fresh DB). No write, no bootstrap.

### #2 — `migrate:status` double-lists every migration

**Symptom:** each migration appears twice — once `Pending`, once
`Applied (file missing)`.

**Root cause:** `buildMigrationStatuses` builds `appliedMap` keyed by the
**ledger filename** (`…init.sql`, with extension) but looks up by `file.name`
(`…init`, no extension). The keys never match, so every file is reported
`pending` and every ledger row is reported `applied (file missing)`.
(`packages/nextly/src/cli/commands/migrate-status.ts:444-499`)

**Fix:** Normalize the key. Strip the `.sql` extension when building the map
key from `record.filename` (or look up with `${file.name}.sql`), so the file
and its ledger row reconcile to a single row. Display-only; no schema/DB impact.

### #3 — `migrate:fresh` (SQLite) creates legacy tables → next `migrate` aborts

**Symptom:** after `migrate:fresh`, the DB has `nextly_migrations` +
`content_schema_events` and is missing ~11 consolidated tables (incl.
`nextly_schema_events`). A subsequent `migrate` aborts:
`Legacy bookkeeping tables detected (nextly_migrations). Run nextly upgrade…`.

**Root cause:** `migrate:fresh` special-cases SQLite-without-bundled-migrations
to call `pushSqliteSchema` → `generateSqliteCreateStatements()`, a hand-written
block of **stale, legacy** `CREATE TABLE` DDL that was never updated when the
schema was consolidated to `getDialectTables` + `nextly_schema_events`.
(`packages/nextly/src/cli/commands/migrate-fresh.ts:236-243, 715-752+`)

**Fix:** **Delete the SQLite special-case** and let all dialects fall through
to the existing `runMigrate` path (which the PG/MySQL branch already uses).
`runMigrate` does Phase 1 core reconcile via `freshPushSchema(getDialectTables)`
(the consolidated single source of truth + ledger bootstrap) and Phase 2 user
files. Because there are **no bundled migrations for any dialect** (verified at
build: "migrations directory not found"), removing the special-case changes
behavior *only* for the broken `!hasBundledMigrations && sqlite` case; every
other case already went through `runMigrate`.

Remove the now-dead `pushSqliteSchema` and `generateSqliteCreateStatements`.
Also remove `checkBundledMigrationsExist` / `hasBundledMigrations` if they
become unused (else `eslint --max-warnings 0` fails). Confirm nothing else
references the removed symbols before deleting.

**Bonus:** SQLite `migrate:fresh` will now also apply user migration files
(Phase 2), which the old special-case skipped entirely.

**Verdict:** OSS-maintainability win — deletes hundreds of lines of
hand-maintained DDL in favor of one source of truth. Empirically pre-validated:
the E2E's first `migrate` on an empty SQLite DB already produced the full
consolidated schema via Phase 1.

### #4 — `migrate:resolve --rolled-back` never actually re-runs the file

**Symptom:** `migrate:resolve --rolled-back <file>` reports "it will re-run on
next migrate", but the next `migrate` says "Nothing to migrate".

**Root cause:** `resolveRolledBack` appends a new `rolled_back` `file_apply`
event (append-only, by design) but leaves the prior `applied` row intact
(`packages/nextly/src/domains/schema/migrate/resolve.ts:160-181`). However
`SchemaEventsRepository.isFileApplied` returns true if **any** `applied` row
exists ever, ignoring a later `rolled_back`. So the file stays "applied".
(`packages/nextly/src/domains/schema/events/schema-events-repository.ts:156`)

**Fix:** Make `isFileApplied` **latest-status-wins** — a file is "applied" iff
its *most recent* `file_apply` event has `status === "applied"`. This aligns
`isFileApplied` with the event-sourced model the resolve command already uses
(`resolve.ts` has a `newest(rows)` helper, sort by `startedAt` desc). 

Implementation notes:
- Extract the newest-event ordering into a **shared** location (e.g. a small
  helper in the schema-events domain) and use it from BOTH `isFileApplied` and
  `resolve.ts`'s `newest`. The repository must NOT import from the
  `cli/commands` or resolve-command layer (wrong dependency direction).
- Keep the tiebreaker identical to today's `newest()` (`startedAt` desc) for
  consistency; resolve inserts `rolled_back` with a strictly-later timestamp so
  in practice the order is unambiguous.
- Affected `isFileApplied` call sites — verify each is correct under latest-wins:
  - `migrate.ts:293` (dry-run pending) — rolled_back ⇒ pending. Correct.
  - `migrate.ts:372` (Phase 2 skip) — rolled_back ⇒ re-runs. The goal.
  - `schema-events-repository.ts:284` `assertFileNotAlreadyApplied` (MySQL
    duplicate guard) — rolled_back ⇒ allows re-apply. Correct.
- **Existing tests:** `schema-events-repository.test.ts` encodes the old
  "any applied row" behavior; update those assertions to latest-wins.

**Verdict:** Aligns a predicate with the codebase's own existing event-sourced
model — consistency, not a new philosophy.

## Testing

- **#2 (unit):** `buildMigrationStatuses` with a ledger filename `…init.sql` and
  a discovered file `…init` → one `applied` row, no `pending` + no
  `applied (file missing)` duplicate.
- **#4 (unit):** `isFileApplied` — applied-only ⇒ true; applied then later
  rolled_back ⇒ false; in_progress→failed ⇒ false. Update existing repo tests.
- **#1 (integration, real SQLite):** fresh DB (no ledger) → `migrate --dry-run`
  lists all migrations pending, exits 0, writes nothing (ledger still absent).
- **#3 (integration, real SQLite):** `migrate:fresh --force` → DB has
  `nextly_schema_events`, NOT `nextly_migrations`/`content_schema_events`; then
  `migrate` runs without the legacy-bookkeeping abort.

All tests run against isolated SQLite (`:memory:` / `file:/tmp/…`), never Neon.

## Files

- Modify: `packages/nextly/src/cli/commands/migrate.ts` (#1 dry-run guard +
  thread `tableExists` into `findPendingFiles`)
- Modify: `packages/nextly/src/cli/commands/migrate-status.ts` (#2 key
  normalization in `buildMigrationStatuses`)
- Modify: `packages/nextly/src/cli/commands/migrate-fresh.ts` (#3 remove SQLite
  special-case + dead code)
- Modify: `packages/nextly/src/domains/schema/events/schema-events-repository.ts`
  (#4 `isFileApplied` latest-wins)
- Create/Modify: a shared `newest`-event helper in the schema-events domain;
  update `resolve.ts` to use it (#4)
- Tests: extend `schema-events-repository.test.ts` (#4) +
  `migrate-status` unit coverage (#2) + new integration tests for #1 and #3.
