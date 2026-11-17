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

Migrations at start (`db.runMigrationsOnBoot`) now do at a production start what `nextly migrate`
does, and are the start's only writer of bookkeeping or schema. The step runs first, before the
start reads the registry: against an empty database it sets it up as the command does (the
ledger's record of the core schema and the registry record included) and the start goes on, and
the start then reads what it wrote, with no reload and no "run `nextly migrate`" warning for a
row the step has just written. The step now also marks the permissions an applied migration
drops and refuses a translations column that cannot hold a newly translated field, through the
same code as the command. A migration that deletes data applies only under
`NEXTLY_ACCEPT_DATA_LOSS` naming its tables, as for the command. An older build whose migrations
folder lacks a migration the database records applied writes nothing, logs a warning naming each
one, and starts, where it used to refuse to start. A failed migration's log now gives its reason.
