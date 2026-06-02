# Fresh-Push Drop-Guard Unification — Design

**Date:** 2026-06-02
**Status:** Approved (design)
**Scope:** Single focused fix within the unified-schema-pipeline initiative.

## Problem

`nextly migrate` Phase 1 (core schema reconciliation) can silently drop all
user content tables (`dc_*` / `single_*` / `comp_*`) as collateral damage.

Mechanism (verified):

1. `reconcileCore` introspects only `CORE_TABLE_NAMES`, diffs against
   `getCoreSchema`, and — when core drift is detected (`ops.length > 0`) —
   calls `applyCore` → `freshPushSchema(dialect, db, getDialectTables(d))`.
   `getDialectTables` returns the **core-only** static bundle.
   (`packages/nextly/src/domains/schema/migrate/core-reconcile.ts:78-84`,
   `packages/nextly/src/database/index.ts:52-58`)
2. `freshPushSchema` hands that core-only schema to drizzle-kit's
   `pushSchema`, which diffs it against the **entire live DB**. User tables
   are absent from the provided schema, so drizzle-kit marks them
   "extraneous" and emits `DROP TABLE` for them.
   (`packages/nextly/src/domains/schema/pipeline/fresh-push.ts:90-91,134-139`)
3. `freshPushSchema` executes those statements raw — its statement filter
   explicitly **allows** `DROP`. The user tables are dropped.

The danger is **not** SQLite-specific. The worst real-world case is a Nextly
**version upgrade** that legitimately changes the core schema on production
Postgres: `ops.length > 0` fires, `applyCore` runs, and every content table
is dropped.

### Why the dev server is NOT affected

The dev server (`next dev` boot-apply → `reloadNextlyConfig`) uses the same
drizzle-kit `pushSchema`, but through `PushSchemaPipeline`, which wraps it
with `filterUnsafeStatements`
(`packages/nextly/src/domains/schema/pipeline/pushschema-pipeline.ts:955-1066`).
That guard **blocks** `DROP TABLE` / `DROP SEQUENCE` / `DROP INDEX` for any
object whose owner table is not in the desired set, logging
`[Nextly schema] Blocked DROP ...`. `freshPushSchema` calls `pushSchema` raw,
without this guard. Same engine — one caller guarded, one not. That single
difference is the entire bug.

`migrate:fresh` is unaffected and stays destructive on purpose: its wipe is
the explicit `dropAllTables` (`DROP TABLE IF EXISTS`), not this implicit
drop. (`packages/nextly/src/cli/commands/migrate-fresh.ts:454-474`)

## Goal

Share the dev server's proven drop-guard onto `freshPushSchema` so that a
core-only push can never drop a user table on any dialect — eliminating two
divergent apply paths in favor of one guarded path.

**Non-goal:** Do NOT replace the file-based migration model with the dev
server's declarative introspect-and-auto-apply. Phase 2 (committed,
checksummed `.sql` files + ledger) stays file-based — that is the OSS-standard
production-safe contract and is deliberately forbidden from running at boot in
production (`packages/nextly/src/init/boot-apply.ts:22-27`).

## Design

### Unit 1 — Extract the guard into a shared pure module

Create `packages/nextly/src/domains/schema/pipeline/filter-unsafe-statements.ts`
(sits beside the existing `pipeline/managed-tables.ts` it depends on).

Move, verbatim, from `pushschema-pipeline.ts`:

- `filterUnsafeStatements(statements: string[], desiredTableNames: string[]): string[]`
  (currently the private method at lines 955-1066) — exported pure function.
- `inferOwnerTableFromObjectName(objectName, desiredSet)` (lines 1089-1101) —
  module-private helper.
- `ORPHAN_DROP_PATTERNS` (lines 222-234) — module-private const.

It imports `isManagedTable` from the existing `./managed-tables` module (no
change there). The `console.warn` blocking logs stay inside the function so
every caller emits the identical operator-visible protection log. Behavior is
byte-identical to today.

