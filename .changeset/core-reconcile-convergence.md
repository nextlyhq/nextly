---
"@nextlyhq/adapter-drizzle": patch
"@nextlyhq/adapter-mysql": patch
"@nextlyhq/adapter-postgres": patch
"@nextlyhq/adapter-sqlite": patch
"@nextlyhq/admin": patch
"@nextlyhq/admin-css": patch
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

Schema reconcile now converges, and SQLite no longer loses indexes when a table changes.

Four faults compounded into one. Comparing a primary key's nullability produced a change no `ALTER` can make on SQLite, so it was proposed forever. Comparing a string default compared `'pending'` against `pending`, so every string-defaulted column looked changed, on every dialect. Both kept the reconcile from ever seeing a clean database, and each unnecessary change rebuilt the table — which on SQLite drops its indexes, because the rebuild creates a new table from a schema that never declared them. `nextly_i18n_archive` completed the set: it was declared in the schema the diff reads but missing from the map the apply pushes, so it was proposed on every run and created by none.

On a real database this took a reconcile from 45 proposed operations to 1, and from 23 to 9 on an older one, where the remainder is the genuine upgrade. Indexes declared for a collection are now re-asserted in the same transaction as the change, so a table cannot commit without them.
