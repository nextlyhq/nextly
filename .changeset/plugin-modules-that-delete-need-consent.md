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

A plugin migration module that deletes data runs only with the data-loss consent (`--accept-data-loss`, or `NEXTLY_ACCEPT_DATA_LOSS`), as an app migration file does. This holds on every road that runs a module: `nextly migrate`, the migrations a production start runs (`db.runMigrationsOnBoot`), `plugins install`, and `migrate:down --plugin` for a module's DOWN.

- A module deletes data when one of its statements for the running database drops a table or a column, or removes rows. A removal of rows that a cascading foreign key carries into another table is a deletion in that table too, so consent naming only the parent is refused, naming the other table.
- Without consent covering every deletion, the run refuses before anything changes and names the module by its ledger key (`plugin:<plugin>/<module>`) and each deletion it does not cover, with the consent that would cover it, for example `--accept-data-loss=seo__meta.summary`. No module runs, and the values and rows are kept.
- **Plugin modules that delete need consent.** A plugin release whose hand-written module drops a table or a column, or removes rows, stops `nextly migrate` and a deploy step running it until the consent names what it deletes. A production start that runs its migrations logs the refusal and then refuses to start, since the plugin's code is ahead of its tables; give the consent in `NEXTLY_ACCEPT_DATA_LOSS` for that start, or run `nextly migrate --accept-data-loss=<targets>` first.
