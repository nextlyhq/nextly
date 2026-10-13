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

A repeater or group on a table the Schema Builder creates is now stored in the
database's JSON type (`jsonb` on PostgreSQL, `json` on MySQL), as on every
code-first table. That covers Builder collections and singles, and the singles
`nextly db:sync` creates itself. They were created as `text`, while the schema
`db:sync` compares against names the JSON type, so each such table was offered
a conversion its author never asked for. Tables created from now on match.

Existing tables keep their `text` columns: this changes no stored data, and
`db:sync` still offers to convert them. That conversion succeeds when every
stored value is valid JSON. It refuses the whole apply when one is not (an
empty string, for example), leaving the column as it was. SQLite is unchanged:
it stores JSON as text either way.
