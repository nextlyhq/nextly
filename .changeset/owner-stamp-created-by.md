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

Add a `created_by` owner column to collection entry tables and stamp it on create.

Every collection entry table now carries a nullable `created_by` system column (text, matching the id column type on each dialect) alongside `created_at` / `updated_at`, and it is stamped with the creating user's id on every create path. This makes `owner-only` access work zero-config: the stored rule compares `created_by` to the caller with no per-collection setup. System and seed writes (no user context) leave it null.

Because the column is nullable with no default, existing tables pick it up as a plain additive `ADD COLUMN` on the next schema apply — no backfill and no interactive prompt.

This also repairs a latent bug in the bulk create transaction path, which passed camelCase `createdAt` / `updatedAt` keys the database driver rejected; the batch create paths now use the real snake_case column names.