`PushSchemaPipeline` is updated to import and delegate to the shared function
(its private method is removed, or becomes a one-line passthrough). This must
not change dev-server behavior — covered by existing pipeline tests.

### Unit 2 — Wire the guard into `freshPushSchema`

In `packages/nextly/src/domains/schema/pipeline/fresh-push.ts`, the desired
table set is exactly `Object.keys(schema)` — the tables the caller handed in.

- **SQLite** (`applyViaPushSchemaSQLite`): run `result.statementsToExecute`
  through `filterUnsafeStatements(stmts, Object.keys(schema))` before the
  existing execution loop (line 127).
- **PostgreSQL**: replace `result.apply()` (which executes opaquely, leaving
  no seam for the filter) with the dev-server shape — read
  `result.statementsToExecute`, run them through
  `filterUnsafeStatements(stmts, Object.keys(schema))`, and execute the safe
  set ourselves via the async `.execute()` path, wrapped in a single
  transaction (`BEGIN` … `COMMIT` / `ROLLBACK`) for atomic core reconcile.
  This mirrors `pushschema-pipeline.ts:795-843`.
- **MySQL** (`applyViaGenerate`): diffs against an empty snapshot → emits only
  `CREATE` → the filter is a harmless no-op. Apply it anyway for uniformity.

Effect: a core-only `freshPushSchema` call can no longer drop a
`dc_*`/`single_*`/`comp_*` table — they are not in `Object.keys(schema)`, so
they hit the BLOCK branch. The SQLite rebuild pattern
(`CREATE __new / DROP / RENAME` for a table that IS in the desired set) still
passes, because that table is in the keys → ALLOW branch.

This fixes the root cause for **all three** `freshPushSchema` callers at once:
Phase 1 core reconcile, `ensureCoreTables`, and the MySQL seed safety-net.

### Transaction note (Neon)

The PG transaction wraps only Phase 1 core DDL — a handful of `CREATE`/`ALTER`
statements, run only when core drifts, executed back-to-back and committed
immediately (never idle). It does not approach Neon's
`idle_in_transaction_session_timeout`. The transaction is **separable from the
safety fix**: the data-loss protection comes entirely from
`filterUnsafeStatements`; the transaction only adds atomicity and could be
dropped without weakening protection.

## Error handling

- Blocked drops are logged (`[Nextly schema] Blocked DROP ...`) and skipped;
  the apply continues with the safe statements (matches dev-server behavior).
- PG transaction: on any statement error, `ROLLBACK` then rethrow, so core
  reconcile is all-or-nothing.
- Existing `already exists` / `duplicate column` swallowing in `fresh-push.ts`
  is preserved.

## Testing

1. **Unit (shared guard):** move/extend existing `filterUnsafeStatements`
   coverage to target the new module — DROP TABLE in/out of desired set,
   DROP SEQUENCE/INDEX owner inference, custom-named object → blocked.
2. **DB-backed regression (the core proof), isolated SQLite only:**
   - Create core schema + a `dc_articles` table; insert a row.
   - Force a core-reconcile that triggers `applyCore` (core drift present).
   - Assert: `dc_articles` still exists, the row still exists, and a
     `[Nextly schema] Blocked DROP TABLE "dc_articles"` warning was emitted.
3. **Regression guard:** existing `PushSchemaPipeline` + `reload-config` tests
   must stay green (proves the dev-server path is unchanged by the extraction).

Testing runs against isolated SQLite (`file:/tmp/...`), never the real Neon
Postgres DB.

## Files

- Create: `packages/nextly/src/domains/schema/pipeline/filter-unsafe-statements.ts`
- Modify: `packages/nextly/src/domains/schema/pipeline/pushschema-pipeline.ts`
  (delegate to shared function; remove moved code)
- Modify: `packages/nextly/src/domains/schema/pipeline/fresh-push.ts`
  (wire guard into SQLite + PG + MySQL paths; PG → statement-level + tx)
- Create/extend tests as above.
