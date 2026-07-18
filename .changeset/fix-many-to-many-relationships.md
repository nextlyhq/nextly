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

Fix many-to-many relationships, which did not work on any database.

Creating a many-to-many field produced an invalid junction-table migration, so the junction table was never created. Even past that, the target collection was never resolved (so links silently did nothing), the parent table gained a phantom column it should not have, inserts crashed on SQLite, and reads plus inserts failed on MySQL. Many-to-many links now create, read, and delete correctly on Postgres, MySQL, and SQLite.
