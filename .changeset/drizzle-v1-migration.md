---
"nextly": patch
"@nextlyhq/adapter-drizzle": patch
"@nextlyhq/adapter-postgres": patch
"@nextlyhq/adapter-mysql": patch
"@nextlyhq/adapter-sqlite": patch
"@nextlyhq/admin": patch
"@nextlyhq/ui": patch
"@nextlyhq/plugin-sdk": patch
"@nextlyhq/plugin-form-builder": patch
"@nextlyhq/plugin-page-builder": patch
"@nextlyhq/storage-s3": patch
"@nextlyhq/storage-uploadthing": patch
"@nextlyhq/storage-vercel-blob": patch
"create-nextly-app": patch
---

Migrate to Drizzle V1 (`drizzle-orm` + `drizzle-kit` pinned exactly to `1.0.0-rc.4`).

**What changed under the hood**

- The schema engine now uses drizzle-kit's per-dialect `payload/*` programmatic entrypoints; the removed `drizzle-kit/api` module is gone from every code path.
- Runtime relations are assembled centrally with `defineRelations` (relations v2); the 21 per-file `relations()` blocks are deleted. Dynamic (UI-builder) tables register as queryable tables and _can_ carry relation edges through the registry's composition path (the 3-arg `registerDynamicSchema` API); wiring specific edges (e.g. `creator`) at the registration sites is follow-up work.
- All internal queries use RQB v2 object filters; adapters construct Drizzle with the object form only.
- The data-loss guard was redesigned for v1's semantics: v1 _includes_ destructive statements in its output (the old omit-and-warn contract is gone), so Nextly scans every statement batch and refuses unexpected destructive SQL. The SQLite cascade defense (#5782) is unchanged and re-verified.

**What you must do when upgrading**

- If your app imports `drizzle-orm` directly, move it to **exactly `1.0.0-rc.4`** — the same instance Nextly uses. Mixed versions break Drizzle's internal `is()` checks. Apps that only use Nextly's APIs (the default scaffold) need no change.
- If you wrote your own `relations()` definitions, follow Drizzle's relations v1→v2 migration guide (`defineRelations`).
- Run `drizzle-kit up` only if you ALSO ran raw drizzle-kit against the same project.

**One-time schema reconcile on first boot after upgrading** (automatic, non-destructive, verified against databases created by the previous Drizzle):

- PostgreSQL: nothing — v1 proposes zero changes on an untouched schema.
- MySQL: `created_at`/`updated_at` DDL defaults are normalized to `CURRENT_TIMESTAMP` (metadata-only `MODIFY COLUMN`s; previous versions baked a boot-time literal into the default).
- SQLite: the Nextly metadata tables are rebuilt once via SQLite's data-preserving table-rebuild (v1 represents UNIQUE constraints inline). Your content rows survive; this was pinned by an upgrade-simulation test.

**Advisory (#5782)**: on SQLite, `PRAGMA foreign_keys=OFF` is silently ignored inside a transaction. Nextly's own applies are defended (rebuilds run outside transactions with an integrity check); raw drizzle-kit migrations you run yourself against the same SQLite database are not covered by that defense.
