---
"@nextlyhq/adapter-drizzle": patch
"@nextlyhq/adapter-mysql": patch
"@nextlyhq/adapter-postgres": patch
"@nextlyhq/adapter-sqlite": patch
"@nextlyhq/admin": patch
"create-nextly-app": patch
"@nextlyhq/eslint-config": patch
"nextly": patch
"@nextlyhq/plugin-form-builder": patch
"@nextlyhq/prettier-config": patch
"@nextlyhq/storage-s3": patch
"@nextlyhq/storage-uploadthing": patch
"@nextlyhq/storage-vercel-blob": patch
"@nextlyhq/telemetry": patch
"@nextlyhq/tsconfig": patch
"@nextlyhq/ui": patch
---

Fix the schema-apply pipeline silently skipping column type changes on Postgres, leaving the live DB permanently drifted while the journal still recorded the apply as successful.

**The bug, end-to-end.** When a Builder field was reclassified from a text-like type (`text`, `richText`, `textarea`) to a JSON-backed type (`group`, `repeater`, `blocks`, `json`, `chips`, `point`), the diff engine produced a `change_column_type` operation (`text` → `jsonb` on Postgres). That op type was not in the fast in-memory DDL emitter's allow-list, so the pipeline fell back to `drizzle-kit`'s `pushSchema`. `pushSchema` considers `text` → `jsonb` a non-implicit cast and, in programmatic (non-TTY) mode, omits the `ALTER COLUMN … SET DATA TYPE` statement from `statementsToExecute`, returning the omission only in `warnings`. The pipeline ran the (now-empty or partial) statement list, hit no error, and the migration journal recorded `status='success'`. The next preview compared the live `text` column to the desired `jsonb` token from `field-column-descriptor` and re-detected the same drift — forever. A site running on Neon (rext-site-v2 / `dc_case_studies`) ended up with 10 columns stuck on `text` after three "successful" UI applies on 2026-05-20.

**The fix.** Four complementary changes in `domains/schema/pipeline/`:

1. The fast in-memory DDL emitter now owns `change_column_type`, `change_column_nullable`, and `change_column_default` on Postgres. `change_column_type` emits `ALTER TABLE … ALTER COLUMN … SET DATA TYPE <toType> USING "<col>"::<toType>` — the explicit `USING` cast covers the cross-family transitions that Postgres refuses to do implicitly (including the `text` → `jsonb` case), and Postgres errors loudly at execution when no registered cast exists between the source and target types. `change_column_nullable` emits `SET NOT NULL` / `DROP NOT NULL` per the `toNullable` value. `change_column_default` emits `SET DEFAULT <expr>` (raw expression, owned by `build-from-fields`) or `DROP DEFAULT` when `toDefault === undefined`. The three op types are added to `FAST_PATH_OP_TYPES` so they never reach drizzle-kit on Postgres again.

2. The code-first SQL template at `sql-templates/postgres.ts` (consumed by `nextly migrate:create`) now emits the same `USING "<col>"::<toType>` clause for `change_column_type`. Without this, code-first projects on Postgres would have produced a `.sql` file in the repo whose `ALTER COLUMN … TYPE jsonb` failed at `nextly migrate` apply time in CI — the same drift loop as the Builder UI path, just deferred to migration-apply time. Both consumer surfaces (the apply pipeline and the migration-file generator) now share the same `USING` contract.

3. Empty op lists on Postgres now also take the fast path (which emits nothing) instead of falling through to drizzle-kit. Letting drizzle-kit handle a "no ops" apply meant it ran its own catalog re-introspection and rename heuristics against the full live DB, and emitted destructive DDL that the diff engine had explicitly decided was not needed. The textarea→richText regression on rext-site-v2 / `test_verify_fix` surfaced this: both field types map to a `text` column on Postgres, so the diff produced zero column-level ops, but the slow path then attempted `DROP INDEX "single_pricings_pkey"` for an unrelated managed table, which Postgres rejects because a primary-key index cannot be dropped directly. Trusting our own diff for "no DDL is needed" closes that surface entirely.

4. A safety net for the slow path (MySQL / SQLite, where the in-memory emitter does not apply, or any future op type that hasn't yet been added to the fast path). After `kit.pushSchema(...)` returns, the pipeline now inspects `pushResult.warnings`; when drizzle-kit declined any statement the apply throws a `PushSchemaError` carrying the warning text, so the journal correctly records a failed apply rather than a false success. Operators see the precise drizzle-kit message instead of an invisible silent skip, and the next apply will not re-detect the same phantom drift.

Affected sites running on a published `0.0.2-alpha.0` … `0.0.2-alpha.16` still need a one-time `ALTER TABLE … ALTER COLUMN … SET DATA TYPE jsonb USING …` to relabel columns that were created as `text` during the silent-skip window; the fix prevents NEW drift but does not retroactively repair existing tables (running an Apply through the Builder after upgrading does the relabel automatically). Unit tests cover the three new emitter cases (including identifier-quoting through the `USING` clause), the routing-eligibility decisions for each (including the empty-ops case), and the safety-net throw path with a representative drizzle-kit warning payload.
