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

The CLI tells your machine from a live site by where the database is, never by `NODE_ENV` or `--mode`. A SQLite file, an in-memory SQLite database, a Unix socket, `localhost`, a loopback address and `host.docker.internal` are on this machine; every other address, a private network address and a Docker Compose service name included, is live. Every command that uses a database now starts with `● local · <target> · <dialect>` or `● LIVE database <target> · <dialect>`, still with the mode and where `DATABASE_URL` came from, and still without a user name, password or query parameter. Outside a CI or hosting build, a live database adds: "This database isn't on this machine. If it's a development copy: nextly db mark-dev". `--mode` and `NODE_ENV` still choose which environment files are read.
