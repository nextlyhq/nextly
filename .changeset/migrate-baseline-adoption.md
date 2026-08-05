---
"nextly": patch
"create-nextly-app": patch
"@nextlyhq/admin": patch
"@nextlyhq/admin-css": patch
"@nextlyhq/blocks-engine": patch
"@nextlyhq/blocks-react": patch
"@nextlyhq/ui": patch
"@nextlyhq/adapter-drizzle": patch
"@nextlyhq/adapter-postgres": patch
"@nextlyhq/adapter-mysql": patch
"@nextlyhq/adapter-sqlite": patch
"@nextlyhq/storage-s3": patch
"@nextlyhq/storage-uploadthing": patch
"@nextlyhq/storage-vercel-blob": patch
"@nextlyhq/plugin-form-builder": patch
"@nextlyhq/plugin-page-builder": patch
"@nextlyhq/plugin-seo": patch
"@nextlyhq/plugin-sdk": patch
"@nextlyhq/eslint-config": patch
"@nextlyhq/prettier-config": patch
"@nextlyhq/telemetry": patch
"@nextlyhq/tsconfig": patch
---

Adopting an existing database into migrations no longer requires guesswork.

A project built with `db:sync` has no migration snapshot, so its first
`migrate:create` diffed the config against an empty baseline and emitted
`CREATE TABLE` for every table that already existed. Once that project also had
a pending config change, the generated migration bundled "adopt what exists"
with "apply the change" — the live database matched neither side, `migrate`
refused, and none of the three recoveries it suggested could succeed.

`nextly migrate:baseline` records the live schema as the starting snapshot,
changing nothing in the database. The next `migrate:create` then emits only the
delta. This is the step Flyway (`baseline`), Django (`--fake-initial`), Alembic
(`stamp head`) and Prisma (`migrate diff --from-database`) each provide; Nextly
already shipped the second half of that flow in `migrate:resolve --applied`.

The drift message now recognises this case. When every difference is a table
that simply already exists and the migration expected to start from nothing,
`migrate` names the un-adopted database and points at the one command that fixes
it, instead of listing three recoveries that cannot work from that state.
