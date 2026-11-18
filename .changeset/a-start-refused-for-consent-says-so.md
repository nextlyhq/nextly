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

A production start that runs its own migrations (`db.runMigrationsOnBoot`) and has them refused for the data-loss consent now says so in the error it stops on. Before, a plugin left behind by the refusal stopped the start with `PLUGIN_SCHEMA_BEHIND` and "Run nextly migrate", which would be refused the same way. The error keeps its code and now lists each migration refused (a plugin's module by the name the ledger records it under, `plugin:<plugin>/<module>`), what each deletes, and the consent to give: `NEXTLY_ACCEPT_DATA_LOSS=<targets>` for the start, or `nextly migrate --accept-data-loss=<targets>`. Its context carries `reason: "data-loss-consent"`. One refusal stops the whole run, so the migration listed can be an app migration or another plugin's module. The start's log line for the refusal (`Boot migrations failed, and the app will continue: …`) ends on the same consent, where it said to run `nextly migrate`, so a start with no plugin behind, which serves on, is told it too. Nothing is deleted, as before, and a plugin behind for any other reason gets the same message as before. In the command-line rendering of a data-loss refusal, the consent now stays on the `Next:` line when the database has DDL event triggers, which the refusal tells of after it.
