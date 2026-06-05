---
"@nextlyhq/admin": patch
"nextly": patch
---

Unified schema-migration pipeline with `ui-schema.json` dual-write.

- **Migration CLI**: `migrate:create` / `migrate` / `migrate:check` / `migrate:status`, plus `migrate:down` for forward-resolved rollbacks (DOWN SQL generated at create time, renames preserved). A pooler-safe TTL migration lock replaces the session advisory lock that leaked through Neon's PgBouncer, and production deployments can run pending migrations on boot (`db.runMigrationsOnBoot` + `db.migrateLockTtlSeconds`).

- **`ui-schema.json` dual-write**: the admin Schema Builder always applies changes to the dev database AND writes a committable `ui-schema.json` (the file-only mode is retired). The manifest is now a lossless record of every field option the builder/code-first can set — full validation (min/max length, pattern, etc.), per-field admin (width, description, placeholder…), `unique`, `index`, labels, the Draft/Published `status` flag (persisted from both the field-change and settings-only save paths), and polymorphic `relationTo` arrays (previously truncated to the first target). The `toggle` field type round-trips correctly.

- **Correct column types**: `migrate:create` no longer flattens fields before diffing, so hasMany and polymorphic relationships emit `json` columns instead of a single `text` id column.

- **Diffable index/unique migrations** (Postgres/MySQL/SQLite): field `unique`/`index`, single-relationship auto-indexes, and the system slug/created_at indexes are now diffed and emitted (`CREATE`/`DROP INDEX`) with live-DB introspection, down-migration support, and a backward-compat sentinel so pre-existing tables don't churn.

- **Cleanup**: removed the unused `verification_tokens` table (a leftover from the retired Auth.js integration; custom auth uses `email_verification_tokens` and `password_reset_tokens`). `dev:reset` auto-detects the dialect from `DATABASE_URL`, and the ui-schema field-type set was widened to the full canonical list.
