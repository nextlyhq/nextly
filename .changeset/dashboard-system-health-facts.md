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

System health on the dashboard now answers a developer's first questions. Under one status line ("Everything is working", or how many problems need attention and things to check), it shows the Nextly version and whether it is the newest in its release channel (or "Couldn't check for updates" when the registry cannot be reached), the environment, the database and its response time, whether the database connection is encrypted, migrations, storage, the email provider and background jobs. Details opens a drawer with the Node, Next.js and React versions and each plugin's version.

Whether the connection is encrypted is read from the database session itself (PostgreSQL's `pg_stat_ssl`, MySQL's `Ssl_cipher`), not from configuration; once the session has answered, the site's own connection decides, so behind a connection pooler a plain session over the site's TLS connection counts as encrypted, and an encrypted pooler session over the site's plain connection does not. In production, an unencrypted connection to a database on another machine is a problem on the card and in Needs your attention, with a "How to fix" link to the new Encrypted connections page; a connection whose encryption could not be read is a warning, never treated as encrypted. The database adapters gain `inspectConnection()`, which answers this without throwing. System health's default width is now half the dashboard.
