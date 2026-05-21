---
"nextly": patch
---

Fix `nextly migrate` failing on every fresh database with `relation "nextly_migration_journal" does not exist` (PostgreSQL) / equivalent on MySQL + SQLite, and the dev cold-boot prompting interactively to "rename" or "create" the missing table with destructive options.

**Root cause.** The `nextly_migration_journal` table (F8 PR 5 — runtime audit journal for every schema apply) is declared in three Drizzle schema files (`src/schemas/migration-journal/{postgres,mysql,sqlite}.ts`) but no bundled migration ever creates it. The chain instead jumped straight to `20260501_000000_journal_batch.sql`, which does `ALTER TABLE nextly_migration_journal ADD COLUMN batch ...` — failing because the table doesn't exist yet.

Two downstream symptoms:

1. `nextly migrate` on a fresh DB fails at the journal_batch ALTER — every migration before it applies, then the chain aborts. Operators see `1 failed` in the summary and downstream migrations never run.
2. The runtime first-run probe (`PROBE_TABLE` in `src/init/first-run.ts` = `"nextly_migration_journal"`) checks for this table to decide whether `ensureFirstRunSetup` should run. Since the table never gets created by migrations, the probe always returns `false` on cold boot, kicking off `freshPushSchema` which uses `drizzle-kit pull` and emits an interactive TTY prompt offering to "rename example_users → nextly_migration_journal" / "rename field_permissions → nextly_migration_journal" — both of which would silently destroy user data if accepted.

**Fix.** Adds a new bundled migration `20260430_000000_000_create_migration_journal.sql` for each of the three dialects (PostgreSQL, MySQL, SQLite) that creates the table per its Drizzle schema declaration. The synthetic `_000000_000` time component sorts the new migration strictly between `20260429_000000_000_initial_journal.sql` (creates the unrelated `nextly_migrations` file-ledger table) and the existing `20260501_000000_journal_batch.sql` (which now succeeds against the newly-created table).

The new migration omits the `batch` column on purpose — the existing `20260501_journal_batch` migration adds it next, preserving the migration audit trail for environments that already ran the earlier subset.

**Note for migrators on a partial-failed state.** Any environment that ran `nextly migrate` on `0.0.2-alpha.14` and hit the `journal_batch` failure has the `nextly_migrations` table created + populated, but `nextly_migration_journal` missing. `nextly migrate` on `0.0.2-alpha.15+` will run the new `20260430_create_migration_journal` migration (creating the missing table) and then re-attempt `20260501_journal_batch` (which now succeeds). No manual intervention required.

**Follow-up recommended.** The repo has no integration test that runs the full bundled migration chain end-to-end against a fresh PostgreSQL container — adding one would have caught this regression. Suggested location: `packages/nextly/src/database/migrations/__tests__/full-chain.integration.test.ts`.
