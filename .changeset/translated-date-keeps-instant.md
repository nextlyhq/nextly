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

A translated date field keeps its instant on a PostgreSQL server whose time zone is not UTC. The translations table now keeps a date the way the main table does, as a plain `timestamp` holding the UTC time, and a date written in a language other than the default one is stored as that UTC time too, whatever the app server's time zone. Before, on a server not in UTC, a date moved into the translations table by turning translation on was stored shifted by the server's time zone, and a date written there while translated was shown in Nextly shifted by it.

**Compatibility:** an existing PostgreSQL database keeps its translated date columns as `timestamp with time zone` until `nextly upgrade` converts them. Run it once the new release serves every instance, in the app's time zone: it logs each column it converts and the zone it used, and a second run finds nothing. `nextly migrate` and a production start leave the columns as they are and name each one; in development the sync converts them. Each value keeps the date Nextly showed: dates written in a translation on a non-UTC PostgreSQL server before this release were shown, and are kept, shifted by the zone's offset, so check recent translated dates after upgrading. UTC servers are unaffected, and MySQL and SQLite are unchanged.
