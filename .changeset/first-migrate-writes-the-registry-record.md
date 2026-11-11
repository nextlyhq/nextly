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

A database's first `nextly migrate` on this release writes a registry record once, naming the newest applied app migration or the point before any, decided from the database and the migrations folder alone so a run that stopped part-way is finished by the next. Where no migration's snapshot carries the registry metadata, it applies the pending migrations, then writes the registry rows from the configuration it runs with (saying how many), adds the permissions and sets the preset grants, and writes the record with those rows and the live permissions kept as the registry baseline, all in one transaction. Where a pending migration carries the metadata, the record and the baseline (the registry as it stands) commit just before it applies. Where an applied one already carries it, the rows from its snapshot, the permissions, the grants and the record commit in one transaction before anything applies. Once the record exists, the rows come only from the migrations. A pending migration written by an earlier release's `migrate:create` is refused, naming it, when it comes after one that carries the metadata or after the record.
A `migrate:create` for a configuration declaring no collection, Single or field group now records that it declares none, so its migration applies after the registry record instead of being refused.
