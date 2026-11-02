---
"@nextlyhq/adapter-drizzle": patch
"@nextlyhq/adapter-mysql": patch
"@nextlyhq/adapter-postgres": patch
"@nextlyhq/adapter-sqlite": patch
"@nextlyhq/admin": patch
"@nextlyhq/admin-css": patch
"@nextlyhq/blocks-engine": patch
"@nextlyhq/blocks-react": patch
"@nextlyhq/builder": patch
"@nextlyhq/eslint-config": patch
"@nextlyhq/eslint-plugin": patch
"@nextlyhq/module-specifiers": patch
"@nextlyhq/plugin-accounts": patch
"@nextlyhq/plugin-commerce": patch
"@nextlyhq/plugin-form-builder": patch
"@nextlyhq/plugin-mcp": patch
"@nextlyhq/plugin-page-builder": patch
"@nextlyhq/plugin-sdk": patch
"@nextlyhq/plugin-seo": patch
"@nextlyhq/prettier-config": patch
"@nextlyhq/storage-s3": patch
"@nextlyhq/storage-uploadthing": patch
"@nextlyhq/storage-vercel-blob": patch
"@nextlyhq/telemetry": patch
"@nextlyhq/tsconfig": patch
"@nextlyhq/ui": patch
"create-nextly-app": patch
"nextly": patch
---

An applied app migration now carries the checksum of its file's whole text, down section included: `nextly migrate`, `migrate:baseline` and `migrate:resolve --applied` all record it. When an applied file no longer matches, `nextly migrate` (and the boot migrate step) stop before changing anything, name every edited file, and exit with code 2 (`MIGRATION_TAMPERED`, as the migrations guide documents); restore the file and put the change in a new migration, or, where the edit is intended and the database already matches it, accept it with `nextly migrate:resolve --applied <file>`, which records the new checksum. `migrate:status` shows a file as "Applied (modified)" only when it differs from a recorded checksum, so a file recorded by `migrate:resolve --applied` no longer reads as modified.

**Checksums for existing rows.** Rows recorded without a checksum (by `migrate:resolve --applied`, or by an earlier version) are taken as matching. The next run records the current file's checksum and lists those files. Edits made before the upgrade to those files are not detected. A project whose applied rows already carry a checksum (recorded by a recent `nextly migrate`) and whose applied files were edited since will see the first run of this release stop with exit code 2, naming those files; the boot migrate step logs it, keeps serving, and applies nothing until it is resolved. Restore each file, or accept the edit with `nextly migrate:resolve --applied <file>`.
