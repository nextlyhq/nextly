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
"@nextlyhq/plugin-accounts": patch
"@nextlyhq/plugin-commerce": patch
"@nextlyhq/plugin-form-builder": patch
"@nextlyhq/plugin-mcp": patch
"@nextlyhq/plugin-page-builder": patch
"@nextlyhq/plugin-seo": patch
"@nextlyhq/plugin-sdk": patch
"@nextlyhq/eslint-config": patch
"@nextlyhq/eslint-plugin": patch
"@nextlyhq/prettier-config": patch
"@nextlyhq/telemetry": patch
"@nextlyhq/tsconfig": patch
"@nextlyhq/builder": patch
"@nextlyhq/module-specifiers": patch
---

create-nextly-app tests a PostgreSQL or MySQL connection before it writes anything. A run without a terminal, or with `--yes`, connects with the string it was given, says "Connected" with the server's version and the database, and warns when the database already holds tables, saying whether they look like a Nextly site. When the connection fails, it says why in plain words (the server can't be reached, the login was refused, the database doesn't exist, the server's version is too old), exits with code 1 and writes nothing; no user name, password or query from the string is printed or sent. With PostgreSQL or MySQL chosen and no `--database-url`, the installer now reads `DATABASE_URL`. The installer carries the PostgreSQL and MySQL drivers for this test.
