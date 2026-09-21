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
"create-nextly-app": patch
"@nextlyhq/eslint-config": patch
"@nextlyhq/eslint-plugin": patch
"@nextlyhq/module-specifiers": patch
"nextly": patch
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
---

**Breaking for fresh installs.** Nextly no longer creates the `accounts` and
`sessions` tables. They came from an authentication model it no longer uses:
sessions are stateless JWTs with their own refresh-token table, and an external
identity belongs to the plugin that authenticated it.

An existing database keeps both. Dropping a table that may hold rows is the
operator's decision rather than an upgrade's, so Nextly warns once at startup,
naming each table still present and how many rows it holds, and changes
nothing. `nextly migrate` with `NEXTLY_ALLOW_CORE_DESTRUCTIVE=1` drops them;
one that still holds rows additionally needs `NEXTLY_DROP_NONEMPTY_RETIRED=1`,
because accepting a schema change is not the same decision as accepting the
loss of rows nothing can recreate.

Both names stay reserved, so a collection cannot take a name that an existing
database still has a table under.
