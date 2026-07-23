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
"@nextlyhq/plugin-page-builder": patch
"@nextlyhq/plugin-sdk": patch
"@nextlyhq/prettier-config": patch
"@nextlyhq/storage-s3": patch
"@nextlyhq/storage-uploadthing": patch
"@nextlyhq/storage-vercel-blob": patch
"@nextlyhq/telemetry": patch
"@nextlyhq/tsconfig": patch
"@nextlyhq/ui": patch
---

Duplicate entries now report "Resource already exists." instead of the stale-version conflict message, and CLI guidance only suggests commands and flags that exist.

Creating an entry that violates a unique constraint returned 409 with "The resource has changed since you last loaded it. Please refresh and try again." — the message for an optimistic-concurrency conflict, which wrongly tells the user to refresh. The legacy service envelope now carries the canonical error code, so the REST dispatcher and the Direct API rebuild the precise DUPLICATE error.

CLI guidance is corrected to real commands: the production auto-sync guard points at `nextly migrate:create` + `nextly migrate` (previously the unregistered `migrate:generate` / `migrate:run`), `nextly add` no longer tells you to run the removed `nextly dev`, and the `db:sync --force` help text states the flag is a deprecated no-op. `nextly upgrade` and `nextly migrate:resolve` now accept `--force-unlock`, so the migrate-lock busy error's advice to re-run with that flag works on every command that takes the lock.
